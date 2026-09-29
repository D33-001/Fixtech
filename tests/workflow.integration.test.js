import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createApp } from '../src/app.js';

const databaseUrl = process.env.FIXTECH_TEST_DATABASE_URL;
const seedPassword = process.env.DEMO_SEED_PASSWORD ?? 'Fixtech-Demo-Only-2026!';
const customerEmail = 'customer1@fixtech.demo';
let referenceMode = 'fresh-live';
let referencePause = null;
let aiPause = null;

test('customer, provider, company and admin workflows persist correctly in PostgreSQL', { skip: !databaseUrl }, async () => {
  assert.equal(process.env.FIXTECH_TEST_DATABASE_ALLOW_MUTATION, 'yes',
    'Set FIXTECH_TEST_DATABASE_ALLOW_MUTATION=yes only after verifying this is a disposable seeded Demo database');
  const { Pool } = pg;
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const storageRoot = await mkdtemp(join(tmpdir(), 'fixtech-workflow-files-'));
  const app = createApp({
    pool,
    env: { SESSION_SECRET: 'integration-test-session-secret-at-least-32-bytes', NODE_ENV: 'test' },
    storageRoot,
    aiProvider: {
      async analyze() { if(aiPause){aiPause.started();await aiPause.wait;} return { summary: 'ทดสอบอาการและสรุปโดย test double', missingInfo: [], safeGuidance: ['ปิดอุปกรณ์ก่อนตรวจสายไฟ'], provider: 'test-double', model: 'fixed-v1' }; },
      async chat({ question }) { return { answer: `คำตอบทดสอบ: ${question}`, provider: 'test-double', model: 'fixed-v1' }; }
    },
    marketPriceProvider: {
      async getReferencePrice({ category }) {
        if (referenceMode === 'stale-curated') return { sourceName: 'test-curated', sourceReference: 'fixture:curated', sourceUpdatedAt: new Date().toISOString(), reviewedAt: new Date(Date.now() - 31 * 86400_000).toISOString(), referenceType: 'CURATED_PUBLIC_EXAMPLES', referenceLow: 300, referenceHigh: 500, currency: 'THB' };
        if (referenceMode === 'paused-live') { referencePause.started(); await referencePause.wait; }
        return { sourceName: 'test-double', sourceReference: `fixture:${category}`, sourceUpdatedAt: new Date().toISOString(), referenceLow: 300, referenceHigh: 500, currency: 'THB' };
      }
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { cookie, method = 'GET', body, raw, contentType, filename, binary = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (contentType) headers['Content-Type'] = contentType;
    if (filename) headers['X-File-Name'] = filename;
    const response = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : raw });
    const data = response.status === 204 || binary ? null : await response.json();
    return { response, data };
  }
  async function login(email) {
    const { response, data } = await request('/api/auth/login', { method: 'POST', body: { email, password: seedPassword } });
    assert.equal(response.status, 200, JSON.stringify(data));
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'login must issue an HttpOnly session cookie');
    return cookie;
  }
  async function createAndPublish({ cookie, category, serviceFormat, districtCode, withAi = false }) {
    const created = await request('/api/jobs', { cookie, method: 'POST', body: { category, serviceFormat, districtCode, symptom: 'อาการจำลองสำหรับทดสอบระบบ' } });
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    const jobId = created.data.data.jobId;
    let attachmentId;
    let analysisRunId;
    if (withAi) {
      const png = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
      const uploaded = await request(`/api/jobs/${jobId}/attachments`, { cookie, method: 'POST', contentType: 'image/png', filename: 'test.png', raw: png });
      assert.equal(uploaded.response.status, 201, JSON.stringify(uploaded.data));
      attachmentId = uploaded.data.data.attachmentId;
      const consent = await request(`/api/jobs/${jobId}/ai-consents`, { cookie, method: 'POST', body: { dataScope: { symptom: true, attachmentIds: [attachmentId] } } });
      assert.equal(consent.response.status, 201, JSON.stringify(consent.data));
      const analyzed = await request(`/api/jobs/${jobId}/analyze`, { cookie, method: 'POST', body: {} });
      assert.equal(analyzed.response.status, 200, JSON.stringify(analyzed.data));
      assert.equal(analyzed.data.data.provider, 'test-double');
      analysisRunId=analyzed.data.data.analysisRunId;
      const chatOne = await request(`/api/jobs/${jobId}/ai-chat`, { cookie, method: 'POST', body: { question: 'ควรตรวจอะไรเป็นอันดับแรก?' } });
      assert.equal(chatOne.response.status, 201, JSON.stringify(chatOne.data));
      const chatTwo = await request(`/api/jobs/${jobId}/ai-chat`, { cookie, method: 'POST', body: { question: 'แล้วถ้ายังไม่หายล่ะ?' } });
      assert.equal(chatTwo.response.status, 201, JSON.stringify(chatTwo.data));
      for(let turn=2;turn<20;turn++){
        const extra=await request(`/api/jobs/${jobId}/ai-chat`,{cookie,method:'POST',body:{question:`คำถามทดสอบรอบ ${turn+1}`} });
        assert.equal(extra.response.status,201,JSON.stringify(extra.data));
      }
      const chatHistory = await request(`/api/jobs/${jobId}/ai-chat`, { cookie });
      assert.equal(chatHistory.response.status, 200);
      assert.equal(chatHistory.data.data.length, 20);
      assert.equal(chatHistory.data.data[1].question, 'แล้วถ้ายังไม่หายล่ะ?');
      const overLimit=await request(`/api/jobs/${jobId}/ai-chat`,{cookie,method:'POST',body:{question:'เกินขีดจำกัด'} });
      assert.equal(overLimit.response.status,409);
    } else {
      const summary = await request(`/api/jobs/${jobId}/manual-summary`, { cookie, method: 'POST', body: { summary: 'ลูกค้าสรุปอาการสำหรับทดสอบ' } });
      assert.equal(summary.response.status, 200, JSON.stringify(summary.data));
    }
    const clientPriceOverride = await request(`/api/jobs/${jobId}/price-estimates`, { cookie, method: 'POST', body: { complexity: 2, urgency: 'URGENT' } });
    assert.equal(clientPriceOverride.response.status, 400, 'client must not override server-side pricing multipliers');
    const estimate = await request(`/api/jobs/${jobId}/price-estimates`, { cookie, method: 'POST', body: {} });
    assert.equal(estimate.response.status, 200, JSON.stringify(estimate.data));
    assert.ok(estimate.data.data.referenceValidUntil === null || Number.isFinite(Date.parse(estimate.data.data.referenceValidUntil)), 'response must provide a valid curated-reference expiry when applicable');
    if(analysisRunId){const linked=await pool.query('SELECT analysis_run_id FROM price_estimates WHERE id=$1',[estimate.data.data.estimateId]);assert.equal(linked.rows[0].analysis_run_id,analysisRunId,'price provenance must reference an analysis run, not a chat turn');}
    const confirmed = await request(`/api/jobs/${jobId}/confirm-summary`, { cookie, method: 'POST', body: {} });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));
    const accepted = await request(`/api/jobs/${jobId}/price-estimates/${estimate.data.data.estimateId}/accept`, { cookie, method: 'POST', body: {} });
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data));
    const published = await request(`/api/jobs/${jobId}/publish`, { cookie, method: 'POST', body: {} });
    assert.equal(published.response.status, 200, JSON.stringify(published.data));
    return { jobId, attachmentId, published: published.data.data };
  }
  async function finishJob({ customerCookie, providerCookie, jobId, paymentMethod, withWarranty = true, conflictCustomerCookie, idempotencyKey }) {
    const startAt = new Date(Date.now() + 4 * 60 * 60_000);
    const appointment = await request(`/api/jobs/${jobId}/appointments`, { cookie: customerCookie, method: 'POST', body: { startsAt: startAt.toISOString(), endsAt: new Date(startAt.getTime() + 60 * 60_000).toISOString() } });
    assert.equal(appointment.response.status, 201, JSON.stringify(appointment.data));
    let competingAppointmentId;
    if (conflictCustomerCookie) {
      const competingJob = await createAndPublish({ cookie: conflictCustomerCookie, category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA' });
      const competingAppointment = await request(`/api/jobs/${competingJob.jobId}/appointments`, { cookie: conflictCustomerCookie, method: 'POST', body: { startsAt: startAt.toISOString(), endsAt: new Date(startAt.getTime() + 60 * 60_000).toISOString() } });
      assert.equal(competingAppointment.response.status, 201, JSON.stringify(competingAppointment.data));
      competingAppointmentId=competingAppointment.data.data.appointmentId;
    }
    const confirmed = await request(`/api/appointments/${appointment.data.data.appointmentId}/confirm`, { cookie: providerCookie, method: 'POST', body: {} });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));
    if (competingAppointmentId) {
      const collision = await request(`/api/appointments/${competingAppointmentId}/confirm`, { cookie: providerCookie, method: 'POST', body: {} });
      assert.equal(collision.response.status, 409, 'concurrent appointments for one provider must not both be confirmed');
      const cancelled = await request(`/api/appointments/${competingAppointmentId}/cancel`, { cookie: conflictCustomerCookie, method: 'POST', body: { reason: 'ยกเลิกกรณีทดสอบช่วงเวลาซ้อน' } });
      assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.data));
    }
    const message = await request(`/api/jobs/${jobId}/messages`, { cookie: customerCookie, method: 'POST', body: { body: 'ยืนยันเวลานัดหมายแล้ว' } });
    assert.equal(message.response.status, 201, JSON.stringify(message.data));
    const chat = await request(`/api/jobs/${jobId}/messages`, { cookie: providerCookie });
    assert.equal(chat.response.status, 200);
    assert.equal('senderId' in chat.data.data[0], false, 'chat must not expose either party profile id');
    const started = await request(`/api/jobs/${jobId}/start`, { cookie: providerCookie, method: 'POST', body: {} });
    assert.equal(started.response.status, 200, JSON.stringify(started.data));
    const submitted = await request(`/api/jobs/${jobId}/submit-completion`, { cookie: providerCookie, method: 'POST', body: { note: 'ส่งงานทดสอบแล้ว' } });
    assert.equal(submitted.response.status, 200, JSON.stringify(submitted.data));
    if (withWarranty) {
      const offered = await request(`/api/jobs/${jobId}/warranty-terms`, { cookie: providerCookie, method: 'POST', body: { offered: true, durationDays: 14, scope: 'ครอบคลุมอาการเดิม', exclusions: 'ความเสียหายจากอุบัติเหตุ' } });
      assert.equal(offered.response.status, 201, JSON.stringify(offered.data));
    const accepted = await request(`/api/jobs/${jobId}/warranty-terms/accept`, { cookie: customerCookie, method: 'POST', body: { offerId: offered.data.data.offerId } });
      assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data));
      const termsMessage = await request(`/api/jobs/${jobId}/messages`, { cookie: customerCookie });
      assert.equal(termsMessage.response.status, 200);
      assert.ok(termsMessage.data.data.some((item) => item.type === 'WARRANTY_TERMS' && item.terms.scope === 'ครอบคลุมอาการเดิม'));
      assert.ok(termsMessage.data.data.every((item) => !item.body?.startsWith('[FIXTECH_')));
    } else {
      const offered = await request(`/api/jobs/${jobId}/warranty-terms`, { cookie: providerCookie, method: 'POST', body: { offered: false } });
      assert.equal(offered.response.status, 201, JSON.stringify(offered.data));
      const accepted = await request(`/api/jobs/${jobId}/warranty-terms/accept`, { cookie: customerCookie, method: 'POST', body: { offerId: offered.data.data.offerId } });
      assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data));
    }
    const completed = await request(`/api/jobs/${jobId}/confirm-completion`, { cookie: customerCookie, method: 'POST', body: {} });
    assert.equal(completed.response.status, 200, JSON.stringify(completed.data));
    const paymentKey=idempotencyKey??`${jobId}-payment`;
    const payment = await request(`/api/jobs/${jobId}/payment-simulations`, { cookie: customerCookie, method: 'POST', body: { method: paymentMethod, idempotencyKey: paymentKey } });
    assert.equal(payment.response.status, 201, JSON.stringify(payment.data));
    const retry = await request(`/api/jobs/${jobId}/payment-simulations`, { cookie: customerCookie, method: 'POST', body: { method: paymentMethod, idempotencyKey: paymentKey } });
    assert.equal(retry.response.status, 201, JSON.stringify(retry.data));
    if (paymentMethod === 'PLATFORM_SIMULATED') {
      const paid = await request(`/api/payment-simulations/${payment.data.data.id}/confirm-platform`, { cookie: customerCookie, method: 'POST', body: {} });
      assert.equal(paid.response.status, 200, JSON.stringify(paid.data));
    } else {
      const paid = await request(`/api/payment-simulations/${payment.data.data.id}/confirm-direct-received`, { cookie: providerCookie, method: 'POST', body: {} });
      assert.equal(paid.response.status, 200, JSON.stringify(paid.data));
    }
    return payment.data.data;
  }

  try {
    const customer = await login(customerEmail);
    const competingCustomer = await login('customer2@fixtech.demo');
    const company = await login('company@fixtech.demo');
    const admin = await login('admin@fixtech.demo');
    const imageValidationDraft = await request('/api/jobs', { cookie: customer, method: 'POST', body: { category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', symptom: 'ทดสอบข้อจำกัดไฟล์ภาพสังเคราะห์' } });
    assert.equal(imageValidationDraft.response.status, 201);
    const imageJobId = imageValidationDraft.data.data.jobId;
    const invalidImage = await request(`/api/jobs/${imageJobId}/attachments`, { cookie: customer, method: 'POST', contentType: 'image/png', filename: 'not-an-image.png', raw: Buffer.from('not an image') });
    assert.equal(invalidImage.response.status, 400);
    assert.equal(invalidImage.data.error.code, 'INVALID_IMAGE');
    const oversizedImage = Buffer.alloc(10 * 1024 * 1024 + 1);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(oversizedImage);
    const oversizedUpload = await request(`/api/jobs/${imageJobId}/attachments`, { cookie: customer, method: 'POST', contentType: 'image/png', filename: 'oversized.png', raw: oversizedImage });
    assert.equal(oversizedUpload.response.status, 413);
    const testPng = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
    for (let index = 0; index < 3; index++) {
      const upload = await request(`/api/jobs/${imageJobId}/attachments`, { cookie: customer, method: 'POST', contentType: 'image/png', filename: `synthetic-${index + 1}.png`, raw: testPng });
      assert.equal(upload.response.status, 201, JSON.stringify(upload.data));
    }
    const fourthImage = await request(`/api/jobs/${imageJobId}/attachments`, { cookie: customer, method: 'POST', contentType: 'image/png', filename: 'synthetic-4.png', raw: testPng });
    assert.equal(fourthImage.response.status, 409);
    assert.equal(fourthImage.data.error.code, 'ATTACHMENT_LIMIT');
    const emptyPatch = await request(`/api/jobs/${imageJobId}`, { cookie: customer, method: 'PATCH', body: {} });
    assert.equal(emptyPatch.response.status, 400);
    const companyFieldPatch = await request(`/api/jobs/${imageJobId}`, { cookie: customer, method: 'PATCH', body: { manufacturer: 'Synthetic' } });
    assert.equal(companyFieldPatch.response.status, 400, 'general customer cannot add company fields');
    const unknownDistrictPatch = await request(`/api/jobs/${imageJobId}`, { cookie: customer, method: 'PATCH', body: { districtCode: 'UNKNOWN_DISTRICT' } });
    assert.equal(unknownDistrictPatch.response.status, 400, 'invalid district must not leak as a database error');

    const raceDraft = await request('/api/jobs', { cookie: customer, method: 'POST', body: { category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', symptom: 'อาการก่อนแก้ข้อมูลระหว่างขอราคา' } });
    assert.equal(raceDraft.response.status, 201);
    const raceJobId = raceDraft.data.data.jobId;
    await request(`/api/jobs/${raceJobId}/manual-summary`, { cookie: customer, method: 'POST', body: { summary: 'สรุปอาการก่อนแก้ข้อมูล' } });
    const beforeNoop = await pool.query('SELECT xmin::text AS version,analysis_version FROM jobs WHERE id=$1',[raceJobId]);
    const noOpPatch = await request(`/api/jobs/${raceJobId}`, { cookie: customer, method: 'PATCH', body: { symptom: 'อาการก่อนแก้ข้อมูลระหว่างขอราคา' } });
    assert.equal(noOpPatch.response.status, 200);
    assert.equal(noOpPatch.data.data.unchanged, true);
    const afterNoop = await pool.query('SELECT xmin::text AS version,analysis_version FROM jobs WHERE id=$1',[raceJobId]);
    assert.deepEqual(afterNoop.rows[0],beforeNoop.rows[0], 'no-op edit must preserve analysis and avoid a DB update');
    let notifyPriceStarted;
    let allowPriceToFinish;
    const priceStarted = new Promise((resolve) => { notifyPriceStarted = resolve; });
    const priceWait = new Promise((resolve) => { allowPriceToFinish = resolve; });
    referencePause = { started: notifyPriceStarted, wait: priceWait };
    referenceMode = 'paused-live';
    const racingEstimate = request(`/api/jobs/${raceJobId}/price-estimates`, { cookie: customer, method: 'POST', body: {} });
    await priceStarted;
    const changedDraft = await request(`/api/jobs/${raceJobId}`, { cookie: customer, method: 'PATCH', body: { districtCode: 'PATHUM_WAN' } });
    assert.equal(changedDraft.response.status, 200);
    allowPriceToFinish();
    const racedResult = await racingEstimate;
    assert.equal(racedResult.response.status, 409, 'estimate must reject a Draft changed while the price source was pending');
    assert.equal(racedResult.data.error.code, 'JOB_CHANGED');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM price_estimates WHERE job_id=$1',[raceJobId])).rows[0].n,0);
    referencePause = null;
    referenceMode = 'fresh-live';

    const aiRaceDraft = await request('/api/jobs', { cookie: customer, method: 'POST', body: { category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', symptom: 'อาการก่อนแก้ระหว่าง AI วิเคราะห์' } });
    assert.equal(aiRaceDraft.response.status, 201);
    const aiRaceJobId = aiRaceDraft.data.data.jobId;
    const aiRaceConsent = await request(`/api/jobs/${aiRaceJobId}/ai-consents`, { cookie: customer, method: 'POST', body: { dataScope: { symptom: true, attachmentIds: [] } } });
    assert.equal(aiRaceConsent.response.status, 201);
    let notifyAiStarted;
    let allowAiToFinish;
    const aiStarted = new Promise((resolve) => { notifyAiStarted = resolve; });
    const aiWait = new Promise((resolve) => { allowAiToFinish = resolve; });
    aiPause = { started: notifyAiStarted, wait: aiWait };
    const racingAnalysis = request(`/api/jobs/${aiRaceJobId}/analyze`, { cookie: customer, method: 'POST', body: {} });
    await aiStarted;
    const changedAiDraft = await request(`/api/jobs/${aiRaceJobId}`, { cookie: customer, method: 'PATCH', body: { symptom: 'อาการใหม่หลังแก้ระหว่าง AI วิเคราะห์' } });
    assert.equal(changedAiDraft.response.status, 200);
    allowAiToFinish();
    const racedAnalysis = await racingAnalysis;
    assert.equal(racedAnalysis.response.status, 409, 'analysis must reject a Draft changed while the AI provider was pending');
    assert.equal(racedAnalysis.data.error.code, 'JOB_CHANGED');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM ai_analysis_runs WHERE job_id=$1',[aiRaceJobId])).rows[0].n,0);
    aiPause = null;
    const staleGenerateDraft = await request('/api/jobs', { cookie: customer, method: 'POST', body: { category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', symptom: 'ทดสอบราคาอ้างอิงหมดอายุ' } });
    assert.equal(staleGenerateDraft.response.status, 201);
    referenceMode = 'stale-curated';
    const staleGeneratedEstimate = await request(`/api/jobs/${staleGenerateDraft.data.data.jobId}/price-estimates`, { cookie: customer, method: 'POST', body: {} });
    assert.equal(staleGeneratedEstimate.response.status, 503, 'estimate generation must fail closed when reviewedAt is over 30 days old');
    assert.equal(staleGeneratedEstimate.data.error.code, 'ESTIMATE_UNAVAILABLE');
    referenceMode = 'fresh-live';

    const staleAcceptDraft = await request('/api/jobs', { cookie: customer, method: 'POST', body: { category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', symptom: 'ทดสอบหมดอายุก่อนยอมรับ' } });
    const staleAcceptJobId = staleAcceptDraft.data.data.jobId;
    await request(`/api/jobs/${staleAcceptJobId}/manual-summary`, { cookie: customer, method: 'POST', body: { summary: 'ทดสอบการยอมรับราคาหมดอายุ' } });
    const staleAcceptEstimate = await request(`/api/jobs/${staleAcceptJobId}/price-estimates`, { cookie: customer, method: 'POST', body: {} });
    await pool.query(`UPDATE price_estimates SET source_snapshot=jsonb_set(jsonb_set(source_snapshot,'{referenceType}','"CURATED_PUBLIC_EXAMPLES"'),'{reviewedAt}',to_jsonb($2::text)) WHERE id=$1`, [staleAcceptEstimate.data.data.estimateId, new Date(Date.now() - 31 * 86400_000).toISOString()]);
    const staleAccept = await request(`/api/jobs/${staleAcceptJobId}/price-estimates/${staleAcceptEstimate.data.data.estimateId}/accept`, { cookie: customer, method: 'POST', body: {} });
    assert.equal(staleAccept.response.status, 409, 'acceptance must recheck the curated reviewedAt cutoff');
    assert.equal(staleAccept.data.error.code, 'ESTIMATE_STALE');

    const stalePublishDraft = await request('/api/jobs', { cookie: customer, method: 'POST', body: { category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', symptom: 'ทดสอบหมดอายุก่อนเผยแพร่' } });
    const stalePublishJobId = stalePublishDraft.data.data.jobId;
    await request(`/api/jobs/${stalePublishJobId}/manual-summary`, { cookie: customer, method: 'POST', body: { summary: 'ทดสอบการเผยแพร่ด้วยราคาหมดอายุ' } });
    const stalePublishEstimate = await request(`/api/jobs/${stalePublishJobId}/price-estimates`, { cookie: customer, method: 'POST', body: {} });
    await request(`/api/jobs/${stalePublishJobId}/confirm-summary`, { cookie: customer, method: 'POST', body: {} });
    await request(`/api/jobs/${stalePublishJobId}/price-estimates/${stalePublishEstimate.data.data.estimateId}/accept`, { cookie: customer, method: 'POST', body: {} });
    await pool.query(`UPDATE price_estimates SET source_snapshot=jsonb_set(jsonb_set(source_snapshot,'{referenceType}','"CURATED_PUBLIC_EXAMPLES"'),'{reviewedAt}',to_jsonb($2::text)) WHERE id=$1`, [stalePublishEstimate.data.data.estimateId, new Date(Date.now() - 31 * 86400_000).toISOString()]);
    const stalePublish = await request(`/api/jobs/${stalePublishJobId}/publish`, { cookie: customer, method: 'POST', body: {} });
    assert.equal(stalePublish.response.status, 409, 'publish must recheck that the accepted estimate is still fresh');
    assert.equal(stalePublish.data.error.code, 'ESTIMATE_STALE');
    const stalePublishState = await request(`/api/jobs/${stalePublishJobId}`, { cookie: customer });
    assert.equal(stalePublishState.data.data.status, 'READY_TO_PUBLISH', 'stale publish must leave the job unpublished');

    const general = await createAndPublish({ cookie: customer, category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', withAi: true });
    assert.equal(general.published.status, 'WAITING_FOR_APPOINTMENT');
    const ownerDetail = await request(`/api/jobs/${general.jobId}`, { cookie: customer });
    assert.equal(ownerDetail.response.status, 200);
    assert.equal('assigned_provider_id' in ownerDetail.data.data, false, 'customer must not receive provider profile id');
    const ownerList = await request('/api/jobs', { cookie: customer });
    const listedGeneral = ownerList.data.data.find((job) => job.id === general.jobId);
    assert.equal('assigned_provider_id' in listedGeneral, false, 'customer list must not expose provider profile id');
    assert.equal(listedGeneral.has_provider, true);
    const assigned = await pool.query('SELECT u.email FROM jobs j JOIN provider_profiles p ON p.id=j.assigned_provider_id JOIN users u ON u.id=p.user_id WHERE j.id=$1', [general.jobId]);
    const technician = await login(assigned.rows[0].email);
    const technicianDetail = await request(`/api/jobs/${general.jobId}`, { cookie: technician });
    assert.equal(technicianDetail.response.status, 200);
    assert.equal('customer_user_id' in technicianDetail.data.data, false, 'technician must not receive customer profile id');
    const earlyStart = await request(`/api/jobs/${general.jobId}/start`, { cookie: technician, method: 'POST', body: {} });
    assert.equal(earlyStart.response.status, 409, 'technician must not start before both parties confirm an appointment');
    const privateFile = await request(`/api/jobs/${general.jobId}/attachments/${general.attachmentId}`, { cookie: technician, binary: true });
    assert.equal(privateFile.response.status, 200);
    const unrelatedFile = await request(`/api/jobs/${general.jobId}/attachments/${general.attachmentId}`, { cookie: company, binary: true });
    assert.equal(unrelatedFile.response.status, 404, 'an unrelated company must not download a private attachment');
    const denial = await request(`/api/jobs/${general.jobId}`, { cookie: company });
    assert.equal(denial.response.status, 404);
    const payment = await finishJob({ customerCookie: customer, providerCookie: technician, jobId: general.jobId, paymentMethod: 'DIRECT', conflictCustomerCookie: competingCustomer });
    const secondGeneral = await createAndPublish({ cookie: competingCustomer, category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA' });
    const secondProviderRow = await pool.query('SELECT u.email FROM jobs j JOIN provider_profiles p ON p.id=j.assigned_provider_id JOIN users u ON u.id=p.user_id WHERE j.id=$1', [secondGeneral.jobId]);
    const secondProvider = await login(secondProviderRow.rows[0].email);
    await finishJob({ customerCookie: competingCustomer, providerCookie: secondProvider, jobId: secondGeneral.jobId, paymentMethod: 'DIRECT' });
    const crossJobRetry = await request(`/api/jobs/${secondGeneral.jobId}/payment-simulations`, { cookie: competingCustomer, method: 'POST', body: { method: 'DIRECT', idempotencyKey: `${general.jobId}-payment` } });
    assert.equal(crossJobRetry.response.status, 409, 'idempotency key from another job must not return that job\'s payment');
    const appointments = await request(`/api/jobs/${general.jobId}/appointments`, { cookie: customer });
    assert.equal(appointments.response.status, 200);
    assert.equal('proposed_by_user_id' in appointments.data.data[0], false, 'appointments must not expose party profile ids');
    assert.equal(payment.amount > 0, true);
    const review = await request(`/api/jobs/${general.jobId}/reviews`, { cookie: customer, method: 'POST', body: { rating: 5, comment: 'ทดสอบรีวิว' } });
    assert.equal(review.response.status, 201, JSON.stringify(review.data));
    const duplicateReview = await request(`/api/jobs/${general.jobId}/reviews`, { cookie: customer, method: 'POST', body: { rating: 4 } });
    assert.equal(duplicateReview.response.status, 409);
    const claim = await request(`/api/jobs/${general.jobId}/warranty-claims`, { cookie: customer, method: 'POST', body: { reason: 'ทดสอบการใช้สิทธิ์รับประกัน' } });
    assert.equal(claim.response.status, 201, JSON.stringify(claim.data));
    const claimQueue = await request('/api/admin/warranty-claims', { cookie: admin });
    assert.equal(claimQueue.response.status, 200);
    const claimResolution = await request(`/api/admin/warranty-claims/${claim.data.data.id}/resolve`, { cookie: admin, method: 'POST', body: { status: 'RESOLVED', resolution: 'ปิดผลทดสอบ' } });
    assert.equal(claimResolution.response.status, 200, JSON.stringify(claimResolution.data));
    const dispute = await request(`/api/jobs/${general.jobId}/disputes`, { cookie: customer, method: 'POST', body: { type: 'WARRANTY', reason: 'ทดสอบข้อพิพาท', attachmentIds: [general.attachmentId] } });
    assert.equal(dispute.response.status, 201, JSON.stringify(dispute.data));
    const adminQueue = await request('/api/admin/disputes', { cookie: admin });
    assert.equal(adminQueue.response.status, 200);
    const invalidReturn = await request(`/api/admin/disputes/${dispute.data.data.id}/resolve`, { cookie: admin, method: 'POST', body: { outcome: 'RETURN_TO_CUSTOMER', resolution: 'ทดสอบการป้องกันสถานะเสร็จแล้ว' } });
    assert.equal(invalidReturn.response.status, 409, 'completed job must not return to customer confirmation');
    const resolution = await request(`/api/admin/disputes/${dispute.data.data.id}/resolve`, { cookie: admin, method: 'POST', body: { outcome: 'KEEP_COMPLETED', resolution: 'ปิดผลทดสอบ' } });
    assert.equal(resolution.response.status, 200, JSON.stringify(resolution.data));
    const adminEvidence = await request(`/api/jobs/${general.jobId}/attachments/${general.attachmentId}`, { cookie: admin, binary: true });
    assert.equal(adminEvidence.response.status, 200);

    const business = await createAndPublish({ cookie: company, category: 'HARDWARE', serviceFormat: 'ONSITE', districtCode: 'PATHUM_WAN' });
    assert.equal(business.published.status, 'WAITING_FOR_SELECTION');
    const offers = await request(`/api/jobs/${business.jobId}/offers`, { cookie: company });
    assert.equal(offers.response.status, 200); assert.equal(offers.data.data.length, 2);
    const selected = await request(`/api/jobs/${business.jobId}/offers/${offers.data.data[0].id}/select`, { cookie: company, method: 'POST', body: {} });
    assert.equal(selected.response.status, 200, JSON.stringify(selected.data));
    const techRow = await pool.query('SELECT u.email FROM jobs j JOIN provider_profiles p ON p.id=j.assigned_provider_id JOIN users u ON u.id=p.user_id WHERE j.id=$1',[business.jobId]);
    const businessTech = await login(techRow.rows[0].email);
    const appointmentTime = new Date(Date.now()+24*60*60_000);
    const bAppt = await request(`/api/jobs/${business.jobId}/appointments`,{cookie:company,method:'POST',body:{startsAt:appointmentTime.toISOString(),endsAt:new Date(appointmentTime.getTime()+3600_000).toISOString()}});
    assert.equal(bAppt.response.status,201,JSON.stringify(bAppt.data));
    const bConfirmed = await request(`/api/appointments/${bAppt.data.data.appointmentId}/confirm`,{cookie:businessTech,method:'POST',body:{}});
    assert.equal(bConfirmed.response.status,200,JSON.stringify(bConfirmed.data));
    const bStarted = await request(`/api/jobs/${business.jobId}/start`,{cookie:businessTech,method:'POST',body:{}});
    assert.equal(bStarted.response.status,200,JSON.stringify(bStarted.data));
    const bSubmit = await request(`/api/jobs/${business.jobId}/submit-completion`,{cookie:businessTech,method:'POST',body:{}});
    assert.equal(bSubmit.response.status,200,JSON.stringify(bSubmit.data));
    const terms = await request(`/api/jobs/${business.jobId}/warranty-terms`,{cookie:businessTech,method:'POST',body:{offered:false}});
    assert.equal(terms.response.status,201,JSON.stringify(terms.data));
    const termsAccepted = await request(`/api/jobs/${business.jobId}/warranty-terms/accept`,{cookie:company,method:'POST',body:{offerId:terms.data.data.offerId}});
    assert.equal(termsAccepted.response.status,200,JSON.stringify(termsAccepted.data));
    const bComplete=await request(`/api/jobs/${business.jobId}/confirm-completion`,{cookie:company,method:'POST',body:{}});
    assert.equal(bComplete.response.status,200,JSON.stringify(bComplete.data));
    const forbiddenDirect=await request(`/api/jobs/${business.jobId}/payment-simulations`,{cookie:company,method:'POST',body:{method:'DIRECT',idempotencyKey:`${business.jobId}-bad`}});
    assert.equal(forbiddenDirect.response.status,403);
    const bPayment=await request(`/api/jobs/${business.jobId}/payment-simulations`,{cookie:company,method:'POST',body:{method:'PLATFORM_SIMULATED',idempotencyKey:`${business.jobId}-paid`}});
    assert.equal(bPayment.response.status,201,JSON.stringify(bPayment.data));
    const bPaid=await request(`/api/payment-simulations/${bPayment.data.data.id}/confirm-platform`,{cookie:company,method:'POST',body:{}});
    assert.equal(bPaid.response.status,200,JSON.stringify(bPaid.data));
    const notices=await request('/api/notifications',{cookie:customer});
    assert.equal(notices.response.status,200); assert.ok(notices.data.data.length>0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await rm(storageRoot,{recursive:true,force:true});
  }
});
