import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPairing: vi.fn(),
  pairingStatus: vi.fn(),
  createSession: vi.fn(),
  authorizeToken: vi.fn(),
  sync: vi.fn(),
  claim: vi.fn(),
  revoke: vi.fn(),
  rotate: vi.fn(),
}));

vi.mock('../screen-protocol-v2', async () => {
  const actual = await vi.importActual<typeof import('../screen-protocol-v2')>('../screen-protocol-v2');
  return {
    ...actual,
    createDisplayPairingV2: mocks.createPairing,
    getDisplayPairingStatusV2: mocks.pairingStatus,
    createDisplaySessionV2: mocks.createSession,
    authorizeDisplayTokenV2: mocks.authorizeToken,
    syncDisplayV2: mocks.sync,
    claimDisplayPairingV2: mocks.claim,
    revokeDisplayDeviceV2: mocks.revoke,
    rotateDisplayCredentialV2: mocks.rotate,
  };
});

vi.mock('../screen-control', async () => {
  const actual = await vi.importActual<typeof import('../screen-control')>('../screen-control');
  return { ...actual, getScreenControlFeatures: () => ({ screenControlEnabled: true, requirePairing: false, captchaProvider: null, captchaSiteKey: null, configurationError: null }) };
});

const config = {
  version: 'v1', slas: [],
  dashboard: { pollingInterval: 1, title: 'x', teamMembers: [], displayOrder: [], priorityLabels: {}, stateLabels: {}, report: { slaWindowHours: 24, enabled: true }, kitchenPhrases: { emptyState: '', warningTimer: '', breachedTimer: '' }, teams: [{ id: 'a', name: 'A', filter: 'active-states', timer: true }] },
};
vi.mock('../config', () => ({ loadConfig: () => config, ensureConfig: vi.fn(async () => config), saveConfig: vi.fn() }));

import { createApp } from '../app';

const pairingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = '11111111-1111-4111-8111-111111111111';
const installationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const deviceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const state = {
  schemaVersion: 1, layout: 'single',
  panes: {
    left: { teamId: 'a', view: 'board', filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
    right: { teamId: 'a', view: 'board', filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
  },
};

describe('display protocol v2 routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONFIG_ADMIN_TOKEN = 'admin-token';
    process.env.SCREEN_PAIRING_SECRET = 'screen-pairing-secret-with-at-least-32-characters';
    mocks.createPairing.mockResolvedValue({ protocolVersion: 2, pairingId, installationId, installationSecret: 'one-time-secret', code: '123456', expiresAt: '2026-07-19T00:05:00.000Z' });
    mocks.pairingStatus.mockResolvedValue({ status: 'claimed', deviceId, deviceToken: 'fallback-token', cookieToken: 'cookie-token', tokenExpiresAt: '2026-07-19T00:15:00.000Z' });
    mocks.createSession.mockResolvedValue({ deviceId, deviceToken: 'fallback-token', cookieToken: 'cookie-token', tokenExpiresAt: '2026-07-19T00:15:00.000Z' });
    mocks.authorizeToken.mockResolvedValue({ id: 'credential' });
    mocks.sync.mockResolvedValue({ protocolVersion: 2, nextPollMs: 10_000, deviceToken: 'next-token' });
    mocks.claim.mockResolvedValue({ id: deviceId });
    mocks.revoke.mockResolvedValue(true);
    mocks.rotate.mockResolvedValue({ installationId, installationSecret: 'rotated-secret', generation: 2 });
  });

  it('creates a server-authenticated pairing without Supabase Auth or CAPTCHA', async () => {
    const response = await request(createApp()).post('/api/display/pairings').send({ requestId, capabilities: { webSocket: false } }).expect(201);
    expect(response.body).toMatchObject({ protocolVersion: 2, pairingId, installationId, code: '123456' });
    expect(mocks.createPairing).toHaveBeenCalledWith(requestId, null);
  });

  it('maps durable pairing throttling to a 15-minute retry window', async () => {
    mocks.createPairing.mockRejectedValueOnce(new Error('pairing rate limit exceeded'));
    const response = await request(createApp()).post('/api/display/pairings').send({ requestId }).expect(429);
    expect(response.headers['retry-after']).toBe('900');
  });

  it('exchanges the installation secret for both a secure cookie and bearer fallback', async () => {
    const response = await request(createApp()).post(`/api/display/pairings/${pairingId}/status`)
      .set('Authorization', 'Bearer one-time-secret').expect(200);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('Secure');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(response.body).toMatchObject({ deviceToken: 'fallback-token' });
    expect(JSON.stringify(response.body)).not.toContain('cookie-token');
  });

  it('requires a matching Origin for cookie-authenticated display mutations', async () => {
    await request(createApp()).post('/api/display/sync')
      .set('Cookie', 'camtom_display_session_v2=cookie-token')
      .send({ appliedStateVersion: 0 }).expect(403);
    await request(createApp()).post('/api/display/sync')
      .set('Host', 'example.test').set('Origin', 'http://example.test')
      .set('Cookie', 'camtom_display_session_v2=cookie-token')
      .send({ appliedStateVersion: 0 }).expect(200);
    expect(mocks.authorizeToken).toHaveBeenCalledWith('cookie-token');
  });

  it('creates a 30-day admin cookie and automatically invalidates it after token rotation', async () => {
    const login = await request(createApp()).post('/api/control/session')
      .set('Authorization', 'Bearer admin-token').expect(200);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    expect(login.headers['set-cookie'][0]).toContain('Max-Age=2592000');
    await request(createApp()).get('/api/control/session').set('Cookie', cookie).expect(200);
    await request(createApp()).post(`/api/control/display/devices/${deviceId}/revoke`)
      .set('Cookie', cookie).expect(403);
    await request(createApp()).post(`/api/control/display/devices/${deviceId}/revoke`)
      .set('Host', 'example.test').set('Origin', 'http://example.test').set('Cookie', cookie).expect(200);
    process.env.CONFIG_ADMIN_TOKEN = 'rotated-admin-token';
    await request(createApp()).get('/api/control/session').set('Cookie', cookie).expect(401);
  });

  it('keeps admin bearer compatibility and validates team isolation on v2 claim', async () => {
    const app = createApp();
    await request(app).post('/api/control/display/pairings/claim')
      .set('Authorization', 'Bearer admin-token')
      .send({ code: '123456', requestId, name: 'TV', allowedTeamIds: ['outside'], desiredState: state })
      .expect(400);
    expect(mocks.claim).not.toHaveBeenCalled();
    await request(app).post('/api/control/display/pairings/claim')
      .set('Authorization', 'Bearer admin-token')
      .send({ code: '123456', requestId, name: 'TV', allowedTeamIds: ['a'], desiredState: state })
      .expect(201);
    expect(mocks.claim).toHaveBeenCalled();
  });

  it('exposes revoke, rotation, and safe replacement controller operations', async () => {
    const app = createApp();
    const auth = { Authorization: 'Bearer admin-token' };
    await request(app).post(`/api/control/display/devices/${deviceId}/revoke`).set(auth).expect(200);
    await request(app).post(`/api/control/display/devices/${deviceId}/rotate`).set(auth).expect(200);
    await request(app).post(`/api/control/display/devices/${deviceId}/replace`).set(auth)
      .send({ code: '123456', requestId, name: 'Replacement', allowedTeamIds: ['a'], desiredState: state }).expect(201);
    expect(mocks.claim).toHaveBeenLastCalledWith(expect.objectContaining({ replacementForDeviceId: deviceId }));
  });
});
