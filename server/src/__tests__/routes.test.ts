import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../linear-client', () => ({
  fetchIssuesSince: vi.fn(() => Promise.resolve([])),
  fetchFullIssues: vi.fn(() => Promise.resolve({ issues: [], pages: 1, upperBound: '2026-01-01T00:00:00.000Z' })),
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
  claimWebhookDelivery: vi.fn(() => Promise.resolve('claimed')),
  completeWebhookDelivery: vi.fn(() => Promise.resolve()),
  releaseWebhookDelivery: vi.fn(() => Promise.resolve()),
  acquireReconcileLease: vi.fn(() => Promise.resolve(true)),
  releaseReconcileLease: vi.fn(() => Promise.resolve()),
  getConfiguredReconcileTeamIds: vi.fn(() => Promise.resolve(['team-1'])),
  getTicketsForTeams: vi.fn(() => Promise.resolve([])),
  getReconcileScopeState: vi.fn(() => Promise.resolve(null)),
  createReconcileRun: vi.fn(() => Promise.resolve('run-1')),
  finishReconcileRun: vi.fn(() => Promise.resolve()),
  finalizeFullReconcile: vi.fn(() => Promise.resolve({ archivedDeleted: 0, missingDeleted: 0 })),
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
const linear = await import('../linear-client');
const storage = await import('../supabase');

describe('API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONFIG_ADMIN_TOKEN;
    delete process.env.CRON_SECRET;
    delete process.env.FULL_RECONCILE_APPLY;
    vi.mocked(storage.acquireReconcileLease).mockResolvedValue(true);
    vi.mocked(storage.getConfiguredReconcileTeamIds).mockResolvedValue(['team-1']);
    vi.mocked(storage.getTicketsForTeams).mockResolvedValue([]);
    vi.mocked(storage.getReconcileScopeState).mockResolvedValue(null);
    vi.mocked(linear.fetchIssuesSince).mockResolvedValue([]);
    vi.mocked(linear.fetchFullIssues).mockResolvedValue({ issues: [], pages: 1, upperBound: '2026-01-01T00:00:00.000Z' });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CONFIG_ADMIN_TOKEN;
    delete process.env.CRON_SECRET;
    delete process.env.FULL_RECONCILE_APPLY;
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

  it('GET /api/cron/reconcile returns conflict without advancing the cursor when its lease is busy', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    vi.mocked(storage.acquireReconcileLease).mockResolvedValue(false);

    const res = await request(app)
      .get('/api/cron/reconcile')
      .set('Authorization', 'Bearer cron-secret');

    expect(res.status).toBe(409);
    expect(storage.acquireReconcileLease).toHaveBeenCalledWith('incremental', expect.any(String), 240);
    expect(storage.setLastSync).not.toHaveBeenCalled();
    expect(linear.fetchIssuesSince).not.toHaveBeenCalled();
  });

  it('GET /api/cron/reconcile/full is dry-run by default and does not mutate tickets or cursor', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const issue = {
      id: 'issue-1', identifier: 'ENG-1', title: 'Ticket', priority: 1 as const, priorityLabel: 'Urgent',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      state: { id: 'state', name: 'Open', type: 'started' }, team: { id: 'team-1', name: 'Team' },
    };
    vi.mocked(linear.fetchFullIssues).mockResolvedValue({
      issues: [issue], pages: 1, upperBound: '2026-01-02T00:00:00.000Z',
    });

    const res = await request(app)
      .get('/api/cron/reconcile/full')
      .set('Authorization', 'Bearer cron-secret');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applied: false, dryRun: true });
    expect(storage.upsertTickets).not.toHaveBeenCalled();
    expect(storage.finalizeFullReconcile).not.toHaveBeenCalled();
    expect(storage.setLastSync).not.toHaveBeenCalled();
    expect(storage.acquireReconcileLease).toHaveBeenCalledWith(
      'full', expect.any(String), 90, expect.any(AbortSignal),
    );
    expect(storage.finishReconcileRun).toHaveBeenCalledWith(
      'run-1', expect.objectContaining({ status: 'completed' }), expect.any(AbortSignal),
    );
  });

  it('GET /api/cron/reconcile/full blocks an empty configured scope before fetching or deleting', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    vi.mocked(storage.getConfiguredReconcileTeamIds).mockResolvedValue([]);

    const res = await request(app)
      .get('/api/cron/reconcile/full')
      .set('Authorization', 'Bearer cron-secret');

    expect(res.status).toBe(409);
    expect(linear.fetchFullIssues).not.toHaveBeenCalled();
    expect(storage.finalizeFullReconcile).not.toHaveBeenCalled();
  });

  it('GET /api/cron/reconcile/full closes a timed-out run and releases its lease', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    vi.mocked(linear.fetchFullIssues).mockRejectedValueOnce(new Error('Linear reconcile deadline exceeded'));

    const res = await request(app)
      .get('/api/cron/reconcile/full')
      .set('Authorization', 'Bearer cron-secret');

    expect(res.status).toBe(500);
    expect(storage.finishReconcileRun).toHaveBeenCalledWith(
      'run-1', expect.objectContaining({ status: 'failed', error: expect.stringContaining('deadline') }),
      expect.any(AbortSignal),
    );
    expect(storage.releaseReconcileLease).toHaveBeenCalledWith(
      'full', expect.any(String), expect.any(AbortSignal),
    );
    expect(storage.finalizeFullReconcile).not.toHaveBeenCalled();
  });

  it('GET /api/cron/reconcile/full times out a hanging Supabase read and attempts bounded cleanup', async () => {
    vi.useFakeTimers();
    process.env.CRON_SECRET = 'cron-secret';
    vi.mocked(storage.getTicketsForTeams).mockImplementationOnce(() => new Promise(() => undefined));

    const responsePromise = request(app)
      .get('/api/cron/reconcile/full')
      .set('Authorization', 'Bearer cron-secret')
      .then((response) => response);

    await vi.waitFor(() => expect(storage.getTicketsForTeams).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(4_000);
    const res = await responsePromise;

    expect(res.status).toBe(500);
    expect(storage.finishReconcileRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('deadline') }),
      expect.any(AbortSignal),
    );
    expect(storage.releaseReconcileLease).toHaveBeenCalledWith(
      'full', expect.any(String), expect.any(AbortSignal),
    );
    expect(storage.finalizeFullReconcile).not.toHaveBeenCalled();
    expect(storage.setLastSync).not.toHaveBeenCalled();
  });
});
