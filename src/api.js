import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { basename, resolve } from 'node:path';
import express from 'express';
import { getSessionToken, hashPassword, issueSession, readSession, sessionCookie, verifyPassword } from './auth.js';
import { CURATED_REFERENCE_MAX_AGE_DAYS, estimatePrice, referenceIsFresh } from './pricing.js';
import { registerFastworkApi } from './routes/fastwork.js';
import { registerAdminApi } from './routes/admin.js';
import { registerAiScreeningApi } from './routes/ai-screening.js';

const CUSTOMER_ROLES = new Set(['CUSTOMER_GENERAL', 'CUSTOMER_BUSINESS']);
const JOB_TERMINAL = new Set(['COMPLETED', 'CANCELLED']);
const JOB_TRANSITIONS = Object.freeze({
  DRAFT: new Set(['READY_TO_PUBLISH','CANCELLED']),
  READY_TO_PUBLISH: new Set(['POSTED','CANCELLED']),
  POSTED: new Set(['MATCHED','WAITING_FOR_SELECTION','NO_PROVIDER_FOUND','CANCELLED']),
  MATCHED: new Set(['WAITING_FOR_APPOINTMENT','CANCELLED']),
  WAITING_FOR_SELECTION: new Set(['ASSIGNED','NO_PROVIDER_FOUND','CANCELLED']),
  ASSIGNED: new Set(['WAITING_FOR_APPOINTMENT','CANCELLED']),
  NO_PROVIDER_FOUND: new Set(['CANCELLED']),
  WAITING_FOR_APPOINTMENT: new Set(['SCHEDULED','CANCELLED']),
  SCHEDULED: new Set(['WAITING_FOR_APPOINTMENT','IN_PROGRESS','CANCELLED']),
  IN_PROGRESS: new Set(['WAITING_FOR_CUSTOMER_CONFIRMATION']),
  WAITING_FOR_CUSTOMER_CONFIRMATION: new Set(['COMPLETED','DISPUTED']),
  COMPLETED: new Set(['DISPUTED']),
  DISPUTED: new Set(['WAITING_FOR_CUSTOMER_CONFIRMATION','COMPLETED','CANCELLED']),
  CANCELLED: new Set()
});
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_IMAGES = 3;
const MAX_AI_CHAT_TURNS = 20;

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function fail(status, code, message) { throw new HttpError(status, code, message); }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? '')); }
function text(value, max, field) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max) fail(400, 'VALIDATION_ERROR', `${field} ไม่ถูกต้อง`);
  return value.trim();
}
function cookieOptions(env) { return { secure: env.NODE_ENV === 'production' }; }
function safeUser(row) {
  return { id: row.id, email: row.email, role: row.role, displayName: row.display_name, providerId: row.provider_id ?? null };
}
function isOwner(job, user) { return job.customer_user_id === user.id; }
function canAccess(job, user) {
  return user.role === 'ADMIN' || isOwner(job, user) ||
    (user.role === 'TECHNICIAN' && job.assigned_provider_id && job.assigned_provider_id === user.providerId);
}
function requireRole(user, allowed) { if (!allowed.includes(user.role)) fail(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้'); }
function requireOwner(job, user) { if (!isOwner(job, user)) fail(404, 'NOT_FOUND', 'ไม่พบงาน'); }
function requireProvider(job, user) {
  if (user.role !== 'TECHNICIAN' || job.assigned_provider_id !== user.providerId) fail(404, 'NOT_FOUND', 'ไม่พบงาน');
}
function requireParticipant(job, user) {
  if (!canAccess(job, user) || user.role === 'ADMIN') fail(404, 'NOT_FOUND', 'ไม่พบงาน');
}
function parseCookieToken(req, env) {
  return readSession(getSessionToken(req), env.SESSION_SECRET);
}
async function tx(pool, callback) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await callback(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
async function jobFor(client, id, { lock = false } = {}) {
  if (!isUuid(id)) fail(404, 'NOT_FOUND', 'ไม่พบงาน');
  const result = await client.query(
    `SELECT j.*, j.xmin::text AS row_version, p.user_id AS provider_user_id
     FROM jobs j LEFT JOIN provider_profiles p ON p.id = j.assigned_provider_id
     WHERE j.id = $1 ${lock ? 'FOR UPDATE OF j' : ''}`,
    [id]
  );
  if (!result.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบงาน');
  return result.rows[0];
}
async function statusEvent(client, job, actorId, nextStatus) {
  if (!JOB_TRANSITIONS[job.status]?.has(nextStatus)) fail(409,'INVALID_STATE_TRANSITION',`เปลี่ยนสถานะจาก ${job.status} ไป ${nextStatus} ไม่ได้`);
  await client.query('INSERT INTO job_status_events(id,job_id,actor_user_id,from_status,to_status) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), job.id, actorId, job.status, nextStatus]);
}
async function notify(client, userId, jobId, eventKey, type, title, body) {
  if (!userId) return;
  await client.query(
    `INSERT INTO notifications(id,user_id,job_id,event_key,type,title,body)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,event_key) DO NOTHING`,
    [randomUUID(), userId, jobId, eventKey, type, title, body]
  );
}
async function notifyParties(client, job, actorId, eventKey, title, body) {
  await notify(client, job.customer_user_id, job.id, eventKey, 'JOB_UPDATE', title, body);
  if (job.provider_user_id !== actorId) await notify(client, job.provider_user_id, job.id, eventKey, 'JOB_UPDATE', title, body);
}
function validateStatus(job, states) { if (!states.includes(job.status)) fail(409, 'INVALID_STATE_TRANSITION', 'สถานะงานไม่อนุญาตให้ทำรายการนี้'); }
function hasImageSignature(mime, data) {
  if (mime === 'image/jpeg') return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mime === 'image/png') return data.length >= 8 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/webp') return data.length >= 12 && data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP';
  return false;
}
function expressRawImage(req,res,callback,next) {
  express.raw({ type: 'image/*', limit: MAX_IMAGE })(req,res,(error) => {
    if (error) return next(error);
    Promise.resolve(callback(req.body)).catch(next);
  });
}

export function registerApi(app, { pool, env, aiProvider, marketPriceProvider, storageRoot }) {
  const loginAttempts = new Map();
  const registrationAttempts = new Map();
  app.get('/api/catalog', async (_req, res) => {
    const [services, districts] = await Promise.all([
      pool.query('SELECT category,service_format,label FROM service_catalog WHERE is_active ORDER BY category'),
      pool.query('SELECT code,name FROM districts ORDER BY name')
    ]);
    res.json({ data: { services: services.rows, districts: districts.rows } });
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const key = `${req.ip}:${email}`;
    const attempts = loginAttempts.get(key) ?? { count: 0, since: Date.now() };
    if (Date.now() - attempts.since > 15 * 60_000) { attempts.count = 0; attempts.since = Date.now(); }
    if (attempts.count >= 10) fail(429, 'LOGIN_THROTTLED', 'ลองเข้าสู่ระบบใหม่ภายหลัง');
    const result = await pool.query(
      `SELECT u.id,u.email,u.role,u.display_name,u.password_hash,u.is_active,p.id AS provider_id
       FROM users u LEFT JOIN provider_profiles p ON p.user_id=u.id WHERE lower(u.email)=lower($1)`, [email]
    );
    const user = result.rows[0];
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      attempts.count += 1; loginAttempts.set(key, attempts);
      fail(401, 'INVALID_CREDENTIALS', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }
    loginAttempts.delete(key);
    res.setHeader('Set-Cookie', sessionCookie(issueSession(user.id, env.SESSION_SECRET), cookieOptions(env)));
    res.json({ data: { user: safeUser(user) } });
  });

  app.post('/api/auth/register', async (req, res) => {
    const key = req.ip;
    const attempts = registrationAttempts.get(key) ?? { count: 0, since: Date.now() };
    if (Date.now() - attempts.since > 15 * 60_000) { attempts.count = 0; attempts.since = Date.now(); }
    if (attempts.count >= 10) fail(429, 'REGISTRATION_THROTTLED', 'สมัครบัญชีหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง');
    attempts.count += 1;
    registrationAttempts.set(key, attempts);

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'VALIDATION_ERROR', 'อีเมลไม่ถูกต้อง');
    const displayName = text(req.body?.displayName, 100, 'ชื่อที่แสดง');
    const role = req.body?.role;
    if (!CUSTOMER_ROLES.has(role)) fail(400, 'VALIDATION_ERROR', 'สมัครได้เฉพาะบัญชีลูกค้าทั่วไปหรือลูกค้าบริษัท');
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'VALIDATION_ERROR', 'รหัสผ่านต้องยาว 12–128 ตัวอักษร');
    const companyName = role === 'CUSTOMER_BUSINESS' ? text(req.body?.companyName, 160, 'ชื่อบริษัท') : null;
    const existing = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1) LIMIT 1', [email]);
    if (existing.rowCount) fail(409, 'EMAIL_ALREADY_REGISTERED', 'อีเมลนี้มีบัญชีแล้ว กรุณาใช้อีเมลอื่นหรือเข้าสู่ระบบ');

    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    try {
      await tx(pool, async (client) => {
        await client.query('INSERT INTO users(id,email,password_hash,role,display_name) VALUES($1,$2,$3,$4,$5)', [id, email, passwordHash, role, displayName]);
        if (role === 'CUSTOMER_BUSINESS') await client.query(
          'INSERT INTO company_profiles(user_id,company_name,contact_name) VALUES($1,$2,$3)', [id, companyName, displayName]
        );
      });
    } catch (error) {
      if (error.code === '23505') fail(409, 'EMAIL_ALREADY_REGISTERED', 'อีเมลนี้มีบัญชีแล้ว กรุณาใช้อีเมลอื่นหรือเข้าสู่ระบบ');
      throw error;
    }
    const user = { id, email, role, displayName, providerId: null };
    res.setHeader('Set-Cookie', sessionCookie(issueSession(id, env.SESSION_SECRET), cookieOptions(env)));
    res.status(201).json({ data: { user } });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', sessionCookie('', { ...cookieOptions(env), clear: true }));
    res.status(204).end();
  });

  app.use('/api', async (req, _res, next) => {
    if (req.path === '/health/live' || req.path === '/health/ready' || req.path === '/demo/status' || req.path === '/catalog' || req.path === '/auth/login' || req.path === '/auth/register' || req.path === '/auth/logout' || req.path === '/ai/screen-chat') return next();
    if (!/^\/(auth\/me|jobs(?:\/|$)|notifications(?:\/|$)|appointments\/|payment-simulations\/|admin\/|users\/|technician\/|reports(?:\/|$)|ai\/)/.test(req.path)) return next();
    const userId = parseCookieToken(req, env);
    if (!userId) return next(new HttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ'));
    try {
      const result = await pool.query(
        `SELECT u.id,u.email,u.role,u.display_name,u.is_active,p.id AS provider_id
         FROM users u LEFT JOIN provider_profiles p ON p.user_id=u.id WHERE u.id=$1`, [userId]
      );
      if (!result.rowCount || !result.rows[0].is_active) return next(new HttpError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบใหม่'));
      req.user = safeUser(result.rows[0]); next();
    } catch (error) { next(error); }
  });

  app.get('/api/auth/me', (req, res) => res.json({ data: { user: req.user } }));

  app.post('/api/jobs/:jobId/attachments', async (req, res, next) => {
    expressRawImage(req,res,async (body) => {
      const mime = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
      const data = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
      if (!IMAGE_TYPES.has(mime) || data.length < 1 || data.length > MAX_IMAGE || !hasImageSignature(mime,data)) fail(400,'INVALID_IMAGE','ชนิดหรือขนาดรูปภาพไม่ถูกต้อง');
      const id = randomUUID(); const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'; const key = `${id}.${ext}`;
      const filename = basename(String(req.headers['x-file-name'] ?? `image.${ext}`).replace(/[\u0000-\u001f\u007f]/g,'')).slice(0,255) || 'image';
      const filePath = resolve(storageRoot,key);
      await fs.mkdir(storageRoot,{recursive:true,mode:0o700}); await fs.writeFile(filePath,data,{flag:'wx',mode:0o600});
      try {
        await tx(pool,async (client) => {
          const job = await jobFor(client,req.params.jobId,{lock:true}); requireOwner(job,req.user);
          validateStatus(job,['DRAFT','READY_TO_PUBLISH','POSTED','MATCHED','WAITING_FOR_SELECTION','ASSIGNED','NO_PROVIDER_FOUND','WAITING_FOR_APPOINTMENT','SCHEDULED','IN_PROGRESS','WAITING_FOR_CUSTOMER_CONFIRMATION']);
          const count = await client.query("SELECT count(*)::int AS n FROM job_attachments WHERE job_id=$1 AND status='ACTIVE'",[job.id]);
          if (count.rows[0].n >= MAX_IMAGES) fail(409,'ATTACHMENT_LIMIT','งานหนึ่งรายการแนบได้ไม่เกิน 3 รูป');
          await client.query(`INSERT INTO job_attachments(id,job_id,uploaded_by_user_id,storage_key,original_filename,mime_type,size_bytes,sha256)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,job.id,req.user.id,key,filename,mime,data.length,createHash('sha256').update(data).digest('hex')]);
        });
      } catch (error) { await fs.rm(filePath,{force:true}); throw error; }
      res.status(201).json({data:{attachmentId:id,filename,mimeType:mime,sizeBytes:data.length}});
    },next);
  });

  app.get('/api/jobs/:jobId/attachments/:attachmentId',async (req,res) => {
    const job = await jobFor(pool,req.params.jobId);
    const found = await pool.query("SELECT * FROM job_attachments WHERE id=$1 AND job_id=$2 AND status='ACTIVE'",[req.params.attachmentId,job.id]);
    if (!found.rowCount) fail(404,'NOT_FOUND','ไม่พบไฟล์');
    if (req.user.role === 'ADMIN') {
      const evidence = await pool.query('SELECT 1 FROM dispute_evidence de JOIN disputes d ON d.id=de.dispute_id WHERE de.attachment_id=$1 AND d.job_id=$2 LIMIT 1',[req.params.attachmentId,job.id]);
      if (!evidence.rowCount) fail(404,'NOT_FOUND','ไม่พบไฟล์');
    } else if (!canAccess(job,req.user)) fail(404,'NOT_FOUND','ไม่พบไฟล์');
    res.setHeader('Content-Type',found.rows[0].mime_type); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Disposition',`attachment; filename="${found.rows[0].original_filename.replace(/["\\\r\n]/g,'_')}"`);
    createReadStream(resolve(storageRoot,found.rows[0].storage_key)).on('error',() => { if (!res.headersSent) res.status(404).end(); else res.destroy(); }).pipe(res);
  });

  app.delete('/api/jobs/:jobId/attachments/:attachmentId',async (req,res) => {
    const key = await tx(pool,async (client) => {
      const job = await jobFor(client,req.params.jobId,{lock:true}); requireOwner(job,req.user);
      const file = await client.query("SELECT storage_key FROM job_attachments WHERE id=$1 AND job_id=$2 AND status='ACTIVE' FOR UPDATE",[req.params.attachmentId,job.id]);
      if (!file.rowCount) fail(404,'NOT_FOUND','ไม่พบไฟล์');
      const used = await client.query('SELECT 1 FROM dispute_evidence WHERE attachment_id=$1 LIMIT 1',[req.params.attachmentId]);
      if (used.rowCount) fail(409,'EVIDENCE_LOCKED','ไฟล์ถูกใช้เป็นหลักฐานข้อพิพาท');
      await client.query("UPDATE job_attachments SET status='DELETED' WHERE id=$1",[req.params.attachmentId]);
      await client.query('UPDATE ai_consents SET revoked_at=now() WHERE job_id=$1 AND revoked_at IS NULL',[job.id]);
      return file.rows[0].storage_key;
    });
    await fs.rm(resolve(storageRoot,key),{force:true}); res.status(204).end();
  });

  app.post('/api/jobs', async (req, res) => {
    requireRole(req.user, [...CUSTOMER_ROLES]);
    const category = req.body?.category ?? 'HARDWARE';
    const serviceFormat = req.body?.serviceFormat ?? 'ONSITE';
    const districtCode = text(req.body?.districtCode ?? 'BANG_NA', 30, 'districtCode');
    const symptom = text(req.body?.symptom ?? req.body?.symptomText ?? 'แจ้งซ่อมอุปกรณ์', 1000, 'symptom');
    if (![['SOFTWARE','ONLINE'], ['HARDWARE','ONSITE']].some(([c, f]) => c === category && f === serviceFormat)) fail(400, 'VALIDATION_ERROR', 'ประเภทงานและรูปแบบบริการไม่รองรับ');
    const manufacturer = req.body?.manufacturer ? text(req.body.manufacturer, 100, 'manufacturer') : null;
    const model = req.body?.model ? text(req.body.model, 100, 'model') : null;
    const preferred = req.body?.preferredTimeNote ? text(req.body.preferredTimeNote, 200, 'preferredTimeNote') : null;

    const deviceType = req.body?.deviceType ? text(req.body.deviceType, 30, 'deviceType') : null;
    const deviceBrandOrModel = req.body?.deviceBrandOrModel ? text(req.body.deviceBrandOrModel, 150, 'deviceBrandOrModel') : (manufacturer ? `${manufacturer} ${model ?? ''}`.trim() : null);
    const powerFanBeepStatus = req.body?.powerFanBeepStatus ? text(req.body.powerFanBeepStatus, 1000, 'powerFanBeepStatus') : null;
    const screenCableStatus = req.body?.screenCableStatus ? text(req.body.screenCableStatus, 1000, 'screenCableStatus') : null;
    const preIncidentEvent = req.body?.preIncidentEvent ? text(req.body.preIncidentEvent, 1000, 'preIncidentEvent') : null;
    const batteryChargingStatus = req.body?.batteryChargingStatus ? text(req.body.batteryChargingStatus, 1000, 'batteryChargingStatus') : null;
    const chassisScreenKeyboardStatus = req.body?.chassisScreenKeyboardStatus ? text(req.body.chassisScreenKeyboardStatus, 1000, 'chassisScreenKeyboardStatus') : null;
    const damageHistory = req.body?.damageHistory ? text(req.body.damageHistory, 1000, 'damageHistory') : null;
    const otherSymptoms = req.body?.otherSymptoms ? text(req.body.otherSymptoms, 1000, 'otherSymptoms') : null;
    const aiDraftChecklist = req.body?.aiDraftChecklist ? JSON.stringify(req.body.aiDraftChecklist) : null;
    const aiSummary = req.body?.aiSummary ? text(req.body.aiSummary, 1000, 'aiSummary') : null;

    const directPublish = Boolean(req.body?.directPublish);
    const initialStatus = directPublish ? 'POSTED' : 'DRAFT';

    const id = randomUUID();
    await tx(pool, async (client) => {
      const district = await client.query('SELECT 1 FROM districts WHERE code=$1', [districtCode]);
      if (!district.rowCount) fail(400, 'VALIDATION_ERROR', 'เขตบริการไม่ถูกต้อง');
      await client.query(
        `INSERT INTO jobs(
           id, customer_user_id, district_code, category, service_format, status, symptom_text,
           manufacturer, model, preferred_time_note, device_type, device_brand_or_model,
           power_fan_beep_status, screen_cable_status, pre_incident_event, battery_charging_status,
           chassis_screen_keyboard_status, damage_history, other_symptoms, ai_draft_checklist, ai_summary,
           posted_at
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          id, req.user.id, districtCode, category, serviceFormat, initialStatus, symptom,
          manufacturer, model, preferred, deviceType, deviceBrandOrModel,
          powerFanBeepStatus, screenCableStatus, preIncidentEvent, batteryChargingStatus,
          chassisScreenKeyboardStatus, damageHistory, otherSymptoms, aiDraftChecklist, aiSummary,
          directPublish ? new Date() : null
        ]
      );
      await client.query("INSERT INTO job_status_events(id,job_id,actor_user_id,from_status,to_status) VALUES($1,$2,$3,NULL,'DRAFT')", [randomUUID(), id, req.user.id]);
      if (directPublish) {
        await client.query("INSERT INTO job_status_events(id,job_id,actor_user_id,from_status,to_status) VALUES($1,$2,$3,'DRAFT','POSTED')", [randomUUID(), id, req.user.id]);
      }
    });
    res.status(201).json({ data: { jobId: id, status: initialStatus } });
  });

  app.get('/api/jobs', async (req, res) => {
    let result;
    if (req.user.role === 'ADMIN') result = await pool.query('SELECT id,customer_user_id,district_code,category,service_format,assigned_provider_id,agreed_amount,status,symptom_text,created_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT 100');
    else if (req.user.role === 'TECHNICIAN') result = await pool.query('SELECT id,district_code,category,service_format,assigned_provider_id,agreed_amount,status,symptom_text,created_at,updated_at FROM jobs WHERE assigned_provider_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.providerId]);
    else result = await pool.query('SELECT id,customer_user_id,district_code,category,service_format,(assigned_provider_id IS NOT NULL) AS has_provider,agreed_amount,status,symptom_text,ai_summary,manufacturer,model,preferred_time_note,created_at,updated_at FROM jobs WHERE customer_user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    res.json({ data: result.rows });
  });

  app.get('/api/jobs/:jobId', async (req, res) => {
    const job = await jobFor(pool, req.params.jobId);
    if (!canAccess(job, req.user)) fail(404, 'NOT_FOUND', 'ไม่พบงาน');
    const result = await pool.query(
      `SELECT j.id,j.customer_user_id,j.district_code,j.category,j.service_format,j.assigned_provider_id,
              j.agreed_amount,j.agreed_by_user_id,j.agreed_at,j.status,j.symptom_text,j.ai_summary,
              j.manufacturer,j.model,j.preferred_time_note,j.analysis_version,j.confirmed_analysis_version,
              j.created_at,j.updated_at,j.posted_at,j.started_at,j.submitted_at,j.completed_at,j.cancelled_at,
              p.display_name AS provider_label
       FROM jobs j LEFT JOIN provider_profiles p ON p.id=j.assigned_provider_id WHERE j.id=$1`, [job.id]
    );
    const attachments = await pool.query('SELECT id,original_filename,mime_type,size_bytes,created_at FROM job_attachments WHERE job_id=$1 AND status=\'ACTIVE\' ORDER BY created_at', [job.id]);
    const view = { ...result.rows[0], attachments: attachments.rows };
    if (view.assigned_provider_id) view.provider_label = 'ช่างที่จับคู่แล้ว';
    if (req.user.role === 'CUSTOMER_GENERAL' || req.user.role === 'CUSTOMER_BUSINESS') delete view.assigned_provider_id;
    if (req.user.role === 'TECHNICIAN') delete view.customer_user_id;
    res.json({ data: view });
  });

  app.get('/api/jobs/:jobId/events',async(req,res)=>{
    const job=await jobFor(pool,req.params.jobId); if(!canAccess(job,req.user)) fail(404,'NOT_FOUND','ไม่พบงาน');
    const result=await pool.query(`SELECT e.from_status,e.to_status,e.created_at,u.role AS actor_role
      FROM job_status_events e JOIN users u ON u.id=e.actor_user_id WHERE e.job_id=$1 ORDER BY e.created_at,e.id`,[job.id]);
    res.json({data:result.rows});
  });

  app.patch('/api/jobs/:jobId', async (req, res) => {
    const allowedKeys = ['symptom','districtCode','manufacturer','model','preferredTimeNote'];
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length === 0) fail(400, 'VALIDATION_ERROR', 'ต้องระบุฟิลด์ที่จะแก้ไข');
    if (Object.keys(req.body).some((key) => !allowedKeys.includes(key))) fail(400, 'VALIDATION_ERROR', 'มีฟิลด์ที่แก้ไขไม่ได้');
    if (req.user.role !== 'CUSTOMER_BUSINESS' && ['manufacturer','model','preferredTimeNote'].some((key) => Object.hasOwn(req.body,key))) fail(400, 'VALIDATION_ERROR', 'ข้อมูลบริษัทใช้ได้เฉพาะบัญชีบริษัท');
    const updated = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true }); requireOwner(job, req.user);
      validateStatus(job, ['DRAFT']);
      const symptom = req.body.symptom === undefined ? job.symptom_text : text(req.body.symptom, 1000, 'symptom');
      const district = req.body.districtCode === undefined ? job.district_code : text(req.body.districtCode, 30, 'districtCode');
      const manufacturer = req.body.manufacturer === undefined ? job.manufacturer : (req.body.manufacturer ? text(req.body.manufacturer, 100, 'manufacturer') : null);
      const model = req.body.model === undefined ? job.model : (req.body.model ? text(req.body.model, 100, 'model') : null);
      const preferred = req.body.preferredTimeNote === undefined ? job.preferred_time_note : (req.body.preferredTimeNote ? text(req.body.preferredTimeNote, 200, 'preferredTimeNote') : null);
      if (symptom === job.symptom_text && district === job.district_code && manufacturer === job.manufacturer && model === job.model && preferred === job.preferred_time_note) return { id: job.id, status: 'DRAFT', unchanged: true };
      if (district !== job.district_code && !(await client.query('SELECT 1 FROM districts WHERE code=$1',[district])).rowCount) fail(400, 'VALIDATION_ERROR', 'เขตบริการไม่ถูกต้อง');
      await client.query('UPDATE ai_consents SET revoked_at=now() WHERE job_id=$1 AND revoked_at IS NULL',[job.id]);
      await client.query(
        `UPDATE jobs SET symptom_text=$2,district_code=$3,manufacturer=$4,model=$5,preferred_time_note=$6,
         ai_summary=NULL,analysis_version=0,confirmed_analysis_version=NULL,analyzed_at=NULL,summary_confirmed_at=NULL,updated_at=now() WHERE id=$1`,
        [job.id,symptom,district,manufacturer,model,preferred]
      );
      return { id: job.id, status: 'DRAFT' };
    });
    res.json({ data: updated });
  });

  app.post('/api/jobs/:jobId/manual-summary', async (req, res) => {
    const summary = text(req.body?.summary, 1000, 'summary');
    const result = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true }); requireOwner(job, req.user); validateStatus(job, ['DRAFT']);
      const version = job.analysis_version + 1;
      await client.query("UPDATE price_estimates SET status='SUPERSEDED' WHERE job_id=$1 AND status IN ('ESTIMATED','ACCEPTED')",[job.id]);
      await client.query('UPDATE jobs SET ai_summary=$2,analysis_version=$3,analyzed_at=now(),confirmed_analysis_version=NULL,summary_confirmed_at=NULL,updated_at=now() WHERE id=$1', [job.id,summary,version]);
      return { jobId: job.id, summary, version, source: 'CUSTOMER' };
    });
    res.json({ data: result });
  });

  app.post('/api/jobs/:jobId/analyze', async (req, res) => {
    requireRole(req.user, [...CUSTOMER_ROLES]);
    const job = await jobFor(pool, req.params.jobId); requireOwner(job, req.user); validateStatus(job, ['DRAFT']);
    if (!aiProvider) fail(503, 'AI_PROVIDER_UNAVAILABLE', 'ยังไม่ได้เปิดใช้ AI provider');
    const consents = await pool.query('SELECT id,data_scope FROM ai_consents WHERE job_id=$1 AND user_id=$2 AND revoked_at IS NULL ORDER BY consented_at DESC LIMIT 1', [job.id, req.user.id]);
    if (!consents.rowCount) fail(409, 'AI_CONSENT_REQUIRED', 'ต้องยินยอมก่อนส่งข้อมูลให้ AI');
    const selected = Array.isArray(consents.rows[0].data_scope?.attachmentIds) ? consents.rows[0].data_scope.attachmentIds : [];
    const files = selected.length ? await pool.query('SELECT id,storage_key,mime_type FROM job_attachments WHERE job_id=$1 AND id=ANY($2::uuid[]) AND status=\'ACTIVE\'', [job.id, selected]) : { rows: [] };
    if (files.rows.length !== selected.length) fail(400, 'INVALID_CONSENT_SCOPE', 'รายการภาพที่ยินยอมไม่ถูกต้อง');
    const output = await aiProvider.analyze({ symptom: job.symptom_text, category: job.category, attachments: files.rows.map((f) => ({ ...f, path: resolve(storageRoot, f.storage_key) })) });
    if (!output || typeof output.summary !== 'string' || output.summary.length > 1000 || !Array.isArray(output.missingInfo) || !Array.isArray(output.safeGuidance)) fail(502, 'AI_INVALID_RESPONSE', 'ผลวิเคราะห์จาก AI ไม่เป็นไปตามรูปแบบที่กำหนด');
    const result = await tx(pool, async (client) => {
      const current = await jobFor(client, job.id, { lock: true }); requireOwner(current, req.user); validateStatus(current, ['DRAFT']);
      if (current.row_version !== job.row_version) fail(409, 'JOB_CHANGED', 'ข้อมูลงานเปลี่ยนระหว่างวิเคราะห์ กรุณาลองใหม่');
      const activeConsent = await client.query('SELECT id FROM ai_consents WHERE id=$1 AND revoked_at IS NULL FOR UPDATE',[consents.rows[0].id]);
      if (!activeConsent.rowCount) fail(409, 'AI_CONSENT_REQUIRED', 'ถอนความยินยอมแล้ว กรุณายินยอมใหม่ก่อนวิเคราะห์');
      const latest = await client.query('SELECT coalesce(max(version),0)::int AS v FROM ai_analysis_runs WHERE job_id=$1', [job.id]);
      const version = latest.rows[0].v + 1; const runId = randomUUID();
      await client.query("UPDATE price_estimates SET status='SUPERSEDED' WHERE job_id=$1 AND status IN ('ESTIMATED','ACCEPTED')",[job.id]);
      await client.query(`INSERT INTO ai_analysis_runs(id,job_id,consent_id,version,provider_name,model_name,status,result_json,completed_at)
        VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED',$7::jsonb,now())`, [runId,job.id,consents.rows[0].id,version,output.provider,output.model,JSON.stringify(output)]);
      for (const file of files.rows) await client.query('INSERT INTO ai_run_attachments(analysis_run_id,attachment_id) VALUES($1,$2)', [runId,file.id]);
      await client.query('UPDATE jobs SET ai_summary=$2,analysis_version=$3,analyzed_at=now(),confirmed_analysis_version=NULL,summary_confirmed_at=NULL,updated_at=now() WHERE id=$1', [job.id,output.summary,version]);
      return { jobId: job.id, analysisRunId: runId, version, ...output };
    });
    res.json({ data: result });
  });

  app.get('/api/jobs/:jobId/ai-chat', async (req, res) => {
    const job = await jobFor(pool, req.params.jobId); requireOwner(job, req.user); validateStatus(job, ['DRAFT']);
    const result = await pool.query(`SELECT id, result_json, completed_at FROM ai_analysis_runs
      WHERE job_id=$1 AND result_json->>'type'='CHAT' ORDER BY version`, [job.id]);
    res.json({ data: result.rows.map((row) => ({ id: row.id, question: row.result_json.question, answer: row.result_json.answer, createdAt: row.completed_at })) });
  });

  app.post('/api/jobs/:jobId/ai-chat', async (req, res) => {
    const question = text(req.body?.question, 1000, 'question');
    if (!aiProvider || typeof aiProvider.chat !== 'function') fail(503, 'AI_CHAT_UNAVAILABLE', 'ยังไม่ได้เปิดใช้ AI สำหรับบทสนทนา');
    const job = await jobFor(pool, req.params.jobId); requireOwner(job, req.user); validateStatus(job, ['DRAFT']);
    const consent = await pool.query(`SELECT id,data_scope FROM ai_consents WHERE job_id=$1 AND user_id=$2 AND revoked_at IS NULL
      ORDER BY consented_at DESC LIMIT 1`, [job.id, req.user.id]);
    if (!consent.rowCount) fail(409, 'AI_CONSENT_REQUIRED', 'ต้องยินยอมก่อนส่งข้อมูลให้ AI');
    const selected = Array.isArray(consent.rows[0].data_scope?.attachmentIds) ? consent.rows[0].data_scope.attachmentIds : [];
    const files = selected.length ? await pool.query(`SELECT id,storage_key,mime_type FROM job_attachments
      WHERE job_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'`, [job.id, selected]) : { rows: [] };
    if (files.rows.length !== selected.length) fail(400, 'INVALID_CONSENT_SCOPE', 'รายการภาพที่ยินยอมไม่ถูกต้อง');
    const historyResult = await pool.query(`SELECT result_json FROM ai_analysis_runs WHERE job_id=$1 AND result_json->>'type'='CHAT' ORDER BY version`, [job.id]);
    const history = historyResult.rows.map(({ result_json }) => ({ question: result_json.question, answer: result_json.answer }));
    if (history.length >= MAX_AI_CHAT_TURNS) fail(409, 'AI_CHAT_LIMIT_REACHED', `Draft นี้ถาม AI ครบ ${MAX_AI_CHAT_TURNS} รอบแล้ว`);
    const output = await aiProvider.chat({ question, history, symptom: job.symptom_text, category: job.category,
      attachments: files.rows.map((file) => ({ ...file, path: resolve(storageRoot, file.storage_key) })) });
    if (!output || typeof output.answer !== 'string' || !output.answer.trim() || output.answer.length > 4000 ||
        typeof output.provider !== 'string' || !output.provider.trim() || output.provider.length > 80 ||
        typeof output.model !== 'string' || !output.model.trim() || output.model.length > 120) {
      fail(502, 'AI_INVALID_RESPONSE', 'ผลบทสนทนาจาก AI ไม่เป็นไปตามรูปแบบที่กำหนด');
    }
    const saved = await tx(pool, async (client) => {
      const current = await jobFor(client, job.id, { lock: true }); requireOwner(current, req.user); validateStatus(current, ['DRAFT']);
      if (current.row_version !== job.row_version) fail(409, 'JOB_CHANGED', 'ข้อมูลงานเปลี่ยนระหว่างถาม AI กรุณาลองใหม่');
      const chatCount = await client.query("SELECT count(*)::int AS n FROM ai_analysis_runs WHERE job_id=$1 AND result_json->>'type'='CHAT'", [job.id]);
      if (chatCount.rows[0].n >= MAX_AI_CHAT_TURNS) fail(409, 'AI_CHAT_LIMIT_REACHED', `Draft นี้ถาม AI ครบ ${MAX_AI_CHAT_TURNS} รอบแล้ว`);
      const activeConsent = await client.query('SELECT id FROM ai_consents WHERE id=$1 AND revoked_at IS NULL FOR UPDATE', [consent.rows[0].id]);
      if (!activeConsent.rowCount) fail(409, 'AI_CONSENT_REQUIRED', 'ถอนความยินยอมแล้ว กรุณายินยอมใหม่ก่อนถาม AI');
      const latest = await client.query('SELECT coalesce(max(version),0)::int AS v FROM ai_analysis_runs WHERE job_id=$1', [job.id]);
      const id = randomUUID(); const version = latest.rows[0].v + 1;
      const result = { type: 'CHAT', question, answer: output.answer.trim() };
      await client.query(`INSERT INTO ai_analysis_runs(id,job_id,consent_id,version,provider_name,model_name,status,result_json,completed_at)
        VALUES($1,$2,$3,$4,$5,$6,'SUCCEEDED',$7::jsonb,now())`, [id, job.id, consent.rows[0].id, version, output.provider, output.model, JSON.stringify(result)]);
      for (const file of files.rows) await client.query('INSERT INTO ai_run_attachments(analysis_run_id,attachment_id) VALUES($1,$2)', [id, file.id]);
      return { id, question, answer: result.answer };
    });
    res.status(201).json({ data: saved });
  });

  app.post('/api/jobs/:jobId/ai-consents', async (req, res) => {
    const scope = req.body?.dataScope;
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).some((key) => !['symptom','attachmentIds'].includes(key)) || scope.symptom !== true || !Array.isArray(scope.attachmentIds)) fail(400, 'VALIDATION_ERROR', 'ขอบเขต consent ไม่ถูกต้อง');
    if (scope.attachmentIds.length > MAX_IMAGES || scope.attachmentIds.some((id) => !isUuid(id))) fail(400, 'VALIDATION_ERROR', 'รายการภาพไม่ถูกต้อง');
    const id = randomUUID();
    await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true }); requireOwner(job, req.user); validateStatus(job, ['DRAFT']);
      if (scope.attachmentIds.length) {
        const found = await client.query('SELECT count(*)::int AS n FROM job_attachments WHERE job_id=$1 AND id=ANY($2::uuid[]) AND status=\'ACTIVE\'', [job.id,scope.attachmentIds]);
        if (found.rows[0].n !== scope.attachmentIds.length) fail(400, 'VALIDATION_ERROR', 'ภาพต้องเป็นของงานนี้และยังใช้งานได้');
      }
      await client.query('INSERT INTO ai_consents(id,job_id,user_id,terms_version,data_scope) VALUES($1,$2,$3,$4,$5::jsonb)', [id,job.id,req.user.id,'fixtech-ai-v1',JSON.stringify(scope)]);
    });
    res.status(201).json({ data: { consentId: id, consented: true } });
  });

  app.post('/api/jobs/:jobId/ai-consents/:consentId/revoke', async (req, res) => {
    const result = await pool.query(`UPDATE ai_consents c SET revoked_at=now() FROM jobs j
      WHERE c.id=$1 AND c.job_id=j.id AND j.id=$2 AND j.customer_user_id=$3 AND c.revoked_at IS NULL RETURNING c.id`, [req.params.consentId,req.params.jobId,req.user.id]);
    if (!result.rowCount) fail(404, 'NOT_FOUND', 'ไม่พบ consent');
    res.json({ data: { consentId: result.rows[0].id, revoked: true } });
  });

  app.post('/api/jobs/:jobId/price-estimates', async (req, res) => {
    requireRole(req.user, [...CUSTOMER_ROLES]);
    if (Object.keys(req.body ?? {}).length) fail(400, 'VALIDATION_ERROR', 'การประเมินราคา Demo ไม่รับ urgency หรือ complexity จาก client');
    const job = await jobFor(pool, req.params.jobId); requireOwner(job, req.user); validateStatus(job, ['DRAFT']);
    if (!marketPriceProvider) fail(503, 'MARKET_PRICE_UNAVAILABLE', 'ยังไม่ได้เปิดใช้แหล่งข้อมูลราคาตลาด');
    const ruleResult = await pool.query('SELECT id,version,rules_json FROM pricing_rule_sets WHERE is_active ORDER BY version DESC LIMIT 1');
    if (!ruleResult.rowCount) fail(503, 'PRICING_RULES_UNAVAILABLE', 'ยังไม่มีชุดกฎประเมินราคาที่เปิดใช้');
    const rules = ruleResult.rows[0].rules_json;
    const input = { category: job.category, serviceFormat: job.service_format, districtCode: job.district_code,
      urgency: 'STANDARD', complexityMultiplier: 1.0 };
    const latestRun = await pool.query("SELECT id FROM ai_analysis_runs WHERE job_id=$1 AND status='SUCCEEDED' AND result_json->>'type' IS DISTINCT FROM 'CHAT' ORDER BY version DESC LIMIT 1", [job.id]);
    let reference;
    try { reference = await marketPriceProvider.getReferencePrice(input); }
    catch (error) {
      const id = randomUUID();
      await tx(pool, async (client) => {
        const current = await jobFor(client, job.id, { lock: true }); requireOwner(current, req.user); validateStatus(current, ['DRAFT']);
        if (current.row_version !== job.row_version) fail(409, 'JOB_CHANGED', 'ข้อมูลงานเปลี่ยนระหว่างประเมินราคา กรุณาลองใหม่');
        const version = await client.query('SELECT coalesce(max(version),0)::int+1 AS n FROM price_estimates WHERE job_id=$1',[job.id]);
        await client.query(`INSERT INTO price_estimates(id,job_id,version,analysis_run_id,rule_set_id,category,service_format,fetched_at,source_snapshot,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8::jsonb,'UNAVAILABLE')`,
          [id,job.id,version.rows[0].n,latestRun.rows[0]?.id ?? null,ruleResult.rows[0].id,job.category,job.service_format,JSON.stringify({ errorCode: error.code ?? 'MARKET_PRICE_UNAVAILABLE' })]);
      });
      throw error;
    }
    if (!reference || !reference.sourceName || !reference.sourceReference || !reference.sourceUpdatedAt ||
        !Number.isFinite(Number(reference.referenceLow)) || !Number.isFinite(Number(reference.referenceHigh)) ||
        Number(reference.referenceLow) <= 0 || Number(reference.referenceHigh) < Number(reference.referenceLow) || reference.currency !== 'THB') {
      fail(502, 'MARKET_PRICE_INVALID_RESPONSE', 'แหล่งข้อมูลราคาตลาดส่งข้อมูลไม่ครบหรือไม่ถูกต้อง');
    }
    const updatedAt = new Date(reference.sourceUpdatedAt);
    if (!referenceIsFresh(reference, Date.now(), env.MARKET_PRICE_MAX_AGE_HOURS ?? 24)) fail(503, 'ESTIMATE_UNAVAILABLE', 'ข้อมูลราคาอ้างอิงเก่าเกินกำหนด กรุณาทบทวนแหล่งข้อมูล');
    const customerRole = (await pool.query('SELECT role FROM users WHERE id=$1',[job.customer_user_id])).rows[0]?.role;
    let prices;
    try { prices = estimatePrice({ rules, referenceLow: reference.referenceLow, referenceHigh: reference.referenceHigh, districtCode: job.district_code, key: `${job.category}_${job.service_format}`, isBusiness: customerRole === 'CUSTOMER_BUSINESS' }); }
    catch { fail(503, 'PRICING_RULES_INVALID', 'ชุดกฎประเมินราคาไม่ถูกต้อง'); }
    const { min: estimatedMin, max: estimatedMax } = prices;
    const id = randomUUID();
    const saved = await tx(pool, async (client) => {
      const current = await jobFor(client, job.id, { lock: true }); requireOwner(current, req.user); validateStatus(current, ['DRAFT']);
      if (current.row_version !== job.row_version) fail(409, 'JOB_CHANGED', 'ข้อมูลงานเปลี่ยนระหว่างประเมินราคา กรุณาลองใหม่');
      if (!referenceIsFresh(reference, Date.now(), env.MARKET_PRICE_MAX_AGE_HOURS ?? 24)) fail(503, 'ESTIMATE_UNAVAILABLE', 'ข้อมูลราคาอ้างอิงเก่าเกินกำหนด กรุณาทบทวนแหล่งข้อมูล');
      const prior = await client.query("UPDATE price_estimates SET status='SUPERSEDED' WHERE job_id=$1 AND status IN ('ESTIMATED','ACCEPTED')", [job.id]);
      const version = await client.query('SELECT coalesce(max(version),0)::int+1 AS n FROM price_estimates WHERE job_id=$1', [job.id]);
      await client.query(`INSERT INTO price_estimates(id,job_id,version,analysis_run_id,rule_set_id,category,service_format,source_name,source_reference,fetched_at,source_updated_at,source_snapshot,estimated_min,estimated_max,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11::jsonb,$12,$13,'ESTIMATED')`,
      [id,job.id,version.rows[0].n,latestRun.rows[0]?.id ?? null,ruleResult.rows[0].id,job.category,job.service_format,reference.sourceName,reference.sourceReference,updatedAt.toISOString(),JSON.stringify({ referenceLow: reference.referenceLow,referenceHigh: reference.referenceHigh,currency: 'THB',referenceType: reference.referenceType ?? 'LIVE_SOURCE',reviewedAt: reference.reviewedAt ?? null,referenceNotes: reference.referenceNotes ?? null,formula: rules,inputs: input,version: ruleResult.rows[0].version }),estimatedMin,estimatedMax]);
      const curated = reference.referenceType === 'CURATED_PUBLIC_EXAMPLES';
      const validUntil = curated ? new Date(Date.parse(reference.reviewedAt) + CURATED_REFERENCE_MAX_AGE_DAYS * 24 * 60 * 60_000).toISOString() : null;
      return { estimateId: id, jobId: job.id, min: estimatedMin, max: estimatedMax, currency: 'THB', source: reference.sourceName, sourceReference: reference.sourceReference, sourceUpdatedAt: updatedAt.toISOString(), fetchedAt: new Date().toISOString(), freshness: curated ? 'CURATED' : 'FRESH', referenceType: reference.referenceType ?? 'LIVE_SOURCE', reviewedAt: reference.reviewedAt ?? null, referenceValidUntil: validUntil, referenceNotes: reference.referenceNotes ?? null, formulaVersion: ruleResult.rows[0].version, supersededEstimateCount: prior.rowCount };
    });
    res.json({ data: saved });
  });

  app.post('/api/jobs/:jobId/price-estimates/:estimateId/accept', async (req, res) => {
    const result = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true }); requireOwner(job, req.user); validateStatus(job, ['DRAFT']);
      if (!isUuid(req.params.estimateId)) fail(404, 'NOT_FOUND', 'ไม่พบผลประเมินราคา');
      const estimate = await client.query('SELECT * FROM price_estimates WHERE id=$1 AND job_id=$2 FOR UPDATE', [req.params.estimateId,job.id]);
      if (!estimate.rowCount || estimate.rows[0].status !== 'ESTIMATED') fail(409, 'ESTIMATE_NOT_CURRENT', 'ผลประเมินนี้ไม่ใช่รายการปัจจุบัน');
      const e = estimate.rows[0];
      const freshness = { referenceType: e.source_snapshot?.referenceType, reviewedAt: e.source_snapshot?.reviewedAt, sourceUpdatedAt: e.source_updated_at };
      if (!referenceIsFresh(freshness, Date.now(), env.MARKET_PRICE_MAX_AGE_HOURS ?? 24)) fail(409, 'ESTIMATE_STALE', 'ผลประเมินหมดอายุ กรุณาประเมินใหม่');
      const userRole = req.user.role;
      if (userRole === 'CUSTOMER_GENERAL' && Number(e.estimated_min) !== Number(e.estimated_max)) fail(409, 'INVALID_ESTIMATE_SHAPE', 'ลูกค้าทั่วไปต้องได้รับราคาเดียว');
      await client.query("UPDATE price_estimates SET status='SUPERSEDED' WHERE job_id=$1 AND status='ACCEPTED'", [job.id]);
      await client.query("UPDATE price_estimates SET status='ACCEPTED',accepted_by_user_id=$2,accepted_at=now() WHERE id=$1", [e.id,req.user.id]);
      let status = job.status;
      if (job.confirmed_analysis_version === job.analysis_version && job.summary_confirmed_at) {
        status = 'READY_TO_PUBLISH';
        await client.query("UPDATE jobs SET status='READY_TO_PUBLISH',agreed_amount=CASE WHEN $2='CUSTOMER_GENERAL' THEN $3 ELSE agreed_amount END,agreed_by_user_id=CASE WHEN $2='CUSTOMER_GENERAL' THEN $4 ELSE agreed_by_user_id END,agreed_at=CASE WHEN $2='CUSTOMER_GENERAL' THEN now() ELSE agreed_at END,updated_at=now() WHERE id=$1",
          [job.id,userRole,e.estimated_min,req.user.id]);
        await statusEvent(client, job, req.user.id, status);
      }
      return { jobId: job.id, estimateId: e.id, status, accepted: true, min: e.estimated_min, max: e.estimated_max };
    });
    res.json({ data: result });
  });

  app.post('/api/jobs/:jobId/publish', async (req, res) => {
    const outcome = await tx(pool, async (client) => {
      let job = await jobFor(client, req.params.jobId, { lock: true }); requireOwner(job, req.user); validateStatus(job, ['READY_TO_PUBLISH']);
      if (!job.ai_summary || !job.analyzed_at || job.confirmed_analysis_version !== job.analysis_version) fail(409, 'ANALYSIS_STALE', 'ต้องยืนยันสรุปปัจจุบันก่อนเผยแพร่');
      const estimate = await client.query("SELECT * FROM price_estimates WHERE job_id=$1 AND status='ACCEPTED' ORDER BY version DESC LIMIT 1 FOR UPDATE", [job.id]);
      if (!estimate.rowCount || !referenceIsFresh({ referenceType: estimate.rows[0].source_snapshot?.referenceType, reviewedAt: estimate.rows[0].source_snapshot?.reviewedAt, sourceUpdatedAt: estimate.rows[0].source_updated_at }, Date.now(), env.MARKET_PRICE_MAX_AGE_HOURS ?? 24)) fail(409, 'ESTIMATE_STALE', 'ต้องมีราคาที่ลูกค้ายอมรับและยังสดก่อนเผยแพร่');
      if (job.customer_user_id && (await client.query('SELECT role FROM users WHERE id=$1',[job.customer_user_id])).rows[0]?.role === 'CUSTOMER_GENERAL' && !job.agreed_amount) fail(409, 'PRICE_NOT_ACCEPTED', 'ต้องยอมรับยอดราคาก่อนเผยแพร่');
      await client.query("UPDATE jobs SET status='POSTED',posted_at=now(),updated_at=now() WHERE id=$1", [job.id]);
      await statusEvent(client, job, req.user.id, 'POSTED'); job = { ...job,status: 'POSTED' };
      const providers = await client.query(`SELECT p.id,p.display_name,p.priority,p.user_id
        FROM provider_profiles p
        JOIN provider_services ps ON ps.provider_id=p.id AND ps.category=$1 AND ps.service_format=$2
        JOIN provider_districts pd ON pd.provider_id=p.id AND pd.district_code=$3
        WHERE p.is_approved AND p.is_available ORDER BY p.priority ASC,p.id ASC LIMIT 3`, [job.category,job.service_format,job.district_code]);
      if (req.user.role === 'CUSTOMER_GENERAL') {
        if (!providers.rowCount) {
          await client.query("UPDATE jobs SET status='NO_PROVIDER_FOUND',updated_at=now() WHERE id=$1", [job.id]);
          await statusEvent(client, job, req.user.id, 'NO_PROVIDER_FOUND');
          await notify(client, job.customer_user_id, job.id, `job:${job.id}:no-provider`, 'MATCHING', 'ยังไม่พบช่าง', 'ไม่มีช่างตรงกับเงื่อนไขงานนี้');
          return { jobId: job.id, status: 'NO_PROVIDER_FOUND', providers: [] };
        }
        const provider = providers.rows[0];
        await client.query("UPDATE jobs SET status='MATCHED',assigned_provider_id=$2,updated_at=now() WHERE id=$1", [job.id,provider.id]);
        await statusEvent(client, job, req.user.id, 'MATCHED'); job = { ...job,status: 'MATCHED',assigned_provider_id: provider.id,provider_user_id: provider.user_id };
        await client.query("UPDATE jobs SET status='WAITING_FOR_APPOINTMENT',updated_at=now() WHERE id=$1", [job.id]);
        await statusEvent(client, job, req.user.id, 'WAITING_FOR_APPOINTMENT');
        await notifyParties(client, job, req.user.id, `job:${job.id}:matched`, 'MATCHED', 'พบช่างที่เหมาะสม', 'ระบบจับคู่ผู้ให้บริการให้แล้ว สามารถใช้แชตและนัดหมายในงานนี้');
        return { jobId: job.id, status: 'WAITING_FOR_APPOINTMENT', provider: { label: 'ช่างที่จับคู่แล้ว' } };
      }
      if (providers.rowCount < 2) {
        await client.query("UPDATE jobs SET status='NO_PROVIDER_FOUND',updated_at=now() WHERE id=$1", [job.id]);
        await statusEvent(client, job, req.user.id, 'NO_PROVIDER_FOUND');
        return { jobId: job.id, status: 'NO_PROVIDER_FOUND', offers: [] };
      }
      const min = Number(estimate.rows[0].estimated_min); const max = Number(estimate.rows[0].estimated_max);
      const offers = [];
      for (let index = 0; index < 2; index += 1) {
      const provider = providers.rows[index]; const amount = index === 0 ? min : max;
        const offerId = randomUUID();
        const scope = job.category === 'SOFTWARE' ? 'ตรวจและแก้ปัญหา Software ตามอาการที่ยืนยัน (ข้อเสนอจำลอง)' : 'ตรวจและดำเนินงาน Hardware ตามอาการที่ยืนยัน (ข้อเสนอจำลอง)';
        await client.query('INSERT INTO offers(id,job_id,provider_id,scope_summary,amount,status) VALUES($1,$2,$3,$4,$5,\'AVAILABLE\')', [offerId,job.id,provider.id,scope,amount]);
        offers.push({ id: offerId, providerLabel: `ทีมช่าง ${index + 1}`, scopeSummary: scope, amount, currency: 'THB', isSimulation: true });
      }
      await client.query("UPDATE jobs SET status='WAITING_FOR_SELECTION',updated_at=now() WHERE id=$1", [job.id]);
      await statusEvent(client, job, req.user.id, 'WAITING_FOR_SELECTION');
      await notify(client, job.customer_user_id, job.id, `job:${job.id}:offers`, 'OFFERS', 'มีข้อเสนอให้เลือก', 'ตรวจสอบราคาและขอบเขตบริการก่อนเลือก');
      return { jobId: job.id, status: 'WAITING_FOR_SELECTION', offers };
    });
    res.json({ data: outcome });
  });

  app.get('/api/jobs/:jobId/offers', async (req, res) => {
    const job = await jobFor(pool, req.params.jobId); requireOwner(job, req.user);
    const rows = await pool.query(`SELECT o.id,o.scope_summary,o.amount,o.status,p.display_name AS provider_label
      FROM offers o JOIN provider_profiles p ON p.id=o.provider_id WHERE o.job_id=$1 ORDER BY o.amount,o.id`, [job.id]);
    res.json({ data: rows.rows.map((row, index) => ({ id: row.id, scopeSummary: row.scope_summary, amount: Number(row.amount), currency: 'THB', status: row.status, providerLabel: `ทีมช่าง ${index + 1}`, isSimulation: true })) });
  });

  app.post('/api/jobs/:jobId/offers/:offerId/select', async (req, res) => {
    requireRole(req.user, ['CUSTOMER_BUSINESS']);
    const outcome = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true }); requireOwner(job, req.user); validateStatus(job, ['WAITING_FOR_SELECTION']);
      const offer = await client.query('SELECT * FROM offers WHERE id=$1 AND job_id=$2 AND status=\'AVAILABLE\' FOR UPDATE', [req.params.offerId,job.id]);
      if (!offer.rowCount) fail(404, 'OFFER_NOT_FOUND', 'ไม่พบข้อเสนอที่เลือก');
      await client.query("UPDATE offers SET status=CASE WHEN id=$2 THEN 'SELECTED' ELSE 'NOT_SELECTED' END WHERE job_id=$1", [job.id,offer.rows[0].id]);
      await client.query("UPDATE jobs SET status='ASSIGNED',assigned_provider_id=$2,agreed_amount=$3,agreed_by_user_id=$4,agreed_at=now(),updated_at=now() WHERE id=$1", [job.id,offer.rows[0].provider_id,offer.rows[0].amount,req.user.id]);
      await statusEvent(client, job, req.user.id, 'ASSIGNED');
      const assigned = await jobFor(client, job.id, { lock: true });
      await client.query("UPDATE jobs SET status='WAITING_FOR_APPOINTMENT',updated_at=now() WHERE id=$1", [job.id]);
      await statusEvent(client, assigned, req.user.id, 'WAITING_FOR_APPOINTMENT');
      await notifyParties(client, assigned, req.user.id, `job:${job.id}:offer-selected`, 'OFFER_SELECTED', 'เลือกข้อเสนอแล้ว', 'คู่สัญญาสามารถพูดคุยและนัดหมายได้');
      return { jobId: job.id, status: 'WAITING_FOR_APPOINTMENT', selectedOfferId: offer.rows[0].id, agreedAmount: Number(offer.rows[0].amount) };
    });
    res.json({ data: outcome });
  });

  app.get('/api/jobs/:jobId/messages', async (req,res) => {
    const job = await jobFor(pool,req.params.jobId); requireParticipant(job,req.user);
    if (!job.assigned_provider_id) fail(409,'PROVIDER_NOT_ASSIGNED','งานนี้ยังไม่มีผู้ให้บริการ');
    const result = await pool.query(`SELECT m.id,m.sender_user_id,m.body,m.created_at,u.role AS sender_role
      FROM job_messages m JOIN users u ON u.id=m.sender_user_id WHERE m.job_id=$1 ORDER BY m.created_at,m.id LIMIT 100`,[job.id]);
    res.json({data:result.rows.map((r)=>{
      const termsPrefix='[FIXTECH_WARRANTY_TERMS]'; const acceptedPrefix='[FIXTECH_WARRANTY_ACCEPTED]';
      if(r.body.startsWith(termsPrefix)) return {id:r.id,type:'WARRANTY_TERMS',senderRole:r.sender_role,terms:JSON.parse(r.body.slice(termsPrefix.length)),createdAt:r.created_at};
      if(r.body.startsWith(acceptedPrefix)) return {id:r.id,type:'WARRANTY_ACCEPTED',senderRole:r.sender_role,createdAt:r.created_at};
      return {id:r.id,type:'TEXT',senderRole:r.sender_role,body:r.body,createdAt:r.created_at};
    })});
  });

  app.post('/api/jobs/:jobId/messages', async (req,res) => {
    const body = text(req.body?.body,2000,'body');
    const result = await tx(pool,async (client)=>{
      const job = await jobFor(client,req.params.jobId,{lock:true}); requireParticipant(job,req.user);
      if (!job.assigned_provider_id || ['DRAFT','READY_TO_PUBLISH','POSTED','NO_PROVIDER_FOUND','CANCELLED'].includes(job.status)) fail(409,'CHAT_UNAVAILABLE','ยังไม่เปิดแชตสำหรับงานนี้');
      const id = randomUUID(); await client.query('INSERT INTO job_messages(id,job_id,sender_user_id,body) VALUES($1,$2,$3,$4)',[id,job.id,req.user.id,body]);
      const recipient = req.user.id === job.customer_user_id ? job.provider_user_id : job.customer_user_id;
      await notify(client,recipient,job.id,`message:${id}`,'MESSAGE','มีข้อความใหม่','มีข้อความใหม่ในงานของคุณ');
      return {id,jobId:job.id,body,createdAt:new Date().toISOString()};
    });
    res.status(201).json({data:result});
  });

  app.get('/api/notifications',async (req,res)=>{
    const result = await pool.query('SELECT id,job_id,type,title,body,created_at,read_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.id]);
    res.json({data:result.rows});
  });

  app.post('/api/notifications/:notificationId/read',async (req,res)=>{
    const result = await pool.query('UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING id,read_at',[req.params.notificationId,req.user.id]);
    if (!result.rowCount) fail(404,'NOT_FOUND','ไม่พบการแจ้งเตือน');
    res.json({data:result.rows[0]});
  });

  app.post('/api/jobs/:jobId/appointments',async (req,res)=>{
    const starts = new Date(req.body?.startsAt); const ends = new Date(req.body?.endsAt);
    if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || starts <= new Date() || starts >= ends) fail(400,'INVALID_APPOINTMENT_TIME','ช่วงนัดหมายไม่ถูกต้อง');
    const outcome = await tx(pool,async (client)=>{
      const job = await jobFor(client,req.params.jobId,{lock:true}); requireParticipant(job,req.user);
      validateStatus(job,['WAITING_FOR_APPOINTMENT']);
      if (!job.assigned_provider_id || !job.agreed_amount) fail(409,'PRICE_NOT_AGREED','ต้องมีผู้ให้บริการและราคาที่ตกลงก่อนนัดหมาย');
      await client.query('SELECT id FROM provider_profiles WHERE id=$1 FOR UPDATE',[job.assigned_provider_id]);
      const overlap = await client.query(`SELECT 1 FROM appointments WHERE provider_id=$1 AND status='CONFIRMED'
        AND starts_at < $3 AND ends_at > $2 LIMIT 1`,[job.assigned_provider_id,starts.toISOString(),ends.toISOString()]);
      if (overlap.rowCount) fail(409,'APPOINTMENT_CONFLICT','ช่างมีนัดหมายในช่วงเวลาดังกล่าว');
      const id=randomUUID(); const isCustomer=req.user.id===job.customer_user_id;
      await client.query(`INSERT INTO appointments(id,job_id,provider_id,proposed_by_user_id,starts_at,ends_at,status,customer_confirmed_at,provider_confirmed_at)
        VALUES($1,$2,$3,$4,$5,$6,'PROPOSED',$7,$8)`,[id,job.id,job.assigned_provider_id,req.user.id,starts.toISOString(),ends.toISOString(),isCustomer?new Date():null,isCustomer?null:new Date()]);
      await notify(client,isCustomer?job.provider_user_id:job.customer_user_id,job.id,`appointment:${id}:proposed`,'APPOINTMENT','มีข้อเสนอนัดหมาย','โปรดตรวจสอบและยืนยันช่วงเวลานัดหมาย');
      return {appointmentId:id,jobId:job.id,status:'PROPOSED',startsAt:starts.toISOString(),endsAt:ends.toISOString()};
    });
    res.status(201).json({data:outcome});
  });

  app.get('/api/jobs/:jobId/appointments',async (req,res)=>{
    const job=await jobFor(pool,req.params.jobId); requireParticipant(job,req.user);
    const result=await pool.query('SELECT id,CASE WHEN proposed_by_user_id=$2 THEN \'CUSTOMER\' ELSE \'TECHNICIAN\' END AS proposed_by_role,starts_at,ends_at,status,customer_confirmed_at,provider_confirmed_at,supersedes_id,created_at FROM appointments WHERE job_id=$1 ORDER BY created_at DESC',[job.id,job.customer_user_id]);
    res.json({data:result.rows});
  });

  app.post('/api/appointments/:appointmentId/confirm',async (req,res)=>{
    const result=await tx(pool,async(client)=>{
      const found=await client.query('SELECT * FROM appointments WHERE id=$1 FOR UPDATE',[req.params.appointmentId]);
      if(!found.rowCount) fail(404,'NOT_FOUND','ไม่พบนัดหมาย'); const appointment=found.rows[0];
      const job=await jobFor(client,appointment.job_id,{lock:true}); requireParticipant(job,req.user);
      validateStatus(job,['WAITING_FOR_APPOINTMENT']);
      if(appointment.status!=='PROPOSED') fail(409,'INVALID_STATE_TRANSITION','นัดหมายนี้ไม่อยู่ระหว่างรอยืนยัน');
      const isCustomer=req.user.id===job.customer_user_id;
      if((isCustomer && appointment.proposed_by_user_id===req.user.id)||(!isCustomer && req.user.providerId!==appointment.provider_id)) fail(403,'NOT_COUNTERPARTY','ผู้เสนอช่วงเวลายืนยันซ้ำไม่ได้');
      const field=isCustomer?'customer_confirmed_at':'provider_confirmed_at';
      const customerAt=isCustomer?new Date():appointment.customer_confirmed_at;
      const providerAt=isCustomer?appointment.provider_confirmed_at:new Date();
      const confirmed=Boolean(customerAt&&providerAt);
      if(confirmed){
        await client.query('SELECT id FROM provider_profiles WHERE id=$1 FOR UPDATE',[appointment.provider_id]);
        const overlap=await client.query(`SELECT 1 FROM appointments WHERE provider_id=$1 AND status='CONFIRMED' AND id<>$4
          AND starts_at<$3 AND ends_at>$2 LIMIT 1`,[appointment.provider_id,appointment.starts_at,appointment.ends_at,appointment.id]);
        if(overlap.rowCount) fail(409,'APPOINTMENT_CONFLICT','ช่างมีนัดหมายที่ยืนยันแล้วในช่วงเวลาดังกล่าว');
        await client.query("UPDATE appointments SET status='CONFIRMED',customer_confirmed_at=$2,provider_confirmed_at=$3 WHERE id=$1",[appointment.id,customerAt,providerAt]);
        validateStatus(job,['WAITING_FOR_APPOINTMENT']);
        await client.query("UPDATE jobs SET status='SCHEDULED',updated_at=now() WHERE id=$1",[job.id]); await statusEvent(client,job,req.user.id,'SCHEDULED');
      }else await client.query(`UPDATE appointments SET ${field}=$2 WHERE id=$1`,[appointment.id,new Date()]);
      await notifyParties(client,job,req.user.id,`appointment:${appointment.id}:confirmed:${req.user.id}`,'APPOINTMENT','נัดหมายได้รับการยืนยัน',confirmed?'ทั้งสองฝ่ายยืนยันแล้ว':'อีกฝ่ายยืนยันช่วงนัดหมาย');
      return {appointmentId:appointment.id,status:confirmed?'CONFIRMED':'PROPOSED',jobStatus:confirmed?'SCHEDULED':job.status};
    });
    res.json({data:result});
  });

  app.post('/api/appointments/:appointmentId/cancel',async(req,res)=>{
    const reason=text(req.body?.reason,500,'reason');
    const result=await tx(pool,async(client)=>{
      const found=await client.query('SELECT * FROM appointments WHERE id=$1 FOR UPDATE',[req.params.appointmentId]);
      if(!found.rowCount) fail(404,'NOT_FOUND','ไม่พบนัดหมาย'); const appointment=found.rows[0];
      const job=await jobFor(client,appointment.job_id,{lock:true}); requireParticipant(job,req.user);
      validateStatus(job,['WAITING_FOR_APPOINTMENT','SCHEDULED']);
      if(!['PROPOSED','CONFIRMED','RESCHEDULE_REQUESTED'].includes(appointment.status)) fail(409,'INVALID_STATE_TRANSITION','ยกเลิกนัดหมายนี้ไม่ได้');
      await client.query("UPDATE appointments SET status='CANCELLED',cancelled_by_user_id=$2,cancel_reason=$3 WHERE id=$1",[appointment.id,req.user.id,reason]);
      if(job.status==='SCHEDULED') { await client.query("UPDATE jobs SET status='WAITING_FOR_APPOINTMENT',updated_at=now() WHERE id=$1",[job.id]); await statusEvent(client,job,req.user.id,'WAITING_FOR_APPOINTMENT'); }
      await notifyParties(client,job,req.user.id,`appointment:${appointment.id}:cancelled`,'APPOINTMENT_CANCELLED','นัดหมายถูกยกเลิก',reason);
      return {appointmentId:appointment.id,status:'CANCELLED'};
    });
    res.json({data:result});
  });

  app.post('/api/appointments/:appointmentId/reschedule',async(req,res)=>{
    const reason=text(req.body?.reason,500,'reason'); const starts=new Date(req.body?.startsAt); const ends=new Date(req.body?.endsAt);
    if(!Number.isFinite(starts.getTime())||!Number.isFinite(ends.getTime())||starts<=new Date()||starts>=ends) fail(400,'INVALID_APPOINTMENT_TIME','ช่วงนัดหมายใหม่ไม่ถูกต้อง');
    const result=await tx(pool,async(client)=>{
      const found=await client.query('SELECT * FROM appointments WHERE id=$1 FOR UPDATE',[req.params.appointmentId]);
      if(!found.rowCount) fail(404,'NOT_FOUND','ไม่พบนัดหมาย'); const prior=found.rows[0]; const job=await jobFor(client,prior.job_id,{lock:true}); requireParticipant(job,req.user);
      validateStatus(job,['WAITING_FOR_APPOINTMENT','SCHEDULED']);
      if(!['PROPOSED','CONFIRMED','RESCHEDULE_REQUESTED'].includes(prior.status)) fail(409,'INVALID_STATE_TRANSITION','นัดหมายนี้เปลี่ยนเวลาไม่ได้');
      if(job.status==='IN_PROGRESS'||job.status==='COMPLETED'||job.status==='CANCELLED') fail(409,'INVALID_STATE_TRANSITION','งานเริ่มแล้วหรือปิดแล้ว');
      await client.query('SELECT id FROM provider_profiles WHERE id=$1 FOR UPDATE',[prior.provider_id]);
      const overlap=await client.query("SELECT 1 FROM appointments WHERE provider_id=$1 AND status='CONFIRMED' AND id<>$4 AND starts_at<$3 AND ends_at>$2 LIMIT 1",[prior.provider_id,starts.toISOString(),ends.toISOString(),prior.id]);
      if(overlap.rowCount) fail(409,'APPOINTMENT_CONFLICT','ช่างมีนัดหมายในช่วงเวลาดังกล่าว');
      await client.query("UPDATE appointments SET status='CANCELLED',cancelled_by_user_id=$2,cancel_reason=$3 WHERE id=$1",[prior.id,req.user.id,`เลื่อนนัด: ${reason}`]);
      const customer=req.user.id===job.customer_user_id; const id=randomUUID();
      await client.query(`INSERT INTO appointments(id,job_id,provider_id,proposed_by_user_id,starts_at,ends_at,status,customer_confirmed_at,provider_confirmed_at,supersedes_id)
        VALUES($1,$2,$3,$4,$5,$6,'PROPOSED',$7,$8,$9)`,[id,job.id,prior.provider_id,req.user.id,starts.toISOString(),ends.toISOString(),customer?new Date():null,customer?null:new Date(),prior.id]);
      if(job.status==='SCHEDULED'){await client.query("UPDATE jobs SET status='WAITING_FOR_APPOINTMENT',updated_at=now() WHERE id=$1",[job.id]);await statusEvent(client,job,req.user.id,'WAITING_FOR_APPOINTMENT');}
      await notify(client,customer?job.provider_user_id:job.customer_user_id,job.id,`appointment:${id}:rescheduled`,'APPOINTMENT','มีการเสนอเวลานัดใหม่',reason);
      return {appointmentId:id,supersedesId:prior.id,status:'PROPOSED',startsAt:starts.toISOString(),endsAt:ends.toISOString()};
    });
    res.status(201).json({data:result});
  });

  app.post('/api/jobs/:jobId/start',async(req,res)=>{
    const result=await tx(pool,async(client)=>{
      const job=await jobFor(client,req.params.jobId,{lock:true}); requireProvider(job,req.user); validateStatus(job,['SCHEDULED']);
      if(!job.agreed_amount) fail(409,'PRICE_NOT_AGREED','ไม่พบราคาที่ตกลง');
      await client.query("UPDATE jobs SET status='IN_PROGRESS',started_at=now(),updated_at=now() WHERE id=$1",[job.id]);
      await statusEvent(client,job,req.user.id,'IN_PROGRESS'); await notifyParties(client,job,req.user.id,`job:${job.id}:started`,'JOB_STARTED','ช่างเริ่มดำเนินงานแล้ว','งานของคุณกำลังดำเนินการ');
      return {jobId:job.id,status:'IN_PROGRESS'};
    });
    res.json({data:result});
  });

  app.post('/api/jobs/:jobId/submit-completion',async(req,res)=>{
    const note=req.body?.note ? text(req.body.note,500,'note') : null;
    const result=await tx(pool,async(client)=>{
      const job=await jobFor(client,req.params.jobId,{lock:true}); requireProvider(job,req.user); validateStatus(job,['IN_PROGRESS']);
      await client.query("UPDATE jobs SET status='WAITING_FOR_CUSTOMER_CONFIRMATION',completion_note=$2,submitted_at=now(),updated_at=now() WHERE id=$1",[job.id,note]);
      await statusEvent(client,job,req.user.id,'WAITING_FOR_CUSTOMER_CONFIRMATION'); await notify(client,job.customer_user_id,job.id,`job:${job.id}:completion-submitted`,'COMPLETION','ช่างส่งงานให้ตรวจรับ','กรุณาตรวจงานและรับทราบเงื่อนไขรับประกัน');
      return {jobId:job.id,status:'WAITING_FOR_CUSTOMER_CONFIRMATION'};
    });
    res.json({data:result});
  });

  app.post('/api/jobs/:jobId/warranty-terms',async(req,res)=>{
    const offered=req.body?.offered;
    if(typeof offered!=='boolean') fail(400,'VALIDATION_ERROR','ระบุว่ามีหรือไม่มีการรับประกัน');
    const duration=offered?Number(req.body?.durationDays):null;
    if(offered&&![7,14,30].includes(duration)) fail(400,'VALIDATION_ERROR','ระยะรับประกันต้องเป็น 7, 14 หรือ 30 วัน');
    const scope=offered?text(req.body?.scope,1000,'scope'):'';
    const exclusions=offered&&req.body?.exclusions?text(req.body.exclusions,1000,'exclusions'):'';
    const outcome=await tx(pool,async(client)=>{
      const job=await jobFor(client,req.params.jobId,{lock:true}); requireProvider(job,req.user); validateStatus(job,['WAITING_FOR_CUSTOMER_CONFIRMATION']);
      const prior=await client.query("SELECT id FROM job_messages WHERE job_id=$1 AND body LIKE '[FIXTECH_WARRANTY_TERMS]%' ORDER BY created_at DESC LIMIT 1",[job.id]);
      if(prior.rowCount) fail(409,'WARRANTY_TERMS_ALREADY_OFFERED','มีข้อเสนอรับประกันแล้ว');
      const messageId=randomUUID(); const terms={messageId,offered,durationDays:duration,scope,exclusions};
      const body=`[FIXTECH_WARRANTY_TERMS]${JSON.stringify(terms)}`;
      await client.query('INSERT INTO job_messages(id,job_id,sender_user_id,body) VALUES($1,$2,$3,$4)',[messageId,job.id,req.user.id,body]);
      await notify(client,job.customer_user_id,job.id,`warranty:terms:${messageId}`,'WARRANTY','มีเงื่อนไขรับประกันให้พิจารณา',offered?`รับประกัน ${duration} วัน: ${scope}`:'ผู้ให้บริการเสนอไม่มีการรับประกัน');
      return {offerId:messageId,offered,durationDays:duration,scope,exclusions};
    });
    res.status(201).json({data:outcome});
  });

  app.post('/api/jobs/:jobId/warranty-terms/accept',async(req,res)=>{
    if(!isUuid(req.body?.offerId)) fail(400,'VALIDATION_ERROR','offerId ไม่ถูกต้อง');
    const result=await tx(pool,async(client)=>{
      const job=await jobFor(client,req.params.jobId,{lock:true}); requireOwner(job,req.user); validateStatus(job,['WAITING_FOR_CUSTOMER_CONFIRMATION']);
      const offer=await client.query('SELECT * FROM job_messages WHERE id=$1 AND job_id=$2 AND sender_user_id=$3',[req.body.offerId,job.id,job.provider_user_id]);
      if(!offer.rowCount||!offer.rows[0].body.startsWith('[FIXTECH_WARRANTY_TERMS]')) fail(404,'WARRANTY_OFFER_NOT_FOUND','ไม่พบเงื่อนไขรับประกัน');
      const terms=JSON.parse(offer.rows[0].body.slice('[FIXTECH_WARRANTY_TERMS]'.length));
      const acceptanceId=randomUUID();
      await client.query('INSERT INTO job_messages(id,job_id,sender_user_id,body) VALUES($1,$2,$3,$4)',[acceptanceId,job.id,req.user.id,`[FIXTECH_WARRANTY_ACCEPTED]${JSON.stringify({offerId:offer.rows[0].id,terms})}`]);
      await notify(client,job.provider_user_id,job.id,`warranty:accepted:${offer.rows[0].id}`,'WARRANTY','ลูกค้ายืนยันเงื่อนไขรับประกันแล้ว','สามารถดำเนินการปิดงานหลังตรวจรับได้');
      return {jobId:job.id,offerId:offer.rows[0].id,accepted:true};
    });
    res.json({data:result});
  });

  app.post('/api/jobs/:jobId/confirm-completion',async(req,res)=>{
    const result=await tx(pool,async(client)=>{
      const job=await jobFor(client,req.params.jobId,{lock:true}); requireOwner(job,req.user); validateStatus(job,['WAITING_FOR_CUSTOMER_CONFIRMATION']);
      const accepted=await client.query("SELECT body,created_at FROM job_messages WHERE job_id=$1 AND sender_user_id=$2 AND body LIKE '[FIXTECH_WARRANTY_ACCEPTED]%' ORDER BY created_at DESC LIMIT 1",[job.id,req.user.id]);
      if(!accepted.rowCount) fail(409,'WARRANTY_ACCEPTANCE_REQUIRED','ผู้ให้บริการต้องเสนอเงื่อนไขและลูกค้าต้องยืนยันก่อนตรวจรับ');
      const record=JSON.parse(accepted.rows[0].body.slice('[FIXTECH_WARRANTY_ACCEPTED]'.length));
      const terms=record.terms; const acceptedAt=accepted.rows[0].created_at; const id=randomUUID();
      await client.query(`INSERT INTO warranties(id,job_id,provider_id,status,duration_days,terms_snapshot,accepted_by_user_id,accepted_at,starts_at,ends_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,[
        id,job.id,job.assigned_provider_id,terms.offered?'ACTIVE':'NOT_APPLICABLE',terms.offered?terms.durationDays:null,
        JSON.stringify({...terms,offerId:record.offerId,acceptedMessageAt:acceptedAt}),req.user.id,acceptedAt,
        terms.offered?new Date():null,terms.offered?new Date(Date.now()+terms.durationDays*86400_000):null
      ]);
      await client.query("UPDATE jobs SET status='COMPLETED',completed_at=now(),updated_at=now() WHERE id=$1",[job.id]);
      await client.query("UPDATE appointments SET status='COMPLETED' WHERE job_id=$1 AND status='CONFIRMED'",[job.id]);
      await statusEvent(client,job,req.user.id,'COMPLETED');
      await notifyParties(client,job,req.user.id,`job:${job.id}:completed`,'JOB_COMPLETED','ลูกค้ายืนยันรับงานแล้ว','คุณสามารถติดตามการชำระจำลองและรีวิวได้');
      return {jobId:job.id,status:'COMPLETED',warranty:{status:terms.offered?'ACTIVE':'NOT_APPLICABLE',durationDays:terms.durationDays}};
    });
    res.json({data:result});
  });

  app.post('/api/jobs/:jobId/payment-simulations',async(req,res)=>{
    const method=req.body?.method; const key=text(req.body?.idempotencyKey,100,'idempotencyKey');
    if(!['PLATFORM_SIMULATED','DIRECT'].includes(method)) fail(400,'VALIDATION_ERROR','วิธีชำระเงินจำลองไม่ถูกต้อง');
    const result=await tx(pool,async(client)=>{
      const job=await jobFor(client,req.params.jobId,{lock:true}); requireOwner(job,req.user); validateStatus(job,['COMPLETED']);
      if(!job.agreed_amount) fail(409,'PRICE_NOT_AGREED','ไม่พบราคาที่ตกลง');
      if(req.user.role==='CUSTOMER_BUSINESS'&&method!=='PLATFORM_SIMULATED') fail(403,'PAYMENT_METHOD_NOT_ALLOWED','บัญชีบริษัทใช้ได้เฉพาะการชำระผ่านระบบจำลอง');
      const existing=await client.query('SELECT id,job_id,initiated_by_user_id,method,status,amount,currency FROM payment_simulations WHERE idempotency_key=$1',[key]);
      if(existing.rowCount){const payment=existing.rows[0];if(payment.job_id!==job.id||payment.initiated_by_user_id!==req.user.id||payment.method!==method) fail(409,'IDEMPOTENCY_KEY_REUSED','idempotencyKey นี้ถูกใช้กับงาน ผู้ใช้ หรือวิธีชำระอื่นแล้ว');return payment;}
      const id=randomUUID(); await client.query(`INSERT INTO payment_simulations(id,job_id,initiated_by_user_id,method,status,amount,idempotency_key)
        VALUES($1,$2,$3,$4,'PENDING',$5,$6)`,[id,job.id,req.user.id,method,job.agreed_amount,key]);
      return {id,job_id:job.id,method,status:'PENDING',amount:Number(job.agreed_amount),currency:'THB'};
    });
    res.status(201).json({data:{...result,notice:'จำลองเท่านั้น — ไม่มีการโอนเงินจริง'}});
  });

  app.get('/api/jobs/:jobId/payment-simulations',async(req,res)=>{
    const job=await jobFor(pool,req.params.jobId); requireParticipant(job,req.user);
    const result=await pool.query('SELECT id,method,status,amount,currency,created_at,confirmed_at FROM payment_simulations WHERE job_id=$1 ORDER BY created_at DESC',[job.id]);
    res.json({data:result.rows});
  });

  app.post('/api/payment-simulations/:paymentId/confirm-platform',async(req,res)=>{
    const result=await tx(pool,async(client)=>{
      const payment=await client.query('SELECT * FROM payment_simulations WHERE id=$1 FOR UPDATE',[req.params.paymentId]);
      if(!payment.rowCount) fail(404,'NOT_FOUND','ไม่พบรายการชำระจำลอง');
      const job=await jobFor(client,payment.rows[0].job_id,{lock:true}); requireOwner(job,req.user);
      if(payment.rows[0].method!=='PLATFORM_SIMULATED') fail(409,'PAYMENT_METHOD_NOT_ALLOWED','รายการนี้ไม่ได้เลือกชำระผ่านระบบจำลอง');
      if(payment.rows[0].status==='PLATFORM_SIMULATED_PAID') return payment.rows[0];
      if(payment.rows[0].status!=='PENDING') fail(409,'INVALID_STATE_TRANSITION','สถานะรายการนี้ยืนยันไม่ได้');
      const saved=await client.query("UPDATE payment_simulations SET status='PLATFORM_SIMULATED_PAID',confirmed_by_user_id=$2,confirmed_at=now(),updated_at=now() WHERE id=$1 RETURNING id,method,status,amount,currency,confirmed_at",[payment.rows[0].id,req.user.id]);
      await notify(client,job.provider_user_id,job.id,`payment:${payment.rows[0].id}:confirmed`,'PAYMENT','บันทึกการชำระจำลองแล้ว','ไม่มีการโอนเงินจริง'); return saved.rows[0];
    });
    res.json({data:{...result,notice:'จำลองเท่านั้น — ไม่มีการโอนเงินจริง'}});
  });

  app.post('/api/payment-simulations/:paymentId/confirm-direct-received',async(req,res)=>{
    const result=await tx(pool,async(client)=>{
      const payment=await client.query('SELECT * FROM payment_simulations WHERE id=$1 FOR UPDATE',[req.params.paymentId]);
      if(!payment.rowCount) fail(404,'NOT_FOUND','ไม่พบรายการชำระจำลอง');
      const job=await jobFor(client,payment.rows[0].job_id,{lock:true}); requireProvider(job,req.user);
      if(payment.rows[0].method!=='DIRECT') fail(409,'PAYMENT_METHOD_NOT_ALLOWED','รายการนี้ไม่ได้เลือกชำระตรง');
      if(payment.rows[0].status==='PROVIDER_CONFIRMED_DIRECT') return payment.rows[0];
      if(payment.rows[0].status!=='PENDING') fail(409,'INVALID_STATE_TRANSITION','สถานะรายการนี้ยืนยันไม่ได้');
      const saved=await client.query("UPDATE payment_simulations SET status='PROVIDER_CONFIRMED_DIRECT',confirmed_by_user_id=$2,confirmed_at=now(),updated_at=now() WHERE id=$1 RETURNING id,method,status,amount,currency,confirmed_at",[payment.rows[0].id,req.user.id]);
      await notify(client,job.customer_user_id,job.id,`payment:${payment.rows[0].id}:direct-confirmed`,'PAYMENT','ช่างยืนยันการรับเงินตรง','เป็นคำยืนยันจากช่าง ไม่ใช่หลักฐานจาก Fixtech'); return saved.rows[0];
    });
    res.json({data:{...result,notice:'คำยืนยันจากผู้ให้บริการเท่านั้น'}});
  });

  app.post('/api/jobs/:jobId/reviews',async(req,res)=>{
    const rating=Number(req.body?.rating); const comment=req.body?.comment==null||req.body.comment===''?null:text(req.body.comment,1000,'comment');
    if(!Number.isInteger(rating)||rating<1||rating>5) fail(400,'VALIDATION_ERROR','คะแนนต้องอยู่ระหว่าง 1 ถึง 5');
    const result=await tx(pool,async(client)=>{
      const job=await jobFor(client,req.params.jobId,{lock:true}); requireOwner(job,req.user); validateStatus(job,['COMPLETED']);
      const id=randomUUID(); const saved=await client.query('INSERT INTO reviews(id,job_id,customer_user_id,provider_id,rating,comment) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,job_id,rating,comment,created_at',[id,job.id,req.user.id,job.assigned_provider_id,rating,comment]);
      await notify(client,job.provider_user_id,job.id,`review:${id}`,'REVIEW','ได้รับรีวิวใหม่','มีรีวิวจากงานที่เสร็จแล้ว'); return saved.rows[0];
    });
    res.status(201).json({data:result});
  });

  app.post('/api/jobs/:jobId/warranty-claims',async(req,res)=>{
    const reason=text(req.body?.reason,2000,'reason');
    const result=await tx(pool,async(client)=>{
      const job=await jobFor(client,req.params.jobId,{lock:true}); requireOwner(job,req.user); validateStatus(job,['COMPLETED']);
      const warranty=await client.query("SELECT * FROM warranties WHERE job_id=$1 AND status='ACTIVE' AND ends_at>now()",[job.id]);
      if(!warranty.rowCount) fail(409,'WARRANTY_NOT_ACTIVE','งานนี้ไม่มีการรับประกันที่ยังมีผล');
      const id=randomUUID(); await client.query("INSERT INTO warranty_claims(id,warranty_id,opened_by_user_id,reason,status) VALUES($1,$2,$3,$4,'OPEN')",[id,warranty.rows[0].id,req.user.id,reason]);
      await notify(client,job.provider_user_id,job.id,`warranty-claim:${id}`,'WARRANTY_CLAIM','มีคำขอใช้สิทธิ์รับประกัน',reason.slice(0,400)); return {id,jobId:job.id,status:'OPEN'};
    });
    res.status(201).json({data:result});
  });

  app.post('/api/jobs/:jobId/disputes',async(req,res)=>{
    const type=req.body?.type; const reason=text(req.body?.reason,2000,'reason');
    const allowedTypes=['SERVICE_QUALITY','PRICE_OR_SCOPE','PAYMENT','WARRANTY','CANCELLATION','OTHER'];
    if(!allowedTypes.includes(type)) fail(400,'VALIDATION_ERROR','ประเภทข้อพิพาทไม่ถูกต้อง');
    const evidenceIds=req.body?.attachmentIds??[];
    if(!Array.isArray(evidenceIds)||evidenceIds.length>3||evidenceIds.some((id)=>!isUuid(id))) fail(400,'VALIDATION_ERROR','รายการหลักฐานไม่ถูกต้อง');
    const result=await tx(pool,async(client)=>{
      const job=await jobFor(client,req.params.jobId,{lock:true}); requireParticipant(job,req.user); validateStatus(job,['WAITING_FOR_CUSTOMER_CONFIRMATION','COMPLETED']);
      const open=await client.query("SELECT 1 FROM disputes WHERE job_id=$1 AND status IN ('OPEN','UNDER_REVIEW') LIMIT 1",[job.id]);
      if(open.rowCount) fail(409,'DISPUTE_ALREADY_OPEN','งานนี้มีข้อพิพาทที่ยังไม่ปิด');
      if(evidenceIds.length){const files=await client.query("SELECT count(*)::int AS n FROM job_attachments WHERE job_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",[job.id,evidenceIds]);if(files.rows[0].n!==evidenceIds.length) fail(400,'INVALID_EVIDENCE','หลักฐานต้องเป็นไฟล์ของงานนี้');}
      const id=randomUUID(); await client.query("INSERT INTO disputes(id,job_id,opened_by_user_id,type,reason,status) VALUES($1,$2,$3,$4,$5,'OPEN')",[id,job.id,req.user.id,type,reason]);
      for(const attachmentId of evidenceIds) await client.query('INSERT INTO dispute_evidence(dispute_id,attachment_id,added_by_user_id) VALUES($1,$2,$3)',[id,attachmentId,req.user.id]);
      await client.query("UPDATE jobs SET status='DISPUTED',updated_at=now() WHERE id=$1",[job.id]); await statusEvent(client,job,req.user.id,'DISPUTED');
      const admins=await client.query("SELECT id FROM users WHERE role='ADMIN' AND is_active");
      for(const admin of admins.rows) await notify(client,admin.id,job.id,`dispute:${id}:opened:${admin.id}`,'DISPUTE','มีข้อพิพาทใหม่',`งาน ${job.id} มีข้อพิพาทรอพิจารณา`);
      await notifyParties(client,job,req.user.id,`dispute:${id}:opened`,'DISPUTE','เปิดข้อพิพาทแล้ว','ทีมผู้ดูแลจะตรวจสอบรายการและหลักฐาน');
      return {id,jobId:job.id,type,status:'OPEN'};
    });
    res.status(201).json({data:result});
  });

  app.get('/api/jobs/:jobId/disputes',async(req,res)=>{
    const job=await jobFor(pool,req.params.jobId); requireParticipant(job,req.user);
    const result=await pool.query('SELECT id,type,reason,status,opened_by_user_id,resolution,created_at,resolved_at FROM disputes WHERE job_id=$1 ORDER BY created_at DESC',[job.id]);
    res.json({data:result.rows});
  });

  app.get('/api/admin/disputes',async(req,res)=>{
    requireRole(req.user,['ADMIN']);
    const status=['OPEN','UNDER_REVIEW','RESOLVED','REJECTED','CLOSED'].includes(req.query.status)?req.query.status:null;
    const result=await pool.query(`SELECT d.id,d.job_id,d.type,d.reason,d.status,d.opened_by_user_id,d.resolution,d.created_at,j.category,j.service_format,j.status AS job_status
      FROM disputes d JOIN jobs j ON j.id=d.job_id WHERE ($1::varchar IS NULL OR d.status=$1) ORDER BY d.created_at DESC LIMIT 100`,[status]);
    res.json({data:result.rows});
  });

  app.post('/api/admin/disputes/:disputeId/resolve',async(req,res)=>{
    requireRole(req.user,['ADMIN']); const resolution=text(req.body?.resolution,2000,'resolution');
    const outcome=req.body?.outcome; if(!['RETURN_TO_CUSTOMER','KEEP_COMPLETED','CANCEL'].includes(outcome)) fail(400,'VALIDATION_ERROR','ผลพิจารณาไม่ถูกต้อง');
    const result=await tx(pool,async(client)=>{
      const found=await client.query('SELECT * FROM disputes WHERE id=$1 FOR UPDATE',[req.params.disputeId]); if(!found.rowCount) fail(404,'NOT_FOUND','ไม่พบข้อพิพาท'); const dispute=found.rows[0];
      if(!['OPEN','UNDER_REVIEW'].includes(dispute.status)) fail(409,'DISPUTE_CLOSED','ข้อพิพาทนี้ปิดแล้ว');
      const job=await jobFor(client,dispute.job_id,{lock:true}); if(job.status!=='DISPUTED') fail(409,'INVALID_STATE_TRANSITION','งานไม่อยู่ระหว่างข้อพิพาท');
      let nextStatus;
      if(outcome==='RETURN_TO_CUSTOMER') { if(job.completed_at) fail(409,'INVALID_RESOLUTION','งานที่ยืนยันเสร็จแล้วไม่สามารถย้อนกลับไปตรวจรับซ้ำใน Demo ได้'); nextStatus='WAITING_FOR_CUSTOMER_CONFIRMATION'; }
      else if(outcome==='KEEP_COMPLETED') { if(!job.completed_at) fail(409,'INVALID_RESOLUTION','งานที่ยังไม่เสร็จเลือกผลนี้ไม่ได้'); nextStatus='COMPLETED'; }
      else { if(job.completed_at) fail(409,'INVALID_RESOLUTION','งานที่ลูกค้ายืนยันเสร็จแล้วไม่สามารถยกเลิกย้อนหลังใน Demo ได้'); nextStatus='CANCELLED'; }
      const reasonForCancel=nextStatus==='CANCELLED'?`ข้อพิพาท ${dispute.id} — ${resolution}`.slice(0,500):null;
      await client.query("UPDATE disputes SET status='RESOLVED',resolved_by_admin_user_id=$2,resolution=$3,resolved_at=now() WHERE id=$1",[dispute.id,req.user.id,resolution]);
      await client.query('UPDATE jobs SET status=$2::varchar,cancel_reason=$3,cancelled_at=CASE WHEN $2::varchar=\'CANCELLED\' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1',[job.id,nextStatus,reasonForCancel]);
      await statusEvent(client,job,req.user.id,nextStatus);
      await client.query(`INSERT INTO admin_audit_logs(id,actor_user_id,job_id,dispute_id,action,reason,before_state,after_state)
        VALUES($1,$2,$3,$4,'DISPUTE_RESOLVED',$5,$6::jsonb,$7::jsonb)`,[randomUUID(),req.user.id,job.id,dispute.id,resolution,JSON.stringify({jobStatus:job.status,disputeStatus:dispute.status}),JSON.stringify({jobStatus:nextStatus,disputeStatus:'RESOLVED',outcome})]);
      await notifyParties(client,job,req.user.id,`dispute:${dispute.id}:resolved`,'DISPUTE_RESOLVED','Admin พิจารณาข้อพิพาทแล้ว',resolution.slice(0,400));
      return {disputeId:dispute.id,status:'RESOLVED',jobStatus:nextStatus};
    });
    res.json({data:result});
  });

  app.get('/api/admin/warranty-claims',async(req,res)=>{
    requireRole(req.user,['ADMIN']);
    const result=await pool.query(`SELECT wc.id,wc.warranty_id,wc.opened_by_user_id,wc.reason,wc.status,wc.resolution,wc.created_at,w.job_id
      FROM warranty_claims wc JOIN warranties w ON w.id=wc.warranty_id ORDER BY wc.created_at DESC LIMIT 100`);
    res.json({data:result.rows});
  });

  app.post('/api/admin/warranty-claims/:claimId/resolve',async(req,res)=>{
    requireRole(req.user,['ADMIN']); const resolution=text(req.body?.resolution,2000,'resolution');
    const status=req.body?.status; if(!['RESOLVED','REJECTED'].includes(status)) fail(400,'VALIDATION_ERROR','สถานะผลเคลมไม่ถูกต้อง');
    const result=await tx(pool,async(client)=>{
      const claim=await client.query('SELECT wc.*,w.job_id FROM warranty_claims wc JOIN warranties w ON w.id=wc.warranty_id WHERE wc.id=$1 FOR UPDATE OF wc',[req.params.claimId]);
      if(!claim.rowCount) fail(404,'NOT_FOUND','ไม่พบคำขอรับประกัน'); if(!['OPEN','UNDER_REVIEW'].includes(claim.rows[0].status)) fail(409,'INVALID_STATE_TRANSITION','คำขอนี้ปิดแล้ว');
      await client.query('UPDATE warranty_claims SET status=$2,resolution=$3,closed_at=now() WHERE id=$1',[req.params.claimId,status,resolution]);
      const job=await jobFor(client,claim.rows[0].job_id); await client.query(`INSERT INTO admin_audit_logs(id,actor_user_id,job_id,action,reason,before_state,after_state)
        VALUES($1,$2,$3,'WARRANTY_CLAIM_RESOLVED',$4,$5::jsonb,$6::jsonb)`,[randomUUID(),req.user.id,job.id,resolution,JSON.stringify({claimStatus:claim.rows[0].status}),JSON.stringify({claimStatus:status})]);
      await notify(client,claim.rows[0].opened_by_user_id,job.id,`warranty-claim:${req.params.claimId}:resolved`,'WARRANTY_CLAIM','อัปเดตคำขอรับประกัน',resolution.slice(0,400));
      return {claimId:req.params.claimId,status,resolution};
    });
    res.json({data:result});
  });

  app.post('/api/jobs/:jobId/confirm-summary', async (req, res) => {
    const result = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true }); requireOwner(job, req.user); validateStatus(job, ['DRAFT']);
      if (!job.ai_summary || !job.analyzed_at || job.analysis_version < 1) fail(409, 'ANALYSIS_REQUIRED', 'ต้องมีสรุปอาการก่อนยืนยัน');
      const estimate = await client.query("SELECT id FROM price_estimates WHERE job_id=$1 AND status='ACCEPTED' ORDER BY version DESC LIMIT 1",[job.id]);
      const nextStatus = estimate.rowCount ? 'READY_TO_PUBLISH' : 'DRAFT';
      await client.query("UPDATE jobs SET confirmed_analysis_version=analysis_version,summary_confirmed_at=now(),status=$2,updated_at=now() WHERE id=$1", [job.id,nextStatus]);
      if (nextStatus !== job.status) await statusEvent(client, job, req.user.id, nextStatus);
      return { jobId: job.id, status: nextStatus, confirmedAnalysisVersion: job.analysis_version, priceAccepted: Boolean(estimate.rowCount) };
    });
    res.json({ data: result });
  });

  app.post('/api/jobs/:jobId/cancel', async (req, res) => {
    const reason = text(req.body?.reason, 500, 'reason');
    const result = await tx(pool, async (client) => {
      const job = await jobFor(client, req.params.jobId, { lock: true }); requireOwner(job, req.user);
      if (['IN_PROGRESS','WAITING_FOR_CUSTOMER_CONFIRMATION','COMPLETED','CANCELLED','DISPUTED'].includes(job.status)) fail(409, 'INVALID_STATE_TRANSITION', 'ยกเลิกได้ก่อนเริ่มงานเท่านั้น');
      await client.query('UPDATE jobs SET status=\'CANCELLED\',cancel_reason=$2,cancelled_at=now(),updated_at=now() WHERE id=$1', [job.id,reason]);
      await client.query("UPDATE offers SET status='NOT_SELECTED' WHERE job_id=$1 AND status='AVAILABLE'", [job.id]);
      await client.query("UPDATE appointments SET status='CANCELLED',cancelled_by_user_id=$2,cancel_reason=$3 WHERE job_id=$1 AND status IN ('PROPOSED','CONFIRMED','RESCHEDULE_REQUESTED')", [job.id,req.user.id,reason]);
      await statusEvent(client, job, req.user.id, 'CANCELLED'); await notifyParties(client, job, req.user.id, `job:${job.id}:cancelled`, 'JOB_CANCELLED', 'งานถูกยกเลิก', reason);
      return { jobId: job.id, status: 'CANCELLED' };
    });
    res.json({ data: result });
  });

  registerFastworkApi(app, { pool, env, storageRoot });
  registerAdminApi(app, { pool, env });
  registerAiScreeningApi(app, { aiProvider });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const databaseUnavailable = ['28P01', 'ECONNREFUSED', 'ENOTFOUND', '3D000', 'ETIMEDOUT', '57P03'].includes(err.code);
    const safeIntegrationFailure = [502,503].includes(err.status) && /^(AI_|MARKET_PRICE_|ESTIMATE_)/.test(err.code ?? '');
    const status = err instanceof HttpError ? err.status : safeIntegrationFailure ? err.status : databaseUnavailable ? 503 : (err.code === '23505' ? 409 : err.type === 'entity.too.large' ? 413 : 500);
    const code = err instanceof HttpError ? err.code : safeIntegrationFailure ? err.code : databaseUnavailable ? 'DATABASE_UNAVAILABLE' : (err.code === '23505' ? 'CONFLICT' : err.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR');
    const message = err instanceof HttpError ? err.message : safeIntegrationFailure ? err.message : databaseUnavailable ? 'เชื่อมต่อฐานข้อมูลไม่ได้ กรุณาตรวจ PostgreSQL และค่า DATABASE_URL ใน .env แล้วลองใหม่' : (err.code === '23505' ? 'รายการนี้มีอยู่แล้ว' : err.type === 'entity.too.large' ? 'ไฟล์มีขนาดเกิน 10 MiB' : 'เกิดข้อผิดพลาดภายในระบบ');
    if (status >= 500) console.error('API request failed', { method: req.method, path: req.path, code: err.code, message: err.message, stack: err.stack });
    res.status(status).json({ error: { code, message } });
  });
}
