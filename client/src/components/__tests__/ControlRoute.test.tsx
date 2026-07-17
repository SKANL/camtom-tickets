import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listDevices: vi.fn(),
  updateDevice: vi.fn(),
  claimPairing: vi.fn(),
  revokeDevice: vi.fn(),
  config: { dashboard: { teams: [{ id: 'a', name: 'Team A', filter: 'active-states', timer: true }, { id: 'b', name: 'Team B', filter: 'active-states', timer: true }] } },
}));

vi.mock('../../hooks/useConfig', () => ({ useConfig: () => ({ config: mocks.config }) }));
vi.mock('../../lib/config-admin', () => ({ readAdminToken: () => 'admin', storeAdminToken: vi.fn() }));
vi.mock('../../lib/screen-control', async () => {
  class ScreenControlError extends Error { constructor(message: string, public status?: number) { super(message); } }
  return { ...mocks, ScreenControlError, createRequestId: () => '11111111-1111-4111-8111-111111111111' };
});

import { ControlRoute } from '../ControlRoute';

const desiredState = {
  schemaVersion: 1 as const, layout: 'single' as const, muted: false,
  panes: {
    left: { teamId: 'a', view: 'board' as const, filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
    right: { teamId: 'b', view: 'board' as const, filter: { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] } },
  },
};

describe('ControlRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const device = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'TV1', desiredState, stateVersion: 2, lastAppliedVersion: 2, lastSeenAt: '2026-07-16T12:00:00Z', capabilities: {}, allowedTeamIds: ['a', 'b'], pairedAt: '2026-07-16T10:00:00Z', revokedAt: null, createdAt: '2026-07-16T10:00:00Z', health: 'online' };
    mocks.listDevices.mockResolvedValue([device]);
    mocks.updateDevice.mockResolvedValue({ ...device, stateVersion: 3 });
  });

  it('loads a device and sends an expected-version command from its card', async () => {
    render(<ControlRoute />);
    expect(await screen.findByRole('heading', { name: 'TV1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(mocks.updateDevice).toHaveBeenCalledWith('admin', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expect.objectContaining({
      expectedVersion: 2,
      requestId: '11111111-1111-4111-8111-111111111111',
      allowedTeamIds: ['a', 'b'],
    })));
  });
});
