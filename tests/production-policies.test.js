import test from 'node:test';
import assert from 'node:assert/strict';
import { bahtToMinor, preparePaymentIntent, verifiedGatewayStatus, verifiedTechnicianIsEligible, networkReference } from '../src/production/policies.js';

test('amounts use exact minor units and business customers cannot choose direct payment', () => {
  assert.equal(bahtToMinor('470.05'), 47005);
  assert.throws(() => bahtToMinor('470.005'), { code: 'INVALID_AMOUNT' });
  const job = { customer_user_id: 'customer', status: 'COMPLETED', assigned_provider_id: 'tech', agreed_amount: '470.05' };
  const customer = { id: 'customer', role: 'CUSTOMER_BUSINESS' };
  assert.throws(() => preparePaymentIntent({ job, customer, method: 'DIRECT' }), { code: 'BUSINESS_MUST_USE_GATEWAY' });
  assert.deepEqual(preparePaymentIntent({ job, customer, method: 'GATEWAY' }), { amountMinor: 47005, currency: 'THB', method: 'GATEWAY' });
});

test('payment can only be marked paid from a matching verified gateway charge', () => {
  const intent = { method: 'GATEWAY', gateway_charge_id: 'chrg_test_1', amount_minor: 47005, currency: 'THB' };
  const charge = { id: 'chrg_test_1', amount: 47005, currency: 'THB', livemode: false, status: 'successful' };
  assert.equal(verifiedGatewayStatus({ intent, charge, expectedLiveMode: false }), 'PAID');
  assert.throws(() => verifiedGatewayStatus({ intent, charge: { ...charge, amount: 47000 }, expectedLiveMode: false }), { code: 'CHARGE_MISMATCH' });
  assert.throws(() => verifiedGatewayStatus({ intent, charge: { ...charge, livemode: true }, expectedLiveMode: false }), { code: 'CHARGE_MISMATCH' });
});

test('technician verification expires and a price reference needs distinct current providers', () => {
  const now = new Date('2026-09-26T00:00:00.000Z');
  const card = (id, amount, validUntil = '2026-09-27T00:00:00.000Z') => ({
    id: `card-${id}`, provider_id: id, category: 'SOFTWARE', service_format: 'ONLINE', district_code: 'BANG_NA',
    status: 'ACTIVE', usage_grant_ref: 'terms-v1', approved_by_user_id: 'admin', amount_minor: amount,
    published_at: '2026-09-25T00:00:00.000Z', valid_until: validUntil,
    provider: { id, is_approved: true, is_available: true },
    verification: { provider_id: id, status: 'VERIFIED', expires_at: '2026-10-01T00:00:00.000Z' }
  });
  const cards = [card('a', 30000), card('b', 50000), card('c', 90000)];
  assert.equal(verifiedTechnicianIsEligible({ provider: cards[0].provider, verification: cards[0].verification, now }), true);
  assert.equal(networkReference({ rateCards: cards, category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', now }).sampleCount, 3);
  assert.throws(() => networkReference({ rateCards: [cards[0], cards[0], cards[1]], category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', now }), { code: 'INSUFFICIENT_PRICE_COVERAGE' });
  assert.throws(() => networkReference({ rateCards: [cards[0], cards[1], card('c', 90000, '2026-09-25T00:00:00.000Z')], category: 'SOFTWARE', serviceFormat: 'ONLINE', districtCode: 'BANG_NA', now }), { code: 'INSUFFICIENT_PRICE_COVERAGE' });
});
