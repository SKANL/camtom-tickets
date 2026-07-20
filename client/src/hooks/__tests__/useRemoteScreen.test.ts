import React from 'react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigResponse, Issue, ScreenState } from '@camtom/shared';

const mocks = vi.hoisted(() => ({
  fetchScreenFeatures: vi.fn(),
  fetchDeviceConfig: vi.fn(),
  requestScreenCaptchaToken: vi.fn(),
  startPairing: vi.fn(),
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  selectDevice: vi.fn(),
  rpc: vi.fn(),
  removeChannel: vi.fn(),
  unsubscribe: vi.fn(),
  changeHandler: null as null | ((payload: any) => void),
  statusHandler: null as null | ((status: string) => void),
}));

vi.mock('../../lib/screen-control', () => ({
  createRequestId: () => '11111111-1111-4111-8111-111111111111',
  deviceCapabilities: () => ({ websocket: true }),
  fetchScreenFeatures: mocks.fetchScreenFeatures,
  fetchDeviceConfig: mocks.fetchDeviceConfig,
  requestScreenCaptchaToken: mocks.requestScreenCaptchaToken,
  startPairing: mocks.startPairing,
}));

vi.mock('../../lib/supabase', () => {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => mocks.selectDevice());
  const channel: any = {
    on: vi.fn((_kind: string, _filter: unknown, callback: (payload: any) => void) => {
      mocks.changeHandler = callback;
      return channel;
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      mocks.statusHandler = callback;
      return channel;
    }),
  };
  return {
    screenSupabase: {
      auth: {
        getSession: mocks.getSession,
        signInAnonymously: mocks.signInAnonymously,
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: mocks.unsubscribe } } })),
      },
      from: vi.fn(() => builder),
      channel: vi.fn(() => channel),
      removeChannel: mocks.removeChannel,
      rpc: mocks.rpc,
    },
  };
});

import { useRemoteScreen } from '../useRemoteScreen';
import { Dashboard } from '../../components/Dashboard';

const presentationIssues: Issue[] = [1, 2, 3, 4, 5].map((value) => ({
  id: String(value),
  identifier: `ORDER-${value}`,
  title: `Order ${value}`,
  priority: 1,
  priorityLabel: 'Urgent',
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
  state: { id: 'open', name: 'Open', type: 'unstarted' },
}));

