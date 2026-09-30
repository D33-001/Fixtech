import { createHash, randomUUID } from 'node:crypto';
import { verifiedGatewayStatus } from './policies.js';

// The gateway adapter must retrieve the charge from a fixed official API origin using server credentials.
// No browser return URL or webhook body may directly set PAID.
export async function applyGatewayEvent({ pool, gateway, event, rawPayload, expectedLiveMode }) {
  if (!gateway?.name || typeof gateway.retrieveCharge !== 'function' ||
      typeof event?.id !== 'string' || event.id.length > 160 || !event.id ||
      typeof event.chargeId !== 'string' || event.chargeId.length > 160 || !event.chargeId ||
      !['charge.create', 'charge.update', 'charge.complete', 'charge.expire'].includes(event.type) ||
      !Buffer.isBuffer(rawPayload) || rawPayload.length > 65536 || typeof expectedLiveMode !== 'boolean') {
    throw new TypeError('Invalid gateway event input');
  }
  const digest = createHash('sha256').update(rawPayload).digest('hex');
  const known = await pool.query('SELECT id FROM payment_intents WHERE gateway_name=$1 AND gateway_charge_id=$2 AND method=\'GATEWAY\'', [gateway.name, event.chargeId]);
  if (!known.rowCount) return { outcome: 'UNKNOWN_CHARGE' };
  const duplicate = await pool.query('SELECT payload_sha256 FROM payment_webhook_events WHERE gateway_name=$1 AND external_event_id=$2', [gateway.name,event.id]);
  if (duplicate.rowCount) return { outcome: duplicate.rows[0].payload_sha256 === digest ? 'DUPLICATE' : 'EVENT_ID_COLLISION' };

  // Treat the webhook as a notification only. The authoritative status is fetched independently.
  const charge = await gateway.retrieveCharge(event.chargeId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query('SELECT * FROM payment_intents WHERE id=$1 FOR UPDATE', [known.rows[0].id]);
    const intent = rows.rows[0];
    if (!intent || intent.gateway_charge_id !== event.chargeId || intent.gateway_name !== gateway.name) {
      await client.query('ROLLBACK');
      return { outcome: 'UNKNOWN_CHARGE' };
    }
    const prior = await client.query('SELECT payload_sha256,processing_status FROM payment_webhook_events WHERE gateway_name=$1 AND external_event_id=$2', [gateway.name,event.id]);
    if (prior.rowCount) {
      await client.query('COMMIT');
      return { outcome: prior.rows[0].payload_sha256 === digest ? 'DUPLICATE' : 'EVENT_ID_COLLISION' };
    }
    let nextStatus;
    let errorCode = null;
    try { nextStatus = verifiedGatewayStatus({ intent, charge, expectedLiveMode }); }
    catch (error) { errorCode = error.code ?? 'INVALID_CHARGE'; }
    let processingStatus = 'REJECTED';
    if (!errorCode) {
      if (intent.status === nextStatus) processingStatus = 'IGNORED';
      else if (['PENDING','AWAITING_CUSTOMER'].includes(intent.status)) {
        await client.query('UPDATE payment_intents SET status=$2::varchar,paid_at=CASE WHEN $2::varchar=\'PAID\' THEN now() ELSE paid_at END,updated_at=now() WHERE id=$1', [intent.id,nextStatus]);
        processingStatus = 'PROCESSED';
      } else {
        processingStatus = 'IGNORED';
        errorCode = 'OUT_OF_ORDER_EVENT';
      }
    }
    await client.query(`INSERT INTO payment_webhook_events
      (id,payment_intent_id,gateway_name,external_event_id,gateway_charge_id,event_type,payload_sha256,processing_status,error_code,processed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
      [randomUUID(),intent.id,gateway.name,event.id,event.chargeId,event.type,digest,processingStatus,errorCode]);
    await client.query('COMMIT');
    return { outcome: processingStatus, status: errorCode ? intent.status : nextStatus, errorCode };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
