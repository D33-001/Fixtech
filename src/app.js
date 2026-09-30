import express from 'express';
import helmet from 'helmet';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerApi } from './api.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export const DEMO_TABLES = Object.freeze([
  'users', 'company_profiles', 'provider_profiles', 'districts', 'service_catalog',
  'provider_services', 'provider_districts', 'jobs', 'offers', 'job_status_events',
  'job_attachments', 'ai_consents', 'ai_analysis_runs', 'ai_run_attachments',
  'pricing_rule_sets', 'price_estimates', 'job_messages', 'notifications', 'appointments',
  'payment_simulations', 'warranties', 'warranty_claims', 'reviews', 'disputes',
  'dispute_evidence', 'admin_audit_logs'
]);

export function createApp({ pool, env = process.env, aiProvider, marketPriceProvider, storageRoot } = {}) {
  if (!pool) throw new TypeError('A database pool is required');

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb', strict: true }));

  app.get('/api/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/api/health/ready', async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT count(*)::int AS table_count
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
           AND table_name = ANY($1::text[])`,
        [DEMO_TABLES]
      );
      if (Number(result.rows[0]?.table_count) !== DEMO_TABLES.length) {
        return res.status(503).json({ status: 'not_ready', database: 'schema_mismatch' });
      }
      res.status(200).json({ status: 'ready', database: 'ok' });
    } catch {
      res.status(503).json({ status: 'not_ready', database: 'unavailable' });
    }
  });

  app.get('/api/demo/status', (_req, res) => {
    res.status(200).json({
      scope: 'Fixtech Demo v1.8',
      aiIntegration: env.AI_PROVIDER === 'ollama' ? 'configured_pending_validation' : 'disabled',
      marketPriceIntegration: env.MARKET_PRICE_PROVIDER === 'curated_demo' ? 'curated_reference' : 'disabled',
      payment: 'simulation_only'
    });
  });

  registerApi(app, {
    pool, env, aiProvider, marketPriceProvider,
    storageRoot: storageRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'storage', 'private')
  });

  app.use(express.static(PUBLIC_DIR, { dotfiles: 'deny', index: 'index.html', fallthrough: true }));

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบ endpoint' } });
  });

  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'ข้อมูลคำขอมีขนาดใหญ่เกินไป' } });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'รูปแบบ JSON ไม่ถูกต้อง' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาดภายในระบบ' } });
  });

  return app;
}
