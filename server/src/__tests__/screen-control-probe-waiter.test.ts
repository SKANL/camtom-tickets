import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupScreenProbeResources } from '../screen-control-probe-cleanup';
import { waitForProbeSubscription } from '../screen-control-probe-waiter';

describe('hosted probe Realtime waiters', () => {
  afterEach(() => vi.useRealTimers());

  it('times out subscription, clears every timer, completes cleanup, and emits no unhandled rejection', async () => {
    vi.useFakeTimers();
    const removeChannel = vi.fn().mockResolvedValue('ok');
    const deleteDevice = vi.fn().mockResolvedValue({ error: null });
    const deleteUser = vi.fn().mockResolvedValue({ error: null });
    const cleanup = vi.fn(() => cleanupScreenProbeResources({
      admin: {
        from: vi.fn(() => ({ delete: vi.fn(() => ({ eq: deleteDevice })) })),
        auth: { admin: { deleteUser } },
      } as any,
      firstClient: { removeChannel } as any,
      firstUserId: 'user-1', secondUserId: 'user-2', deviceId: 'device-1', channel: {} as any,
    }));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    let changeWaiterCreated = false;
    const run = async () => {
      try {
        const changeWaiter = await waitForProbeSubscription(() => undefined, 50, 50);
        changeWaiterCreated = true;
        await changeWaiter.promise;
      } finally {
        await cleanup();
      }
    };
    try {
      const execution = run();
      const rejection = expect(execution).rejects.toThrow('Realtime subscription timed out');
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(50);
      await rejection;
      await vi.runAllTicks();
      expect(changeWaiterCreated).toBe(false);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(removeChannel).toHaveBeenCalledOnce();
      expect(deleteDevice).toHaveBeenCalledWith('id', 'device-1');
      expect(deleteUser).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('starts the change timeout only after SUBSCRIBED and allows explicit cancellation', async () => {
    vi.useFakeTimers();
    let onStatus!: (status: string) => void;
    const pending = waitForProbeSubscription((callback) => { onStatus = callback; }, 50, 100);
    expect(vi.getTimerCount()).toBe(1);
    onStatus('SUBSCRIBED');
    const changeWaiter = await pending;
    expect(vi.getTimerCount()).toBe(1);
    changeWaiter.cancel();
    await expect(changeWaiter.promise).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