function RemotePresentationHarness({ onExecute }: { onExecute: (commandId: string) => void }) {
  const remote = useRemoteScreen();
  return React.createElement(Dashboard, {
    issues: presentationIssues,
    doneToday: [],
    timers: new Map(),
    loading: false,
    error: null,
    config: remote.config,
    presentationMode: true,
    rotation: { enabled: true, intervalSeconds: 12, paused: true },
    presentationCommand: remote.screenState?.presentationCommand,
    onPresentationCommandHandled: (commandId: string) => {
      onExecute(commandId);
      void remote.acknowledgePresentationCommand(commandId);
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const filter = { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] };
function state(nonce: string): ScreenState {
  return { schemaVersion: 1, layout: 'single', reloadNonce: nonce, panes: {
    left: { teamId: 'a', view: 'board', filter }, right: { teamId: 'a', view: 'board', filter },
  } };
}
function row(
  version: number,
  revokedAt: string | null = null,
  desiredState: ScreenState = state(`v${version}`),
  lastAppliedVersion = version - 1,
) {
  return { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', display_name: 'TV1', desired_state: desiredState, state_version: version, last_applied_version: lastAppliedVersion, last_seen_at: new Date().toISOString(), capabilities: {}, allowed_team_ids: ['a'], paired_at: '2026-07-16T10:00:00Z', revoked_at: revokedAt, created_at: '2026-07-16T10:00:00Z' };
}
function config(title: string): ConfigResponse {
  return { version: title, slas: [], dashboard: { pollingInterval: 30_000, title, teamMembers: [], displayOrder: [], priorityLabels: {}, stateLabels: {}, report: { slaWindowHours: 24, enabled: true }, kitchenPhrases: { emptyState: '', warningTimer: '', breachedTimer: '' }, teams: [{ id: 'a', name: 'A', filter: 'active-states', timer: true }] } };
}

describe('useRemoteScreen monotonic coordinator', () => {
  const originalWebSocket = globalThis.WebSocket;
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.changeHandler = null;
    mocks.statusHandler = null;
    mocks.fetchScreenFeatures.mockResolvedValue({
      screenControlEnabled: true, requirePairing: true,
      captchaProvider: 'turnstile', captchaSiteKey: 'site-key', configurationError: null,
    });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tv-token', user: { id: 'user-1', is_anonymous: true } } } });
    mocks.requestScreenCaptchaToken.mockResolvedValue('captcha-token');
    mocks.signInAnonymously.mockResolvedValue({ data: { session: { access_token: 'new-token', user: { id: 'user-2', is_anonymous: true } } }, error: null });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: class {} });
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
  });

  it('lets fast Realtime v3 invalidate a delayed polling v2 before commit or ACK', async () => {
    const delayedV2 = deferred<ConfigResponse>();
    mocks.selectDevice.mockResolvedValue({ data: [row(2)], error: null });
    mocks.fetchDeviceConfig.mockImplementationOnce(() => delayedV2.promise).mockResolvedValueOnce(config('v3'));
    const { result } = renderHook(() => useRemoteScreen());
    await waitFor(() => expect(mocks.fetchDeviceConfig).toHaveBeenCalledTimes(1));

    act(() => { mocks.changeHandler?.({ new: row(3) }); });
    await waitFor(() => expect(result.current.screenState?.reloadNonce).toBe('v3'));
    await act(async () => { delayedV2.resolve(config('v2')); await delayedV2.promise; });

    expect(result.current.screenState?.reloadNonce).toBe('v3');
    expect(result.current.config?.version).toBe('v3');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('screen_device_ack', expect.objectContaining({ p_applied_version: 3 }));
  });

  it('does not let an older reconnect SELECT overwrite an applied Realtime version', async () => {
    mocks.selectDevice.mockResolvedValueOnce({ data: [row(3)], error: null });
    mocks.fetchDeviceConfig.mockResolvedValue(config('v3'));
    const { result } = renderHook(() => useRemoteScreen());
    await waitFor(() => expect(result.current.screenState?.reloadNonce).toBe('v3'));
    mocks.selectDevice.mockResolvedValueOnce({ data: [row(2)], error: null });
    act(() => { mocks.statusHandler?.('SUBSCRIBED'); });
    await waitFor(() => expect(mocks.selectDevice).toHaveBeenCalledTimes(2));
    expect(result.current.screenState?.reloadNonce).toBe('v3');
    expect(mocks.fetchDeviceConfig).toHaveBeenCalledTimes(1);
  });

  it('refreshes effective config when its version changes without a screen state version change', async () => {
    mocks.selectDevice.mockResolvedValue({ data: [row(2)], error: null });
    mocks.fetchDeviceConfig.mockResolvedValueOnce(config('config-v1')).mockResolvedValueOnce(config('config-v2'));
    const { result } = renderHook(() => useRemoteScreen());
    await waitFor(() => expect(result.current.config?.version).toBe('config-v1'));

    act(() => { mocks.changeHandler?.({ new: row(2) }); });
    await waitFor(() => expect(result.current.config?.version).toBe('config-v2'));

    expect(result.current.screenState?.reloadNonce).toBe('v2');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('executes v1 presentation commands before ACK and strips them after ACK or reload', async () => {
    const commandState: ScreenState = {
      ...state('command-v2'),
      presentationCommand: { id: 'command-2', type: 'next' },
    };
    mocks.selectDevice.mockResolvedValue({ data: [row(2, null, commandState, 1)], error: null });
    mocks.fetchDeviceConfig.mockResolvedValue(config('v2'));
    const first = renderHook(() => useRemoteScreen());
    await waitFor(() => expect(first.result.current.screenState?.presentationCommand?.id).toBe('command-2'));
    expect(mocks.rpc).not.toHaveBeenCalledWith('screen_device_ack', expect.objectContaining({ p_applied_version: 2 }));

    await act(async () => {
      await first.result.current.acknowledgePresentationCommand('command-2');
    });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      'screen_device_ack',
      expect.objectContaining({ p_applied_version: 2 }),
    ));
    await waitFor(() => expect(first.result.current.screenState?.presentationCommand).toBeUndefined());
    first.unmount();

    vi.clearAllMocks();
    mocks.fetchScreenFeatures.mockResolvedValue({
      screenControlEnabled: true, requirePairing: true,
      captchaProvider: 'turnstile', captchaSiteKey: 'site-key', configurationError: null,
    });
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'tv-token', user: { id: 'user-1', is_anonymous: true } } } });
    mocks.selectDevice.mockResolvedValue({ data: [row(2, null, commandState, 2)], error: null });
    mocks.fetchDeviceConfig.mockResolvedValue(config('v2-reload'));
    const reloaded = renderHook(() => useRemoteScreen());
    await waitFor(() => expect(reloaded.result.current.phase).toBe('paired'));
    expect(reloaded.result.current.screenState?.presentationCommand).toBeUndefined();
    expect(mocks.rpc).not.toHaveBeenCalledWith('screen_device_ack', expect.anything());
  });

  it('retries a failed v1 command ACK on polling without re-executing the committed command', async () => {
    const commandState: ScreenState = {
      ...state('command-v2'),
      presentationCommand: { id: 'command-retry', type: 'next' },
    };
    let ackAttempts = 0;
    mocks.selectDevice.mockResolvedValue({ data: [row(2, null, commandState, 1)], error: null });
    mocks.fetchDeviceConfig.mockResolvedValue(config('v2'));
    mocks.rpc.mockImplementation(async (name: string, args: { p_applied_version?: number }) => {
      if (name === 'screen_device_ack' && args.p_applied_version === 2) {
        ackAttempts++;
        return ackAttempts === 1
          ? { data: null, error: { message: 'temporary ACK failure' } }
          : { data: true, error: null };
      }
      return { data: true, error: null };
    });
    const execute = vi.fn();
    render(React.createElement(RemotePresentationHarness, { onExecute: execute }));

    await waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(screen.getByText('Order 5')).toBeInTheDocument();
    await waitFor(() => expect(ackAttempts).toBe(1));

    act(() => { mocks.changeHandler?.({ new: row(2, null, commandState, 1) }); });
    await waitFor(() => expect(ackAttempts).toBe(2));
    expect(execute).toHaveBeenCalledOnce();
    expect(screen.getByText('Order 5')).toBeInTheDocument();
  });

  it('fails closed on an out-of-scope config refresh and recovers at the same state version', async () => {
    mocks.selectDevice.mockResolvedValue({ data: [row(2)], error: null });
    mocks.fetchDeviceConfig.mockResolvedValueOnce(config('valid-v1'));
    const { result } = renderHook(() => useRemoteScreen());
    await waitFor(() => expect(result.current.phase).toBe('paired'));

    const invalid = config('invalid');
    invalid.dashboard.teams = [];
    mocks.fetchDeviceConfig.mockResolvedValueOnce(invalid);
    act(() => { mocks.changeHandler?.({ new: row(2) }); });
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.config).toBeNull();
    expect(result.current.screenState).toBeNull();

    mocks.fetchDeviceConfig.mockResolvedValueOnce(config('valid-v2'));
    act(() => { mocks.changeHandler?.({ new: row(2) }); });
    await waitFor(() => expect(result.current.phase).toBe('paired'));
    expect(result.current.config?.version).toBe('valid-v2');
    expect(result.current.screenState?.reloadNonce).toBe('v2');
  });

  it('makes revocation terminal during a config fetch and clears device caches', async () => {
    const delayed = deferred<ConfigResponse>();
    mocks.selectDevice.mockResolvedValue({ data: [row(2)], error: null });
    mocks.fetchDeviceConfig.mockReturnValue(delayed.promise);
    localStorage.setItem('camtom-tickets:issues:screen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:a', '[{"id":"secret"}]');
    localStorage.setItem('camtom-alert-memory-v1:screen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:a', '{"initialized":true}');
    const { result } = renderHook(() => useRemoteScreen());
    await waitFor(() => expect(mocks.fetchDeviceConfig).toHaveBeenCalledOnce());

    act(() => { mocks.changeHandler?.({ new: row(2, new Date().toISOString()) }); });
    expect(result.current.phase).toBe('revoked');
    expect(result.current.config).toBeNull();
    expect(localStorage.getItem('camtom-tickets:issues:screen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:a')).toBeNull();
    expect(localStorage.getItem('camtom-alert-memory-v1:screen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:a')).toBeNull();
    expect(mocks.removeChannel).toHaveBeenCalled();
    await act(async () => { delayed.resolve(config('v2')); await delayed.promise; });
    expect(result.current.phase).toBe('revoked');
    expect(mocks.rpc).not.toHaveBeenCalledWith('screen_device_ack', expect.anything());
    act(() => { mocks.changeHandler?.({ new: row(3) }); });
    expect(result.current.phase).toBe('revoked');
    expect(result.current.screenState).toBeNull();
  });

  it('invalidates deferred work and tears down subscriptions on unmount', async () => {
    const delayed = deferred<ConfigResponse>();
    mocks.selectDevice.mockResolvedValue({ data: [row(2)], error: null });
    mocks.fetchDeviceConfig.mockReturnValue(delayed.promise);
    const { unmount } = renderHook(() => useRemoteScreen());
    await waitFor(() => expect(mocks.fetchDeviceConfig).toHaveBeenCalledOnce());
    unmount();
    await act(async () => { delayed.resolve(config('v2')); await delayed.promise; });
    expect(mocks.rpc).not.toHaveBeenCalledWith('screen_device_ack', expect.anything());
    expect(mocks.removeChannel).toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it('passes a single-use CAPTCHA token into anonymous Auth', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    mocks.selectDevice.mockResolvedValue({ data: [], error: null });
    mocks.startPairing.mockResolvedValue({ code: '123456', expiresAt: '2026-07-16T10:05:00Z' });
    renderHook(() => useRemoteScreen());
    await waitFor(() => expect(mocks.signInAnonymously).toHaveBeenCalledWith({
      options: { captchaToken: 'captcha-token' },
    }));
    expect(mocks.requestScreenCaptchaToken).toHaveBeenCalledWith(expect.objectContaining({
      captchaProvider: 'turnstile', captchaSiteKey: 'site-key',
    }));
  });

  it('fails closed before anonymous Auth when pairing requires missing CAPTCHA configuration', async () => {
    mocks.fetchScreenFeatures.mockResolvedValue({
      screenControlEnabled: true, requirePairing: true,
      captchaProvider: null, captchaSiteKey: null,
      configurationError: 'CAPTCHA requerido',
    });
    const { result } = renderHook(() => useRemoteScreen(true));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.message).toBe('CAPTCHA requerido');
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
  });

  it('periodically applies the runtime kill switch without deleting the pairing or device caches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.selectDevice.mockResolvedValue({ data: [row(2)], error: null });
    mocks.fetchDeviceConfig.mockResolvedValue(config('v2'));
    const { result } = renderHook(() => useRemoteScreen());
    await waitFor(() => expect(result.current.phase).toBe('paired'));
    localStorage.setItem('camtom-tickets:issues:screen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:a', '[{"id":"kept"}]');
    localStorage.setItem('camtom-screen-pairing-request-v1', '11111111-1111-4111-8111-111111111111');
    mocks.fetchScreenFeatures.mockResolvedValue({
      screenControlEnabled: false, requirePairing: false,
      captchaProvider: null, captchaSiteKey: null, configurationError: null,
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(result.current.phase).toBe('local');
    expect(result.current.transport).toBe('offline');
    expect(mocks.removeChannel).toHaveBeenCalled();
    expect(localStorage.getItem('camtom-screen-pairing-request-v1')).toBe('11111111-1111-4111-8111-111111111111');
    expect(localStorage.getItem('camtom-tickets:issues:screen:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:a')).not.toBeNull();
  });
});
