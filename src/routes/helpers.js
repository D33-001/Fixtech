import { randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(status, code, message) {
  throw new HttpError(status, code, message);
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

export function text(value, max, field) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max) {
    fail(400, 'VALIDATION_ERROR', `${field} ไม่ถูกต้อง`);
  }
  return value.trim();
}

export function optionalText(value, max, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) {
    fail(400, 'VALIDATION_ERROR', `${field} ไม่ถูกต้อง`);
  }
  return value.trim();
}

export function requireRole(user, allowed) {
  if (!user || !allowed.includes(user.role)) {
    fail(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ดำเนินการนี้');
  }
}

export async function tx(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function jobFor(client, id, { lock = false } = {}) {
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

export async function notify(client, userId, jobId, eventKey, type, title, body) {
  if (!userId) return;
  await client.query(
    `INSERT INTO notifications(id,user_id,job_id,event_key,type,title,body)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,event_key) DO NOTHING`,
    [randomUUID(), userId, jobId, eventKey, type, title, body]
  );
}

export async function audit(client, actorUserId, { jobId = null, disputeId = null, action, reason, beforeState = null, afterState }) {
  await client.query(
    `INSERT INTO admin_audit_logs(id,actor_user_id,job_id,dispute_id,action,reason,before_state,after_state)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(),
      actorUserId,
      jobId,
      disputeId,
      action,
      reason,
      beforeState ? JSON.stringify(beforeState) : null,
      JSON.stringify(afterState ?? {})
    ]
  );
}
