import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigResponse, DisplaySyncResponse, ScreenDevice, ScreenState } from '@camtom/shared';
import { TvDisplayApp } from '../TvDisplayApp';
import { DisplayRuntime, type DisplaySnapshot } from '../display-runtime';

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
  dashboard: {
    title: 'Booted TV', pollingInterval: 10_000, teamMembers: [], displayOrder: [],
    priorityLabels: {}, stateLabels: {}, report: { slaWindowHours: 24, enabled: true },
    kitchenPhrases: { emptyState: 'Empty', warningTimer: 'Warning', breachedTimer: 'Breached' },
    teams: [{ id: 'team-a', name: 'Team A', filter: 'active-states', timer: false }],
  },
} as ConfigResponse;

const device: ScreenDevice = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'TV', desiredState: state,
  stateVersion: 3, lastAppliedVersion: 3, lastSeenAt: new Date().toISOString(), capabilities: {},
  allowedTeamIds: ['team-a'], pairedAt: new Date().toISOString(), revokedAt: null,
  createdAt: new Date().toISOString(), health: 'online', protocolVersion: 2,
};

const syncResponse: DisplaySyncResponse = {
  protocolVersion: 2, device, desiredState: state, config, configVersion: 'config-1', tickets: [],
  ticketVersion: 'tickets-1', ticketsFullSnapshot: true, nextPollMs: 10_000,
  tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
};

interface RecordedRequest { url: string; headers: Record<string, string>; body: string; withCredentials: boolean }

class FakeXhr {
  static requests: RecordedRequest[] = [];
  static respond: (url: string) => { status: number; body: unknown } = () => ({ status: 500, body: {} });
  readyState = 0;
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private url = '';
  private headers: Record<string, string> = {};
  open(_method: string, url: string) { this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body = '') {
    FakeXhr.requests.push({ url: this.url, headers: { ...this.headers }, body, withCredentials: this.withCredentials });
    const response = FakeXhr.respond(this.url);
    this.status = response.status;
    this.responseText = JSON.stringify(response.body);
    this.readyState = 4;
    this.onreadystatechange?.();
  }
}

beforeEach(() => {
  FakeXhr.requests = [];
  localStorage.clear();
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.stubGlobal('fetch', undefined);
  vi.stubGlobal('WebSocket', undefined);
  vi.stubGlobal('CSS', { supports: () => true });
  vi.spyOn(navigator, 'cookieEnabled', 'get').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('real TV display boot', () => {
  it('resumes from the fragment with throwing storage, no fetch/WebSocket, and cookie-less bearer auth', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked'); });
    window.history.replaceState(null, '', `/display#installation=${credential.installationId}.${credential.installationSecret}`);
    FakeXhr.respond = (url) => url === '/api/display/session'
      ? { status: 200, body: { deviceId: device.id, deviceToken: 'memory-token', tokenExpiresAt: 'later' } }
      : url === '/api/display/sync'
        ? { status: 200, body: syncResponse }
        : { status: 404, body: { error: 'not found' } };

    render(<TvDisplayApp />);

    expect(await screen.findByText(/Control remoto activo/)).toBeInTheDocument();
    expect(screen.getByText('Booted TV')).toBeInTheDocument();
    expect(globalThis.fetch).toBeUndefined();
    expect(globalThis.WebSocket).toBeUndefined();
    await waitFor(() => expect(FakeXhr.requests).toHaveLength(3));
    expect(FakeXhr.requests.map((request) => request.url)).toEqual([
      '/api/display/session', '/api/display/sync', '/api/display/sync',
    ]);
    expect(FakeXhr.requests[0]).toMatchObject({
      headers: { Authorization: `Bearer ${credential.installationSecret}` }, withCredentials: true,
    });
    expect(FakeXhr.requests[1]).toMatchObject({ headers: { Authorization: 'Bearer memory-token' }, withCredentials: true });
    expect(JSON.parse(FakeXhr.requests[1].body).capabilities).toMatchObject({ cookies: false, fetch: false, webSocket: false, localStorage: false });
    expect(JSON.parse(FakeXhr.requests[1].body).appliedStateVersion).toBe(0);
    expect(JSON.parse(FakeXhr.requests[2].body).appliedStateVersion).toBe(3);
  });

  it('boots pairing from cleared storage without persisting or rendering the installation secret', async () => {
    window.history.replaceState(null, '', '/display');
    FakeXhr.respond = (url) => url === '/api/display/pairings'
      ? { status: 201, body: {
        protocolVersion: 2, pairingId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ...credential, code: '123456', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      } }
      : { status: 404, body: { error: 'not found' } };

    render(<TvDisplayApp />);

    expect(await screen.findByText('123456')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(credential.installationSecret);
    expect(localStorage.length).toBe(0);
  });

  it('lets revoked terminal state replace a cached dashboard and remote-active claim', () => {
    const snapshot: DisplaySnapshot = {
      phase: 'revoked', issues: [], config, screenState: state, device,
      lastUpdated: new Date().toISOString(), nextPollMs: 10_000, consecutiveFailures: 0,
      message: 'La URL fue revocada.', capabilities: { xhr: true, cssCustomProperties: true },
    };
    const runtime = {
      current: () => snapshot,
      subscribe: (listener: (value: DisplaySnapshot) => void) => { listener(snapshot); return () => {}; },
      start: vi.fn(), stop: vi.fn(), restartPairing: vi.fn(),
    } as unknown as DisplayRuntime;

    render(<TvDisplayApp runtime={runtime} />);

    expect(screen.getByRole('heading', { name: 'La pantalla necesita atención' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('La URL fue revocada.');
    expect(screen.queryByText(/Control remoto activo/)).not.toBeInTheDocument();
    expect(screen.queryByText('Booted TV')).not.toBeInTheDocument();
  });
});
