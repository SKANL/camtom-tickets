import { beforeEach, describe, expect, it } from 'vitest';
import { Issue, TimerInfo, createConfigV2 } from '@camtom/shared';
import {
  buildAlertSnapshot,
  diffAlerts,
  emptyAlertMemory,
  loadAlertMemory,
  saveAlertMemory,
} from '../alerts';
import { configFixture } from '../../test/config-fixture';

function issue(id: string, teamId: string, stateType: string, updatedAt: string): Issue {
  return {
    id,
    identifier: id.toUpperCase(),
    title: id,
    priority: 1,
    priorityLabel: 'Urgent',
    createdAt: '2026-07-16T10:00:00.000Z',
    updatedAt,
    state: { id: stateType, name: stateType, type: stateType },
    team: { id: teamId, name: teamId },
    ...(stateType === 'completed' ? { completedAt: new Date().toISOString() } : {}),
  };
}

describe('split alert coordination', () => {
  beforeEach(() => localStorage.clear());

  it('deduplicates the same team and ticket across two panes', () => {
    const settings = createConfigV2(configFixture()).teams;
    const current = issue('one', 'a', 'unstarted', '2026-07-16T10:01:00.000Z');
    const timers = new Map<string, TimerInfo>([['one', {
      deadline: 0, remaining: 0, state: 'CRITICAL', slaId: 'timer', maxMinutes: 30,
    }]]);
    const memory = diffAlerts(emptyAlertMemory(), buildAlertSnapshot([], settings, new Map()), ['a', 'a']).next;
    const actions = diffAlerts(memory, buildAlertSnapshot([current], settings, timers), ['a', 'a']);
    expect(actions.arrival).toBe(true);
    expect(actions.warning).toBe(false); // New issues establish their timer baseline; no double sound.
    const repeated = diffAlerts(actions.next, buildAlertSnapshot([current], settings, timers), ['a', 'a']);
    expect(repeated.arrival).toBe(false);
    expect(repeated.warning).toBe(false);
  });

  it('persists a hidden-team transition and emits it once when that pane becomes visible', () => {
    const settings = createConfigV2(configFixture()).teams;
    const open = issue('hidden', 'a', 'started', '2026-07-16T10:00:00.000Z');
    const urgent = issue('hidden', 'a', 'unstarted', '2026-07-16T10:01:00.000Z');
    const baseline = diffAlerts(emptyAlertMemory(), buildAlertSnapshot([open], settings, new Map()), ['b']).next;
    const hidden = diffAlerts(baseline, buildAlertSnapshot([urgent], settings, new Map()), ['b']);
    expect(hidden.arrival).toBe(false);
    expect(hidden.next.pending).toHaveLength(1);

    saveAlertMemory(hidden.next);
    const afterReload = loadAlertMemory();
    const shown = diffAlerts(afterReload, buildAlertSnapshot([urgent], settings, new Map()), ['a']);
    expect(shown.arrival).toBe(true);
    expect(shown.next.pending).toHaveLength(0);
    expect(diffAlerts(shown.next, buildAlertSnapshot([urgent], settings, new Map()), ['a']).arrival).toBe(false);
  });

  it('detects a genuine newer completion after reload', () => {
    const settings = createConfigV2(configFixture()).teams;
    const open = issue('reload', 'a', 'started', '2026-07-16T10:00:00.000Z');
    const baseline = diffAlerts(emptyAlertMemory(), buildAlertSnapshot([open], settings, new Map()), ['a']).next;
    saveAlertMemory(baseline);
    const completed = issue('reload', 'a', 'completed', '2026-07-16T10:02:00.000Z');
    expect(diffAlerts(loadAlertMemory(), buildAlertSnapshot([completed], settings, new Map()), ['a']).success).toBe(true);
  });

  it('isolates persisted alert baselines by device and allowlist scope', () => {
    const memory = { ...emptyAlertMemory(), initialized: true };
    saveAlertMemory(memory, 'screen:device-a:team-a');

    expect(loadAlertMemory('screen:device-a:team-a').initialized).toBe(true);
    expect(loadAlertMemory('screen:device-a:team-b').initialized).toBe(false);
    expect(loadAlertMemory('screen:device-b:team-a').initialized).toBe(false);
  });

  it('preserves persisted timer state while the timer hook rehydrates after reload', () => {
    const settings = createConfigV2(configFixture()).teams;
    const current = issue('timer', 'a', 'started', '2026-07-16T10:00:00.000Z');
    const critical = new Map<string, TimerInfo>([['timer', {
      deadline: 100, remaining: 10, state: 'CRITICAL', slaId: 'timer', maxMinutes: 30,
    }]]);
    const expired = new Map<string, TimerInfo>([['timer', {
      deadline: 100, remaining: 0, state: 'EXPIRED', slaId: 'timer', maxMinutes: 30,
    }]]);
    const baseline = diffAlerts(
      emptyAlertMemory(), buildAlertSnapshot([current], settings, critical), ['a'],
    ).next;
    saveAlertMemory(baseline);

    const loading = diffAlerts(loadAlertMemory(), buildAlertSnapshot([current], settings, new Map()), ['a']);
    expect(loading.warning).toBe(false);
    expect(loading.next.issues.timer.timerState).toBe('CRITICAL');
    const hydrated = diffAlerts(loading.next, buildAlertSnapshot([current], settings, critical), ['a']);
    expect(hydrated.warning).toBe(false);
    expect(diffAlerts(hydrated.next, buildAlertSnapshot([current], settings, expired), ['a']).breach).toBe(true);
  });

  it('retains every active baseline beyond the old 500-entry limit without repeat arrivals', () => {
    const settings = createConfigV2(configFixture()).teams;
    const issues = Array.from({ length: 650 }, (_, index) => issue(
      `ticket-${index}`, 'a', 'unstarted', `2026-07-16T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
    ));
    const baseline = diffAlerts(emptyAlertMemory(), buildAlertSnapshot([], settings, new Map()), ['a']).next;
    const first = diffAlerts(baseline, buildAlertSnapshot(issues, settings, new Map()), ['a']);
    expect(first.arrival).toBe(true);
    expect(Object.keys(first.next.issues)).toHaveLength(650);
    expect(diffAlerts(first.next, buildAlertSnapshot(issues, settings, new Map()), ['a']).arrival).toBe(false);
  });
});
