import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../linear-client', () => ({
  fetchIssuesSince: vi.fn(() => Promise.resolve([])),
  fetchTeams: vi.fn(() => Promise.resolve([])),
  fetchProjects: vi.fn(() => Promise.resolve([])),
  fetchUsers: vi.fn(() => Promise.resolve([])),
  fetchWorkflowStates: vi.fn(() => Promise.resolve([])),
  fetchLabels: vi.fn(() => Promise.resolve([])),
  fetchCycles: vi.fn(() => Promise.resolve([])),
  getRateLimitState: vi.fn(() => ({ limit: 5000, remaining: 5000, resetAt: 0, lastChecked: 0 })),
}));

vi.mock('../supabase', () => ({
  upsertTickets: vi.fn(() => Promise.resolve()),
  deleteTicket: vi.fn(() => Promise.resolve()),
  getLastSync: vi.fn(() => Promise.resolve(null)),
  setLastSync: vi.fn(() => Promise.resolve()),
}));

vi.mock('../config', () => ({
  loadConfig: vi.fn(() => ({
    slas: [
      {
        id: 'test_sla',
        label: 'Test SLA',
        applicablePriorities: [1],
        maxMinutes: 5,
        warningThresholds: { warming: 0.6, heating: 0.3, critical: 0.1 },
      },
    ],
    dashboard: { pollingInterval: 30000, title: 'Test Dashboard' },
    version: 'abc123',
  })),
  getConfig: vi.fn(() => ({
    slas: [{ id: 'test_sla', label: 'Test SLA', applicablePriorities: [1], maxMinutes: 5, warningThresholds: { warming: 0.6, heating: 0.3, critical: 0.1 } }],
    dashboard: { pollingInterval: 30000, title: 'Test Dashboard' },
    version: 'abc123',
  })),
  watchConfig: vi.fn(),
}));

const { app } = await import('../index');

describe('API Routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET /api/health returns status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  it('GET /api/config returns SLAs and version', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.slas).toHaveLength(1);
    expect(res.body.version).toBeDefined();
  });

  it('GET /api/cron/reconcile without secret is rejected', async () => {
    const res = await request(app).get('/api/cron/reconcile');
    expect(res.status).toBe(401);
  });
});
