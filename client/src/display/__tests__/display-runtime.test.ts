import { describe, expect, it, vi } from 'vitest';
import type { ConfigResponse, DisplaySyncResponse, ScreenDevice, ScreenState } from '@camtom/shared';
import { DisplayRuntime, parseInstallationFragment, permanentDisplayPath, type DisplayRuntimeEnvironment } from '../display-runtime';
import { DisplayTransportError, type DisplayTransport } from '../display-transport';

const credential = {
  installationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  installationSecret: 'A'.repeat(43),
};

const state: ScreenState = {
  schemaVersion: 1, layout: 'single', muted: true,
  panes: {
    left: { teamId: 'team-a', view: 'board', filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
    right: { teamId: 'team-a', view: 'board', filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
  },
};

const config = {
  version: 'config-1', slas: [],
  dashboard: { title: 'TV', pollingInterval: 10_000, teamMembers: [], displayOrder: [], priorityLabels: {}, stateLabels: {}, report: { slaWindowHours: 24, enabled: true }, kitchenPhrases: { emptyState: '', warningTimer: '', breachedTimer: '' }, teams: [{ id: 'team-a', name: 'A', filter: 'active-states', timer: false }] },
} as ConfigResponse;

const device: ScreenDevice = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'TV', desiredState: state,
  stateVersion: 3, lastAppliedVersion: 0, lastSeenAt: new Date().toISOString(), capabilities: {},
  allowedTeamIds: ['team-a'], pairedAt: new Date().toISOString(), revokedAt: null,
  createdAt: new Date().toISOString(), health: 'online', protocolVersion: 2,
};

function syncResponse(): DisplaySyncResponse {
  return {
    protocolVersion: 2, device, desiredState: state, config, configVersion: 'config-1', tickets: [],
    ticketVersion: 'tickets-1', ticketsFullSnapshot: true, nextPollMs: 10_000,
    tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function harness(hash = permanentDisplayPath(credential).slice('/display'.length)) {
  let wake = () => {};
  let nextTimer: (() => void) | null = null;
  let nextTimerDelay: number | null = null;
  const replace = vi.fn();
  const env: DisplayRuntimeEnvironment = {
    hash: () => hash,
    setPermanentFragment: replace,
    clearFragment: vi.fn(),
    now: () => Date.now(),
    random: () => 0.5,
    setTimeout: (callback, delay) => { nextTimer = callback; nextTimerDelay = delay; return 1; },
    clearTimeout: () => { nextTimer = null; nextTimerDelay = null; },
    addWakeListeners: (callback) => { wake = callback; return () => {}; },
  };
  const transport: DisplayTransport = {
    createPairing: vi.fn(), pairingStatus: vi.fn(),
    createSession: vi.fn().mockResolvedValue({ deviceId: device.id, deviceToken: 'memory-token', tokenExpiresAt: 'later' }),
    sync: vi.fn().mockResolvedValue(syncResponse()),
  };
  return {
    env,
    transport,
    replace,
    wake: () => wake(),
    timer: () => nextTimer?.(),
    timerDelay: () => nextTimerDelay,
  };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

describe('display v2 runtime', () => {
  it('fails honestly when the embedded engine cannot render CSS custom properties', () => {
    const h = harness();
    const runtime = new DisplayRuntime(h.transport, h.env, { xhr: true, cssCustomProperties: false });
    runtime.start();
    expect(runtime.current()).toMatchObject({ phase: 'incompatible', message: expect.stringContaining('variables CSS') });
    expect(h.transport.createSession).not.toHaveBeenCalled();
  });

  it('recovers from the permanent fragment with an in-memory bearer when cookies are unavailable', async () => {
    const h = harness();
    const runtime = new DisplayRuntime(h.transport, h.env, { xhr: true, cookies: false });
    runtime.start();
    await vi.waitFor(() => expect(h.transport.sync).toHaveBeenCalledOnce());
    expect(h.transport.createSession).toHaveBeenCalledWith(
      { installationId: credential.installationId }, credential.installationSecret,
    );
    expect(h.transport.sync).toHaveBeenCalledWith(expect.objectContaining({ appliedStateVersion: 0 }), 'memory-token');
    expect(runtime.current()).toMatchObject({ phase: 'paired', screenState: state, config, consecutiveFailures: 0 });
  });

  it('immediately ACKs an advanced state once, then returns to the normal poll cadence', async () => {
    const h = harness();
    const runtime = new DisplayRuntime(h.transport, h.env, { xhr: true });
    runtime.start();

    await vi.waitFor(() => expect(h.transport.sync).toHaveBeenCalledOnce());
    expect(h.transport.sync).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ appliedStateVersion: 0 }),
      'memory-token',
    );
    expect(h.timerDelay()).toBe(0);

    h.timer();
    await vi.waitFor(() => expect(h.transport.sync).toHaveBeenCalledTimes(2));
    expect(h.transport.sync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ appliedStateVersion: 3 }),
      'memory-token',
    );
    await vi.waitFor(() => expect(h.timerDelay()).toBe(10_000));
  });

  it('syncs immediately after focus/wake instead of waiting for the normal timer', async () => {
    const h = harness();
    const runtime = new DisplayRuntime(h.transport, h.env, { xhr: true });
    runtime.start();
    await vi.waitFor(() => expect(runtime.current().phase).toBe('paired'));
    h.wake();
    await flush();
    expect(h.transport.sync).toHaveBeenCalledTimes(2);
    expect(h.transport.sync).toHaveBeenLastCalledWith(expect.objectContaining({ appliedStateVersion: 3 }), 'memory-token');
  });

  it('backs off with jitter and never schedules beyond 60 seconds', async () => {
    const h = harness();
    vi.mocked(h.transport.sync).mockRejectedValue(new Error('network down'));
    const runtime = new DisplayRuntime(h.transport, h.env, { xhr: true });
    runtime.start();
    await vi.waitFor(() => expect(runtime.current().consecutiveFailures).toBe(1));
    expect(runtime.current().nextPollMs).toBeGreaterThanOrEqual(1_700);
    expect(runtime.current().nextPollMs).toBeLessThanOrEqual(60_000);
    expect(runtime.current().capabilities.lastError).toBe('network down');
  });

  it('claims once, updates the fragment, and reaches live sync without reloading the document', async () => {
    const h = harness('');
    vi.mocked(h.transport.createPairing).mockResolvedValue({
      protocolVersion: 2, pairingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      ...credential, code: '123456', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.mocked(h.transport.pairingStatus).mockResolvedValue({ status: 'claimed', deviceToken: 'memory-token' });
    const runtime = new DisplayRuntime(h.transport, h.env, { xhr: true });
    runtime.start();
    await flush();
    expect(runtime.current().pairing).toMatchObject({ code: '123456' });
    h.timer();
    await vi.waitFor(() => expect(runtime.current().phase).toBe('paired'));
    expect(h.replace).toHaveBeenCalledWith(credential);
    expect(h.transport.createSession).toHaveBeenCalledWith(
      { installationId: credential.installationId }, credential.installationSecret,
    );
    expect(h.transport.sync).toHaveBeenCalledWith(expect.any(Object), 'memory-token');
    expect(permanentDisplayPath(credential)).toBe(`/display#installation=${credential.installationId}.${credential.installationSecret}`);
    expect(JSON.stringify(runtime.current())).not.toContain(credential.installationSecret);
  });

  it('surfaces pairing replay and expiration states without exposing the secret', async () => {
    const replay = harness('');
    vi.mocked(replay.transport.createPairing).mockRejectedValue(new DisplayTransportError('La solicitud ya fue utilizada', 409));
    const replayRuntime = new DisplayRuntime(replay.transport, replay.env, { xhr: true });
    replayRuntime.start();
    await flush();
    expect(replayRuntime.current()).toMatchObject({ phase: 'error', message: 'La solicitud ya fue utilizada' });
    expect(replayRuntime.current().message).not.toContain(credential.installationSecret);

    const expired = harness('');
    vi.mocked(expired.transport.createPairing).mockResolvedValue({
      protocolVersion: 2, pairingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ...credential,
      code: '654321', expiresAt: new Date(Date.now() - 1).toISOString(),
    });
    const expiredRuntime = new DisplayRuntime(expired.transport, expired.env, { xhr: true });
    expiredRuntime.start();
    await flush();
    expired.timer();
    await flush();
    expect(expiredRuntime.current().phase).toBe('expired');
  });

  it('rejects malformed fragments and never accepts credentials in a query string', () => {
    expect(parseInstallationFragment(`#installation=${credential.installationId}.${credential.installationSecret}`)).toEqual(credential);
    expect(parseInstallationFragment(`?installation=${credential.installationId}.${credential.installationSecret}`)).toBeNull();
    expect(parseInstallationFragment('#installation=bad.secret')).toBeNull();
  });

  it('ignores an in-flight session response after teardown', async () => {
    const h = harness();
    let resolveSession!: (value: { deviceId: string; deviceToken: string; tokenExpiresAt: string }) => void;
    vi.mocked(h.transport.createSession).mockImplementation(() => new Promise((resolve) => { resolveSession = resolve; }));
    const runtime = new DisplayRuntime(h.transport, h.env, { xhr: true });
    runtime.start();
    runtime.stop();
    resolveSession({ deviceId: device.id, deviceToken: 'late-token', tokenExpiresAt: 'later' });
    await flush();
    expect(h.transport.sync).not.toHaveBeenCalled();
  });
});
