import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoPriceReferenceProvider } from '../src/integrations/demo-price-reference.js';

test('curated service examples include traceable source URLs and an explicit non-live label', async () => {
  const provider = createDemoPriceReferenceProvider();
  const reference = await provider.getReferencePrice({ category: 'SOFTWARE', serviceFormat: 'ONLINE' });
  assert.equal(reference.referenceType, 'CURATED_PUBLIC_EXAMPLES');
  assert.match(reference.sourceName, /not real-time market data/);
  assert.match(reference.sourceReference, /^https:\/\//);
  assert.equal(reference.reviewedAt, reference.sourceUpdatedAt);
  assert.ok(reference.referenceLow > 0 && reference.referenceHigh >= reference.referenceLow);
});

test('curated price provider fails closed for unsupported service combinations', async () => {
  const provider = createDemoPriceReferenceProvider();
  await assert.rejects(provider.getReferencePrice({ category: 'HARDWARE', serviceFormat: 'ONLINE' }), (error) => error.code === 'ESTIMATE_UNAVAILABLE');
});

test('curated review date can be overridden explicitly for deterministic stale-reference tests', async () => {
  const reviewedAt = '2026-08-01T00:00:00.000Z';
  const provider = createDemoPriceReferenceProvider({ reviewedAt });
  const reference = await provider.getReferencePrice({ category: 'SOFTWARE', serviceFormat: 'ONLINE' });
  assert.equal(reference.reviewedAt, reviewedAt);
  assert.equal(reference.sourceUpdatedAt, reviewedAt);
});
