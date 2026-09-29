import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../src/auth.js';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
const seedPassword = process.env.DEMO_SEED_PASSWORD;
if (!connectionString) throw new Error('DATABASE_URL is required');
if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production');
if (process.env.DEMO_SEED_ALLOW_MUTATION !== 'yes') throw new Error('Set DEMO_SEED_ALLOW_MUTATION=yes only after verifying DATABASE_URL points to a disposable Demo database');
if (!seedPassword) throw new Error('Set DEMO_SEED_PASSWORD in the local .env file before seeding');
if (seedPassword.length < 12) throw new Error('DEMO_SEED_PASSWORD must be at least 12 characters');

const accounts = [
  { email: 'customer1@fixtech.demo', role: 'CUSTOMER_GENERAL', name: 'ลูกค้าทั่วไป 1' },
  { email: 'customer2@fixtech.demo', role: 'CUSTOMER_GENERAL', name: 'ลูกค้าทั่วไป 2' },
  { email: 'company@fixtech.demo', role: 'CUSTOMER_BUSINESS', name: 'บริษัทตัวอย่าง' },
  { email: 'tech.soft.a@fixtech.demo', role: 'TECHNICIAN', name: 'ช่างซอฟต์แวร์ A', providerId: 'f7000000-0000-4000-8000-000000000001', priority: 10 },
  { email: 'tech.soft.b@fixtech.demo', role: 'TECHNICIAN', name: 'ช่างซอฟต์แวร์ B', providerId: 'f7000000-0000-4000-8000-000000000002', priority: 20 },
  { email: 'tech.hardware.a@fixtech.demo', role: 'TECHNICIAN', name: 'ช่างฮาร์ดแวร์ A', providerId: 'f7000000-0000-4000-8000-000000000003', priority: 10 },
  { email: 'tech.hardware.b@fixtech.demo', role: 'TECHNICIAN', name: 'ช่างฮาร์ดแวร์ B', providerId: 'f7000000-0000-4000-8000-000000000004', priority: 20 },
  { email: 'admin@fixtech.demo', role: 'ADMIN', name: 'ผู้ดูแลระบบ' }
];
const districts = [
  ['BANG_NA', 'บางนา'], ['PATHUM_WAN', 'ปทุมวัน'], ['CHATUCHAK', 'จตุจักร']
];
const client = new Client({ connectionString });
await client.connect();
try {
  await client.query('BEGIN');
  for (const [code, name] of districts) await client.query(
    'INSERT INTO districts(code,name) VALUES($1,$2) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name', [code,name]
  );
  await client.query(`INSERT INTO service_catalog(category,service_format,label,is_active) VALUES
    ('SOFTWARE','ONLINE','แก้ปัญหา Software ออนไลน์',true),
    ('HARDWARE','ONSITE','ตรวจ/ซ่อม Hardware ณ สถานที่',true)
    ON CONFLICT(category,service_format) DO UPDATE SET label=EXCLUDED.label,is_active=true`);
  const passwordHash = await hashPassword(seedPassword);
  const users = new Map();
  for (const account of accounts) {
    const userId = randomUUID();
    const user = await client.query(`INSERT INTO users(id,email,password_hash,role,display_name,is_active)
      VALUES($1,$2,$3,$4,$5,true)
      ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,display_name=EXCLUDED.display_name,is_active=true,updated_at=now()
      RETURNING id`, [userId, account.email, passwordHash, account.role, account.name]);
    users.set(account.email, user.rows[0].id);
    if (account.role === 'CUSTOMER_BUSINESS') await client.query(`INSERT INTO company_profiles(user_id,company_name,contact_name)
      VALUES($1,'Fixtech บริษัทตัวอย่าง','ผู้ประสานงาน') ON CONFLICT(user_id) DO NOTHING`, [user.rows[0].id]);
    if (account.providerId) {
      const provider = await client.query(`INSERT INTO provider_profiles(id,user_id,display_name,priority,is_approved,is_available)
        VALUES($1,$2,$3,$4,true,true)
        ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,priority=EXCLUDED.priority,is_approved=true,is_available=true,updated_at=now()
        RETURNING id`, [account.providerId,user.rows[0].id,account.name,account.priority]);
      const service = account.email.includes('soft.') ? ['SOFTWARE','ONLINE'] : ['HARDWARE','ONSITE'];
      await client.query('INSERT INTO provider_services(provider_id,category,service_format) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [provider.rows[0].id,...service]);
      for (const [code] of districts) await client.query('INSERT INTO provider_districts(provider_id,district_code) VALUES($1,$2) ON CONFLICT DO NOTHING', [provider.rows[0].id,code]);
    }
  }
  await client.query(`INSERT INTO pricing_rule_sets(id,version,rules_json,effective_at,is_active)
    VALUES($1,1,$2::jsonb,now(),false) ON CONFLICT(version) DO NOTHING`, [randomUUID(), JSON.stringify({
      note: 'Historical v1 demo calculation rules.',
      laborBase: { SOFTWARE_ONLINE: 180, HARDWARE_ONSITE: 300 },
      marketShare: 0.7,
      complexityFactor: 1,
      districtFactors: { BANG_NA: 1, PATHUM_WAN: 1.1, CHATUCHAK: 1.05 },
      profitMargin: 0.15
    })]);
  await client.query(`INSERT INTO pricing_rule_sets(id,version,rules_json,effective_at,is_active)
    VALUES($1,2,$2::jsonb,now(),false) ON CONFLICT(version) DO NOTHING`, [randomUUID(), JSON.stringify({
      note: 'Historical v2 student-demo pricing rules; retained for reproducible estimate snapshots.',
      laborBase: { SOFTWARE_ONLINE: 180, HARDWARE_ONSITE: 300 },
      marketShare: 0.7,
      complexityFactor: 1,
      districtFactors: { BANG_NA: 1, PATHUM_WAN: 1.1, CHATUCHAK: 1.05 },
      profitMargin: 0.15
    })]);
  await client.query(`INSERT INTO pricing_rule_sets(id,version,rules_json,effective_at,is_active)
    VALUES($1,3,$2::jsonb,now(),true) ON CONFLICT(version) DO UPDATE SET rules_json=EXCLUDED.rules_json,is_active=true,effective_at=EXCLUDED.effective_at`, [randomUUID(), JSON.stringify({
      note: 'Step 7 student-demo formula; platform markup is a demo assumption, not actual profit or provider commission.',
      laborBase: { SOFTWARE_ONLINE: 180, HARDWARE_ONSITE: 300 },
      marketShare: 0.7,
      districtFactors: { BANG_NA: 1, PATHUM_WAN: 1.1, CHATUCHAK: 1.05 },
      platformMarkupRate: 0.15,
      complexityMultiplier: 1,
      urgencyMultiplier: 1
    })]);
  await client.query('UPDATE pricing_rule_sets SET is_active=false WHERE version < 3');
  await client.query('COMMIT');
  console.log(`Seed complete: ${accounts.length} demo accounts, ${districts.length} districts, 4 providers.`);
  console.log('The demo password is set locally in DEMO_SEED_PASSWORD; it is not printed.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
