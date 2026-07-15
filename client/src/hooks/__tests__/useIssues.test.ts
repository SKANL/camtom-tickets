import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketRow } from '@camtom/shared';

const mock = vi.hoisted(() => {
  const state: {
    selectResolvers: Array<(value: unknown) => void>;
    subscribeCallback?: (status: string) => void;
    changeCallback?: (payload: unknown) => void;
  } = { selectResolvers: [] };
  const channel: Record<string, unknown> = {};
  const select = vi.fn(() => new Promise((resolve) => state.selectResolvers.push(resolve)));
  const on = vi.fn((_type: string, _filter: unknown, callback: (payload: unknown) => void) => {
    state.changeCallback = callback;
    return channel;
  });
  const subscribe = vi.fn((callback: (status: string) => void) => {
    state.subscribeCallback = callback;
    return channel;
  });
  Object.assign(channel, { on, subscribe });
  return { state, channel, select, on, subscribe, removeChannel: vi.fn() };
});

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ select: mock.select })),
    channel: vi.fn(() => mock.channel),
    removeChannel: mock.removeChannel,
  },
}));

import { useIssues } from '../useIssues';

function row(title: string, updatedAt = '2026-07-15T10:00:00.000Z'): TicketRow {
  return {
    id: 'CAM-1', identifier: 'CAM-1', title, description: null, priority: 1,
    priority_label: 'Urgente', created_at: '2026-07-15T09:00:00.000Z', updated_at: updatedAt,
    completed_at: null, assigned_at: null, due_date: null, assignee: null,
    state: { id: 'new', name: 'Nuevo', type: 'unstarted' }, labels: null,
    project: null, team: null, cycle: null, estimate: null,
  };
}

async function resolveSelect(value: unknown): Promise<void> {
  const resolve = mock.state.selectResolvers.shift();
  if (!resolve) throw new Error('No pending SELECT');
  await act(async () => resolve(value));
}

describe('useIssues resync', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    mock.state.selectResolvers = [];
    mock.state.subscribeCallback = undefined;
    mock.state.changeCallback = undefined;
    mock.select.mockClear();
    mock.removeChannel.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a queued resync after reconnecting during an active snapshot', async () => {
    const { result } = renderHook(() => useIssues());
    act(() => mock.state.subscribeCallback?.('SUBSCRIBED'));
    expect(mock.select).toHaveBeenCalledTimes(1);

    act(() => {
      mock.state.subscribeCallback?.('CHANNEL_ERROR');
      mock.state.subscribeCallback?.('SUBSCRIBED');
    });
    await resolveSelect({ data: [row('Primer snapshot')], error: null });
    await waitFor(() => expect(mock.select).toHaveBeenCalledTimes(2));
    await resolveSelect({ data: [row('Snapshot recuperado', '2026-07-15T10:01:00.000Z')], error: null });

    await waitFor(() => expect(result.current.issues[0]?.title).toBe('Snapshot recuperado'));
    expect(result.current.connection).toBe('live');
  });

  it('keeps resync pending after SELECT failure and retries with backoff', async () => {
    vi.useFakeTimers();
    renderHook(() => useIssues());
    act(() => mock.state.subscribeCallback?.('SUBSCRIBED'));
    await resolveSelect({ data: null, error: { message: 'select failed' } });
    expect(mock.select).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(4999));
    expect(mock.select).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(mock.select).toHaveBeenCalledTimes(2);
  });

  it('removes the channel and ignores pending work after cleanup', async () => {
    const { unmount } = renderHook(() => useIssues());
    act(() => mock.state.subscribeCallback?.('SUBSCRIBED'));
    unmount();

    expect(mock.removeChannel).toHaveBeenCalledWith(mock.channel);
    await resolveSelect({ data: [row('Ignorado')], error: null });
  });
});
