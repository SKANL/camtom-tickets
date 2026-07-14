import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import request from 'supertest';

// Mock dependencies before importing app
vi.mock('../poller', () => ({
  getCachedIssues: vi.fn(),
  startPolling: vi.fn(),
}));

vi.mock('../config', () => ({
  loadConfig: vi.fn(() => ({
    slas: [
      { id: 'test_sla', label: 'Test SLA', applicablePriorities: [1], maxMinutes: 5, warningThreshold: 0.2 },
    ],
    dashboard: { pollingInterval: 30000, title: 'Test Dashboard' },
    version: 'abc123',
  })),
  getConfig: vi.fn(() => ({
    slas: [
      { id: 'test_sla', label: 'Test SLA', applicablePriorities: [1], maxMinutes: 5, warningThreshold: 0.2 },
    ],
    dashboard: { pollingInterval: 30000, title: 'Test Dashboard' },
    version: 'abc123',
  })),
  watchConfig: vi.fn(),
}));

vi.mock('../sse', () => ({
  sseManager: {
    addClient: vi.fn((_id: string, res: any) => {
      // The real SSE handler writes headers — mock must do the same
      // so the HTTP response arrives instead of hanging
      res.writeHead?.(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write?.(`event: connected\ndata: {}\n\n`);
    }),
    startHeartbeat: vi.fn(),
    broadcastDelta: vi.fn(),
  },
}));

import { loadConfig, getConfig } from '../config';
import { getCachedIssues } from '../poller';

// Import app after mocks
const { app } = await import('../index');

describe('API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('returns health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('uptime');
    });
  });

  describe('GET /api/issues', () => {
    it('returns cached issues when available', async () => {
      const mockIssues = [
        {
          id: '1',
          identifier: 'TEST-1',
          title: 'Test issue',
          priority: 1,
          priorityLabel: 'Urgent',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          assignee: { id: 'u1', name: 'Alice' },
          state: { id: 's1', name: 'In Progress', type: 'started' },
        },
      ];

      vi.mocked(getCachedIssues).mockReturnValue(mockIssues);

      const res = await request(app).get('/api/issues');
      expect(res.status).toBe(200);
      expect(res.body.issues).toHaveLength(1);
      expect(res.body.issues[0].identifier).toBe('TEST-1');
      expect(res.body.cached).toBe(true);
    });

    it('returns empty array when no cached issues', async () => {
      vi.mocked(getCachedIssues).mockReturnValue(null);

      const res = await request(app).get('/api/issues');
      expect(res.status).toBe(200);
      expect(res.body.issues).toHaveLength(0);
      expect(res.body.cached).toBe(false);
    });
  });

  describe('GET /api/config', () => {
    it('returns config with SLA definitions and version', async () => {
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.body.slas).toBeDefined();
      expect(res.body.slas).toHaveLength(1);
      expect(res.body.slas[0].id).toBe('test_sla');
      expect(res.body.version).toBeDefined();
      expect(res.body.dashboard).toBeDefined();
    });
  });

  describe('GET /api/events', () => {
    it('registers SSE route and returns correct content type', async () => {
      // SSE streams are infinite — create a fresh server and connect via raw http,
      // read headers from the 'response' event (fired immediately), then destroy
      const server = http.createServer(app);

      const res = await new Promise<{ status: number; contentType: string }>((resolve, reject) => {
        server.listen(0, () => {
          const addr = server.address();
          const port = typeof addr === 'object' && addr ? addr.port : 0;
          const req = http.get(`http://localhost:${port}/api/events`, (res) => {
            resolve({
              status: res.statusCode ?? 200,
              contentType: res.headers['content-type'] ?? '',
            });
            res.destroy();
            server.close();
          });
          req.on('error', (err) => {
            server.close();
            reject(err);
          });
        });
      });

      expect(res.status).toBe(200);
      expect(res.contentType).toBe('text/event-stream');
    });
  });
});
