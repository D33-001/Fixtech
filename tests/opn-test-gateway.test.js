import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpnTestGateway } from '../src/production/opn-test-gateway.js';

test('Opn test adapter sends only a server-side test charge to the fixed API origin', async () => {
  const seen = [];
  const adapter = createOpnTestGateway({ secretKey: 'skey_test_placeholder', returnUri: 'https://fixtech.example.invalid/payment-return', fetchImpl: async (url, options) => {
    seen.push({ url, options });
    return { ok: true, json: async () => ({ object: 'charge', id: 'chrg_test_abc123', livemode: false, status: 'pending' }) };
  } });
  const charge = await adapter.createCharge({ amountMinor: 47000 });
  assert.equal(charge.id, 'chrg_test_abc123');
  assert.equal(seen[0].url, 'https://api.omise.co/charges');
  assert.equal(seen[0].options.body.get('amount'), '47000');
  assert.equal(seen[0].options.body.get('source[type]'), 'grabpay');
  assert.equal(seen[0].options.body.get('currency'), 'THB');
  assert.equal(seen[0].options.headers.Authorization.startsWith('Basic '), true);
  await adapter.retrieveCharge('chrg_test_abc123');
  assert.equal(seen[1].url, 'https://api.omise.co/charges/chrg_test_abc123');
});

test('Opn test adapter rejects live keys, insecure redirects and live-mode responses', async () => {
  assert.throws(() => createOpnTestGateway({ secretKey: 'skey_live_placeholder' }));
  assert.throws(() => createOpnTestGateway({ secretKey: 'skey_test_placeholder', returnUri: 'http://fixtech.example.invalid/return' }));
  const adapter = createOpnTestGateway({ secretKey: 'skey_test_placeholder', returnUri: 'https://fixtech.example.invalid/return', fetchImpl: async () => ({
    ok: true, json: async () => ({ object: 'charge', id: 'chrg_live_abc123', livemode: true })
  }) });
  await assert.rejects(adapter.createCharge({ amountMinor: 0 }));
  await assert.rejects(adapter.retrieveCharge('chrg_test_abc123'));
});
