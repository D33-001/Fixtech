import { createApp } from './app.js';
import { createPool } from './db/pool.js';
import { createAiProvider, createMarketPriceProvider } from './integrations/unavailable.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Production launch is disabled: real payment, verified technician onboarding, licensed current-price data, and release acceptance are not implemented. See docs/production-expansion-v1.md.');
}

if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 bytes');
}
const pool = createPool();
const aiProvider = createAiProvider({
  provider: process.env.AI_PROVIDER ?? 'disabled',
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL ?? 'gemma3:4b',
  timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 120000)
});
const marketPriceProvider = createMarketPriceProvider({
  provider: process.env.MARKET_PRICE_PROVIDER ?? 'disabled',
  reviewedAt: process.env.NODE_ENV === 'test' ? process.env.FIXTECH_TEST_CURATED_REVIEWED_AT : undefined
});
const app = createApp({ pool, aiProvider, marketPriceProvider });
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

const server = app.listen(port, () => {
  console.log(`Fixtech Demo v1.8 listening on http://localhost:${port}`);
});

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(async (error) => {
    await pool.end();
    process.exit(error ? 1 : 0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
