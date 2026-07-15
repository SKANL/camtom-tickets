import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  getAppConfig: vi.fn(() => Promise.resolve(null)),
  setAppConfig: vi.fn(() => Promise.resolve()),
  getMetadataCache: vi.fn(() => Promise.resolve(null)),
  setMetadataCache: vi.fn(() => Promise.resolve()),
}));

const mockConfig = {
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
};

vi.mock('../config', () => ({
  loadConfig: vi.fn(() => mockConfig),
  getConfig: vi.fn(() => mockConfig),
  ensureConfig: vi.fn(() => Promise.resolve(mockConfig)),
  saveConfig: vi.fn(() => Promise.resolve(mockConfig)),
}));

const { app } = await import('../index');
const { saveConfig } = await import('../config');

describe('API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONFIG_ADMIN_TOKEN;
  });
  afterEach(() => {
    delete process.env.CONFIG_ADMIN_TOKEN;
  });

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

  it('PUT /api/config fails closed when the admin token is not configured', async () => {
    const res = await request(app).put('/api/config').send({ dashboard: { title: 'Nuevo' } });
    expect(res.status).toBe(503);
  });

  it('PUT /api/config rejects a missing or invalid bearer token', async () => {
    process.env.CONFIG_ADMIN_TOKEN = 'correct-token';
    const missing = await request(app).put('/api/config').send({ dashboard: { title: 'Nuevo' } });
    const invalidTokens = ['x', 'x'.repeat(10_000)];
    const invalid = await Promise.all(invalidTokens.map((token) => request(app)
      .put('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ dashboard: { title: 'Nuevo' } })));

    expect(missing.status).toBe(401);
    expect(invalid.map((response) => response.status)).toEqual([401, 401]);
  });

  it('PUT /api/config validates and persists an authorized update', async () => {
    process.env.CONFIG_ADMIN_TOKEN = 'correct-token';
    const res = await request(app)
      .put('/api/config')
      .set('Authorization', 'Bearer correct-token')
      .send({ dashboard: { title: 'Nuevo' } });

    expect(res.status).toBe(200);
    expect(saveConfig).toHaveBeenCalledWith({ dashboard: { title: 'Nuevo' } });
  });

  it('PUT /api/config rejects malformed payloads before persistence', async () => {
    process.env.CONFIG_ADMIN_TOKEN = 'correct-token';
    const invalidPayloads = [
      { unknown: true },
      { dashboard: { unknown: true } },
      { dashboard: { teamMembers: ['valid', 1] } },
      { dashboard: { priorityLabels: { 1: { label: 'Urgente', color: 'red', extra: true } } } },
      { dashboard: { displayOptions: { timerStyle: 'dial' } } },
      { dashboard: { teams: [{ id: 'team', name: 'Team', filter: 'all', timer: true }] } },
      { slas: 'invalid' },
      {
        slas: [{
          id: 'sla', label: 'SLA', applicablePriorities: [1], maxMinutes: 30,
          warningThresholds: { warming: 1.2, heating: 0.3, critical: 0.1 },
        }],
      },
      {
        slas: [{
          id: 'sla', label: 'SLA', applicablePriorities: [1], maxMinutes: 30, extra: true,
          warningThresholds: { warming: 0.6, heating: 0.3, critical: 0.1 },
        }],
      },
    ];

    const responses = await Promise.all(invalidPayloads.map((payload) => request(app)
      .put('/api/config')
      .set('Authorization', 'Bearer correct-token')
      .send(payload)));

    expect(responses.map((response) => response.status)).toEqual(invalidPayloads.map(() => 400));
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('PUT /api/config accepts the complete payload produced by SettingsPanel', async () => {
    process.env.CONFIG_ADMIN_TOKEN = 'correct-token';
    const body = {
      dashboard: {
        title: 'Nuevo',
        teamMembers: ['Ana'],
        kitchenPhrases: { emptyState: 'Listo' },
        zoneLabels: { new: 'Nuevo', active: 'Activo', done: 'Listo' },
        teams: [{ id: 'team-1', name: 'Team', filter: 'ticket-label', timer: true, accent: '#4CAF50' }],
        activeTeamId: 'team-1',
        displayOptions: { timerStyle: 'circle', animationIntensity: 'subtle', autoMute: false },
        priorityLabels: { 1: { label: 'Urgente', color: 'red', dotColor: '#D32F2F' } },
        report: { slaWindowHours: 24, enabled: true },
      },
      slas: [{
        id: 'ticket_timer', label: 'Ticket Timer', applicablePriorities: [0, 1, 2, 3, 4], maxMinutes: 30,
        warningThresholds: { warming: 0.6, heating: 0.3, critical: 0.1 },
      }],
    };

    const res = await request(app)
      .put('/api/config')
      .set('Authorization', 'Bearer correct-token')
      .send(body);

    expect(res.status).toBe(200);
    expect(saveConfig).toHaveBeenCalledWith(body);
  });

  it('PUT /api/config hides persistence error details from the response', async () => {
    process.env.CONFIG_ADMIN_TOKEN = 'correct-token';
    vi.mocked(saveConfig).mockRejectedValueOnce(new Error('supabase-secret-details'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(app)
      .put('/api/config')
      .set('Authorization', 'Bearer correct-token')
      .send({ dashboard: { title: 'Nuevo' } });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'No se pudo guardar la configuración' });
    expect(JSON.stringify(res.body)).not.toContain('supabase-secret-details');
    expect(errorSpy).toHaveBeenCalledWith(
      '[config] PUT /api/config persistence failed:',
      expect.objectContaining({ message: 'supabase-secret-details' }),
    );
    errorSpy.mockRestore();
  });

  it('GET /api/cron/reconcile without secret is rejected', async () => {
    const res = await request(app).get('/api/cron/reconcile');
    expect(res.status).toBe(401);
  });
});
