import pg from 'pg';
import { DEMO_TABLES } from '../src/app.js';

const { Client } = pg;
const requiredRoles = ['CUSTOMER_GENERAL', 'CUSTOMER_BUSINESS', 'TECHNICIAN', 'ADMIN'];
const beforeSeed = process.argv.includes('--before-seed');
const demoEmails = [
  'customer1@fixtech.demo', 'customer2@fixtech.demo', 'company@fixtech.demo',
  'tech.soft.a@fixtech.demo', 'tech.soft.b@fixtech.demo',
  'tech.hardware.a@fixtech.demo', 'tech.hardware.b@fixtech.demo',
  'admin@fixtech.demo'
];
let failed = false;

function pass(label) { console.log(`[ผ่าน] ${label}`); }
function issue(label) { failed = true; console.error(`[ต้องแก้] ${label}`); }

const connectionString = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;
const seedPassword = process.env.DEMO_SEED_PASSWORD;
let canCheckDatabase = Boolean(connectionString);

if (!connectionString) issue('ไม่พบ DATABASE_URL ใน .env');
else {
  try {
    const database = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error();
    if (!['localhost', '127.0.0.1', '::1'].includes(database.hostname)) {
      issue('DATABASE_URL ต้องชี้ไปยัง PostgreSQL ในเครื่องสำหรับ Demo นี้');
      canCheckDatabase = false;
    } else if (!database.pathname || database.pathname === '/') {
      issue('DATABASE_URL ยังไม่ได้ระบุชื่อฐานข้อมูล');
      canCheckDatabase = false;
    }
  } catch {
    issue('DATABASE_URL มีรูปแบบไม่ถูกต้อง (ไม่ได้แสดงค่าลับ)');
    canCheckDatabase = false;
  }
}

if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32 || /replace-with/i.test(sessionSecret)) {
  issue('ตั้ง SESSION_SECRET ใน .env ให้ยาวอย่างน้อย 32 bytes และไม่ใช้ข้อความตัวอย่าง');
} else pass('SESSION_SECRET ถูกตั้งค่า');

if (!seedPassword || seedPassword.length < 12 || /replace-with/i.test(seedPassword)) {
  issue('ตั้ง DEMO_SEED_PASSWORD ใน .env อย่างน้อย 12 ตัวอักษร ก่อน seed บัญชี');
} else pass('DEMO_SEED_PASSWORD ถูกตั้งค่า');

if (process.env.NODE_ENV === 'production') issue('NODE_ENV=production ใช้เปิด Demo นี้ไม่ได้');

if (canCheckDatabase) {
const client = new Client({ connectionString, connectionTimeoutMillis: 3000 });
try {
  await client.connect();
  pass('เชื่อมต่อ PostgreSQL ในเครื่องได้');

  const schema = await client.query(
    `SELECT count(*)::int AS count
     FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name=ANY($1::text[])`,
    [DEMO_TABLES]
  );
  const actualTables = Number(schema.rows[0]?.count ?? 0);
  if (actualTables !== DEMO_TABLES.length) {
    issue(`Schema ยังไม่ครบ: พบ ${actualTables}/${DEMO_TABLES.length} ตารางที่ระบบต้องใช้; ติดตั้ง DDL v1.8 ลงฐาน Demo ว่างก่อน`);
  } else pass(`Schema v1.8 ครบ ${actualTables}/${DEMO_TABLES.length} ตาราง`);

  if (actualTables === DEMO_TABLES.length) {
    const accounts = await client.query(
      'SELECT count(*)::int AS count, count(DISTINCT role)::int AS roles FROM users WHERE email=ANY($1::text[]) AND is_active=true',
      [demoEmails]
    );
    const accountCount = Number(accounts.rows[0]?.count ?? 0);
    const roleCount = Number(accounts.rows[0]?.roles ?? 0);
    if (accountCount !== demoEmails.length || roleCount !== requiredRoles.length) {
      const message = `บัญชีสาธิตยังไม่ครบ: พบ ${accountCount}/${demoEmails.length} บัญชีที่ใช้งานได้; หากเป็นฐานใหม่ให้ seed เพียงครั้งเดียว`;
      if (beforeSeed) console.log(`[ขั้นถัดไป] ${message}`);
      else issue(message);
    } else pass(`บัญชีสาธิตพร้อม ${accountCount}/${demoEmails.length} บัญชี ครบ ${roleCount} บทบาท`);
  }
} catch (error) {
  const reason = error.code === '28P01'
    ? 'ยืนยันตัวตน PostgreSQL ไม่ผ่าน (28P01); ตรวจ username/password ใน DATABASE_URL โดยไม่ส่งรหัสผ่านให้ผู้อื่น'
    : error.code === '3D000'
      ? 'ไม่พบฐานข้อมูลตาม DATABASE_URL; สร้างฐาน Demo ว่างก่อน'
      : `เชื่อมต่อฐานข้อมูลไม่ได้ (${error.code ?? 'unknown'}); ตรวจ PostgreSQL และ DATABASE_URL`;
  issue(reason);
} finally {
  await client.end().catch(() => {});
}
}

if (failed) process.exitCode = 1;
else console.log('\nพร้อมเริ่มเว็บด้วย: npm start');
