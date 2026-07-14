import dotenv from 'dotenv';
import path from 'path';

// On Vercel, env vars are injected by the platform — no .env needed
if (!process.env.VERCEL) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

import express, { Application } from 'express';
import cors from 'cors';
import { loadConfig } from './config';
import { startPolling } from './poller';
import { ensureLabel } from './linear-client';
import issuesRouter from './routes/issues';
import configRouter from './routes/config';
import eventsRouter from './routes/events';
import metadataRouter from './routes/metadata';

export function createApp(): Application {
  const app: Application = express();

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3001'];

  // Middleware
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(express.json());

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Routes
  app.use(issuesRouter);
  app.use(configRouter);
  app.use(eventsRouter);
  app.use(metadataRouter);

  // In production, serve the client SPA build
  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.resolve(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Error handling middleware
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server] Unhandled error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
}

export function initServer(): void {
  const config = loadConfig();
  console.log(`[server] Config loaded: ${config.slas.length} SLAs, version ${config.version}`);

  // Start polling (works in serverless, runs on cold start)
  startPolling();

  // Non-blocking label creation probe
  ensureLabel('ticket').catch((err) => {
    console.warn('[server] Failed to ensure ticket label:', err.message);
  });
}
