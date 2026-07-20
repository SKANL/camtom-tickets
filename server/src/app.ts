import dotenv from 'dotenv';
import path from 'path';

// On Vercel, env vars are injected by the platform — no .env needed
if (!process.env.VERCEL) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { loadConfig, ensureConfig } from './config';
import { getRateLimitState } from './linear-client';
import configRouter from './routes/config';
import metadataRouter from './routes/metadata';
import webhooksRouter from './routes/webhooks';
import reconcileRouter from './routes/reconcile';
import screensRouter from './routes/screens';
import displayV2Router from './routes/display-v2';
import { getReconciliationHealth } from './supabase';

export function createApp(): Application {
  const app: Application = express();

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3001'];

  app.use(cors({ origin: corsOrigin, credentials: true }));

  // Linear payloads can exceed Express's default 100 KiB limit. Keep the larger
  // limit route-specific and preserve the exact bytes used for HMAC verification.
  app.use(
    '/api/webhooks/linear',
    express.json({
      limit: 1024 * 1024,
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as any).rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use(express.json());

  app.get('/api/health', async (_req, res) => {
    try {
      const reconciliation = await getReconciliationHealth();
      res.json({ status: 'ok', uptime: process.uptime(), rateLimit: getRateLimitState(), reconciliation });
    } catch {
      res.status(503).json({
        status: 'degraded',
        uptime: process.uptime(),
        rateLimit: getRateLimitState(),
        reconciliation: {
          scheduler: 'supabase-pg-cron',
          fullApplyEnabled: process.env.FULL_RECONCILE_APPLY === 'true',
          available: false,
        },
      });
    }
  });

  app.use(configRouter);
  app.use(metadataRouter);
  app.use(webhooksRouter);
  app.use(reconcileRouter);
  app.use(screensRouter);
  app.use(displayV2Router);

  // In production the client is served as static files by Vercel; nothing to do here.

  app.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large' });
    }

    console.error('[server] Unhandled error:', err.message);
    return res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
}

/** Cheap cold-start warmup: load config into the module cache. */
export function initServer(): void {
  const config = loadConfig();
  console.log(`[server] Config loaded: ${config.slas.length} SLAs, version ${config.version}`);
  ensureConfig().catch((e) => console.warn('[server] config hydrate on init failed:', e.message));
}
