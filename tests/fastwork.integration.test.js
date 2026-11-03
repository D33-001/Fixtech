import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import pg from 'pg';
import { createApp } from '../src/app.js';

const connectionString = process.env.DATABASE_URL;
const seedPassword = process.env.DEMO_SEED_PASSWORD ?? 'FixtechDemo@2026';

const runIntegration = Boolean(connectionString);

async function withServer(app, fn) {
  const server = createServer(app);
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function loginUser(base, email, password = seedPassword) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie);
  const data = await res.json();
  return { cookie, user: data.data.user };
}

test('Fastwork Flow & Admin Portal Backend Integration', { skip: !runIntegration }, async (t) => {
  const pool = new pg.Pool({ connectionString });
  const app = createApp({ pool });

  // Reset fee setting to 10.0% for clean deterministic test run
  await pool.query("UPDATE system_settings SET value='{\"percent\": 10.0}'::jsonb WHERE key='platform_fee_percent'");

  await withServer(app, async (base) => {
    // 1. Test AI Screening Chatbot
    await t.test('AI Screening Chatbot interactive conversation and Draft Card', async () => {
      // First turn
      const res1 = await fetch(`${base}/api/ai/screen-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'สวัสดีครับ คอมมีปัญหา เปิดไม่ติด' }]
        })
      });
      assert.equal(res1.status, 200);
      const data1 = await res1.json();
      assert.ok(data1.data.reply);
      assert.equal(data1.data.isComplete, false);

      // Second turn with notebook details
      const res2 = await fetch(`${base}/api/ai/screen-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'สวัสดีครับ โน้ตบุ๊ก Asus มีปัญหา' },
            { role: 'assistant', content: data1.data.reply },
            { role: 'user', content: 'เป็นโน้ตบุ๊ก Asus เสียบสายชาร์จแล้วไฟไม่เข้า เคยทำน้ำหกใส่' }
          ]
        })
      });
      assert.equal(res2.status, 200);
      const data2 = await res2.json();
      assert.equal(data2.data.isComplete, true);
      assert.ok(data2.data.draftCard);
      assert.equal(data2.data.draftCard.deviceType, 'NOTEBOOK');
      assert.equal(data2.data.draftCard.category, 'HARDWARE');
      assert.equal(data2.data.draftCard.serviceFormat, 'ONSITE');
      assert.ok(data2.data.draftCard.checklist.length > 0);
    });

    // Login accounts
    const customer = await loginUser(base, 'customer1@fixtech.demo');
    const techSoft = await loginUser(base, 'tech.soft.a@fixtech.demo');
    const admin = await loginUser(base, 'admin@fixtech.demo');

    // 2. Direct Job Creation with Tailored Desktop/Notebook Fields
    let createdJobId;
    await t.test('Customer creates job with Fastwork tailored fields and direct publish', async () => {
      const res = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: customer.cookie },
        body: JSON.stringify({
          category: 'HARDWARE',
          serviceFormat: 'ONSITE',
          districtCode: 'BANG_NA',
          symptom: 'โน้ตบุ๊กเปิดไม่ติด ชาร์จไฟไม่เข้า',
          deviceType: 'NOTEBOOK',
          deviceBrandOrModel: 'Asus ZenBook 14',
          batteryChargingStatus: 'ไฟสถานะไม่ขึ้นตอนเสียบชาร์จ',
          damageHistory: 'เคยทำน้ำหกใส่เล็กน้อยเมื่อวาน',
          directPublish: true
        })
      });
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.data.status, 'POSTED');
      createdJobId = data.data.jobId;
    });

    // 3. Technician Job Board & KYC Verification check
    await t.test('Technician sees posted job on open job board and checks KYC', async () => {
      // Tech checks job board
      const resBoard = await fetch(`${base}/api/technician/jobs`, {
        headers: { cookie: techSoft.cookie }
      });
      assert.equal(resBoard.status, 200);
      const boardData = await resBoard.json();
      assert.ok(boardData.data.some((j) => j.id === createdJobId));

      // Check current technician KYC
      const resKyc = await fetch(`${base}/api/technician/kyc`, {
        headers: { cookie: techSoft.cookie }
      });
      assert.equal(resKyc.status, 200);
      const kycData = await resKyc.json();
      assert.ok(kycData.data);
    });

    // 4. Technician Submits Quotation (Fastwork Quotation)
    let quotationId;
    await t.test('Technician submits quotation with labor and transport fees', async () => {
      const resQuote = await fetch(`${base}/api/jobs/${createdJobId}/quotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: techSoft.cookie },
        body: JSON.stringify({
          laborFee: 800,
          transportFee: 200,
          scopeSummary: 'ตรวจเช็คระบบไฟเมนบอร์ดและทำความสะอาดคราบความชื้น',
          itemsDetail: ['ตรวจเช็คบอร์ด', 'ทำความสะอาดคราบน้ำ', 'ทดสอบเปิดเครื่อง']
        })
      });
      assert.equal(resQuote.status, 201);
      const quoteData = await resQuote.json();
      assert.equal(quoteData.data.totalAmount, 1000);
      assert.equal(quoteData.data.laborFee, 800);
      assert.equal(quoteData.data.transportFee, 200);

      // Customer fetches quotations
      const resList = await fetch(`${base}/api/jobs/${createdJobId}/quotations`, {
        headers: { cookie: customer.cookie }
      });
      assert.equal(resList.status, 200);
      const listData = await resList.json();
      assert.equal(listData.data.length, 1);
      assert.equal(listData.data[0].amount, '1000.00');
      quotationId = listData.data[0].id;
    });

    // 5. Customer Upfront Escrow Payment
    let escrowId;
    await t.test('Customer accepts quotation and pays into Escrow upfront', async () => {
      const resPay = await fetch(`${base}/api/jobs/${createdJobId}/quotations/${quotationId}/accept-and-pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: customer.cookie }
      });
      assert.equal(resPay.status, 200);
      const payData = await resPay.json();
      assert.equal(payData.data.status, 'SCHEDULED');
      assert.equal(payData.data.escrowStatus, 'HOLDING');
      assert.equal(payData.data.totalAmount, 1000);
      assert.equal(payData.data.platformFee, 100); // 10%
      assert.equal(payData.data.netProviderAmount, 900);
      escrowId = payData.data.escrowId;

      // Check escrow detail
      const resEscrow = await fetch(`${base}/api/jobs/${createdJobId}/escrow`, {
        headers: { cookie: customer.cookie }
      });
      assert.equal(resEscrow.status, 200);
      const escrowDetail = await resEscrow.json();
      assert.equal(escrowDetail.data.status, 'HOLDING');
    });

    // 6. Technician Work Proofs (Before & After)
    await t.test('Technician submits before and after work evidence', async () => {
      // Before work
      const resBefore = await fetch(`${base}/api/jobs/${createdJobId}/work-proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: techSoft.cookie },
        body: JSON.stringify({
          proofType: 'BEFORE_WORK',
          imageUrl: '/uploads/asus-zenbook-before.jpg',
          note: 'สภาพเครื่องก่อนซ่อม พบคราบออกไซด์บริเวณบอร์ด'
        })
      });
      assert.equal(resBefore.status, 201);

      // After work
      const resAfter = await fetch(`${base}/api/jobs/${createdJobId}/work-proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: techSoft.cookie },
        body: JSON.stringify({
          proofType: 'AFTER_WORK',
          imageUrl: '/uploads/asus-zenbook-after.jpg',
          note: 'ทำความสะอาดคราบออกไซด์และเปิดติดไฟเข้าปกติแล้ว'
        })
      });
      assert.equal(resAfter.status, 201);

      // Verify proofs query
      const resProofs = await fetch(`${base}/api/jobs/${createdJobId}/work-proofs`, {
        headers: { cookie: customer.cookie }
      });
      assert.equal(resProofs.status, 200);
      const proofsData = await resProofs.json();
      assert.equal(proofsData.data.length, 2);
      assert.equal(proofsData.data[0].proof_type, 'BEFORE_WORK');
      assert.equal(proofsData.data[1].proof_type, 'AFTER_WORK');
    });

    // 7. Customer Inspects & Approves Completion
    await t.test('Customer approves completion and Escrow moves to PENDING_PAYOUT', async () => {
      const resApprove = await fetch(`${base}/api/jobs/${createdJobId}/approve-completion`, {
        method: 'POST',
        headers: { cookie: customer.cookie }
      });
      assert.equal(resApprove.status, 200);
      const appData = await resApprove.json();
      assert.equal(appData.data.status, 'COMPLETED');
      assert.equal(appData.data.escrowStatus, 'PENDING_PAYOUT');

      // Check technician dashboard
      const resDash = await fetch(`${base}/api/technician/dashboard`, {
        headers: { cookie: techSoft.cookie }
      });
      assert.equal(resDash.status, 200);
      const dashData = await resDash.json();
      assert.ok(Number(dashData.data.pending_payout) >= 900);
    });

    // 8. Admin Finance Payout Confirmation
    await t.test('Admin confirms payout to technician with slip', async () => {
      const resFinance = await fetch(`${base}/api/admin/finance/summary`, {
        headers: { cookie: admin.cookie }
      });
      assert.equal(resFinance.status, 200);
      const finData = await resFinance.json();
      assert.ok(finData.data.pendingPayouts.some((p) => p.id === escrowId));

      // Admin confirms payout
      const resConfirm = await fetch(`${base}/api/admin/finance/payouts/${escrowId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({
          transferSlipUrl: '/uploads/slip-12345.png',
          note: 'โอนผ่านพร้อมเพย์เรียบร้อย'
        })
      });
      assert.equal(resConfirm.status, 200);
      const confirmData = await resConfirm.json();
      assert.equal(confirmData.data.status, 'TRANSFERRED');

      // Technician dashboard now shows transferred
      const resDash2 = await fetch(`${base}/api/technician/dashboard`, {
        headers: { cookie: techSoft.cookie }
      });
      const dashData2 = await resDash2.json();
      assert.ok(Number(dashData2.data.total_earned) >= 900);
    });

    // 9. Admin Overview, User Management, Reports, and System Settings
    await t.test('Admin Portal APIs: Overview, User Suspension, Reports, Settings, Audit', async () => {
      // Overview
      const resOver = await fetch(`${base}/api/admin/overview`, { headers: { cookie: admin.cookie } });
      assert.equal(resOver.status, 200);
      const overData = await resOver.json();
      assert.ok(overData.data.stats);

      // User Suspend & Unsuspend
      const resSuspend = await fetch(`${base}/api/admin/users/${customer.user.id}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ reason: 'ทดสอบการระงับบัญชี' })
      });
      assert.equal(resSuspend.status, 200);

      const resUnsuspend = await fetch(`${base}/api/admin/users/${customer.user.id}/unsuspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ reason: 'ปลดระงับการใช้งาน' })
      });
      assert.equal(resUnsuspend.status, 200);

      // Send User Report from chat
      const resReport = await fetch(`${base}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: customer.cookie },
        body: JSON.stringify({
          jobId: createdJobId,
          reportedUserId: techSoft.user.id,
          reportType: 'USER_REPORT',
          reason: 'ทดสอบส่งรายงานผู้ใช้'
        })
      });
      assert.equal(resReport.status, 201);
      const repData = await resReport.json();
      const reportId = repData.data.id;

      // Admin views report and responds
      const resAdminRep = await fetch(`${base}/api/admin/reports/${reportId}`, { headers: { cookie: admin.cookie } });
      assert.equal(resAdminRep.status, 200);

      const resRespond = await fetch(`${base}/api/admin/reports/${reportId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ response: 'รับเรื่องเรียบร้อย กำลังตรวจสอบครับ' })
      });
      assert.equal(resRespond.status, 200);

      // System Settings
      const resSet = await fetch(`${base}/api/admin/settings`, { headers: { cookie: admin.cookie } });
      assert.equal(resSet.status, 200);

      const resPutSet = await fetch(`${base}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({
          key: 'platform_fee_percent',
          value: { percent: 12.5 },
          description: 'อัปเดตค่าธรรมเนียมเป็น 12.5%'
        })
      });
      assert.equal(resPutSet.status, 200);

      // Audit Logs
      const resLogs = await fetch(`${base}/api/admin/audit-logs`, { headers: { cookie: admin.cookie } });
      assert.equal(resLogs.status, 200);
      const logsData = await resLogs.json();
      assert.ok(logsData.data.length > 0);

      // Finance CSV Export
      const resCsv = await fetch(`${base}/api/admin/finance/export`, { headers: { cookie: admin.cookie } });
      assert.equal(resCsv.status, 200);
      assert.equal(resCsv.headers.get('content-type'), 'text/csv; charset=utf-8');
      const csvText = await resCsv.text();
      assert.ok(csvText.includes('Escrow ID'));
    });

    // 10. Frontend UI Layout & Static Contracts
    await t.test('Frontend UI Layout serves Customer, Technician, and Admin portals matching Note spec', async () => {
      const res = await fetch(base);
      assert.equal(res.status, 200);
      const html = await res.text();

      // Topbar & Navigation
      assert.ok(html.includes('id="nav-chat-btn"'), 'Chat button exists in Navbar');
      assert.ok(html.includes('id="unread-chat-badge"'), 'Unread chat badge exists');
      assert.ok(html.includes('id="profile-dropdown-menu"'), 'Floating profile menu exists');
      assert.ok(html.includes('id="profile-mode-toggle"'), 'Mode switcher button exists');
      assert.ok(html.includes('id="menu-my-posts"'), 'My Posts menu link exists');
      assert.ok(html.includes('id="menu-chat-center"'), 'Chat Center menu link exists');
      assert.ok(html.includes('id="menu-tech-financials"'), 'Technician Financials menu link exists');

      // Customer Portal: Hero & Job creation
      assert.ok(html.includes('id="btn-hero-self-fill"'), 'Hero Self-fill button exists');
      assert.ok(html.includes('id="btn-hero-ai-assist"'), 'Hero AI-assisted button exists');
      assert.ok(html.includes('id="fields-desktop"'), 'Tailored Desktop PC fields exist');
      assert.ok(html.includes('id="fields-notebook"'), 'Tailored Notebook fields exist');
      assert.ok(html.includes('id="customer-ai-chat-view"'), 'AI Screening Chatbot view exists');
      assert.ok(html.includes('id="customer-my-posts-view"'), 'My Posts view exists');
      assert.ok(html.includes('id="customer-job-detail-view"'), 'Job Detail view with quotations exists');
      assert.ok(html.includes('id="customer-chat-center-view"'), 'Chat Center 1-1 view exists');

      // Technician Portal
      assert.ok(html.includes('id="tech-job-board-view"'), 'Technician Open Job Board exists');
      assert.ok(html.includes('id="tech-financials-view"'), 'Technician Financial Dashboard exists');
      assert.ok(html.includes('id="tech-kyc-alert-banner"'), 'KYC Alert banner exists');

      // Admin Portal: Sidebar with 9 modules
      assert.ok(html.includes('id="admin-overview"'), 'Admin Overview module exists');
      assert.ok(html.includes('id="admin-users"'), 'Admin Users module exists');
      assert.ok(html.includes('id="admin-kyc"'), 'Admin KYC module exists');
      assert.ok(html.includes('id="admin-jobs"'), 'Admin Jobs module exists');
      assert.ok(html.includes('id="admin-reports"'), 'Admin Reports module exists');
      assert.ok(html.includes('id="admin-disputes"'), 'Admin Disputes module exists');
      assert.ok(html.includes('id="admin-finance"'), 'Admin Finance module exists');
      assert.ok(html.includes('id="admin-settings"'), 'Admin Settings module exists');
      assert.ok(html.includes('id="admin-audit"'), 'Admin Audit module exists');
    });
  });

  await pool.end();
});
