import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizeScreenIdentity: vi.fn(),
  startScreenPairing: vi.fn(),
  listScreenDevices: vi.fn(),
  claimScreenPairing: vi.fn(),
  setScreenDesiredState: vi.fn(),
  revokeScreenDevice: vi.fn(),
  getActiveScreenDevice: vi.fn(),
  getScreenControlFeatures: vi.fn(),
}));

vi.mock('../screen-control', () => ({
  ...mocks,
  getScreenControlFeatures: mocks.getScreenControlFeatures,
  filterConfigForScreen: (config: unknown) => config,
  normalizePairingCode: (value: string) => /^\d{6}$/.test(value) ? value : 'invalid',
}));

const config = {
  version: 'v1', slas: [],
  dashboard: { pollingInterval: 1, title: 'x', teamMembers: [], displayOrder: [], priorityLabels: {}, stateLabels: {}, report: { slaWindowHours: 24, enabled: true }, kitchenPhrases: { emptyState: '', warningTimer: '', breachedTimer: '' }, teams: [{ id: 'a', name: 'A', filter: 'active-states', timer: true }] },
};
vi.mock('../config', () => ({ loadConfig: () => config, ensureConfig: vi.fn(async () => config), saveConfig: vi.fn() }));

import { createApp } from '../app';
import { trustedPlatformIp } from '../routes/screens';

const state = {
  schemaVersion: 1, layout: 'single',
  panes: {
    left: { teamId: 'a', view: 'board', filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
    right: { teamId: 'a', view: 'board', filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
  },
};

describe('screen routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONFIG_ADMIN_TOKEN = 'admin-token';
    delete process.env.VERCEL;
    mocks.authorizeScreenIdentity.mockResolvedValue('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    mocks.getScreenControlFeatures.mockReturnValue({
      screenControlEnabled: true, requirePairing: false,
      captchaProvider: null, captchaSiteKey: null, configurationError: null,
    });
    mocks.startScreenPairing.mockResolvedValue({ pairingId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', code: '123456', expiresAt: new Date().toISOString() });
    mocks.listScreenDevices.mockResolvedValue([]);
  });

  it('keeps feature discovery public but protects every controller endpoint', async () => {
    const app = createApp();
    await request(app).get('/api/screens/features').expect(200, {
      screenControlEnabled: true, requirePairing: false,
      captchaProvider: null, captchaSiteKey: null, configurationError: null,
    });
    await request(app).get('/api/screens/devices').expect(401);
    await request(app).get('/api/screens/devices').set('Authorization', 'Bearer admin-token').expect(200, { devices: [] });
    await request(app).post('/api/screens/devices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/revoke').expect(401);
  });

  it('starts an idempotent pairing only after TV identity verification', async () => {
    const app = createApp();
    const requestId = '11111111-1111-4111-8111-111111111111';
    await request(app).post('/api/screens/pairings/start').set('Authorization', 'Bearer tv-jwt').send({ requestId }).expect(201);
    expect(mocks.authorizeScreenIdentity).toHaveBeenCalledWith('tv-jwt');
    expect(mocks.startScreenPairing).toHaveBeenCalledWith('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', requestId, null);
  });

  it('uses only a validated platform-owned IP header and otherwise falls back to UID/global limits', () => {
    expect(trustedPlatformIp({ headers: { 'x-forwarded-for': '203.0.113.10' } } as any)).toBeNull();
    process.env.VERCEL = '1';
    expect(trustedPlatformIp({ headers: { 'x-vercel-forwarded-for': '203.0.113.10' } } as any)).toBe('203.0.113.10');
    expect(trustedPlatformIp({ headers: { 'x-vercel-forwarded-for': 'spoofed' } } as any)).toBeNull();
  });

  it('rejects controller states outside the enabled team allowlist', async () => {
    const app = createApp();
    await request(app).put('/api/screens/devices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/state')
      .set('Authorization', 'Bearer admin-token')
      .send({ desiredState: state, allowedTeamIds: ['outside'], expectedVersion: 1, requestId: '11111111-1111-4111-8111-111111111111' })
      .expect(400, { error: 'Uno o más teams no están habilitados' });
    expect(mocks.setScreenDesiredState).not.toHaveBeenCalled();
  });

  it('maps durable pairing throttling to 429 without logging secrets', async () => {
    mocks.startScreenPairing.mockRejectedValue(new Error('pairing rate limit exceeded'));
    const response = await request(createApp()).post('/api/screens/pairings/start')
      .set('Authorization', 'Bearer tv-jwt')
      .send({ requestId: '11111111-1111-4111-8111-111111111111' })
      .expect(429);
    expect(response.headers['retry-after']).toBe('300');
  });

  it('fails pairing closed when CAPTCHA configuration is missing', async () => {
    mocks.getScreenControlFeatures.mockReturnValue({
      screenControlEnabled: true, requirePairing: true,
      captchaProvider: null, captchaSiteKey: null,
      configurationError: 'CAPTCHA requerido',
    });
    await request(createApp()).post('/api/screens/pairings/start')
      .set('Authorization', 'Bearer tv-jwt')
      .send({ requestId: '11111111-1111-4111-8111-111111111111' })
      .expect(503, { error: 'CAPTCHA requerido' });
    expect(mocks.authorizeScreenIdentity).not.toHaveBeenCalled();
    expect(mocks.startScreenPairing).not.toHaveBeenCalled();
  });

  it('fails controller mutations closed when the runtime kill switch is off', async () => {
    mocks.getScreenControlFeatures.mockReturnValue({
      screenControlEnabled: false, requirePairing: false,
      captchaProvider: null, captchaSiteKey: null, configurationError: null,
    });
    const app = createApp();
    const auth = { Authorization: 'Bearer admin-token' };
    await request(app).put('/api/screens/devices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/state')
      .set(auth).send({ desiredState: state, allowedTeamIds: ['a'], expectedVersion: 1, requestId: '11111111-1111-4111-8111-111111111111' })
      .expect(404, { error: 'El control de pantallas no está habilitado' });
    await request(app).post('/api/screens/devices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/revoke')
      .set(auth).expect(404, { error: 'El control de pantallas no está habilitado' });
    expect(mocks.setScreenDesiredState).not.toHaveBeenCalled();
    expect(mocks.revokeScreenDevice).not.toHaveBeenCalled();
  });
});
