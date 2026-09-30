import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('seed requires a locally configured password and never prints it', async () => {
  const source = await readFile(new URL('../scripts/seed-demo.mjs', import.meta.url), 'utf8');
  assert.match(source, /Set DEMO_SEED_PASSWORD in the local \.env file before seeding/);
  assert.doesNotMatch(source, /Shared demo password:/);
  assert.doesNotMatch(source, /Fixtech-Demo-Only-2026!/);
});

test('seed refuses database mutation without explicit disposable-database acknowledgement', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/seed-demo.mjs', import.meta.url))], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused.invalid/fixtech_demo',
      DEMO_SEED_ALLOW_MUTATION: ''
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEMO_SEED_ALLOW_MUTATION=yes/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|ECONNREFUSED|password authentication failed/);
});

test('seed refuses to run in production even when mutation acknowledgement is set', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/seed-demo.mjs', import.meta.url))], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://unused.invalid/fixtech_demo',
      DEMO_SEED_ALLOW_MUTATION: 'yes'
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /disabled in production/);
  assert.doesNotMatch(result.stderr, /ENOTFOUND|ECONNREFUSED|password authentication failed/);
});
