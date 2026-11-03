import { randomUUID } from 'node:crypto';
import { fail, isUuid, jobFor, notify, optionalText, requireRole, text, tx } from './helpers.js';

export function registerFastworkApi(app, { pool }) {
  // 1. User Profile & Bank / ID details
  app.get('/api/users/profile', async (req, res) => {
    if (!req.user) fail(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
    const userRes = await pool.query(
      `SELECT u.id, u.email, u.role, u.display_name, u.is_active, u.is_suspended,
              u.id_card_number, u.bank_name, u.bank_account_number, u.bank_account_name,
              p.id AS provider_id, p.kyc_status, p.is_approved, p.skills_summary,
              p.id_card_image_url, p.selfie_image_url
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!userRes.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');
    res.json({ data: userRes.rows[0] });
  });

  app.patch('/api/users/profile', async (req, res) => {
    if (!req.user) fail(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
    const { displayName, idCardNumber, bankName, bankAccountNumber, bankAccountName } = req.body ?? {};

    const updated = await tx(pool, async (client) => {
      const user = await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
      if (!user.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');

      const nextDisplayName = displayName ? text(displayName, 100, 'displayName') : user.rows[0].display_name;
      const nextIdCard = idCardNumber !== undefined ? optionalText(idCardNumber, 20, 'idCardNumber') : user.rows[0].id_card_number;
      const nextBankName = bankName !== undefined ? optionalText(bankName, 100, 'bankName') : user.rows[0].bank_name;
      const nextBankAccNum = bankAccountNumber !== undefined ? optionalText(bankAccountNumber, 50, 'bankAccountNumber') : user.rows[0].bank_account_number;
      const nextBankAccName = bankAccountName !== undefined ? optionalText(bankAccountName, 150, 'bankAccountName') : user.rows[0].bank_account_name;

      await client.query(
        `UPDATE users
         SET display_name=$2, id_card_number=$3, bank_name=$4, bank_account_number=$5, bank_account_name=$6, updated_at=now()
         WHERE id=$1`,
        [req.user.id, nextDisplayName, nextIdCard, nextBankName, nextBankAccNum, nextBankAccName]
      );

      // If user also has a provider profile, keep bank details synced
      if (req.user.role === 'TECHNICIAN') {
        await client.query(
          `UPDATE provider_profiles
           SET bank_name=COALESCE($2, bank_name),
               bank_account_number=COALESCE($3, bank_account_number),
               bank_account_name=COALESCE($4, bank_account_name),
               id_card_number=COALESCE($5, id_card_number),
               updated_at=now()
           WHERE user_id=$1`,
          [req.user.id, nextBankName, nextBankAccNum, nextBankAccName, nextIdCard]
        );
      }

      return {
        id: req.user.id,
        displayName: nextDisplayName,
        idCardNumber: nextIdCard,
        bankName: nextBankName,
        bankAccountNumber: nextBankAccNum,
        bankAccountName: nextBankAccName
      };
    });

    res.json({ data: updated });
  });

  // 2. Technician KYC Submission
  app.get('/api/technician/kyc', async (req, res) => {
    requireRole(req.user, ['TECHNICIAN']);
    const result = await pool.query(
      `SELECT id, user_id, display_name, id_card_number, id_card_image_url, selfie_image_url,
              bank_name, bank_account_number, bank_account_name, skills_summary,
              kyc_status, kyc_rejection_reason, is_approved, kyc_submitted_at, kyc_reviewed_at
       FROM provider_profiles WHERE user_id=$1`,
      [req.user.id]
    );
    if (!result.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบโปรไฟล์ช่าง');
    res.json({ data: result.rows[0] });
  });

  app.post('/api/technician/kyc', async (req, res) => {
    requireRole(req.user, ['TECHNICIAN']);
    const { idCardNumber, idCardImageUrl, selfieImageUrl, bankName, bankAccountNumber, bankAccountName, skillsSummary } = req.body ?? {};

    const validIdCard = text(idCardNumber, 20, 'idCardNumber');
    const validBankName = text(bankName, 100, 'bankName');
    const validBankAccNum = text(bankAccountNumber, 50, 'bankAccountNumber');
    const validBankAccName = text(bankAccountName, 150, 'bankAccountName');
    const skills = optionalText(skillsSummary, 2000, 'skillsSummary') ?? 'ฮาร์ดแวร์และซอฟต์แวร์คอมพิวเตอร์';
    const idCardUrl = optionalText(idCardImageUrl, 500, 'idCardImageUrl') ?? '/uploads/default-idcard.png';
    const selfieUrl = optionalText(selfieImageUrl, 500, 'selfieImageUrl') ?? '/uploads/default-selfie.png';

    const updated = await tx(pool, async (client) => {
      const provider = await client.query('SELECT * FROM provider_profiles WHERE user_id=$1 FOR UPDATE', [req.user.id]);
      if (!provider.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบโปรไฟล์ช่าง');

      await client.query(
        `UPDATE provider_profiles
         SET id_card_number=$2, id_card_image_url=$3, selfie_image_url=$4,
             bank_name=$5, bank_account_number=$6, bank_account_name=$7,
             skills_summary=$8, kyc_status='PENDING', kyc_rejection_reason=NULL,
             kyc_submitted_at=now(), updated_at=now()
         WHERE user_id=$1`,
        [req.user.id, validIdCard, idCardUrl, selfieUrl, validBankName, validBankAccNum, validBankAccName, skills]
      );

      // Keep user personal table in sync
      await client.query(
        `UPDATE users
         SET id_card_number=$2, bank_name=$3, bank_account_number=$4, bank_account_name=$5, updated_at=now()
         WHERE id=$1`,
        [req.user.id, validIdCard, validBankName, validBankAccNum, validBankAccName]
      );

      return {
        id: provider.rows[0].id,
        kycStatus: 'PENDING',
        message: 'ส่งเอกสารยืนยันตัวตนเรียบร้อยแล้ว รอผู้ดูแลระบบตรวจสอบ'
      };
    });

    res.json({ data: updated });
  });

  // 3. Technician Job Board & Dashboard
  app.get('/api/technician/jobs', async (req, res) => {
    requireRole(req.user, ['TECHNICIAN', 'ADMIN']);
    const district = req.query.district;
    const category = req.query.category;

    let query = `
      SELECT j.id, j.district_code, j.category, j.service_format, j.status,
             j.device_type, j.device_brand_or_model, j.power_fan_beep_status, j.screen_cable_status,
             j.pre_incident_event, j.battery_charging_status, j.chassis_screen_keyboard_status,
             j.damage_history, j.other_symptoms, j.symptom_text, j.ai_summary, j.created_at,
             d.name AS district_name, u.display_name AS customer_name,
             (SELECT count(*)::int FROM offers o WHERE o.job_id = j.id) AS quotation_count,
             (SELECT id FROM offers o WHERE o.job_id = j.id AND o.provider_id = $1 LIMIT 1) AS my_offer_id,
             (SELECT status FROM offers o WHERE o.job_id = j.id AND o.provider_id = $1 LIMIT 1) AS my_offer_status,
             (SELECT amount FROM offers o WHERE o.job_id = j.id AND o.provider_id = $1 LIMIT 1) AS my_offer_amount
      FROM jobs j
      JOIN districts d ON d.code = j.district_code
      JOIN users u ON u.id = j.customer_user_id
      WHERE j.is_hidden = false
        AND j.status IN ('POSTED', 'WAITING_FOR_SELECTION', 'DRAFT', 'WAITING_FOR_APPOINTMENT', 'SCHEDULED', 'IN_PROGRESS')
    `;

    const params = [req.user.providerId ?? null];
    let pIdx = 2;

    if (district) {
      query += ` AND j.district_code = $${pIdx++}`;
      params.push(district);
    }
    if (category) {
      query += ` AND j.category = $${pIdx++}`;
      params.push(category);
    }

    query += ' ORDER BY j.created_at DESC LIMIT 100';

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  });

  app.get('/api/technician/my-offers', async (req, res) => {
    requireRole(req.user, ['TECHNICIAN']);
    const result = await pool.query(
      `SELECT o.id AS offer_id, o.amount, o.labor_fee, o.transport_fee, o.items_detail, o.scope_summary, o.status AS offer_status, o.created_at AS offered_at,
              j.id AS job_id, j.status AS job_status, j.category, j.service_format, j.symptom_text, j.device_type, j.device_brand_or_model,
              d.name AS district_name, u.display_name AS customer_name
       FROM offers o
       JOIN jobs j ON j.id = o.job_id
       JOIN districts d ON d.code = j.district_code
       JOIN users u ON u.id = j.customer_user_id
       WHERE o.provider_id = $1
       ORDER BY o.created_at DESC`,
      [req.user.providerId]
    );
    res.json({ data: result.rows });
  });

  app.get('/api/technician/dashboard', async (req, res) => {
    requireRole(req.user, ['TECHNICIAN']);
    const providerId = req.user.providerId;

    const stats = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN e.status = 'TRANSFERRED' THEN e.net_provider_amount ELSE 0 END), 0) AS total_earned,
         COALESCE(SUM(CASE WHEN e.status = 'PENDING_PAYOUT' THEN e.net_provider_amount ELSE 0 END), 0) AS pending_payout,
         COALESCE(SUM(CASE WHEN e.status = 'HOLDING' THEN e.net_provider_amount ELSE 0 END), 0) AS in_escrow,
         COALESCE(SUM(CASE WHEN e.status = 'TRANSFERRED' AND e.transferred_at >= date_trunc('month', now()) THEN e.net_provider_amount ELSE 0 END), 0) AS month_earned,
         COALESCE(SUM(CASE WHEN e.status = 'TRANSFERRED' AND e.transferred_at >= date_trunc('day', now()) THEN e.net_provider_amount ELSE 0 END), 0) AS today_earned,
         COUNT(DISTINCT CASE WHEN j.status = 'COMPLETED' THEN j.id END)::int AS completed_jobs_count,
         COUNT(DISTINCT CASE WHEN j.status IN ('SCHEDULED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER_CONFIRMATION') THEN j.id END)::int AS active_jobs_count
       FROM provider_profiles p
       LEFT JOIN jobs j ON j.assigned_provider_id = p.id
       LEFT JOIN escrow_payments e ON e.provider_id = p.id
       WHERE p.id = $1`,
      [providerId]
    );

    res.json({ data: stats.rows[0] });
  });

  // 4. Fastwork Quotation Creation & Inspection
  app.post('/api/jobs/:jobId/quotations', async (req, res) => {
    requireRole(req.user, ['TECHNICIAN']);
    const { laborFee, transportFee, itemsDetail, scopeSummary } = req.body ?? {};

    const numLabor = Number(laborFee);
    const numTransport = Number(transportFee ?? 0);
    if (isNaN(numLabor) || numLabor < 0) fail(400, 'VALIDATION_ERROR', 'ค่าแรงต้องเป็นตัวเลขที่มากกว่าหรือเท่ากับ 0');
    if (isNaN(numTransport) || numTransport < 0) fail(400, 'VALIDATION_ERROR', 'ค่าเดินทางต้องเป็นตัวเลขที่มากกว่าหรือเท่ากับ 0');

    const totalAmount = numLabor + numTransport;
    if (totalAmount <= 0) fail(400, 'VALIDATION_ERROR', 'ยอดรวมใบเสนอราคาต้องมากกว่า 0');

    const scope = text(scopeSummary ?? 'บริการซ่อมตามอาการที่แจ้ง', 500, 'scopeSummary');

    const outcome = await tx(pool, async (client) => {
      // 1. Check Technician KYC Status: Must be APPROVED!
      const provider = await client.query(
        'SELECT id, is_approved, kyc_status, display_name FROM provider_profiles WHERE id=$1 FOR UPDATE',
        [req.user.providerId]
      );
      if (!provider.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบโปรไฟล์ช่าง');
      if (!provider.rows[0].is_approved && provider.rows[0].kyc_status !== 'APPROVED') {
        fail(403, 'KYC_REQUIRED', 'ช่างที่ยังไม่ผ่านการอนุมัติยืนยันตัวตน (KYC) จะยังไม่สามารถเสนองานได้');
      }

      // 2. Check Job status
      const job = await jobFor(client, req.params.jobId, { lock: true });
      if (['COMPLETED', 'CANCELLED'].includes(job.status)) {
        fail(409, 'INVALID_JOB_STATE', 'งานนี้เสร็จสิ้นหรือถูกยกเลิกแล้ว ไม่สามารถเสนอราคาได้');
      }

      // 3. Upsert quotation in offers
      const offerId = randomUUID();
      const existingOffer = await client.query(
        'SELECT id FROM offers WHERE job_id=$1 AND provider_id=$2',
        [job.id, provider.rows[0].id]
      );

      if (existingOffer.rowCount) {
        await client.query(
          `UPDATE offers
           SET amount=$3, labor_fee=$4, transport_fee=$5, items_detail=$6, scope_summary=$7, status='AVAILABLE'
           WHERE id=$1 AND job_id=$2`,
          [existingOffer.rows[0].id, job.id, totalAmount, numLabor, numTransport, JSON.stringify(itemsDetail ?? []), scope]
        );
      } else {
        await client.query(
          `INSERT INTO offers(id, job_id, provider_id, scope_summary, amount, labor_fee, transport_fee, items_detail, status)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'AVAILABLE')`,
          [offerId, job.id, provider.rows[0].id, scope, totalAmount, numLabor, numTransport, JSON.stringify(itemsDetail ?? [])]
        );
      }

      // 4. If job is POSTED or DRAFT, transition to WAITING_FOR_SELECTION so customer can review quotes
      if (job.status === 'POSTED') {
        await client.query("UPDATE jobs SET status='WAITING_FOR_SELECTION', updated_at=now() WHERE id=$1", [job.id]);
        await client.query(
          "INSERT INTO job_status_events(id,job_id,actor_user_id,from_status,to_status) VALUES($1,$2,$3,'POSTED','WAITING_FOR_SELECTION')",
          [randomUUID(), job.id, req.user.id]
        );
      }

      // 5. Notify customer
      await notify(
        client,
        job.customer_user_id,
        job.id,
        `job:${job.id}:quote:${provider.rows[0].id}`,
        'OFFERS',
        'ช่างส่งใบเสนอราคาใหม่',
        `ช่าง ${provider.rows[0].display_name} ส่งใบเสนอราคา ${totalAmount.toLocaleString()} บาท ตรวจสอบและชำระเงินเพื่อเริ่มงาน`
      );

      return {
        jobId: job.id,
        providerId: provider.rows[0].id,
        totalAmount,
        laborFee: numLabor,
        transportFee: numTransport,
        itemsDetail,
        scopeSummary: scope
      };
    });

    res.status(201).json({ data: outcome });
  });

  app.get('/api/jobs/:jobId/quotations', async (req, res) => {
    const job = await jobFor(pool, req.params.jobId);
    const quotes = await pool.query(
      `SELECT o.id, o.job_id, o.provider_id, o.amount, o.labor_fee, o.transport_fee, o.items_detail,
              o.scope_summary, o.status, o.created_at,
              p.display_name AS provider_name, p.is_approved, p.skills_summary,
              COALESCE((SELECT AVG(r.rating) FROM reviews r WHERE r.provider_id=p.id), 5.0)::numeric(2,1) AS average_rating,
              (SELECT count(*)::int FROM reviews r WHERE r.provider_id=p.id) AS review_count
       FROM offers o
       JOIN provider_profiles p ON p.id = o.provider_id
       WHERE o.job_id = $1
       ORDER BY (o.status = 'SELECTED') DESC, o.amount ASC`,
      [job.id]
    );

    res.json({ data: quotes.rows });
  });

  // 5. Customer Upfront Escrow Payment
  app.post('/api/jobs/:jobId/quotations/:quotationId/accept-and-pay', async (req, res) => {
    const outcome = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true });
      if (job.customer_user_id !== req.user.id && req.user.role !== 'ADMIN') {
        fail(403, 'FORBIDDEN', 'มีเฉพาะลูกค้าเจ้าของงานเท่านั้นที่สามารถชำระเงินและเลือกช่างได้');
      }

      const offerRes = await client.query(
        'SELECT * FROM offers WHERE id=$1 AND job_id=$2 FOR UPDATE',
        [req.params.quotationId, job.id]
      );
      if (!offerRes.rowCount) fail(404, 'OFFER_NOT_FOUND', 'ไม่พบใบเสนอราคาที่เลือก');
      const offer = offerRes.rows[0];

      // Mark selected offer
      await client.query(
        "UPDATE offers SET status=CASE WHEN id=$2 THEN 'SELECTED' ELSE 'NOT_SELECTED' END WHERE job_id=$1",
        [job.id, offer.id]
      );

      // Get platform fee percentage from system_settings
      const feeSetting = await client.query("SELECT value FROM system_settings WHERE key='platform_fee_percent'");
      let feePercent = 10.0;
      if (feeSetting.rowCount && feeSetting.rows[0].value?.percent !== undefined) {
        feePercent = Number(feeSetting.rows[0].value.percent);
      }

      const totalAmount = Number(offer.amount);
      const platformFee = Math.round((totalAmount * feePercent) / 100 * 100) / 100;
      const netProviderAmount = Math.round((totalAmount - platformFee) * 100) / 100;

      const escrowId = randomUUID();
      await client.query(
        `INSERT INTO escrow_payments(
           id, job_id, customer_user_id, provider_id, total_amount, platform_fee_percent,
           platform_fee, net_provider_amount, currency, status, created_at, updated_at
         )
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'THB', 'HOLDING', now(), now())`,
        [escrowId, job.id, req.user.id, offer.provider_id, totalAmount, feePercent, platformFee, netProviderAmount]
      );

      // Update Job status to SCHEDULED / IN_PROGRESS
      await client.query(
        `UPDATE jobs
         SET assigned_provider_id=$2, agreed_amount=$3, agreed_by_user_id=$4, agreed_at=now(),
             status='SCHEDULED', updated_at=now()
         WHERE id=$1`,
        [job.id, offer.provider_id, totalAmount, req.user.id]
      );

      await client.query(
        "INSERT INTO job_status_events(id,job_id,actor_user_id,from_status,to_status) VALUES($1,$2,$3,$4,'SCHEDULED')",
        [randomUUID(), job.id, req.user.id, job.status]
      );

      // Notify technician that escrow payment is secured
      const providerUser = await client.query('SELECT user_id FROM provider_profiles WHERE id=$1', [offer.provider_id]);
      if (providerUser.rowCount) {
        await notify(
          client,
          providerUser.rows[0].user_id,
          job.id,
          `job:${job.id}:escrow-secured`,
          'PAYMENT',
          'ลูกค้าชำระเงินและเลือกข้อเสนอแล้ว',
          `ลูกค้าชำระเงิน ${totalAmount.toLocaleString()} บาท เข้าสู่ระบบ Escrow เรียบร้อยแล้ว ช่างสามารถเริ่มงานได้ทันที`
        );
      }

      return {
        jobId: job.id,
        escrowId,
        status: 'SCHEDULED',
        totalAmount,
        platformFee,
        netProviderAmount,
        escrowStatus: 'HOLDING',
        message: 'ชำระเงินเข้าสู่ระบบ Escrow สำเร็จ เงินจะถูกพักไว้จนกว่าคุณจะตรวจรับงาน'
      };
    });

    res.json({ data: outcome });
  });

  // 6. Work Evidence Proofs (Before & After)
  app.post('/api/jobs/:jobId/work-proofs', async (req, res) => {
    requireRole(req.user, ['TECHNICIAN']);
    const { proofType, imageUrl, note, originalFilename } = req.body ?? {};

    if (!['BEFORE_WORK', 'AFTER_WORK'].includes(proofType)) {
      fail(400, 'VALIDATION_ERROR', 'proofType ต้องเป็น BEFORE_WORK หรือ AFTER_WORK');
    }

    const validImageUrl = text(imageUrl ?? '/uploads/default-work-proof.png', 500, 'imageUrl');
    const validNote = optionalText(note, 1000, 'note');

    const outcome = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true });
      if (job.assigned_provider_id !== req.user.providerId) {
        fail(403, 'FORBIDDEN', 'เฉพาะช่างที่ได้รับมอบหมายงานนี้เท่านั้นที่สามารถส่งหลักฐานการทำงานได้');
      }

      const proofId = randomUUID();
      await client.query(
        `INSERT INTO job_work_proofs(id, job_id, provider_id, proof_type, image_url, original_filename, note, created_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, now())`,
        [proofId, job.id, req.user.providerId, proofType, validImageUrl, originalFilename ?? 'proof.jpg', validNote]
      );

      const label = proofType === 'BEFORE_WORK' ? 'ก่อนเริ่มทำงาน' : 'หลังทำงานเสร็จ';
      await notify(
        client,
        job.customer_user_id,
        job.id,
        `job:${job.id}:proof:${proofId}`,
        'WORK_PROOF',
        `ช่างอัปโหลดรูปหลักฐาน ${label}`,
        validNote ? `บันทึกจากช่าง: ${validNote}` : `ช่างได้ส่งหลักฐานภาพถ่าย ${label} แล้ว`
      );

      return {
        id: proofId,
        jobId: job.id,
        proofType,
        imageUrl: validImageUrl,
        note: validNote
      };
    });

    res.status(201).json({ data: outcome });
  });

  app.get('/api/jobs/:jobId/work-proofs', async (req, res) => {
    const job = await jobFor(pool, req.params.jobId);
    const proofs = await pool.query(
      `SELECT id, job_id, provider_id, proof_type, image_url, original_filename, note, created_at
       FROM job_work_proofs
       WHERE job_id = $1
       ORDER BY created_at ASC`,
      [job.id]
    );

    res.json({ data: proofs.rows });
  });

  // 7. Customer Inspects & Approves Completion -> Moves Escrow to PENDING_PAYOUT
  app.post('/api/jobs/:jobId/approve-completion', async (req, res) => {
    const outcome = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true });
      if (job.customer_user_id !== req.user.id && req.user.role !== 'ADMIN') {
        fail(403, 'FORBIDDEN', 'มีเฉพาะลูกค้าเจ้าของงานเท่านั้นที่สามารถกดตรวจรับงานเสร็จสิ้นได้');
      }

      if (['COMPLETED', 'CANCELLED'].includes(job.status)) {
        fail(409, 'INVALID_JOB_STATE', 'งานนี้เสร็จสิ้นหรือถูกยกเลิกแล้ว');
      }

      // Check escrow record
      const escrow = await client.query(
        "SELECT * FROM escrow_payments WHERE job_id=$1 AND status='HOLDING' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [job.id]
      );

      if (escrow.rowCount) {
        await client.query(
          "UPDATE escrow_payments SET status='PENDING_PAYOUT', updated_at=now() WHERE id=$1",
          [escrow.rows[0].id]
        );
      }

      await client.query(
        "UPDATE jobs SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1",
        [job.id]
      );

      await client.query(
        "INSERT INTO job_status_events(id,job_id,actor_user_id,from_status,to_status) VALUES($1,$2,$3,$4,'COMPLETED')",
        [randomUUID(), job.id, req.user.id, job.status]
      );

      // Notify technician
      const providerUser = await client.query('SELECT user_id FROM provider_profiles WHERE id=$1', [job.assigned_provider_id]);
      if (providerUser.rowCount) {
        await notify(
          client,
          providerUser.rows[0].user_id,
          job.id,
          `job:${job.id}:approved`,
          'JOB_COMPLETED',
          'ลูกค้าตรวจรับงานเรียบร้อยแล้ว',
          'ลูกค้ากดยืนยันงานเสร็จสิ้น ยอดเงินเตรียมโอนเข้าบัญชีของคุณโดยผู้ดูแลระบบ'
        );
      }

      return {
        jobId: job.id,
        status: 'COMPLETED',
        escrowStatus: 'PENDING_PAYOUT',
        message: 'ตรวจรับงานสำเร็จ! ยอดเงินเตรียมโอนให้ช่างโดยผู้ดูแลระบบ'
      };
    });

    res.json({ data: outcome });
  });

  // 8. Escrow Detail for a Job
  app.get('/api/jobs/:jobId/escrow', async (req, res) => {
    const job = await jobFor(pool, req.params.jobId);
    const result = await pool.query(
      `SELECT e.*, u.display_name AS customer_name, p.display_name AS provider_name
       FROM escrow_payments e
       JOIN users u ON u.id = e.customer_user_id
       LEFT JOIN provider_profiles p ON p.id = e.provider_id
       WHERE e.job_id = $1
       ORDER BY e.created_at DESC LIMIT 1`,
      [job.id]
    );

    res.json({ data: result.rows[0] ?? null });
  });

  // 9. User Reports & Contact Admin
  app.post('/api/reports', async (req, res) => {
    if (!req.user) fail(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
    const { jobId, reportedUserId, reportType, reason } = req.body ?? {};

    const type = reportType === 'CONTACT_ADMIN' ? 'CONTACT_ADMIN' : 'USER_REPORT';
    const validReason = text(reason, 2000, 'reason');
    const reportId = randomUUID();

    await pool.query(
      `INSERT INTO user_reports(id, reporter_user_id, reported_user_id, job_id, report_type, reason, status, created_at)
       VALUES($1, $2, $3, $4, $5, $6, 'NEW', now())`,
      [reportId, req.user.id, reportedUserId && isUuid(reportedUserId) ? reportedUserId : null, jobId && isUuid(jobId) ? jobId : null, type, validReason]
    );

    res.status(201).json({
      data: {
        id: reportId,
        message: type === 'CONTACT_ADMIN' ? 'ส่งข้อความถึงเจ้าหน้าที่เรียบร้อยแล้ว' : 'ส่งรายงานผู้ใช้เรียบร้อยแล้ว เจ้าหน้าที่จะตรวจสอบโดยเร็ว'
      }
    });
  });

  // 10. Convenience Aliases for Fastwork Frontend
  app.get('/api/fastwork/profile', async (req, res) => {
    if (!req.user) fail(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
    const userRes = await pool.query(
      `SELECT u.id, u.email, u.role, u.display_name, u.is_active, u.is_suspended,
              u.id_card_number, u.bank_name, u.bank_account_number, u.bank_account_name,
              p.id AS provider_id, p.kyc_status, p.kyc_rejection_reason, p.is_approved, p.skills_summary,
              p.id_card_image_url, p.selfie_image_url
       FROM users u
       LEFT JOIN provider_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!userRes.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบบัญชีผู้ใช้');
    res.json({ data: userRes.rows[0] });
  });

  app.post('/api/fastwork/profile', async (req, res) => {
    if (!req.user) fail(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
    const { displayName, idCardNumber, bankName, bankAccountNumber, bankAccountName } = req.body ?? {};

    await pool.query(
      `UPDATE users
       SET display_name=COALESCE($2, display_name),
           id_card_number=COALESCE($3, id_card_number),
           bank_name=COALESCE($4, bank_name),
           bank_account_number=COALESCE($5, bank_account_number),
           bank_account_name=COALESCE($6, bank_account_name),
           updated_at=now()
       WHERE id=$1`,
      [req.user.id, displayName ?? null, idCardNumber ?? null, bankName ?? null, bankAccountNumber ?? null, bankAccountName ?? null]
    );

    if (req.user.role === 'TECHNICIAN') {
      await pool.query(
        `UPDATE provider_profiles
         SET bank_name=COALESCE($2, bank_name),
             bank_account_number=COALESCE($3, bank_account_number),
             bank_account_name=COALESCE($4, bank_account_name),
             id_card_number=COALESCE($5, id_card_number),
             updated_at=now()
         WHERE user_id=$1`,
        [req.user.id, bankName ?? null, bankAccountNumber ?? null, bankAccountName ?? null, idCardNumber ?? null]
      );
    }

    res.json({ data: { success: true } });
  });

  app.post('/api/fastwork/profile/kyc', async (req, res) => {
    requireRole(req.user, ['TECHNICIAN']);
    const { idCardImageUrl, selfieImageUrl, skills } = req.body ?? {};
    const skillsStr = Array.isArray(skills) ? skills.join(', ') : (skills ?? 'ฮาร์ดแวร์');

    await pool.query(
      `UPDATE provider_profiles
       SET id_card_image_url=COALESCE($2, id_card_image_url),
           selfie_image_url=COALESCE($3, selfie_image_url),
           skills_summary=COALESCE($4, skills_summary),
           kyc_status='PENDING',
           kyc_submitted_at=now(),
           updated_at=now()
       WHERE user_id=$1`,
      [req.user.id, idCardImageUrl ?? null, selfieImageUrl ?? null, skillsStr]
    );

    res.json({ data: { success: true, message: 'ส่งเอกสารยืนยันตัวตนเรียบร้อยแล้ว รอผู้ดูแลระบบตรวจสอบ' } });
  });

  app.get('/api/fastwork/jobs/board', async (req, res) => {
    const district = req.query.district;
    const deviceType = req.query.deviceType;

    let query = `
      SELECT j.id, j.district_code, j.category, j.service_format, j.status,
             j.device_type, j.device_brand_or_model, j.laptop_brand_model, j.pc_specs_case,
             j.symptom_text, j.ai_summary, j.created_at,
             d.name AS district_name, u.display_name AS customer_name
      FROM jobs j
      JOIN districts d ON d.code = j.district_code
      JOIN users u ON u.id = j.customer_user_id
      WHERE j.is_hidden = false
        AND j.status IN ('POSTED', 'WAITING_FOR_SELECTION')
    `;
    const params = [];
    if (district) {
      params.push(district);
      query += ` AND j.district_code = $${params.length}`;
    }
    if (deviceType) {
      params.push(deviceType);
      query += ` AND j.device_type = $${params.length}`;
    }
    query += ' ORDER BY j.created_at DESC LIMIT 50';

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  });

  app.post('/api/fastwork/jobs/:jobId/quote', async (req, res) => {
    requireRole(req.user, ['TECHNICIAN']);
    const { amount, laborFee, transportFee, itemsDetail, scopeSummary } = req.body ?? {};
    const labor = Number(laborFee ?? amount ?? 0);
    const transport = Number(transportFee ?? 0);
    const total = Number(amount ?? (labor + transport));

    const provider = await pool.query(
      'SELECT id, is_approved, kyc_status, display_name FROM provider_profiles WHERE user_id=$1',
      [req.user.id]
    );
    if (!provider.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบโปรไฟล์ช่าง');
    if (!provider.rows[0].is_approved && provider.rows[0].kyc_status !== 'APPROVED') {
      fail(403, 'KYC_REQUIRED', 'ช่างที่ยังไม่ผ่านการอนุมัติยืนยันตัวตน (KYC) จะยังไม่สามารถเสนองานได้');
    }

    const job = await jobFor(pool, req.params.jobId);
    const offerId = randomUUID();
    await pool.query(
      `INSERT INTO offers(id, job_id, provider_id, scope_summary, amount, labor_fee, transport_fee, items_detail, status)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'AVAILABLE')`,
      [offerId, job.id, provider.rows[0].id, scopeSummary ?? 'ซ่อมบำรุงตามอาการ', total, labor, transport, JSON.stringify(itemsDetail ?? [])]
    );

    if (job.status === 'POSTED') {
      await pool.query("UPDATE jobs SET status='WAITING_FOR_SELECTION', updated_at=now() WHERE id=$1", [job.id]);
    }

    res.status(201).json({ data: { offerId, totalAmount: total } });
  });

  app.post('/api/fastwork/escrow/pay', async (req, res) => {
    const { jobId, offerId } = req.body ?? {};
    if (!jobId || !offerId) fail(400, 'VALIDATION_ERROR', 'jobId และ offerId จำเป็นต้องระบุ');

    const job = await jobFor(pool, jobId);
    const offerRes = await pool.query('SELECT * FROM offers WHERE id=$1 AND job_id=$2', [offerId, job.id]);
    if (!offerRes.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบใบเสนอราคา');
    const offer = offerRes.rows[0];

    const feeSetting = await pool.query("SELECT value FROM system_settings WHERE key='platform_fee_percent'");
    const feePercent = Number(feeSetting.rows[0]?.value?.percent ?? 10.0);
    const total = Number(offer.amount);
    const platformFee = Math.round((total * feePercent) / 100 * 100) / 100;
    const net = Math.round((total - platformFee) * 100) / 100;

    const escrowId = randomUUID();
    await pool.query(
      `INSERT INTO escrow_payments(id, job_id, customer_user_id, provider_id, total_amount, platform_fee_percent, platform_fee, net_provider_amount, currency, status, created_at, updated_at)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'THB', 'HOLDING', now(), now())`,
      [escrowId, job.id, req.user.id, offer.provider_id, total, feePercent, platformFee, net]
    );

    await pool.query("UPDATE offers SET status=CASE WHEN id=$2 THEN 'SELECTED' ELSE 'NOT_SELECTED' END WHERE job_id=$1", [job.id, offer.id]);
    await pool.query("UPDATE jobs SET assigned_provider_id=$2, agreed_amount=$3, status='SCHEDULED', updated_at=now() WHERE id=$1", [job.id, offer.provider_id, total]);

    res.json({ data: { success: true, escrowId, status: 'HOLDING' } });
  });

  app.get('/api/fastwork/jobs/:jobId/work-proofs', async (req, res) => {
    const proofs = await pool.query(
      'SELECT * FROM job_work_proofs WHERE job_id=$1 ORDER BY created_at ASC',
      [req.params.jobId]
    );
    res.json({ data: proofs.rows });
  });

  app.post('/api/fastwork/jobs/:jobId/work-proof', async (req, res) => {
    const { proofType, imageUrl, note } = req.body ?? {};
    const type = ['BEFORE_WORK', 'AFTER_WORK'].includes(proofType) ? proofType : 'BEFORE_WORK';
    const proofId = randomUUID();

    const provider = await pool.query('SELECT id FROM provider_profiles WHERE user_id=$1', [req.user.id]);
    const providerId = provider.rows[0]?.id ?? null;

    await pool.query(
      `INSERT INTO job_work_proofs(id, job_id, provider_id, proof_type, image_url, note, created_at)
       VALUES($1, $2, $3, $4, $5, $6, now())`,
      [proofId, req.params.jobId, providerId, type, imageUrl ?? '/uploads/proof.jpg', note ?? null]
    );

    res.status(201).json({ data: { proofId, success: true } });
  });

  app.post('/api/fastwork/jobs/:jobId/approve-completion', async (req, res) => {
    const job = await jobFor(pool, req.params.jobId);
    await pool.query("UPDATE escrow_payments SET status='PENDING_PAYOUT', updated_at=now() WHERE job_id=$1 AND status='HOLDING'", [job.id]);
    await pool.query("UPDATE jobs SET status='COMPLETED', completed_at=now(), updated_at=now() WHERE id=$1", [job.id]);
    res.json({ data: { success: true, status: 'COMPLETED' } });
  });

  app.get('/api/fastwork/provider/financials', async (req, res) => {
    const provider = await pool.query('SELECT id FROM provider_profiles WHERE user_id=$1', [req.user.id]);
    const providerId = provider.rows[0]?.id;
    if (!providerId) {
      return res.json({ data: { todayEarnings: 0, monthEarnings: 0, pendingPayout: 0, escrowHolding: 0, completedJobsCount: 0, payouts: [] } });
    }

    const stats = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN e.status='TRANSFERRED' AND e.transferred_at >= date_trunc('day', now()) THEN e.net_provider_amount ELSE 0 END), 0) AS today_earnings,
         COALESCE(SUM(CASE WHEN e.status='TRANSFERRED' AND e.transferred_at >= date_trunc('month', now()) THEN e.net_provider_amount ELSE 0 END), 0) AS month_earnings,
         COALESCE(SUM(CASE WHEN e.status='PENDING_PAYOUT' THEN e.net_provider_amount ELSE 0 END), 0) AS pending_payout,
         COALESCE(SUM(CASE WHEN e.status='HOLDING' THEN e.net_provider_amount ELSE 0 END), 0) AS escrow_holding,
         (SELECT count(*)::int FROM jobs j WHERE j.assigned_provider_id = $1 AND j.status='COMPLETED') AS completed_jobs_count
       FROM escrow_payments e
       WHERE e.provider_id = $1`,
      [providerId]
    );

    const payouts = await pool.query(
      'SELECT id, job_id, net_provider_amount AS amount, status, created_at FROM escrow_payments WHERE provider_id=$1 ORDER BY created_at DESC LIMIT 20',
      [providerId]
    );

    const row = stats.rows[0];
    res.json({
      data: {
        todayEarnings: Number(row.today_earnings),
        monthEarnings: Number(row.month_earnings),
        pendingPayout: Number(row.pending_payout),
        escrowHolding: Number(row.escrow_holding),
        completedJobsCount: Number(row.completed_jobs_count),
        payouts: payouts.rows
      }
    });
  });

  app.post('/api/fastwork/reports', async (req, res) => {
    const { jobId, reportedUserId, category, reason } = req.body ?? {};
    const reportId = randomUUID();
    const type = category === 'CONTACT_ADMIN' ? 'CONTACT_ADMIN' : 'USER_REPORT';

    await pool.query(
      `INSERT INTO user_reports(id, reporter_user_id, reported_user_id, job_id, report_type, reason, status, created_at)
       VALUES($1, $2, $3, $4, $5, $6, 'NEW', now())`,
      [reportId, req.user.id, reportedUserId && isUuid(reportedUserId) ? reportedUserId : null, jobId && isUuid(jobId) ? jobId : null, type, reason || 'รายงานจากระบบแชท']
    );

    res.status(201).json({ data: { reportId, success: true } });
  });
}
