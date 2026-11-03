import { randomUUID } from 'node:crypto';
import { audit, fail, isUuid, jobFor, notify, optionalText, requireRole, text, tx } from './helpers.js';

export function registerAdminApi(app, { pool }) {
  // Middleware to ensure all /api/admin routes require ADMIN role
  app.use('/api/admin', (req, res, next) => {
    if (!req.user || req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'เฉพาะผู้ดูแลระบบเท่านั้นที่เข้าถึงส่วนนี้ได้' } });
    }
    next();
  });

  // 1. Admin Dashboard Overview
  app.get('/api/admin/overview', async (_req, res) => {
    const counts = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM users) AS total_users,
        (SELECT count(*)::int FROM provider_profiles) AS total_providers,
        (SELECT count(*)::int FROM jobs WHERE status NOT IN ('COMPLETED', 'CANCELLED')) AS active_jobs,
        (SELECT count(*)::int FROM jobs WHERE status = 'COMPLETED' AND completed_at >= date_trunc('day', now())) AS completed_today,
        (SELECT count(*)::int FROM provider_profiles WHERE kyc_status = 'PENDING') AS pending_kyc_count,
        (SELECT count(*)::int FROM user_reports WHERE status = 'NEW') AS new_reports_count,
        (SELECT count(*)::int FROM disputes WHERE status IN ('OPEN', 'UNDER_REVIEW')) AS open_disputes_count,
        (SELECT count(*)::int FROM escrow_payments WHERE status = 'PENDING_PAYOUT') AS pending_payouts_count,
        COALESCE((SELECT sum(total_amount) FROM escrow_payments), 0)::numeric(12,2) AS total_volume,
        COALESCE((SELECT sum(platform_fee) FROM escrow_payments WHERE status = 'TRANSFERRED'), 0)::numeric(12,2) AS total_revenue
    `);

    const jobsByStatus = await pool.query(`
      SELECT status, count(*)::int AS count
      FROM jobs
      GROUP BY status
    `);

    res.json({
      data: {
        stats: counts.rows[0],
        jobsByStatus: jobsByStatus.rows
      }
    });
  });

  // 2. User Management
  app.get('/api/admin/users', async (req, res) => {
    const search = req.query.search?.trim();
    const role = req.query.role?.trim();

    let query = `
      SELECT u.id, u.email, u.role, u.display_name, u.is_active, u.is_suspended,
             u.suspension_reason, u.created_at,
             p.id AS provider_id, p.kyc_status, p.is_approved,
             (SELECT count(*)::int FROM jobs j WHERE j.customer_user_id = u.id) AS customer_jobs_count,
             (SELECT count(*)::int FROM jobs j WHERE j.assigned_provider_id = p.id) AS tech_jobs_count,
             (SELECT count(*)::int FROM user_reports r WHERE r.reported_user_id = u.id) AS reports_against_count
      FROM users u
      LEFT JOIN provider_profiles p ON p.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (u.display_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }
    if (role) {
      params.push(role);
      query += ` AND u.role = $${params.length}`;
    }

    query += ' ORDER BY u.created_at DESC LIMIT 100';

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  });

  app.get('/api/admin/users/:userId', async (req, res) => {
    if (!isUuid(req.params.userId)) fail(400, 'VALIDATION_ERROR', 'userId ไม่ถูกต้อง');
    const userRes = await pool.query(
      `SELECT u.*, p.id AS provider_id, p.kyc_status, p.is_approved, p.skills_summary,
              p.id_card_image_url, p.selfie_image_url, p.bank_name AS tech_bank_name,
              p.bank_account_number AS tech_bank_acc_num, p.bank_account_name AS tech_bank_acc_name
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.params.userId]
    );
    if (!userRes.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบผู้ใช้');

    const user = userRes.rows[0];
    delete user.password_hash;

    const jobs = await pool.query(
      `SELECT id, status, category, service_format, symptom_text, agreed_amount, created_at
       FROM jobs
       WHERE customer_user_id = $1 OR assigned_provider_id = $2
       ORDER BY created_at DESC LIMIT 20`,
      [user.id, user.provider_id ?? '00000000-0000-0000-0000-000000000000']
    );

    const reports = await pool.query(
      `SELECT r.id, r.report_type, r.reason, r.status, r.created_at, u.display_name AS reporter_name
       FROM user_reports r
       JOIN users u ON u.id = r.reporter_user_id
       WHERE r.reported_user_id = $1
       ORDER BY r.created_at DESC`,
      [user.id]
    );

    res.json({
      data: {
        user,
        jobs: jobs.rows,
        reports: reports.rows
      }
    });
  });

  app.post('/api/admin/users/:userId/suspend', async (req, res) => {
    const reason = text(req.body?.reason, 500, 'reason');
    const outcome = await tx(pool, async (client) => {
      const user = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.params.userId]);
      if (!user.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบผู้ใช้');

      await client.query(
        `UPDATE users
         SET is_suspended=true, is_active=false, suspension_reason=$2, suspended_at=now(), suspended_by_admin_id=$3
         WHERE id=$1`,
        [user.rows[0].id, reason, req.user.id]
      );

      await audit(client, req.user.id, {
        action: 'SUSPEND_USER',
        reason,
        beforeState: { is_suspended: user.rows[0].is_suspended, is_active: user.rows[0].is_active },
        afterState: { is_suspended: true, is_active: false, reason, userId: user.rows[0].id }
      });

      return { userId: user.rows[0].id, isSuspended: true, reason };
    });

    res.json({ data: outcome });
  });

  app.post('/api/admin/users/:userId/unsuspend', async (req, res) => {
    const reason = text(req.body?.reason ?? 'ปลดระงับการใช้งานโดยผู้ดูแลระบบ', 500, 'reason');
    const outcome = await tx(pool, async (client) => {
      const user = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.params.userId]);
      if (!user.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบผู้ใช้');

      await client.query(
        `UPDATE users
         SET is_suspended=false, is_active=true, suspension_reason=NULL, suspended_at=NULL, suspended_by_admin_id=NULL
         WHERE id=$1`,
        [user.rows[0].id]
      );

      await audit(client, req.user.id, {
        action: 'UNSUSPEND_USER',
        reason,
        beforeState: { is_suspended: user.rows[0].is_suspended, is_active: user.rows[0].is_active },
        afterState: { is_suspended: false, is_active: true, userId: user.rows[0].id }
      });

      return { userId: user.rows[0].id, isSuspended: false };
    });

    res.json({ data: outcome });
  });

  // 3. Technician KYC Review
  app.get('/api/admin/kyc/pending', async (req, res) => {
    const result = await pool.query(`
      SELECT p.id, p.user_id, p.display_name, p.id_card_number, p.id_card_image_url, p.selfie_image_url,
             p.bank_name, p.bank_account_number, p.bank_account_name, p.skills_summary,
             p.kyc_status, p.kyc_rejection_reason, p.is_approved, p.kyc_submitted_at, p.kyc_reviewed_at,
             u.email, u.created_at AS registered_at
      FROM provider_profiles p
      JOIN users u ON u.id = p.user_id
      WHERE p.kyc_status = 'PENDING'
      ORDER BY p.kyc_submitted_at DESC NULLS LAST
    `);
    res.json({ data: result.rows });
  });

  app.get('/api/admin/kyc', async (req, res) => {
    const status = req.query.status?.trim();
    let query = `
      SELECT p.id, p.user_id, p.display_name, p.id_card_number, p.id_card_image_url, p.selfie_image_url,
             p.bank_name, p.bank_account_number, p.bank_account_name, p.skills_summary,
             p.kyc_status, p.kyc_rejection_reason, p.is_approved, p.kyc_submitted_at, p.kyc_reviewed_at,
             u.email, u.created_at AS registered_at
      FROM provider_profiles p
      JOIN users u ON u.id = p.user_id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      params.push(status);
      query += ` AND p.kyc_status = $${params.length}`;
    }
    query += ' ORDER BY (p.kyc_status = \'PENDING\') DESC, p.kyc_submitted_at DESC NULLS LAST LIMIT 100';

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  });

  app.post('/api/admin/kyc/:providerId/review', async (req, res) => {
    const action = req.body?.action || (req.body?.status === 'APPROVED' ? 'APPROVE' : req.body?.status === 'REJECTED' ? 'REJECT' : null);
    const reason = req.body?.reason || req.body?.rejectionReason;
    if (!['APPROVE', 'REJECT'].includes(action)) {
      fail(400, 'VALIDATION_ERROR', 'action ต้องเป็น APPROVE หรือ REJECT');
    }
    if (action === 'REJECT' && (!reason || typeof reason !== 'string' || reason.trim().length === 0)) {
      fail(400, 'VALIDATION_ERROR', 'ต้องระบุเหตุผลในการปฏิเสธเอกสาร');
    }

    const outcome = await tx(pool, async (client) => {
      const provider = await client.query('SELECT * FROM provider_profiles WHERE id=$1 OR user_id=$1 FOR UPDATE', [req.params.providerId]);
      if (!provider.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบโปรไฟล์ช่าง');

      const isApprove = action === 'APPROVE';
      const kycStatus = isApprove ? 'APPROVED' : 'REJECTED';
      const rejectionReason = isApprove ? null : reason.trim();

      await client.query(
        `UPDATE provider_profiles
         SET is_approved=$2, is_available=true, kyc_status=$3, kyc_rejection_reason=$4,
             kyc_reviewed_at=now(), kyc_reviewed_by_admin_id=$5, updated_at=now()
         WHERE id=$1`,
        [provider.rows[0].id, isApprove, kycStatus, rejectionReason, req.user.id]
      );

      await audit(client, req.user.id, {
        action: isApprove ? 'APPROVE_KYC' : 'REJECT_KYC',
        reason: rejectionReason ?? 'เอกสารถูกต้องครบถ้วน อนุมัติการยืนยันตัวตน',
        beforeState: { kyc_status: provider.rows[0].kyc_status, is_approved: provider.rows[0].is_approved },
        afterState: { providerId: provider.rows[0].id, kyc_status: kycStatus, is_approved: isApprove }
      });

      // Notify technician
      await notify(
        client,
        provider.rows[0].user_id,
        null,
        `kyc:${provider.rows[0].id}:${Date.now()}`,
        'KYC_RESULT',
        isApprove ? 'การยืนยันตัวตน (KYC) ผ่านการอนุมัติแล้ว' : 'การยืนยันตัวตน (KYC) ไม่ผ่านการอนุมัติ',
        isApprove ? 'คุณได้รับการอนุมัติเป็นช่างใน Fixtech แล้ว สามารถส่งใบเสนอราคาและรับงานได้ทันที' : `เหตุผล: ${rejectionReason}`
      );

      return {
        providerId: provider.rows[0].id,
        isApproved: isApprove,
        kycStatus,
        rejectionReason
      };
    });

    res.json({ data: outcome });
  });

  // 4. Job Management & Hiding
  app.get('/api/admin/jobs', async (req, res) => {
    const { status, deviceType, district } = req.query;
    let query = `
      SELECT j.id, j.status, j.category, j.service_format, j.device_type, j.device_brand_or_model,
             j.district_code, j.symptom_text, j.agreed_amount, j.is_hidden, j.hidden_reason, j.created_at,
             u.display_name AS customer_name, u.email AS customer_email,
             p.display_name AS provider_name,
             (SELECT count(*)::int FROM offers o WHERE o.job_id = j.id) AS quotes_count
      FROM jobs j
      JOIN users u ON u.id = j.customer_user_id
      LEFT JOIN provider_profiles p ON p.id = j.assigned_provider_id
      WHERE 1=1
    `;
    const params = [];
    if (status) { params.push(status); query += ` AND j.status = $${params.length}`; }
    if (deviceType) { params.push(deviceType); query += ` AND j.device_type = $${params.length}`; }
    if (district) { params.push(district); query += ` AND j.district_code = $${params.length}`; }

    query += ' ORDER BY j.created_at DESC LIMIT 100';

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  });

  app.post('/api/admin/jobs/:jobId/hide', async (req, res) => {
    if (req.body?.hide === false) {
      const outcome = await tx(pool, async (client) => {
        const job = await jobFor(client, req.params.jobId, { lock: true });
        await client.query(
          `UPDATE jobs
           SET is_hidden=false, hidden_reason=NULL, hidden_at=NULL, hidden_by_admin_id=NULL, updated_at=now()
           WHERE id=$1`,
          [job.id]
        );
        await audit(client, req.user.id, {
          jobId: job.id,
          action: 'UNHIDE_JOB_POST',
          reason: 'ยกเลิกการซ่อนโพสต์โดยผู้ดูแลระบบ',
          beforeState: { is_hidden: job.is_hidden },
          afterState: { is_hidden: false }
        });
        return { jobId: job.id, isHidden: false };
      });
      return res.json({ data: outcome });
    }

    const reason = text(req.body?.reason, 500, 'reason');
    const outcome = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true });
      await client.query(
        `UPDATE jobs
         SET is_hidden=true, hidden_reason=$2, hidden_at=now(), hidden_by_admin_id=$3, updated_at=now()
         WHERE id=$1`,
        [job.id, reason, req.user.id]
      );

      await audit(client, req.user.id, {
        jobId: job.id,
        action: 'HIDE_JOB_POST',
        reason,
        beforeState: { is_hidden: job.is_hidden },
        afterState: { is_hidden: true, hidden_reason: reason }
      });

      return { jobId: job.id, isHidden: true, reason };
    });

    res.json({ data: outcome });
  });

  app.post('/api/admin/jobs/:jobId/unhide', async (req, res) => {
    const outcome = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true });
      await client.query(
        `UPDATE jobs
         SET is_hidden=false, hidden_reason=NULL, hidden_at=NULL, hidden_by_admin_id=NULL, updated_at=now()
         WHERE id=$1`,
        [job.id]
      );

      await audit(client, req.user.id, {
        jobId: job.id,
        action: 'UNHIDE_JOB_POST',
        reason: 'ยกเลิกการซ่อนโพสต์โดยผู้ดูแลระบบ',
        beforeState: { is_hidden: job.is_hidden },
        afterState: { is_hidden: false }
      });

      return { jobId: job.id, isHidden: false };
    });

    res.json({ data: outcome });
  });

  // 5. User Reports & Chat History Review
  app.get('/api/admin/reports', async (req, res) => {
    const status = req.query.status?.trim();
    let query = `
      SELECT r.id, r.reporter_user_id, r.reported_user_id, r.job_id, r.report_type,
             r.reason, r.status, r.admin_notes, r.admin_response, r.created_at, r.resolved_at,
             u1.display_name AS reporter_name, u1.email AS reporter_email,
             u2.display_name AS reported_name, u2.email AS reported_email
      FROM user_reports r
      JOIN users u1 ON u1.id = r.reporter_user_id
      LEFT JOIN users u2 ON u2.id = r.reported_user_id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      params.push(status);
      query += ` AND r.status = $${params.length}`;
    }
    query += ' ORDER BY (r.status = \'NEW\') DESC, r.created_at DESC LIMIT 100';

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  });

  app.get('/api/admin/reports/:reportId', async (req, res) => {
    if (!isUuid(req.params.reportId)) fail(400, 'VALIDATION_ERROR', 'reportId ไม่ถูกต้อง');
    const reportRes = await pool.query(
      `SELECT r.*,
              u1.display_name AS reporter_name, u1.email AS reporter_email,
              u2.display_name AS reported_name, u2.email AS reported_email,
              j.symptom_text, j.status AS job_status
       FROM user_reports r
       JOIN users u1 ON u1.id = r.reporter_user_id
       LEFT JOIN users u2 ON u2.id = r.reported_user_id
       LEFT JOIN jobs j ON j.id = r.job_id
       WHERE r.id = $1`,
      [req.params.reportId]
    );
    if (!reportRes.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบรายงานนี้');
    const report = reportRes.rows[0];

    let messages = [];
    if (report.job_id) {
      const msgRes = await pool.query(
        `SELECT m.id, m.sender_user_id, m.body, m.created_at, u.display_name AS sender_name, u.role AS sender_role
         FROM job_messages m
         JOIN users u ON u.id = m.sender_user_id
         WHERE m.job_id = $1
         ORDER BY m.created_at ASC`,
        [report.job_id]
      );
      messages = msgRes.rows;
    }

    res.json({ data: { report, messages } });
  });

  app.post('/api/admin/reports/:reportId/respond', async (req, res) => {
    const response = text(req.body?.response, 2000, 'response');
    const outcome = await tx(pool, async (client) => {
      const report = await client.query('SELECT * FROM user_reports WHERE id=$1 FOR UPDATE', [req.params.reportId]);
      if (!report.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบรายงานนี้');

      await client.query(
        `UPDATE user_reports
         SET admin_response=$2, status='INVESTIGATING', resolved_by_admin_user_id=$3
         WHERE id=$1`,
        [report.rows[0].id, response, req.user.id]
      );

      await notify(
        client,
        report.rows[0].reporter_user_id,
        report.rows[0].job_id,
        `report:${report.rows[0].id}:reply`,
        'ADMIN_REPLY',
        'เจ้าหน้าที่ตอบกลับเรื่องที่คุณแจ้ง',
        response
      );

      return { reportId: report.rows[0].id, adminResponse: response };
    });

    res.json({ data: outcome });
  });

  app.post('/api/admin/reports/:reportId/resolve', async (req, res) => {
    const { action, notes } = req.body ?? {};
    const validNotes = text(notes ?? 'ปิดเรื่องโดยผู้ดูแลระบบ', 1000, 'notes');

    const outcome = await tx(pool, async (client) => {
      const report = await client.query('SELECT * FROM user_reports WHERE id=$1 FOR UPDATE', [req.params.reportId]);
      if (!report.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบรายงานนี้');

      await client.query(
        `UPDATE user_reports
         SET status='CLOSED', admin_notes=$2, resolved_by_admin_user_id=$3, resolved_at=now()
         WHERE id=$1`,
        [report.rows[0].id, validNotes, req.user.id]
      );

      await audit(client, req.user.id, {
        action: `RESOLVE_REPORT_${action ?? 'CLOSED'}`,
        reason: validNotes,
        afterState: { reportId: report.rows[0].id, action, notes: validNotes }
      });

      return { reportId: report.rows[0].id, status: 'CLOSED', notes: validNotes };
    });

    res.json({ data: outcome });
  });

  // 6. Fastwork Dispute Resolution
  app.post('/api/admin/disputes/:disputeId/fastwork-resolve', async (req, res) => {
    const { outcome, resolution, refundAmount } = req.body ?? {};
    if (!['COMPLETE_AND_PAY', 'REWORK', 'REFUND_FULL', 'REFUND_PARTIAL'].includes(outcome)) {
      fail(400, 'VALIDATION_ERROR', 'ผลการตัดสินไม่ถูกต้อง (COMPLETE_AND_PAY, REWORK, REFUND_FULL, REFUND_PARTIAL)');
    }
    const reasonText = text(resolution, 2000, 'resolution');

    const result = await tx(pool, async (client) => {
      const dispute = await client.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE', [req.params.disputeId]);
      if (!dispute.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบข้อพิพาท');

      const job = await jobFor(client, dispute.rows[0].job_id, { lock: true });
      const escrowRes = await client.query(
        'SELECT * FROM escrow_payments WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
        [job.id]
      );
      const escrow = escrowRes.rows[0];

      if (outcome === 'COMPLETE_AND_PAY') {
        // Mark job completed, release escrow to PENDING_PAYOUT
        if (escrow) {
          await client.query("UPDATE escrow_payments SET status='PENDING_PAYOUT', updated_at=now() WHERE id=$1", [escrow.id]);
        }
        await client.query("UPDATE jobs SET status='COMPLETED', updated_at=now() WHERE id=$1", [job.id]);
      } else if (outcome === 'REWORK') {
        // Return job to technician
        if (escrow) {
          await client.query("UPDATE escrow_payments SET status='HOLDING', updated_at=now() WHERE id=$1", [escrow.id]);
        }
        await client.query("UPDATE jobs SET status='IN_PROGRESS', updated_at=now() WHERE id=$1", [job.id]);
      } else if (outcome === 'REFUND_FULL') {
        if (escrow) {
          await client.query(
            `UPDATE escrow_payments
             SET status='REFUNDED_FULL', refund_amount=total_amount, refund_reason=$2, refunded_at=now(), updated_at=now()
             WHERE id=$1`,
            [escrow.id, reasonText]
          );
        }
        await client.query(
          "UPDATE jobs SET status='CANCELLED', cancel_reason=$2, cancelled_at=now(), updated_at=now() WHERE id=$1",
          [job.id, `ข้อพิพาทยกเลิกงานและคืนเงินเต็มจำนวน: ${reasonText}`]
        );
      } else if (outcome === 'REFUND_PARTIAL') {
        const numRefund = Number(refundAmount);
        if (isNaN(numRefund) || numRefund <= 0 || (escrow && numRefund > Number(escrow.total_amount))) {
          fail(400, 'VALIDATION_ERROR', 'ยอดเงินคืนต้องมากกว่า 0 และไม่เกินยอดชำระทั้งหมด');
        }
        if (escrow) {
          const netRemaining = Number(escrow.total_amount) - numRefund;
          await client.query(
            `UPDATE escrow_payments
             SET status='REFUNDED_PARTIAL', refund_amount=$2, net_provider_amount=$3, refund_reason=$4, refunded_at=now(), updated_at=now()
             WHERE id=$1`,
            [escrow.id, numRefund, netRemaining, reasonText]
          );
        }
        await client.query("UPDATE jobs SET status='COMPLETED', updated_at=now() WHERE id=$1", [job.id]);
      }

      await client.query(
        `UPDATE disputes
         SET status='RESOLVED', resolution=$2, resolved_by_admin_user_id=$3, resolved_at=now()
         WHERE id=$1`,
        [dispute.rows[0].id, `[${outcome}] ${reasonText}`, req.user.id]
      );

      await audit(client, req.user.id, {
        jobId: job.id,
        disputeId: dispute.rows[0].id,
        action: `FASTWORK_RESOLVE_DISPUTE_${outcome}`,
        reason: reasonText,
        afterState: { outcome, resolution: reasonText, refundAmount }
      });

      return {
        disputeId: dispute.rows[0].id,
        jobId: job.id,
        outcome,
        resolution: reasonText
      };
    });

    res.json({ data: result });
  });

  // 7. Finance & Payouts Management
  app.get('/api/admin/finance/payouts', async (_req, res) => {
    const pendingPayouts = await pool.query(`
      SELECT e.id, e.job_id, e.total_amount AS gross_amount, e.platform_fee, e.platform_fee_percent,
             e.net_provider_amount, e.currency, e.status, e.created_at,
             p.id AS provider_id, p.display_name AS provider_name, p.bank_name, p.bank_account_number, p.bank_account_name,
             u.display_name AS customer_name
      FROM escrow_payments e
      JOIN provider_profiles p ON p.id = e.provider_id
      JOIN users u ON u.id = e.customer_user_id
      WHERE e.status = 'PENDING_PAYOUT'
      ORDER BY e.created_at ASC
    `);
    res.json({ data: pendingPayouts.rows });
  });

  app.get('/api/admin/finance/summary', async (_req, res) => {
    // 1. All customer payments
    const payments = await pool.query(`
      SELECT e.id, e.job_id, e.total_amount, e.platform_fee, e.net_provider_amount, e.currency,
             e.status, e.transfer_slip_url, e.created_at, e.transferred_at, e.refund_amount,
             u.display_name AS customer_name, u.email AS customer_email,
             p.display_name AS provider_name
      FROM escrow_payments e
      JOIN users u ON u.id = e.customer_user_id
      LEFT JOIN provider_profiles p ON p.id = e.provider_id
      ORDER BY e.created_at DESC LIMIT 200
    `);

    // 2. Pending payouts (Customer completed & waiting for admin transfer)
    const pendingPayouts = await pool.query(`
      SELECT e.id, e.job_id, e.total_amount, e.platform_fee, e.net_provider_amount, e.currency,
             e.status, e.created_at,
             p.id AS provider_id, p.display_name AS provider_name, p.bank_name, p.bank_account_number, p.bank_account_name,
             u.display_name AS customer_name
      FROM escrow_payments e
      JOIN provider_profiles p ON p.id = e.provider_id
      JOIN users u ON u.id = e.customer_user_id
      WHERE e.status = 'PENDING_PAYOUT'
      ORDER BY e.created_at ASC
    `);

    res.json({
      data: {
        payments: payments.rows,
        pendingPayouts: pendingPayouts.rows
      }
    });
  });

  app.post('/api/admin/finance/payouts/:escrowId/confirm', async (req, res) => {
    const slipUrl = optionalText(req.body?.transferSlipUrl, 500, 'transferSlipUrl') ?? '/uploads/default-transfer-slip.png';
    const note = optionalText(req.body?.note, 500, 'note') ?? 'ยืนยันการโอนเงินให้ช่างสำเร็จ';

    const outcome = await tx(pool, async (client) => {
      const escrow = await client.query('SELECT * FROM escrow_payments WHERE id=$1 FOR UPDATE', [req.params.escrowId]);
      if (!escrow.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบรายการ Escrow นี้');

      await client.query(
        `UPDATE escrow_payments
         SET status='TRANSFERRED', transfer_slip_url=$2, transferred_at=now(), transferred_by_admin_id=$3, updated_at=now()
         WHERE id=$1`,
        [escrow.rows[0].id, slipUrl, req.user.id]
      );

      await audit(client, req.user.id, {
        jobId: escrow.rows[0].job_id,
        action: 'CONFIRM_TECHNICIAN_PAYOUT',
        reason: `${note} (ยอด ${escrow.rows[0].net_provider_amount} บาท)`,
        afterState: { escrowId: escrow.rows[0].id, slipUrl, netAmount: escrow.rows[0].net_provider_amount }
      });

      // Notify technician
      const providerUser = await client.query('SELECT user_id FROM provider_profiles WHERE id=$1', [escrow.rows[0].provider_id]);
      if (providerUser.rowCount) {
        await notify(
          client,
          providerUser.rows[0].user_id,
          escrow.rows[0].job_id,
          `payout:${escrow.rows[0].id}:${Date.now()}`,
          'PAYOUT_TRANSFERRED',
          'โอนเงินค่าจ้างเข้าบัญชีของคุณแล้ว',
          `ยอดเงินสุทธิ ${Number(escrow.rows[0].net_provider_amount).toLocaleString()} บาท ถูกโอนเข้าบัญชีธนาคารเรียบร้อยแล้ว`
        );
      }

      return {
        escrowId: escrow.rows[0].id,
        status: 'TRANSFERRED',
        transferredAmount: escrow.rows[0].net_provider_amount,
        slipUrl
      };
    });

    res.json({ data: outcome });
  });

  app.get('/api/admin/finance/export', async (req, res) => {
    const rows = await pool.query(`
      SELECT e.id, e.job_id, u.display_name AS customer_name, p.display_name AS provider_name,
             e.total_amount, e.platform_fee_percent, e.platform_fee, e.net_provider_amount,
             e.status, e.created_at, e.transferred_at
      FROM escrow_payments e
      JOIN users u ON u.id = e.customer_user_id
      LEFT JOIN provider_profiles p ON p.id = e.provider_id
      ORDER BY e.created_at DESC
    `);

    // Output CSV
    const headers = ['Escrow ID', 'Job ID', 'Customer', 'Technician', 'Total (THB)', 'Fee %', 'Fee (THB)', 'Net Provider (THB)', 'Status', 'Paid At', 'Transferred At'];
    const csvLines = [headers.join(',')];

    for (const r of rows.rows) {
      csvLines.push([
        `"${r.id}"`, `"${r.job_id}"`, `"${r.customer_name}"`, `"${r.provider_name ?? ''}"`,
        r.total_amount, r.platform_fee_percent, r.platform_fee, r.net_provider_amount,
        r.status, `"${r.created_at?.toISOString() ?? ''}"`, `"${r.transferred_at?.toISOString() ?? ''}"`
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fixtech-finance-export.csv"');
    res.send(csvLines.join('\n'));
  });

  app.get('/api/admin/finance/export.csv', async (req, res) => {
    const rows = await pool.query(`
      SELECT e.id, e.job_id, u.display_name AS customer_name, p.display_name AS provider_name,
             e.total_amount, e.platform_fee_percent, e.platform_fee, e.net_provider_amount,
             e.status, e.created_at, e.transferred_at
      FROM escrow_payments e
      JOIN users u ON u.id = e.customer_user_id
      LEFT JOIN provider_profiles p ON p.id = e.provider_id
      ORDER BY e.created_at DESC
    `);

    const headers = ['Escrow ID', 'Job ID', 'Customer', 'Technician', 'Total (THB)', 'Fee %', 'Fee (THB)', 'Net Provider (THB)', 'Status', 'Paid At', 'Transferred At'];
    const csvLines = [headers.join(',')];

    for (const r of rows.rows) {
      csvLines.push([
        `"${r.id}"`, `"${r.job_id}"`, `"${r.customer_name}"`, `"${r.provider_name ?? ''}"`,
        r.total_amount, r.platform_fee_percent, r.platform_fee, r.net_provider_amount,
        r.status, `"${r.created_at?.toISOString() ?? ''}"`, `"${r.transferred_at?.toISOString() ?? ''}"`
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fixtech-finance-export.csv"');
    res.send(csvLines.join('\n'));
  });

  // 8. System Settings
  app.get('/api/admin/settings', async (_req, res) => {
    const rows = await pool.query('SELECT key, value, description, updated_at FROM system_settings');
    const settingsMap = {};
    for (const r of rows.rows) {
      settingsMap[r.key] = { value: r.value, description: r.description, updatedAt: r.updated_at };
    }
    const feeVal = settingsMap['platform_fee_percent']?.value;
    const annVal = settingsMap['system_announcement']?.value;
    const platformFeePercent = typeof feeVal?.percent === 'number' ? feeVal.percent : (Number(feeVal) || 10);
    const systemAnnouncement = typeof annVal?.text === 'string' ? annVal.text : (typeof annVal === 'string' ? annVal : '');

    res.json({
      data: {
        ...settingsMap,
        platformFeePercent,
        systemAnnouncement
      }
    });
  });

  app.post('/api/admin/settings', async (req, res) => {
    const { platformFeePercent, systemAnnouncement, key, value, description } = req.body ?? {};

    if (platformFeePercent !== undefined) {
      await pool.query(
        `INSERT INTO system_settings(key, value, description, updated_at, updated_by_admin_user_id)
         VALUES('platform_fee_percent', $1, 'อัตราค่าธรรมเนียมแพลตฟอร์ม', now(), $2)
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [JSON.stringify({ percent: Number(platformFeePercent) }), req.user.id]
      );
    }
    if (systemAnnouncement !== undefined) {
      await pool.query(
        `INSERT INTO system_settings(key, value, description, updated_at, updated_by_admin_user_id)
         VALUES('system_announcement', $1, 'ประกาศระบบ', now(), $2)
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [JSON.stringify({ text: String(systemAnnouncement) }), req.user.id]
      );
    }

    if (key) {
      await pool.query(
        `INSERT INTO system_settings(key, value, description, updated_at, updated_by_admin_user_id)
         VALUES($1, $2, $3, now(), $4)
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
        [key, JSON.stringify(value ?? {}), description ?? null, req.user.id]
      );
    }

    res.json({ data: { success: true } });
  });

  app.put('/api/admin/settings', async (req, res) => {
    const { key, value, description } = req.body ?? {};
    if (!key || typeof key !== 'string') fail(400, 'VALIDATION_ERROR', 'key จำเป็นต้องระบุ');

    await pool.query(
      `INSERT INTO system_settings(key, value, description, updated_at, updated_by_admin_user_id)
       VALUES($1, $2, $3, now(), $4)
       ON CONFLICT (key) DO UPDATE
       SET value=EXCLUDED.value, description=COALESCE(EXCLUDED.description, system_settings.description),
           updated_at=now(), updated_by_admin_user_id=EXCLUDED.updated_by_admin_user_id`,
      [key, JSON.stringify(value ?? {}), description ?? null, req.user.id]
    );

    await audit(pool, req.user.id, {
      action: 'UPDATE_SYSTEM_SETTINGS',
      reason: `อัปเดตการตั้งค่าระบบ: ${key}`,
      afterState: { key, value }
    });

    res.json({ data: { key, value, success: true } });
  });

  // 9. Admin Audit Logs
  app.get('/api/admin/audit-logs', async (req, res) => {
    const logs = await pool.query(`
      SELECT l.id, l.actor_user_id, l.job_id, l.dispute_id, l.action, l.reason,
             l.before_state, l.after_state, l.created_at,
             u.display_name AS actor_name, u.email AS actor_email
      FROM admin_audit_logs l
      JOIN users u ON u.id = l.actor_user_id
      ORDER BY l.created_at DESC
      LIMIT 100
    `);

    res.json({ data: logs.rows });
  });
}
