import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAiProvider,
  createMarketPriceProvider,
  IntegrationUnavailableError
} from '../src/integrations/unavailable.js';

test('AI provider is disabled and fails closed by default', async () => {
  const provider = createAiProvider();
  await assert.rejects(provider.analyze({}), (error) => {
    assert.ok(error instanceof IntegrationUnavailableError);
    assert.equal(error.code, 'AI_PROVIDER_UNAVAILABLE');
    assert.equal(error.status, 503);
    return true;
  });
});

test('market-price provider is disabled and cannot return a fixture price', async () => {
  const provider = createMarketPriceProvider();
  await assert.rejects(provider.getReferencePrice({}), (error) => {
    assert.ok(error instanceof IntegrationUnavailableError);
    assert.equal(error.code, 'MARKET_PRICE_UNAVAILABLE');
    assert.equal(error.status, 503);
    return true;
  });
});

test('unknown real provider names cannot be enabled accidentally', () => {
  assert.throws(() => createAiProvider({ provider: 'unreviewed' }), /has not passed the integration gate/);
  assert.throws(() => createMarketPriceProvider({ provider: 'unreviewed' }), /has not passed the integration gate/);
});

test('local Ollama AI is rejected in production mode', async () => {
  assert.throws(() => createAiProvider({ provider: 'ollama', nodeEnv: 'production' }), /Demo-only/);
  await assert.rejects(createAiProvider({ provider: 'disabled', nodeEnv: 'production' }).analyze({}), /disabled/);
});
