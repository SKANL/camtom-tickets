import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the functions we're testing from the client utils
// We test the same logic that the client-side timer uses
import {
  computeDeadline,
  getTimerState,
  formatRemaining,
  computeSLAInfo,
  findApplicableSLA,
} from '../../../client/src/utils/sla';

describe('computeDeadline', () => {
  it('computes deadline from createdAt and maxMinutes', () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    const createdMs = new Date(createdAt).getTime();
    const deadline = computeDeadline(createdAt, 5);
    expect(deadline).toBe(createdMs + 5 * 60 * 1000);
  });

  it('clamps future createdAt to now', () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const deadline = computeDeadline(futureDate, 5);
    const now = Date.now();
    // Deadline should be now + 5min, not future + 5min
    expect(deadline).toBeGreaterThanOrEqual(now + 5 * 60 * 1000 - 100);
    expect(deadline).toBeLessThanOrEqual(now + 5 * 60 * 1000 + 100);
  });
});

describe('getTimerState', () => {
  it('returns OK when remaining > warningThreshold', () => {
    const state = getTimerState(240_000, 5, 0.2); // 4 min remaining out of 5 min (80% > 20%)
    expect(state).toBe('OK');
  });

  it('returns WARNING when remaining <= warningThreshold', () => {
    const state = getTimerState(50_000, 5, 0.2); // 50s remaining out of 300s (16.7% < 20%)
    expect(state).toBe('WARNING');
  });

  it('returns BREACHED when remaining is 0', () => {
    const state = getTimerState(0, 5, 0.2);
    expect(state).toBe('BREACHED');
  });

  it('returns BREACHED when remaining is negative', () => {
    const state = getTimerState(-1000, 5, 0.2);
    expect(state).toBe('BREACHED');
  });

  it('returns WARNING at exact threshold boundary', () => {
    // 20% of 5 minutes = 60s = 60000ms
    const state = getTimerState(60_000, 5, 0.2);
    expect(state).toBe('WARNING'); // because pct <= warningThreshold
  });

  it('returns OK just above threshold', () => {
    // 20.1% of 5 minutes = 60.3s = 60300ms
    const state = getTimerState(60_300, 5, 0.2);
    expect(state).toBe('OK');
  });
});

describe('formatRemaining', () => {
  it('formats positive remaining time as mm:ss', () => {
    expect(formatRemaining(125_000)).toBe('02:05'); // 2m 5s
  });

  it('formats zero as 00:00', () => {
    expect(formatRemaining(0)).toBe('00:00');
  });

  it('formats negative as 00:00', () => {
    expect(formatRemaining(-5000)).toBe('00:00');
  });

  it('pads single digit minutes and seconds', () => {
    expect(formatRemaining(63_000)).toBe('01:03');
  });

  it('handles exactly one minute', () => {
    expect(formatRemaining(60_000)).toBe('01:00');
  });
});

describe('computeSLAInfo', () => {
  it('returns correct TimerInfo for an issue within SLA', () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    const info = computeSLAInfo(createdAt, 5, 0.2, 'test_sla');

    expect(info.slaId).toBe('test_sla');
    expect(info.remaining).toBeGreaterThan(0);
    expect(info.remaining).toBeLessThan(5 * 60 * 1000);
    expect(info.state).toBe('OK');
  });

  it('returns BREACHED for an overdue issue', () => {
    const createdAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const info = computeSLAInfo(createdAt, 5, 0.2, 'test_sla');

    expect(info.state).toBe('BREACHED');
    expect(info.remaining).toBe(0);
  });
});

describe('findApplicableSLA', () => {
  const slas = [
    { id: 'sla1', label: 'SLA 1', applicablePriorities: [1, 2], maxMinutes: 5, warningThreshold: 0.2 },
    { id: 'sla2', label: 'SLA 2', applicablePriorities: [1, 2, 3], maxMinutes: 10, warningThreshold: 0.2 },
  ];

  it('finds applicable SLA for priority 1', () => {
    const result = findApplicableSLA(slas, 1);
    expect(result).toBeDefined();
    expect(result!.id).toBe('sla1'); // shortest maxMinutes
  });

  it('finds applicable SLA for priority 3', () => {
    const result = findApplicableSLA(slas, 3);
    expect(result).toBeDefined();
    expect(result!.id).toBe('sla2');
  });

  it('returns undefined for priority with no matching SLA', () => {
    const result = findApplicableSLA(slas, 4);
    expect(result).toBeUndefined();
  });

  it('returns the shortest maxMinutes when multiple SLAs match', () => {
    const result = findApplicableSLA(slas, 1);
    expect(result!.maxMinutes).toBe(5);
  });
});
