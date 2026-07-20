import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '@camtom/shared';
import { Dashboard, rememberIssueUniverse, SEEN_ISSUE_HISTORY_LIMIT } from '../Dashboard';
import { configFixture } from '../../test/config-fixture';

const issue = (id: string, priority: Issue['priority']): Issue => ({
  id,
  identifier: id.toUpperCase(),
  title: `Order ${id}`,
  priority,
  priorityLabel: String(priority),
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
  state: { id: 'open', name: 'Open', type: 'unstarted' },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Dashboard presentation', () => {
  it('applies configured priority visibility and display order', () => {
    const config = configFixture();
    config.dashboard.displayOrder = [4, 1, 2, 3, 0];
    config.dashboard.displayOptions = { columnVisibility: { 2: false } };
    render(
      <Dashboard
        issues={[issue('urgent', 1), issue('low', 4), issue('hidden', 2)]}
        doneToday={[]}
        timers={new Map()}
        loading={false}
        error={null}
        config={config}
      />,
    );

    const titles = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(titles).toEqual(['Order low', 'Order urgent']);
    expect(screen.queryByText('Order hidden')).not.toBeInTheDocument();
  });

  it('does not animate the initial snapshot but marks later arrivals', () => {
    const config = configFixture();
    const { container, rerender } = render(
      <Dashboard issues={[issue('one', 1)]} doneToday={[]} timers={new Map()} loading={false} error={null} config={config} />,
    );
    expect(container.querySelector('.arrival-bounce')).not.toBeInTheDocument();

    rerender(<Dashboard issues={[issue('one', 1), issue('two', 1)]} doneToday={[]} timers={new Map()} loading={false} error={null} config={config} />);
    expect(screen.getByText('Order two').closest('.ticket-card')).toHaveClass('arrival-bounce');
  });

  it('never re-announces tickets that reappear after filters or team changes', () => {
    const config = configFixture();
    const first = issue('one', 1);
    const hidden = issue('hidden', 2);
    const universe = [first, hidden];
    const { container, rerender } = render(
      <Dashboard issues={[first]} issueUniverse={universe} doneToday={[]} timers={new Map()} loading={false} error={null} config={config} />,
    );

    rerender(<Dashboard issues={universe} issueUniverse={universe} doneToday={[]} timers={new Map()} loading={false} error={null} config={config} />);
    expect(screen.getByText('Order hidden')).toBeInTheDocument();
    expect(container.querySelector('.arrival-bounce')).not.toBeInTheDocument();
  });

  it('records hidden arrivals before they become visible', () => {
    const config = configFixture();
    const first = issue('one', 1);
    const hiddenArrival = issue('later', 2);
    const { container, rerender } = render(
      <Dashboard issues={[first]} issueUniverse={[first]} doneToday={[]} timers={new Map()} loading={false} error={null} config={config} />,
    );
    rerender(<Dashboard issues={[first]} issueUniverse={[first, hiddenArrival]} doneToday={[]} timers={new Map()} loading={false} error={null} config={config} />);
    rerender(<Dashboard issues={[first, hiddenArrival]} issueUniverse={[first, hiddenArrival]} doneToday={[]} timers={new Map()} loading={false} error={null} config={config} />);

    expect(screen.getByText('Order later')).toBeInTheDocument();
    expect(container.querySelector('.arrival-bounce')).not.toBeInTheDocument();
  });

  it('rotates overflowing TV orders on the configured interval', () => {
    vi.useFakeTimers();
    const config = configFixture();
    const orders = [1, 2, 3, 4, 5].map((value) => issue(String(value), 1));
    render(
      <Dashboard
        issues={orders}
        doneToday={[]}
        timers={new Map()}
        loading={false}
        error={null}
        config={config}
        presentationMode
        rotation={{ enabled: true, intervalSeconds: 5, paused: false }}
      />,
    );
    expect(screen.queryByText('Order 5')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText('Order 5')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Página 2 de 2' })).toBeInTheDocument();
  });

  it('applies each versioned presentation command only once', () => {
    const config = configFixture();
    const orders = [1, 2, 3, 4, 5].map((value) => issue(String(value), 1));
    const base = {
      issues: orders, doneToday: [], timers: new Map(), loading: false, error: null, config,
      presentationMode: true, rotation: { enabled: true, intervalSeconds: 12, paused: true },
    };
    const handled = vi.fn(() => {
      expect(screen.getByText('Order 5')).toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Página 2 de 2' })).toBeInTheDocument();
    });
    const { rerender } = render(<Dashboard {...base} presentationCommand={{ id: 'command-1', type: 'next' }} onPresentationCommandHandled={handled} />);
    expect(screen.getByText('Order 5')).toBeInTheDocument();
    expect(handled).toHaveBeenCalledOnce();

    rerender(<Dashboard {...base} presentationCommand={{ id: 'command-1', type: 'next' }} onPresentationCommandHandled={handled} />);
    expect(screen.getByText('Order 5')).toBeInTheDocument();
    expect(handled).toHaveBeenCalledOnce();

    rerender(<Dashboard {...base} presentationCommand={{ id: 'command-2', type: 'previous' }} />);
    expect(screen.queryByText('Order 5')).not.toBeInTheDocument();
  });

  it('does not cancel the arrival timeout on an unrelated update', () => {
    vi.useFakeTimers();
    const config = configFixture();
    const first = issue('one', 1);
    const arrival = issue('two', 1);
    const { container, rerender } = render(
      <Dashboard issues={[first]} doneToday={[]} timers={new Map()} loading={false} error={null} config={config} />,
    );
    rerender(<Dashboard issues={[first, arrival]} doneToday={[]} timers={new Map()} loading={false} error={null} config={config} />);
    expect(container.querySelector('.arrival-bounce')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    rerender(<Dashboard issues={[first, arrival]} doneToday={[]} timers={new Map()} loading={false} error={null} config={{ ...config }} />);
    act(() => vi.advanceTimersByTime(1_500));
    expect(container.querySelector('.arrival-bounce')).not.toBeInTheDocument();
  });

  it('bounds inactive seen-ID history without evicting the active working set', () => {
    const history = new Map(Array.from({ length: SEEN_ISSUE_HISTORY_LIMIT + 20 }, (_, index) => [`old-${index}`, index]));
    history.set('active', SEEN_ISSUE_HISTORY_LIMIT + 20);
    rememberIssueUniverse(history, ['active'], SEEN_ISSUE_HISTORY_LIMIT + 21);
    expect(history.size).toBe(SEEN_ISSUE_HISTORY_LIMIT);
    expect(history.has('active')).toBe(true);
  });

  it('restarts both the page and the automatic interval on restartRotation', () => {
    vi.useFakeTimers();
    const config = configFixture();
    const orders = [1, 2, 3, 4, 5].map((value) => issue(String(value), 1));
    const base = {
      issues: orders, doneToday: [], timers: new Map(), loading: false, error: null, config,
      presentationMode: true, rotation: { enabled: true, intervalSeconds: 5, paused: false },
    };
    const { rerender } = render(<Dashboard {...base} />);
    act(() => vi.advanceTimersByTime(4_000));
    rerender(<Dashboard {...base} presentationCommand={{ id: 'restart-1', type: 'restartRotation' }} />);
    expect(screen.queryByText('Order 5')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByText('Order 5')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.getByText('Order 5')).toBeInTheDocument();
  });
});
