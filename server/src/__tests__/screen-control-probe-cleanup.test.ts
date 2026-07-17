import { describe, expect, it, vi } from 'vitest';
import { cleanupScreenProbeResources } from '../screen-control-probe-cleanup';

function resources(overrides: Record<string, unknown> = {}) {
  const deleteUser = vi.fn()
    .mockResolvedValueOnce({ error: { message: 'first failed' } })
    .mockResolvedValueOnce({ error: { message: 'second failed' } });
  const eq = vi.fn().mockResolvedValue({ error: { message: 'device failed' } });
  const admin = {
    from: vi.fn(() => ({ delete: vi.fn(() => ({ eq })) })),
    auth: { admin: { deleteUser } },
  };
  return {
    value: {
      admin, firstClient: { removeChannel: vi.fn().mockResolvedValue('error') },
      firstUserId: 'user-1', secondUserId: 'user-2', deviceId: 'device-1', channel: {},
      ...overrides,
    } as any,
    admin, deleteUser, eq,
  };
}

describe('hosted screen probe cleanup', () => {
  it('attempts every registered resource and aggregates all Supabase cleanup errors', async () => {
    const fixture = resources();
    await expect(cleanupScreenProbeResources(fixture.value)).resolves.toEqual([
      'realtime channel: error',
      'screen device: device failed',
      'first synthetic user: first failed',
      'second synthetic user: second failed',
    ]);
    expect(fixture.eq).toHaveBeenCalledWith('id', 'device-1');
    expect(fixture.deleteUser).toHaveBeenCalledTimes(2);
  });

  it('reports no failures when every cleanup result succeeds', async () => {
    const fixture = resources({
      firstClient: { removeChannel: vi.fn().mockResolvedValue('ok') },
      channel: {},
    });
    fixture.eq.mockResolvedValue({ error: null });
    fixture.deleteUser.mockReset().mockResolvedValue({ error: null });
    await expect(cleanupScreenProbeResources(fixture.value)).resolves.toEqual([]);
  });
});
