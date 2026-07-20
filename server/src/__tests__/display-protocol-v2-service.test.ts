import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  pairing: null as any,
  credential: null as any,
  device: null as any,
  rpcResult: null as any,
  rpcError: null as any,
  ticketRpcError: null as any,
  revision: 1,
  tickets: [] as any[],
  ranges: [] as Array<[number, number]>,
  teamFilters: [] as string[][],
  ticketCalls: [] as any[],
  config: null as any,
}));

vi.mock('../config', () => ({
  ensureConfig: vi.fn(async () => state.config),
}));

vi.mock('../supabase', () => ({
  getSupabaseAdmin: () => ({
    rpc: async (name: string, args: any) => {
      if (name === 'read_screen_ticket_page_v2') {
        state.ticketCalls.push(args);
        return state.ticketRpcError ? { data: null, error: state.ticketRpcError } : {
          data: {
            status: 'ok',
            effective_team_ids: state.rpcResult?.effective_team_ids ?? ['a'],
            tickets: state.tickets.slice(args.p_offset, args.p_offset + args.p_limit),
          },
          error: null,
        };
      }
      return state.rpcError ? { data: null, error: state.rpcError } : { data: state.rpcResult, error: null };
    },
    from: (table: string) => {
      let range: [number, number] | null = null;
      const chain: any = {
        select: () => chain,
        update: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        in: (_column: string, values: string[]) => {
          if (table === 'tickets') state.teamFilters.push([...values]);
          return chain;
        },
        range: (from: number, to: number) => {
          range = [from, to];
          state.ranges.push(range);
          return chain;
        },
        maybeSingle: async () => ({
          data: table === 'screen_pairings' ? state.pairing
            : table === 'screen_device_credentials' ? state.credential
              : table === 'screen_devices' ? state.device : null,
          error: null,
        }),
        single: async () => ({ data: { revision: state.revision }, error: null }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          const data = table === 'tickets' && range
            ? state.tickets.slice(range[0], range[1] + 1)
            : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  }),
}));

import {
  createDisplaySessionV2,
  getDisplayPairingStatusV2,
  hashInstallationSecret,
  loadDisplayTicketSnapshot,
  syncDisplayV2,
} from '../screen-protocol-v2';

const filter = { projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [] };
const desiredState = {
  schemaVersion: 1, layout: 'single',
  panes: {
    left: { teamId: 'a', view: 'board', filter },
    right: { teamId: 'a', view: 'board', filter },
  },
};

describe('display protocol v2 service security', () => {
  beforeEach(() => {
    process.env.SCREEN_PAIRING_SECRET = 'screen-pairing-secret-with-at-least-32-characters';
    state.credential = null;
    state.device = null;
    state.rpcResult = null;
    state.rpcError = null;
    state.ticketRpcError = null;
    state.revision = 1;
    state.tickets = [];
    state.ranges = [];
    state.teamFilters = [];
    state.ticketCalls = [];
    state.config = {
      version: 'config-v1', slas: [],
      dashboard: {
        pollingInterval: 10_000, title: 'Display', teamMembers: [], displayOrder: [],
        priorityLabels: {}, stateLabels: {}, report: { slaWindowHours: 24, enabled: true },
        kitchenPhrases: { emptyState: '', warningTimer: '', breachedTimer: '' },
        teams: [{ id: 'a', name: 'A', filter: 'active-states', timer: true }], activeTeamId: 'a',
      },
    };
  });

  it('uses the pending poll-secret hash without persisting plaintext', async () => {
    state.pairing = {
      id: 'pairing', device_id: null, installation_id: 'installation',
      poll_secret_hash: hashInstallationSecret('pending-secret'),
      expires_at: new Date(Date.now() + 60_000).toISOString(), claimed_at: null,
    };
    await expect(getDisplayPairingStatusV2('pairing', 'pending-secret')).resolves.toEqual({ status: 'pending' });
    await expect(getDisplayPairingStatusV2('pairing', 'wrong-secret')).rejects.toThrow('display credential invalid');
    expect(JSON.stringify(state.pairing)).not.toContain('pending-secret');
  });

  it('rejects the original pairing secret after credential rotation', async () => {
    state.pairing = {
      id: 'pairing', device_id: 'device', installation_id: 'installation',
      poll_secret_hash: hashInstallationSecret('original-secret'),
      expires_at: new Date(Date.now() - 60_000).toISOString(), claimed_at: new Date().toISOString(),
    };
    state.credential = {
      id: 'credential-2', device_id: 'device', generation: 2,
      credential_hash: hashInstallationSecret('rotated-secret'), revoked_at: null,
    };
    await expect(getDisplayPairingStatusV2('pairing', 'original-secret')).rejects.toThrow('display credential invalid');
    await expect(getDisplayPairingStatusV2('pairing', 'rotated-secret')).resolves.toMatchObject({
      status: 'claimed', deviceId: 'device', deviceToken: expect.any(String),
    });
  });

  it('authenticates the original hash before revealing revoked status or minting a session', async () => {
    state.pairing = {
      id: 'pairing', device_id: 'device', installation_id: 'installation',
      poll_secret_hash: hashInstallationSecret('original-secret'),
      expires_at: new Date(Date.now() - 60_000).toISOString(), claimed_at: new Date().toISOString(),
    };
    state.credential = null;
    state.device = { id: 'device', revoked_at: new Date().toISOString() };
    await expect(getDisplayPairingStatusV2('pairing', 'wrong-secret')).rejects.toThrow('display credential invalid');
    await expect(getDisplayPairingStatusV2('pairing', 'original-secret')).resolves.toEqual({ status: 'revoked' });
    await expect(createDisplaySessionV2('installation', 'original-secret')).rejects.toThrow('display credential invalid');
  });

  it('paginates beyond the Supabase 1000-row default before returning a snapshot', async () => {
    state.tickets = Array.from({ length: 1_005 }, (_, index) => ({ id: `ticket-${index}` }));
    state.rpcResult = { effective_team_ids: ['a'] };
    const tickets = await loadDisplayTicketSnapshot('credential', ['a'], 'config-v1');
    expect(tickets).toHaveLength(1_005);
    expect(state.ticketCalls).toEqual([
      { p_credential_id: 'credential', p_expected_config_updated_at: 'config-v1', p_offset: 0, p_limit: 1_000 },
      { p_credential_id: 'credential', p_expected_config_updated_at: 'config-v1', p_offset: 1_000, p_limit: 1_000 },
    ]);
  });

  it('intersects stored teams with current configuration before state, config, and ticket reads', async () => {
    state.revision = 2;
    state.tickets = [{ id: 'ticket-a' }];
    state.rpcResult = {
      status: 'ok',
      effective_team_ids: ['a'],
      config_snapshot: {
        dashboard: state.config.dashboard,
        sla: [],
        updatedAt: 'config-authoritative-a',
        teamConfigs: {},
      },
      device: {
        id: 'device', auth_user_id: null, display_name: 'TV', desired_state: desiredState,
        state_version: 2, last_applied_version: 1, last_seen_at: null,
        capabilities: {}, allowed_team_ids: ['a', 'removed'], paired_at: new Date().toISOString(),
        revoked_at: null, created_at: new Date().toISOString(), protocol_version: 2,
        installation_id: 'installation', superseded_by: null, replacement_for_device_id: null,
      },
    };
    const response = await syncDisplayV2(
      { id: 'credential', device_id: 'device', generation: 1, credential_hash: 'hash', revoked_at: null },
      { appliedStateVersion: 1, ticketVersion: '1', configVersion: null },
    );
    expect(response.device.allowedTeamIds).toEqual(['a']);
    expect(response.config?.dashboard.teams?.map((team) => team.id)).toEqual(['a']);
    expect(response.configVersion).toBe('config-authoritative-a');

    state.rpcResult.device.desired_state = {
      ...desiredState,
      panes: { ...desiredState.panes, left: { ...desiredState.panes.left, teamId: 'removed' } },
    };
    await expect(syncDisplayV2(
      { id: 'credential', device_id: 'device', generation: 1, credential_hash: 'hash', revoked_at: null },
      { appliedStateVersion: 1, ticketVersion: '1', configVersion: null },
    )).rejects.toThrow('desired state is outside configured team scope');

    state.rpcResult = { status: 'scope_revoked' };
    await expect(syncDisplayV2(
      { id: 'credential', device_id: 'device', generation: 1, credential_hash: 'hash', revoked_at: null },
      { appliedStateVersion: 1, ticketVersion: '1', configVersion: null },
    )).rejects.toThrow('authoritative display scope unavailable: scope_revoked');
  });

  it('ignores a stale warm config and fails closed on authoritative DB failure', async () => {
    const { ensureConfig } = await import('../config');
    state.config.dashboard.teams.push({ id: 'removed', name: 'Removed', filter: 'active-states', timer: true });
    state.rpcResult = {
      status: 'ok', effective_team_ids: ['a'],
      config_snapshot: {
        dashboard: { ...state.config.dashboard, teams: state.config.dashboard.teams.filter((team: any) => team.id === 'a') },
        sla: [], updatedAt: 'live-after-removal', teamConfigs: {},
      },
      device: {
        id: 'device', auth_user_id: null, display_name: 'TV', desired_state: desiredState,
        state_version: 2, last_applied_version: 1, last_seen_at: null, capabilities: {},
        allowed_team_ids: ['a', 'removed'], paired_at: new Date().toISOString(), revoked_at: null,
        created_at: new Date().toISOString(), protocol_version: 2, installation_id: 'installation',
      },
    };
    const response = await syncDisplayV2(
      { id: 'credential', device_id: 'device', generation: 1, credential_hash: 'hash', revoked_at: null },
      { appliedStateVersion: 1, ticketVersion: '1', configVersion: null },
    );
    expect(response.device.allowedTeamIds).toEqual(['a']);
    expect(ensureConfig).not.toHaveBeenCalled();

    state.rpcError = { message: 'authoritative database unavailable' };
    await expect(syncDisplayV2(
      { id: 'credential', device_id: 'device', generation: 1, credential_hash: 'hash', revoked_at: null },
      { appliedStateVersion: 1, ticketVersion: '1', configVersion: null },
    )).rejects.toThrow('display sync failed: authoritative database unavailable');
    expect(ensureConfig).not.toHaveBeenCalled();
  });
});
