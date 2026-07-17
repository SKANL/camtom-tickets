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
  const limit = vi.fn(() => new Promise((resolve) => state.selectResolvers.push(resolve)));
  const order = vi.fn(() => ({ limit }));
  const gt = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ gt }));
  const on = vi.fn((_type: string, _filter: unknown, callback: (payload: unknown) => void) => {
    state.changeCallback = callback;
    return channel;
  });
  const subscribe = vi.fn((callback: (status: string) => void) => {
    state.subscribeCallback = callback;
    return channel;
  });
  Object.assign(channel, { on, subscribe });
  return { state, channel, select, gt, order, limit, on, subscribe, removeChannel: vi.fn() };
});

vi.mock('../../lib/supabase', () => {
  const client = {
    from: vi.fn(() => ({ select: mock.select })),
    channel: vi.fn(() => mock.channel),
    removeChannel: mock.removeChannel,
  };
  return { supabase: client, screenSupabase: client };
});

import { useIssues } from '../useIssues';

function row(title: string, updatedAt = '2026-07-15T10:00:00.000Z', id = 'CAM-1'): TicketRow {
  return {
    id, identifier: id, title, description: null, priority: 1,
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
    mock.gt.mockClear();
    mock.order.mockClear();
    mock.limit.mockClear();
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

  it('keyset-pages while replaying an insert, delete, and update between pages', async () => {
    const { result } = renderHook(() => useIssues());
    act(() => mock.state.subscribeCallback?.('SUBSCRIBED'));
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      ...row(`Ticket ${index}`), id: `CAM-${String(index).padStart(4, '0')}`,
    }));
    await resolveSelect({ data: firstPage, error: null });
    await waitFor(() => expect(mock.select).toHaveBeenCalledTimes(2));

    act(() => {
      mock.state.changeCallback?.({
        eventType: 'INSERT', new: row('Inserted behind cursor', '2026-07-15T10:02:00.000Z', 'AAA-NEW'), old: {},
        commit_timestamp: '2026-07-15T10:02:00.000Z',
      });
      mock.state.changeCallback?.({
        eventType: 'DELETE', new: {}, old: firstPage[1], commit_timestamp: '2026-07-15T10:03:00.000Z',
      });
      mock.state.changeCallback?.({
        eventType: 'UPDATE', new: row('Updated during paging', '2026-07-15T10:04:00.000Z', 'CAM-0002'),
        old: firstPage[2], commit_timestamp: '2026-07-15T10:04:00.000Z',
      });
    });
    await resolveSelect({ data: [row('Last', '2026-07-15T10:00:00.000Z', 'CAM-1000')], error: null });

    await waitFor(() => expect(result.current.issues).toHaveLength(1001));
    expect(result.current.issues.some((issue) => issue.id === 'AAA-NEW')).toBe(true);
    expect(result.current.issues.some((issue) => issue.id === 'CAM-0001')).toBe(false);
    expect(result.current.issues.find((issue) => issue.id === 'CAM-0002')?.title).toBe('Updated during paging');
    expect(mock.gt).toHaveBeenNthCalledWith(1, 'id', '');
    expect(mock.gt).toHaveBeenNthCalledWith(2, 'id', 'CAM-0999');
    expect(mock.limit).toHaveBeenCalledWith(1000);
  });
});
