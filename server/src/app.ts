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

export function createApp(): Application {
  const app: Application = express();

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3001'];

  app.use(cors({ origin: corsOrigin, credentials: true }));

  // JSON parser that preserves the raw body for webhook signature verification.
  app.use(
    express.json({
      verify: (req: Request, _res: Response, buf: Buffer) => {
        (req as any).rawBody = buf.toString('utf8');
      },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), rateLimit: getRateLimitState() });
  });

  app.use(configRouter);
  app.use(metadataRouter);
  app.use(webhooksRouter);
  app.use(reconcileRouter);

  // In production the client is served as static files by Vercel; nothing to do here.

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server] Unhandled error:', err.message);
    res.status(500).json({
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
