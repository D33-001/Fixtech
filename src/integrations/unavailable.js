export { IntegrationUnavailableError } from './errors.js';
import { IntegrationUnavailableError } from './errors.js';
import { createOllamaProvider } from './ollama.js';
import { createDemoPriceReferenceProvider } from './demo-price-reference.js';

export function createAiProvider({ provider = 'disabled', nodeEnv = process.env.NODE_ENV, ...options } = {}) {
  if (provider === 'ollama' && nodeEnv === 'production') {
    throw new Error('Local Ollama AI is Demo-only and must not be enabled in production');
  }
  if (provider === 'ollama') return createOllamaProvider(options);
  if (provider !== 'disabled') {
    throw new Error(`AI provider "${provider}" has not passed the integration gate`);
  }
  return Object.freeze({
    async analyze() {
      throw new IntegrationUnavailableError('AI_PROVIDER_UNAVAILABLE', 'AI integration is disabled');
    }
  });
}

export function createMarketPriceProvider({ provider = 'disabled', reviewedAt } = {}) {
  if (provider === 'curated_demo') return createDemoPriceReferenceProvider({ reviewedAt });
  if (provider !== 'disabled') {
    throw new Error(`Market-price provider "${provider}" has not passed the integration gate`);
  }
  return Object.freeze({
    async getReferencePrice() {
      throw new IntegrationUnavailableError('MARKET_PRICE_UNAVAILABLE', 'Market-price integration is disabled');
    }
  });
}
