import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getControlSession: vi.fn(), createControlSession: vi.fn(), deleteControlSession: vi.fn(),
  listDevices: vi.fn(), updateDevice: vi.fn(), claimDisplayPairingV2: vi.fn(),
  replaceDisplayDeviceV2: vi.fn(), revokeDevice: vi.fn(), revokeDisplayDeviceV2: vi.fn(),
  rotateDisplayCredentialV2: vi.fn(),
  config: { dashboard: { teams: [{ id: 'a', name: 'Team A', filter: 'active-states', timer: true }, { id: 'b', name: 'Team B', filter: 'active-states', timer: true }] } },
}));

vi.mock('../../hooks/useConfig', () => ({ useConfig: () => ({ config: mocks.config }) }));
vi.mock('../../lib/screen-control', async () => {
  class ScreenControlError extends Error { constructor(message: string, public status?: number) { super(message); } }
  return { ...mocks, ScreenControlError, createRequestId: () => '11111111-1111-4111-8111-111111111111' };
});

import {
  CONTROL_ACK_REFRESH_INTERVAL_MS,
  CONTROL_REFRESH_INTERVAL_MS,
  ControlRoute,
  controlHealth,
  controlRefreshInterval,
  pendingAckFeedback,
} from '../ControlRoute';

const desiredState = {
  schemaVersion: 1 as const, layout: 'single' as const, muted: false,
  panes: {
    left: { teamId: 'a', view: 'board' as const, filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
    right: { teamId: 'b', view: 'board' as const, filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
  },
};

const device = (id: string, name: string) => ({
  id, name, desiredState, stateVersion: 2, lastAppliedVersion: 2,
  lastSeenAt: '2026-07-16T12:00:00Z', capabilities: { userAgent: 'TV Browser' },
  allowedTeamIds: ['a', 'b'], pairedAt: '2026-07-16T10:00:00Z', revokedAt: null,
  createdAt: '2026-07-16T10:00:00Z', health: 'online' as const, protocolVersion: 2 as const,
});

async function flushUi() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

describe('ControlRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.getControlSession.mockResolvedValue({ authenticated: true });
    mocks.deleteControlSession.mockResolvedValue({ authenticated: false });
    mocks.createControlSession.mockResolvedValue({ authenticated: true, expiresAt: 'later' });
    const devices = [
      device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TV1'),
      device('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TV2'),
      device('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'TV3'),
    ];
    mocks.listDevices.mockResolvedValue(devices);
    mocks.updateDevice.mockImplementation(async (_token: string, id: string) => ({ ...devices.find((item) => item.id === id)!, stateVersion: 3 }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resumes the HttpOnly session without asking for the admin token', async () => {
    render(<ControlRoute />);
    expect(await screen.findByRole('heading', { name: 'TV1' }, { timeout: 5_000 })).toBeInTheDocument();
    expect(mocks.getControlSession).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Clave administrativa')).not.toBeInTheDocument();
  });

  it('targets only explicitly selected TVs instead of the first two devices', async () => {
    render(<ControlRoute />);
    const heading = await screen.findByRole('heading', { name: 'TV3' });
    const article = heading.closest('article')!;
    const target = Array.from(article.querySelectorAll('input')).find((input) => input.parentElement?.textContent?.includes('Controlar esta TV'))!;
    fireEvent.click(target);
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a seleccionadas (1)' }));
    await waitFor(() => expect(mocks.updateDevice).toHaveBeenCalledOnce());
    expect(mocks.updateDevice).toHaveBeenCalledWith('', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', expect.objectContaining({ expectedVersion: 2 }));
    expect(JSON.parse(localStorage.getItem('camtom-control-selected-devices-v1') ?? '[]')).toEqual(['cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
  });

  it('keeps fixed fast deadlines across delayed and out-of-order refresh responses', async () => {
    vi.useFakeTimers();
    const initial = [
      device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TV1'),
      device('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TV2'),
      device('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'TV3'),
    ];
    const awaitingAck = { ...initial[0], stateVersion: 3, lastAppliedVersion: 2 };
    let resolveDelayed!: (devices: typeof initial) => void;
    const delayed = new Promise<typeof initial>((resolve) => { resolveDelayed = resolve; });
    mocks.listDevices
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(() => delayed)
      .mockResolvedValue([awaitingAck, initial[1], initial[2]]);

    render(<ControlRoute />);
    await flushUi();
    const heading = screen.getByRole('heading', { name: 'TV1' });
    const article = heading.closest('article')!;
    fireEvent.click(Array.from(article.querySelectorAll('button')).find((button) => button.textContent === 'Aplicar')!);
    await flushUi();

    expect(mocks.listDevices).toHaveBeenCalledTimes(2);
    expect(article).toHaveTextContent('Enviada v3 · aplicada v2 · esperando ACK');

    for (let elapsed = 0; elapsed < 12_000; elapsed += CONTROL_ACK_REFRESH_INTERVAL_MS) {
      await act(async () => { await vi.advanceTimersByTimeAsync(CONTROL_ACK_REFRESH_INTERVAL_MS); });
    }
    expect(mocks.listDevices).toHaveBeenCalledTimes(6);
    expect(article).toHaveTextContent('Enviada v3 · aplicada v2 · esperando ACK');

    resolveDelayed(initial);
    await flushUi();
    expect(article).toHaveTextContent('Enviada v3 · aplicada v2 · esperando ACK');
  });

  it('shows ACK on the next fast deadline and shuts fast polling down immediately', async () => {
    vi.useFakeTimers();
    const initial = [
      device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TV1'),
      device('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TV2'),
      device('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'TV3'),
    ];
    const awaitingAck = { ...initial[0], stateVersion: 3, lastAppliedVersion: 2 };
    const acknowledged = { ...awaitingAck, lastAppliedVersion: 3 };
    mocks.listDevices
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce([awaitingAck, initial[1], initial[2]])
      .mockResolvedValue([acknowledged, initial[1], initial[2]]);

    render(<ControlRoute />);
    await flushUi();
    const article = screen.getByRole('heading', { name: 'TV1' }).closest('article')!;
    fireEvent.click(Array.from(article.querySelectorAll('button')).find((button) => button.textContent === 'Aplicar')!);
    await flushUi();

    expect(mocks.listDevices).toHaveBeenCalledTimes(2);
    expect(article).toHaveTextContent('esperando ACK');
    await act(async () => { await vi.advanceTimersByTimeAsync(CONTROL_ACK_REFRESH_INTERVAL_MS); });

    expect(mocks.listDevices).toHaveBeenCalledTimes(3);
    expect(article).toHaveTextContent('Enviada v3 · aplicada v3');
    expect(article).not.toHaveTextContent('esperando ACK');

    await act(async () => { await vi.advanceTimersByTimeAsync(CONTROL_ACK_REFRESH_INTERVAL_MS); });
    expect(mocks.listDevices).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONTROL_REFRESH_INTERVAL_MS - CONTROL_ACK_REFRESH_INTERVAL_MS);
    });
    expect(mocks.listDevices).toHaveBeenCalledTimes(4);
  });

  it('preserves the 12-second deadline when one of two TVs ACKs around 10 seconds', async () => {
    vi.useFakeTimers();
    const initial = [
      device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TV1'),
      device('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TV2'),
      device('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'TV3'),
    ];
    const pendingOne = { ...initial[0], stateVersion: 3, lastAppliedVersion: 2 };
    const pendingTwo = { ...initial[1], stateVersion: 3, lastAppliedVersion: 2 };
    const acknowledgedOne = { ...pendingOne, lastAppliedVersion: 3 };
    const acknowledgedTwo = { ...pendingTwo, lastAppliedVersion: 3 };
    const bothPending = [pendingOne, pendingTwo, initial[2]];
    const partialAck = [acknowledgedOne, pendingTwo, initial[2]];
    const finalAck = [acknowledgedOne, acknowledgedTwo, initial[2]];

    mocks.listDevices
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce([pendingOne, initial[1], initial[2]])
      .mockResolvedValueOnce(bothPending)
      .mockResolvedValueOnce(bothPending)
      .mockResolvedValueOnce(bothPending)
      .mockImplementationOnce(() => new Promise((resolve) => {
        window.setTimeout(() => resolve(partialAck), 1_000);
      }))
      .mockResolvedValue(finalAck);

    render(<ControlRoute />);
    await flushUi();
    const tv1 = screen.getByRole('heading', { name: 'TV1' }).closest('article')!;
    const tv2 = screen.getByRole('heading', { name: 'TV2' }).closest('article')!;
    for (const article of [tv1, tv2]) {
      const target = Array.from(article.querySelectorAll('input'))
        .find((input) => input.parentElement?.textContent?.includes('Controlar esta TV'))!;
      fireEvent.click(target);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a seleccionadas (2)' }));
    await flushUi();

    expect(mocks.listDevices).toHaveBeenCalledTimes(3);
    expect(tv1).toHaveTextContent('esperando ACK');
    expect(tv2).toHaveTextContent('esperando ACK');

    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(mocks.listDevices).toHaveBeenCalledTimes(6);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(tv1).not.toHaveTextContent('esperando ACK');
    expect(tv2).toHaveTextContent('esperando ACK');

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.listDevices).toHaveBeenCalledTimes(7);
    expect(tv1).toHaveTextContent('Enviada v3 · aplicada v3');
    expect(tv2).toHaveTextContent('Enviada v3 · aplicada v3');
    expect(tv2).not.toHaveTextContent('esperando ACK');

    await act(async () => { await vi.advanceTimersByTimeAsync(CONTROL_REFRESH_INTERVAL_MS - 1); });
    expect(mocks.listDevices).toHaveBeenCalledTimes(7);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.listDevices).toHaveBeenCalledTimes(8);
  });

  it('uses a bounded transient ACK cadence and preserves the normal cadence otherwise', () => {
    expect(controlRefreshInterval(0)).toBe(CONTROL_REFRESH_INTERVAL_MS);
    expect(controlRefreshInterval(1)).toBe(CONTROL_ACK_REFRESH_INTERVAL_MS);
    expect(controlRefreshInterval(1)).toBeLessThanOrEqual(10_000);
  });

  it('logs out through the server and returns to the login form', async () => {
    render(<ControlRoute />);
    await screen.findByRole('heading', { name: 'TV1' });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByLabelText('Clave administrativa')).toBeInTheDocument();
    expect(mocks.deleteControlSession).toHaveBeenCalledOnce();
  });

  it('exchanges the raw token for a session without persisting it', async () => {
    mocks.getControlSession.mockRejectedValueOnce(new Error('HTTP 401'));
    render(<ControlRoute />);
    const input = await screen.findByLabelText('Clave administrativa');
    fireEvent.change(input, { target: { value: 'admin-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(mocks.createControlSession).toHaveBeenCalledWith('admin-secret'));
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem('camtom-config-admin-token')).toBeNull();
  });

  it('normalizes lifecycle and connectivity diagnostics', () => {
    const base = device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TV');
    expect(controlHealth(base)).toBe('online');
    expect(controlHealth({ ...base, health: 'unstable' })).toBe('degraded');
    expect(controlHealth({ ...base, health: 'stale' })).toBe('offline');
    expect(controlHealth({ ...base, revokedAt: '2026-07-20T00:00:00Z' })).toBe('revoked');
    expect(controlHealth({ ...base, revokedAt: '2026-07-20T00:00:00Z', supersededBy: 'new-tv' })).toBe('replaced');
  });

  it('does not preselect the first configured teams for a new pairing', async () => {
    render(<ControlRoute />);
    const heading = await screen.findByRole('heading', { name: 'Vincular o reemplazar una pantalla' });
    const section = heading.closest('section')!;
    const teamChecks = Array.from(section.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(teamChecks).toHaveLength(2);
    expect(teamChecks.every((input) => !input.checked)).toBe(true);
    fireEvent.change(section.querySelector('input[pattern="[0-9]{6}"]')!, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(await screen.findByText('Elegí al menos un team')).toBeInTheDocument();
    expect(mocks.claimDisplayPairingV2).not.toHaveBeenCalled();
  });

  it('preserves an empty/invalid authoritative draft and refuses apply until teams and both panes are explicit', async () => {
    const invalid = {
      ...device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TV invalid'),
      allowedTeamIds: [],
      desiredState: {
        ...desiredState,
        panes: {
          left: { ...desiredState.panes.left, teamId: 'removed-team' },
          right: { ...desiredState.panes.right, teamId: 'removed-team' },
        },
      },
    };
    mocks.listDevices.mockResolvedValue([invalid]);
    render(<ControlRoute />);
    const heading = await screen.findByRole('heading', { name: 'TV invalid' });
    const article = heading.closest('article')!;
    const teamChecks = Array.from(article.querySelectorAll('fieldset input[type="checkbox"]')) as HTMLInputElement[];
    expect(teamChecks.every((input) => !input.checked)).toBe(true);
    fireEvent.click(Array.from(article.querySelectorAll('button')).find((button) => button.textContent === 'Aplicar')!);
    expect(await screen.findByText(/Elegí al menos un team permitido para TV invalid/)).toBeInTheDocument();
    expect(mocks.updateDevice).not.toHaveBeenCalled();
    fireEvent.click(teamChecks[0]);
    fireEvent.click(Array.from(article.querySelectorAll('button')).find((button) => button.textContent === 'Aplicar')!);
    expect(await screen.findByText(/Elegí explícitamente un team permitido para cada panel de TV invalid/)).toBeInTheDocument();
    expect(mocks.updateDevice).not.toHaveBeenCalled();
  });

  it('sends transient navigation in the existing versioned payload and reports per-device ACK state', async () => {
    render(<ControlRoute />);
    const article = (await screen.findByRole('heading', { name: 'TV1' })).closest('article')!;
    fireEvent.click(Array.from(article.querySelectorAll('button')).find((button) => button.textContent?.includes('Siguiente'))!);
    await waitFor(() => expect(mocks.updateDevice).toHaveBeenCalledWith(
      '',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expect.objectContaining({
        desiredState: expect.objectContaining({
          presentationCommand: { id: '11111111-1111-4111-8111-111111111111', type: 'next' },
        }),
      }),
    ));
    expect(article).toHaveTextContent(/Siguiente página|Confirmado por la TV/);
  });

  it('isolates transient commands from dirty drafts and strips commands from ordinary apply', async () => {
    render(<ControlRoute />);
    const article = (await screen.findByRole('heading', { name: 'TV1' })).closest('article')!;
    fireEvent.click(Array.from(article.querySelectorAll('summary')).find((summary) => summary.textContent?.includes('Configurar'))!);
    const searchInput = Array.from(article.querySelectorAll('input')).find((input) => input.parentElement?.textContent?.includes('Buscar'))!;
    fireEvent.change(searchInput, { target: { value: 'dirty local draft' } });

    fireEvent.click(Array.from(article.querySelectorAll('button')).find((button) => button.textContent?.includes('Siguiente'))!);
    await waitFor(() => expect(mocks.updateDevice).toHaveBeenCalledTimes(1));
    expect(mocks.updateDevice.mock.calls[0][2].desiredState).toMatchObject({
      panes: { left: { filter: { textSearch: '' } } },
      presentationCommand: { type: 'next' },
    });

    fireEvent.click(Array.from(article.querySelectorAll('button')).find((button) => button.textContent === 'Aplicar')!);
    await waitFor(() => expect(mocks.updateDevice).toHaveBeenCalledTimes(2));
    expect(mocks.updateDevice.mock.calls[1][2].desiredState).toMatchObject({
      panes: { left: { filter: { textSearch: 'dirty local draft' } } },
    });
    expect(mocks.updateDevice.mock.calls[1][2].desiredState).not.toHaveProperty('presentationCommand');
  });

  it('never restores an ACKed persisted command into the editable draft', async () => {
    const acked = {
      ...device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TV ACKed'),
      desiredState: { ...desiredState, presentationCommand: { id: 'old-command', type: 'next' as const } },
      stateVersion: 4,
      lastAppliedVersion: 4,
    };
    mocks.listDevices.mockResolvedValue([acked]);
    render(<ControlRoute />);
    const article = (await screen.findByRole('heading', { name: 'TV ACKed' })).closest('article')!;
    fireEvent.click(Array.from(article.querySelectorAll('button')).find((button) => button.textContent === 'Aplicar')!);
    await waitFor(() => expect(mocks.updateDevice).toHaveBeenCalledOnce());
    expect(mocks.updateDevice.mock.calls[0][2].desiredState).not.toHaveProperty('presentationCommand');
  });

  it('reports revoked and replaced devices that disappear before command ACK', () => {
    const base = device('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TV');
    expect(pendingAckFeedback({ ...base, revokedAt: '2026-07-20T00:00:00Z' }, 3)).toEqual({
      waiting: false,
      message: 'No confirmado: la pantalla fue revocada antes del ACK.',
    });
    expect(pendingAckFeedback({ ...base, supersededBy: 'replacement' }, 3)).toEqual({
      waiting: false,
      message: 'No confirmado: la pantalla fue reemplazada antes del ACK.',
    });
  });

  it('uses an accessible themed confirmation instead of window.confirm', async () => {
    mocks.rotateDisplayCredentialV2.mockResolvedValue({ installationId: 'installation', installationSecret: 'secret' });
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<ControlRoute />);
    const article = (await screen.findByRole('heading', { name: 'TV1' })).closest('article')!;
    fireEvent.click(Array.from(article.querySelectorAll('summary')).find((summary) => summary.textContent?.includes('Avanzado'))!);
    fireEvent.click(Array.from(article.querySelectorAll('button')).find((button) => button.textContent === 'Rotar URL')!);
    const dialog = screen.getByRole('alertdialog', { name: '¿Cambiar la llave de esta TV?' });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent === 'Rotar URL')!);
    await waitFor(() => expect(mocks.rotateDisplayCredentialV2).toHaveBeenCalledOnce());
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
