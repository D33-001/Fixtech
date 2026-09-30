import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { reviewVerificationCase } from '../src/production/identity-service.js';
import { getNetworkReference } from '../src/production/network-pricing.js';

const connectionString = process.env.FIXTECH_PRODUCTION_TEST_DATABASE_URL;
const authorized = process.env.FIXTECH_PRODUCTION_TEST_DATABASE_ALLOW_MUTATION === 'yes';

test('vendor-backed Admin approval controls current Fixtech network price coverage', { skip: !connectionString || !authorized }, async () => {
  const database = new URL(connectionString);
  if (database.pathname !== '/fixtech_prod_migration_check' || !['127.0.0.1','localhost'].includes(database.hostname)) {
    throw new Error('Production integration test requires the named disposable loopback database');
  }
  const pool = new pg.Pool({ connectionString, max: 2 });
  const admin = { id: randomUUID(), role: 'ADMIN' };
  const district = `REVIEW_${Date.now()}`;
  const future = new Date(Date.now() + 30 * 86400000).toISOString();
  const priceExpiry = new Date(Date.now() + 86400000).toISOString();
  const providers = [];
  try {
    await pool.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES($1,$2,'unused','ADMIN','Review Admin')", [admin.id,`review-${admin.id}@example.invalid`]);
    await pool.query('INSERT INTO districts(code,name) VALUES($1,$2)', [district,district]);
    await pool.query("INSERT INTO service_catalog(category,service_format,label) VALUES('SOFTWARE','ONLINE','Software online') ON CONFLICT DO NOTHING");
    for (let index = 0; index < 3; index++) {
      const userId = randomUUID(); const providerId = randomUUID(); const caseId = randomUUID();
      const externalRef = `case_${randomUUID()}`;
      await pool.query("INSERT INTO users(id,email,password_hash,role,display_name) VALUES($1,$2,'unused','TECHNICIAN','Review Tech')", [userId,`review-${userId}@example.invalid`]);
      await pool.query('INSERT INTO provider_profiles(id,user_id,display_name,is_approved,is_available) VALUES($1,$2,$3,true,true)', [providerId,userId,`Review Provider ${index}`]);
      await pool.query("INSERT INTO provider_verification_cases(id,provider_id,initiated_by_user_id,vendor,external_case_ref,status) VALUES($1,$2,$3,'iapp',$4,'PENDING')", [caseId,providerId,userId,externalRef]);
      const vendor = { name: 'iapp', retrieveCase: async () => ({ reference: externalRef, verified: true, expiresAt: future }) };
      assert.deepEqual(await reviewVerificationCase({ pool,vendor,caseId,adminUser:admin,decision:'VERIFIED',reason:'ผลตรวจผ่าน' }), { caseId,status:'VERIFIED' });
      await pool.query(`INSERT INTO provider_rate_cards(id,provider_id,category,service_format,district_code,amount_minor,scope_summary,usage_grant_ref,status,approved_by_user_id,published_at,valid_until)
        VALUES($1,$2,'SOFTWARE','ONLINE',$3,$4,'Remote help','terms-v1','ACTIVE',$5,now(),$6)`, [randomUUID(),providerId,district,30000+index*10000,admin.id,priceExpiry]);
      providers.push({ providerId,caseId });
    }
    const reference = await getNetworkReference({ pool,category:'SOFTWARE',serviceFormat:'ONLINE',districtCode:district });
    assert.equal(reference.sampleCount,3);
    assert.equal(reference.lowMinor,30000);
    assert.equal(reference.highMinor,50000);
    await pool.query("UPDATE provider_verification_cases SET status='EXPIRED',decision_by_user_id=NULL,decided_at=NULL WHERE id=$1", [providers[0].caseId]);
    await assert.rejects(getNetworkReference({ pool,category:'SOFTWARE',serviceFormat:'ONLINE',districtCode:district }), { code:'INSUFFICIENT_PRICE_COVERAGE' });
  } finally { await pool.end(); }
});
