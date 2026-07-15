import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSLA } from '../useSLA';
import { Issue, SLAConfig } from '@camtom/shared';

const mockSLAConfig: SLAConfig[] = [
  {
    id: 'ticket_timer',
    label: 'Ticket Timer',
    applicablePriorities: [1, 2, 3],
    maxMinutes: 5,
    warningThresholds: { warming: 0.6, heating: 0.3, critical: 0.1 },
  },
];

const makeIssue = (overrides: Partial<Issue> & { id: string; priority: Issue['priority'] }): Issue => ({
  identifier: `TEST-${overrides.id}`,
  title: 'Test issue',
  priorityLabel: overrides.priority === 1 ? 'Urgent' : 'Medium',
  createdAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
  updatedAt: new Date().toISOString(),
  assignee: { id: 'u1', name: 'Alice' },
  state: { id: 's1', name: 'In Progress', type: 'started' },
  ...overrides,
});

describe('useSLA', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('computes timer info for every issue it receives (team-scoping is upstream)', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 1, labels: { nodes: [{ id: 'l1', name: 'ticket' }] } }),
      makeIssue({ id: '2', priority: 2 }), // no ticket label — still gets a timer now
    ];

    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    expect(result.current.size).toBe(2);
    expect(result.current.has('1')).toBe(true);
    expect(result.current.has('2')).toBe(true);
  });

  it('returns FRESH state for issues within SLA', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 1, labels: { nodes: [{ id: 'l1', name: 'ticket' }] } }),
    ];

    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    const timer = result.current.get('1');
    expect(timer).toBeDefined();
    expect(timer!.state).toBe('FRESH');
    expect(timer!.remaining).toBeGreaterThan(0);
  });

  it('detects EXPIRED state for overdue issues', () => {
    const overdueIssue = makeIssue({
      id: '1',
      priority: 1,
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago, 5min SLA
      labels: { nodes: [{ id: 'l1', name: 'ticket' }] },
    });

    const issues: Issue[] = [overdueIssue];
    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    const timer = result.current.get('1');
    expect(timer).toBeDefined();
    expect(timer!.state).toBe('EXPIRED');
    expect(timer!.remaining).toBe(0);
  });

  it('updates remaining time on each tick', () => {
    const issues: Issue[] = [
      makeIssue({
        id: '1',
        priority: 1,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        labels: { nodes: [{ id: 'l1', name: 'ticket' }] },
      }),
    ];

    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    const firstTimer = result.current.get('1')!;
    const firstRemaining = firstTimer.remaining;

    // Advance by 2 seconds
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const secondTimer = result.current.get('1')!;
    expect(secondTimer.remaining).toBeLessThan(firstRemaining);
  });

  it('times an unlabelled issue too (anchor falls back to createdAt)', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 0 }), // no label — anchor = createdAt
    ];

    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    expect(result.current.size).toBe(1);
    expect(result.current.get('1')).toBeDefined();
  });

  it('returns empty map when no SLA config provided', () => {
    const issues: Issue[] = [makeIssue({ id: '1', priority: 1, labels: { nodes: [{ id: 'l1', name: 'ticket' }] } })];

    const { result } = renderHook(() => useSLA(issues, undefined));

    expect(result.current.size).toBe(0);
  });

  it('returns empty map when issues array is empty', () => {
    const { result } = renderHook(() => useSLA([], mockSLAConfig));

    expect(result.current.size).toBe(0);
  });
});
