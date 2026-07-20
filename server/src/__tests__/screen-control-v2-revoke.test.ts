import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../supabase', () => ({
  getSupabaseAdmin: () => ({
    rpc: mocks.rpc,
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: { id: 'device-v2', protocol_version: 2 }, error: null }),
        update: (...args: unknown[]) => { mocks.update(...args); return chain; },
      };
      return chain;
    },
  }),
}));

import { revokeScreenDevice } from '../screen-control';

describe('legacy screen revoke compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it('dispatches v2 devices to the transactional credential-revocation RPC', async () => {
    await expect(revokeScreenDevice('device-v2')).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith('revoke_screen_device_v2', { p_device_id: 'device-v2' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
