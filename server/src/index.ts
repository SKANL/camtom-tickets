import dotenv from 'dotenv';
import path from 'path';

// Load .env from server directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });
// Also try root .env as fallback
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express, { Application } from 'express';
import cors from 'cors';
import { loadConfig, watchConfig, getConfig } from './config';
import { startPolling } from './poller';
import { ensureLabel } from './linear-client';
import { metadataCache } from './cache';
import issuesRouter from './routes/issues';
import configRouter from './routes/config';
import eventsRouter from './routes/events';
import metadataRouter from './routes/metadata';

const app: Application = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3001'],
  credentials: true,
}));
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

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Initialize and start
function start(): void {
  try {
    // Load config
    const config = loadConfig();
    console.log(`[server] Config loaded: ${config.slas.length} SLAs, version ${config.version}`);

    // Watch for config changes
    watchConfig((newConfig) => {
      console.log(`[server] Config hot-reloaded: version ${newConfig.version}`);
      // Invalidate metadata cache so client picks up changes
      metadataCache.delete('catalog');
    });

    // Start polling
    startPolling();

    // Non-blocking label creation probe
    ensureLabel('ticket').catch((err) => {
      console.warn('[server] Failed to ensure ticket label:', err.message);
    });

    app.listen(PORT, () => {
      console.log(`[server] Camtom Tickets API running on http://localhost:${PORT}`);
      console.log(`[server] Dashboard title: "${getConfig().dashboard.title}"`);
    });
  } catch (err: any) {
    console.error(`[server] Failed to start: ${err.message}`);
    process.exit(1);
  }
}

start();

export { app };
