import { describe, it, expect } from 'vitest';
import { TimerState } from '@camtom/shared';

// Import the functions we're testing from the client utils
import {
  computeDeadline,
  getTimerState,
  formatRemaining,
  computeTimerInfo,
} from '../../../client/src/utils/sla';
import type { SLAWarningThresholds } from '@camtom/shared';

const defaultThresholds: SLAWarningThresholds = { warming: 0.6, heating: 0.3, critical: 0.1 };

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
  it('returns FRESH when remaining > warmingThreshold', () => {
    const state = getTimerState(290_000, 5, defaultThresholds); // 290/300 = 96.7% > 60%
    expect(state).toBe('FRESH');
  });

  it('returns WARMING when remaining <= warming but > heating', () => {
    const state = getTimerState(150_000, 5, defaultThresholds); // 150/300 = 50% (between 30% and 60%)
    expect(state).toBe('WARMING');
  });

  it('returns HEATING when remaining <= heating but > critical', () => {
    const state = getTimerState(60_000, 5, defaultThresholds); // 60/300 = 20% (between 10% and 30%)
    expect(state).toBe('HEATING');
  });

  it('returns CRITICAL when remaining <= critical', () => {
    const state = getTimerState(15_000, 5, defaultThresholds); // 15/300 = 5% ≤ 10%
    expect(state).toBe('CRITICAL');
  });

  it('returns EXPIRED when remaining is 0', () => {
    const state = getTimerState(0, 5, defaultThresholds);
    expect(state).toBe('EXPIRED');
  });

  it('returns EXPIRED when remaining is negative', () => {
    const state = getTimerState(-1000, 5, defaultThresholds);
    expect(state).toBe('EXPIRED');
  });

  it('returns WARMING at exact warming boundary', () => {
    // 60% of 5 minutes = 180s = 180000ms
    const state = getTimerState(180_000, 5, defaultThresholds);
    expect(state).toBe('WARMING');
  });

  it('returns FRESH just above warming boundary', () => {
    const state = getTimerState(180_100, 5, defaultThresholds);
    expect(state).toBe('FRESH');
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

describe('computeTimerInfo', () => {
  it('returns correct TimerInfo for an issue within SLA', () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    const info = computeTimerInfo(createdAt, {
      id: 'test_sla',
      maxMinutes: 5,
      warningThresholds: defaultThresholds,
    });

    expect(info.slaId).toBe('test_sla');
    expect(info.remaining).toBeGreaterThan(0);
    expect(info.remaining).toBeLessThan(5 * 60 * 1000);
    expect(info.state).toBe('FRESH');
  });

  it('returns EXPIRED for an overdue issue', () => {
    const createdAt = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const info = computeTimerInfo(createdAt, {
      id: 'test_sla',
      maxMinutes: 5,
      warningThresholds: defaultThresholds,
    });

    expect(info.state).toBe('EXPIRED');
    expect(info.remaining).toBe(0);
  });
});
