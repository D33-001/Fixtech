import { randomUUID } from 'node:crypto';
import { ProductionPolicyError } from './policies.js';

// The vendor adapter returns only a verification decision and reference.
// Raw ID-card and biometric images should remain with the contracted provider.
export async function reviewVerificationCase({ pool, vendor, caseId, adminUser, decision, reason }) {
  if (adminUser?.role !== 'ADMIN') throw new ProductionPolicyError('ADMIN_REQUIRED', 'เฉพาะผู้ดูแลที่มีสิทธิ์ตรวจช่าง');
  if (!['VERIFIED','REJECTED'].includes(decision) || typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
    throw new ProductionPolicyError('INVALID_DECISION', 'ผลพิจารณาหรือเหตุผลไม่ถูกต้อง');
  }
  const candidate = await pool.query('SELECT id,vendor,external_case_ref,status FROM provider_verification_cases WHERE id=$1', [caseId]);
  if (!candidate.rowCount) throw new ProductionPolicyError('CASE_NOT_FOUND', 'ไม่พบคำขอตรวจช่าง');
  const original = candidate.rows[0];
  let vendorResult;
  if (decision === 'VERIFIED') {
    if (!original.external_case_ref || original.vendor !== vendor?.name || typeof vendor.retrieveCase !== 'function') {
      throw new ProductionPolicyError('VENDOR_UNAVAILABLE', 'ยังไม่มีผลตรวจจากผู้ให้บริการ');
    }
    vendorResult = await vendor.retrieveCase(original.external_case_ref);
    const expires = Date.parse(vendorResult?.expiresAt ?? '');
    if (vendorResult?.reference !== original.external_case_ref || vendorResult?.verified !== true ||
        !Number.isFinite(expires) || expires <= Date.now()) {
      throw new ProductionPolicyError('VENDOR_NOT_VERIFIED', 'ผลตรวจจากผู้ให้บริการยังไม่ผ่านหรือหมดอายุ');
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT c.*,p.user_id FROM provider_verification_cases c
      JOIN provider_profiles p ON p.id=c.provider_id WHERE c.id=$1 FOR UPDATE OF c`, [caseId]);
    if (!current.rowCount || current.rows[0].external_case_ref !== original.external_case_ref ||
        !['PENDING','IN_REVIEW'].includes(current.rows[0].status)) {
      throw new ProductionPolicyError('CASE_CHANGED', 'คำขอเปลี่ยนไปแล้ว กรุณาตรวจใหม่');
    }
    if (current.rows[0].user_id === adminUser.id) throw new ProductionPolicyError('SELF_REVIEW', 'ผู้สมัครอนุมัติตนเองไม่ได้');
    await client.query(`UPDATE provider_verification_cases
      SET status=$2,decision_by_user_id=$3,decision_reason=$4,decided_at=now(),expires_at=$5
      WHERE id=$1`, [caseId,decision,adminUser.id,reason.trim(),decision === 'VERIFIED' ? vendorResult.expiresAt : null]);
    await client.query(`INSERT INTO provider_verification_events(id,case_id,actor_user_id,event_type,result_code)
      VALUES($1,$2,$3,'ADMIN_DECISION',$4)`, [randomUUID(),caseId,adminUser.id,decision]);
    await client.query('COMMIT');
    return { caseId, status: decision };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
