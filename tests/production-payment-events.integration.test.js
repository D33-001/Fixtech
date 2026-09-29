import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { applyGatewayEvent } from '../src/production/payment-events.js';

const connectionString = process.env.FIXTECH_PRODUCTION_TEST_DATABASE_URL;
const authorized = process.env.FIXTECH_PRODUCTION_TEST_DATABASE_ALLOW_MUTATION === 'yes';

test('gateway events persist only independently verified payment status', { skip: !connectionString || !authorized }, async () => {
  const database = new URL(connectionString);
  if (!/^fixtech_prod_migration_check$/.test(database.pathname.slice(1)) || !['127.0.0.1','localhost'].includes(database.hostname)) {
    throw new Error('Production integration test requires the named disposable loopback database');
  }
  const pool = new pg.Pool({ connectionString, max: 2 });
  const customerId = randomUUID();
  const providerUserId = randomUUID();
  const providerId = randomUUID();
  const jobId = randomUUID();
  const intentId = randomUUID();
  const district = `REVIEW_${Date.now()}`;
  const chargeId = `chrg_test_${randomUUID().replaceAll('-', '')}`;
  try {
    await pool.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES($1,$2,'unused','CUSTOMER_GENERAL','Review Customer'),($3,$4,'unused','TECHNICIAN','Review Tech')", [customerId,`review-${customerId}@example.invalid`,providerUserId,`review-${providerUserId}@example.invalid`]);
    await pool.query('INSERT INTO provider_profiles(id,user_id,display_name,is_approved,is_available) VALUES($1,$2,\'Review Provider\',true,true)', [providerId,providerUserId]);
    await pool.query('INSERT INTO districts(code,name) VALUES($1,$2)', [district,district]);
    await pool.query("INSERT INTO service_catalog(category,service_format,label) VALUES('SOFTWARE','ONLINE','Software online') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO jobs(id,customer_user_id,district_code,category,service_format,assigned_provider_id,agreed_amount,agreed_by_user_id,agreed_at,status,symptom_text) VALUES($1,$2,$3,'SOFTWARE','ONLINE',$4,470,$2,now(),'COMPLETED','Synthetic review job')", [jobId,customerId,district,providerId]);
    await pool.query("INSERT INTO payment_intents(id,job_id,customer_user_id,method,status,amount_minor,gateway_name,gateway_charge_id,idempotency_key) VALUES($1,$2,$3,'GATEWAY','PENDING',47000,'opn',$4,$5)", [intentId,jobId,customerId,chargeId,randomUUID()]);
    let charge = { id: chargeId, amount: 47000, currency: 'THB', livemode: false, status: 'successful' };
    const gateway = { name: 'opn', retrieveCharge: async () => charge };
    const event = { id: `evt_${randomUUID()}`, chargeId, type: 'charge.complete' };
    const rawPayload = Buffer.from('{"event":"synthetic"}');
    assert.deepEqual(await applyGatewayEvent({ pool,gateway,event,rawPayload,expectedLiveMode:false }), { outcome:'PROCESSED',status:'PAID',errorCode:null });
    assert.equal((await pool.query('SELECT status,paid_at FROM payment_intents WHERE id=$1',[intentId])).rows[0].status,'PAID');
    assert.equal((await applyGatewayEvent({ pool,gateway,event,rawPayload,expectedLiveMode:false })).outcome,'DUPLICATE');
    charge = { ...charge, status:'failed' };
    assert.deepEqual(await applyGatewayEvent({ pool,gateway,event:{...event,id:`evt_${randomUUID()}`},rawPayload,expectedLiveMode:false }), { outcome:'IGNORED',status:'PAID',errorCode:'OUT_OF_ORDER_EVENT' });
    charge = { ...charge, status:'successful', amount: 47001 };
    assert.equal((await applyGatewayEvent({ pool,gateway,event:{...event,id:`evt_${randomUUID()}`},rawPayload,expectedLiveMode:false })).errorCode,'CHARGE_MISMATCH');
    assert.equal((await pool.query('SELECT status FROM payment_intents WHERE id=$1',[intentId])).rows[0].status,'PAID');
  } finally {
    await pool.end();
  }
});
