import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSLA } from '../useSLA';
import { Issue, SLAConfig } from '@camtom/shared';

const mockSLAConfig: SLAConfig[] = [
  { id: 'urgent_sla', label: 'Urgent SLA', applicablePriorities: [1], maxMinutes: 5, warningThreshold: 0.2 },
  { id: 'standard_sla', label: 'Standard SLA', applicablePriorities: [2, 3], maxMinutes: 10, warningThreshold: 0.2 },
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

  it('computes timer info for each issue', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 1 }),
      makeIssue({ id: '2', priority: 2 }),
    ];

    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    expect(result.current.size).toBe(2);
    expect(result.current.has('1')).toBe(true);
    expect(result.current.has('2')).toBe(true);
  });

  it('returns OK state for issues within SLA', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 1 }), // 1 min ago, 5min SLA -> remaining ~4min
    ];

    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    const timers = result.current.get('1');
    expect(timers).toBeDefined();
    expect(timers!.length).toBeGreaterThan(0);
    expect(timers![0].state).toBe('OK');
    expect(timers![0].remaining).toBeGreaterThan(0);
  });

  it('detects BREACHED state for overdue issues', () => {
    const overdueIssue = makeIssue({
      id: '1',
      priority: 1,
      createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago, 5min SLA
    });

    const issues: Issue[] = [overdueIssue];
    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    const timers = result.current.get('1');
    expect(timers).toBeDefined();
    expect(timers!.length).toBeGreaterThan(0);
    expect(timers![0].state).toBe('BREACHED');
    expect(timers![0].remaining).toBe(0);
  });

  it('updates remaining time on each tick', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 1, createdAt: new Date(Date.now() - 60_000).toISOString() }),
    ];

    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    const firstTimers = result.current.get('1');
    const firstRemaining = firstTimers![0].remaining;

    // Advance by 2 seconds
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const secondTimers = result.current.get('1');
    expect(secondTimers![0].remaining).toBeLessThan(firstRemaining);
  });

  it('handles issues with priority that has no matching SLA', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 0 }), // No priority — no SLA matches
    ];

    const { result } = renderHook(() => useSLA(issues, mockSLAConfig));

    expect(result.current.size).toBe(0);
  });

  it('returns empty map when no SLA config provided', () => {
    const issues: Issue[] = [makeIssue({ id: '1', priority: 1 })];

    const { result } = renderHook(() => useSLA(issues, undefined));

    expect(result.current.size).toBe(0);
  });

  it('returns empty map when issues array is empty', () => {
    const { result } = renderHook(() => useSLA([], mockSLAConfig));

    expect(result.current.size).toBe(0);
  });
});
