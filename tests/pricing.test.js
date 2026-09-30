import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice, referenceIsFresh, CURATED_REFERENCE_MAX_AGE_DAYS } from '../src/pricing.js';

const rules = {
  laborBase: { SOFTWARE_ONLINE: 180, HARDWARE_ONSITE: 300 },
  marketShare: 0.7,
  districtFactors: { BANG_NA: 1, PATHUM_WAN: 1.1, CHATUCHAK: 1.05 },
  platformMarkupRate: 0.15,
  complexityMultiplier: 1,
  urgencyMultiplier: 1
};

test('price formula matches the four approved B2C/B2B examples', () => {
  assert.deepEqual(estimatePrice({ rules, referenceLow: 300, referenceHigh: 2500, districtCode: 'BANG_NA', key: 'SOFTWARE_ONLINE', isBusiness: false }), { min: 450, max: 450 });
  assert.deepEqual(estimatePrice({ rules, referenceLow: 300, referenceHigh: 2500, districtCode: 'BANG_NA', key: 'SOFTWARE_ONLINE', isBusiness: true }), { min: 450, max: 2220 });
  assert.deepEqual(estimatePrice({ rules, referenceLow: 500, referenceHigh: 800, districtCode: 'BANG_NA', key: 'HARDWARE_ONSITE', isBusiness: false }), { min: 750, max: 750 });
  assert.deepEqual(estimatePrice({ rules, referenceLow: 500, referenceHigh: 800, districtCode: 'BANG_NA', key: 'HARDWARE_ONSITE', isBusiness: true }), { min: 750, max: 990 });
});

test('district multiplier applies before platform markup and rounds to nearest ten', () => {
  assert.deepEqual(estimatePrice({ rules, referenceLow: 300, referenceHigh: 300, districtCode: 'PATHUM_WAN', key: 'SOFTWARE_ONLINE', isBusiness: true }), { min: 490, max: 490 });
});

test('invalid or missing active pricing rules fail closed', () => {
  assert.throws(() => estimatePrice({ rules: { ...rules, platformMarkupRate: 1.5 }, referenceLow: 300, referenceHigh: 500, districtCode: 'BANG_NA', key: 'SOFTWARE_ONLINE', isBusiness: true }), { code: 'PRICING_RULES_INVALID' });
  assert.throws(() => estimatePrice({ rules, referenceLow: 500, referenceHigh: 300, districtCode: 'UNKNOWN', key: 'SOFTWARE_ONLINE', isBusiness: true }), { code: 'PRICING_RULES_INVALID' });
});

test('curated reference freshness uses reviewedAt for 30 days, not fetched/source timestamp', () => {
  const now = Date.parse('2026-09-25T00:00:00.000Z');
  const reviewedAt = new Date(now - CURATED_REFERENCE_MAX_AGE_DAYS * 86400_000).toISOString();
  assert.equal(referenceIsFresh({ referenceType: 'CURATED_PUBLIC_EXAMPLES', reviewedAt, sourceUpdatedAt: new Date(now).toISOString() }, now), true);
  assert.equal(referenceIsFresh({ referenceType: 'CURATED_PUBLIC_EXAMPLES', reviewedAt: new Date(now - (CURATED_REFERENCE_MAX_AGE_DAYS * 86400_000 + 1)).toISOString(), sourceUpdatedAt: new Date(now).toISOString() }, now), false);
  assert.equal(referenceIsFresh({ referenceType: 'CURATED_PUBLIC_EXAMPLES', sourceUpdatedAt: new Date(now).toISOString() }, now), false);
});

test('live reference freshness remains independently bounded by the live-source hour policy', () => {
  const now = Date.parse('2026-09-25T00:00:00.000Z');
  assert.equal(referenceIsFresh({ referenceType: 'LIVE_SOURCE', sourceUpdatedAt: new Date(now - 24 * 3600_000).toISOString() }, now, 24), true);
  assert.equal(referenceIsFresh({ referenceType: 'LIVE_SOURCE', sourceUpdatedAt: new Date(now - 24 * 3600_000 - 1).toISOString() }, now, 24), false);
  assert.equal(referenceIsFresh({ referenceType: 'LIVE_SOURCE', sourceUpdatedAt: new Date(now + 120_000).toISOString() }, now, 24), false);
});
