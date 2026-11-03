import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

function demoPool() {
  const users = new Map();
  const companies = new Map();
  let pending = null;
  const query = async (sql, values = []) => {
    if (sql === 'BEGIN') { pending = { users: new Map(users), companies: new Map(companies) }; return { rows: [], rowCount: 0 }; }
    if (sql === 'COMMIT') { users.clear(); companies.clear(); for (const [key, value] of pending.users) users.set(key, value); for (const [key, value] of pending.companies) companies.set(key, value); pending = null; return { rows: [], rowCount: 0 }; }
    if (sql === 'ROLLBACK') { pending = null; return { rows: [], rowCount: 0 }; }
    if (sql.includes('SELECT 1 FROM users')) return { rows: users.has(values[0]) ? [{ '?column?': 1 }] : [], rowCount: users.has(values[0]) ? 1 : 0 };
    if (sql.startsWith('INSERT INTO users')) { pending.users.set(values[1], { id: values[0], email: values[1], password_hash: values[2], role: values[3], display_name: values[4], is_active: true }); return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('INSERT INTO company_profiles')) { pending.companies.set(values[0], { company_name: values[1], contact_name: values[2] }); return { rows: [], rowCount: 1 }; }
    if (sql.includes('FROM users u LEFT JOIN provider_profiles p')) {
      const user = [...users.values()].find((item) => item.email === values[0] || item.id === values[0]);
      return { rows: user ? [{ ...user, provider_id: null }] : [], rowCount: user ? 1 : 0 };
    }
    if (sql.includes('FROM service_catalog')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM districts')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM jobs')) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  return { users, companies, query, connect: async () => ({ query, release() {} }) };
}

async function withServer(run) {
  const pool = demoPool();
  const app = createApp({ pool, env: { SESSION_SECRET: 'registration-test-secret-at-least-32-bytes' } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`, pool); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

test('customer can register with their own password and log in again', async () => {
  await withServer(async (base, pool) => {
    const password = 'student-private-password-123';
    const registered = await post(base, '/api/auth/register', { role: 'CUSTOMER_GENERAL', displayName: 'นักศึกษาทดสอบ', email: ' Student1@Example.com ', password });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.data.user.email, 'student1@example.com');
    assert.equal(registered.body.data.user.role, 'CUSTOMER_GENERAL');
    assert.match(registered.response.headers.get('set-cookie'), /HttpOnly/);
    assert.notEqual(pool.users.get('student1@example.com').password_hash, password);
    const loggedIn = await post(base, '/api/auth/login', { email: 'student1@example.com', password });
    assert.equal(loggedIn.response.status, 200);
    assert.equal(loggedIn.body.data.user.id, registered.body.data.user.id);
    const wrongPassword = await post(base, '/api/auth/login', { email: 'student1@example.com', password: 'wrong' });
    assert.equal(wrongPassword.response.status, 401);
    const duplicate = await post(base, '/api/auth/register', { role: 'CUSTOMER_GENERAL', displayName: 'ซ้ำ', email: 'student1@example.com', password });
    assert.equal(duplicate.response.status, 409);
  });
});

test('company registration creates a company profile and disallows privileged roles', async () => {
  await withServer(async (base, pool) => {
    const password = 'another-private-password-123';
    const company = await post(base, '/api/auth/register', { role: 'CUSTOMER_BUSINESS', displayName: 'ผู้ประสานงาน', companyName: 'บริษัททดลอง', email: 'company-new@example.com', password });
    assert.equal(company.response.status, 201);
    assert.deepEqual(pool.companies.get(company.body.data.user.id), { company_name: 'บริษัททดลอง', contact_name: 'ผู้ประสานงาน' });
    for (const role of ['ADMIN', 'TECHNICIAN']) {
      const denied = await post(base, '/api/auth/register', { role, displayName: 'ทดลอง', email: `${role.toLowerCase()}@example.com`, password });
      assert.equal(denied.response.status, 400);
      assert.equal(pool.users.has(`${role.toLowerCase()}@example.com`), false);
    }
    const noCompany = await post(base, '/api/auth/register', { role: 'CUSTOMER_BUSINESS', displayName: 'ทดลอง', email: 'no-company@example.com', password });
    assert.equal(noCompany.response.status, 400);
    const shortPassword = await post(base, '/api/auth/register', { role: 'CUSTOMER_GENERAL', displayName: 'ทดลอง', email: 'short@example.com', password: 'short' });
    assert.equal(shortPassword.response.status, 400);
  });
});
