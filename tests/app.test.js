import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createApp, DEMO_TABLES } from '../src/app.js';
import { issueSession, sessionCookie } from '../src/auth.js';
import { IntegrationUnavailableError } from '../src/integrations/errors.js';

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('liveness is independent of database state', async () => {
  const app = createApp({ pool: { query: async () => { throw new Error('db down'); } } });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});

test('readiness returns only a generic failure when database is unavailable', async () => {
  const app = createApp({ pool: { query: async () => { throw new Error('secret connection detail'); } } });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/health/ready`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /not_ready/);
    assert.doesNotMatch(body, /secret connection detail/);
  });
});

test('registration reports database failure safely when PostgreSQL rejects credentials', async () => {
  const app = createApp({ pool: { query: async () => { throw Object.assign(new Error('private connection detail'), { code: '28P01' }); } } });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'CUSTOMER_GENERAL', displayName: 'Test User', email: 'new@example.com', password: 'my-own-password-123' })
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(body), /private connection detail|28P01/);
  });
});

test('readiness succeeds only after database query succeeds', async () => {
  const app = createApp({ pool: { query: async () => ({ rows: [{ table_count: 30 }] }) } });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/health/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ready', database: 'ok' });
  });
});

test('readiness rejects a connected but incompatible legacy schema', async () => {
  const app = createApp({ pool: { query: async () => ({ rows: [{ table_count: 24 }] }) } });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/health/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'not_ready', database: 'schema_mismatch' });
  });
});

test('readiness schema contract exactly matches all domain DDL tables', async () => {
  const sqlPath = new URL('../docs/fixtech-demo-v1.8-drawdb.sql', import.meta.url);
  const sql = await readFile(fileURLToPath(sqlPath), 'utf8');
  const tables = [...sql.matchAll(/^CREATE TABLE ([a-z_]+)\s*\(/gim)].map((match) => match[1]);
  assert.equal(DEMO_TABLES.length, 30);
  assert.equal(new Set(DEMO_TABLES).size, 30);
  assert.deepEqual([...DEMO_TABLES].sort(), tables.sort());
});

test('demo status exposes disabled integration defaults', async () => {
  const app = createApp({ pool: { query: async () => ({ rows: [] }) }, env: {} });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/demo/status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      scope: 'Fixtech Demo v1.8',
      aiIntegration: 'disabled',
      marketPriceIntegration: 'disabled',
      payment: 'simulation_only'
    });
  });
});

test('demo status distinguishes local AI validation from curated non-live references', async () => {
  const app = createApp({ pool: { query: async () => ({ rows: [] }) }, env: { AI_PROVIDER: 'ollama', MARKET_PRICE_PROVIDER: 'curated_demo' } });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/demo/status`);
    const data = await response.json();
    assert.equal(data.aiIntegration, 'configured_pending_validation');
    assert.equal(data.marketPriceIntegration, 'curated_reference');
  });
});

test('AI integration outage is exposed as a safe 503 and leaves the draft unchanged', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const jobId = '22222222-2222-4222-8222-222222222222';
  const secret = 'test-session-secret-that-is-at-least-32-bytes';
  const pool = { query: async (sql) => {
    if (sql.includes('FROM users u LEFT JOIN provider_profiles p')) return { rows: [{ id: userId, email: 'synthetic@example.test', role: 'CUSTOMER_GENERAL', display_name: 'Synthetic', is_active: true, provider_id: null }], rowCount: 1 };
    if (sql.includes('FROM jobs j LEFT JOIN provider_profiles p')) return { rows: [{ id: jobId, customer_user_id: userId, status: 'DRAFT', symptom_text: 'เครื่องเปิดไม่ติด', category: 'HARDWARE', service_format: 'ONSITE' }], rowCount: 1 };
    if (sql.includes('FROM ai_consents')) return { rows: [{ id: '33333333-3333-4333-8333-333333333333', data_scope: { attachmentIds: [] } }], rowCount: 1 };
    throw new Error(`Unexpected test SQL: ${sql}`);
  } };
  const app = createApp({ pool, env: { SESSION_SECRET: secret }, aiProvider: { analyze: async () => { throw new IntegrationUnavailableError('AI_PROVIDER_UNAVAILABLE', 'Local AI is unavailable'); } } });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/jobs/${jobId}/analyze`, {
      method: 'POST', headers: { cookie: sessionCookie(issueSession(userId, secret)), 'content-type': 'application/json' }, body: '{}'
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'AI_PROVIDER_UNAVAILABLE', message: 'Local AI is unavailable' } });
  });
});

test('unknown API routes return stable JSON 404', async () => {
  const app = createApp({ pool: { query: async () => ({ rows: [] }) } });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/not-real`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: 'ไม่พบ endpoint' } });
  });
});

test('homepage serves the Demo v1.8 Thai landing page and static assets', async () => {
  const app = createApp({ pool: { query: async () => ({ rows: [] }) } });
  await withServer(app, async (base) => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Fixtech — Demo v1\.8/);
    assert.match(html, /navigation "เมนูหลัก"|aria-label="เมนูหลัก"/);
    assert.match(html, /<dialog id="app-dialog"/);
    const script = await fetch(`${base}/app.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    const scriptText = await script.text();
    assert.doesNotMatch(scriptText, /\b(?:prompt|confirm|alert)\s*\(/);
    assert.match(scriptText, /ai-consents/);
    assert.match(scriptText, /attachmentIds/);
    const stylesheet = await fetch(`${base}/app.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(await stylesheet.text(), /:where\(\[hidden\]\)\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/);
  });
});
