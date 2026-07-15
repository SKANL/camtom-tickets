import { describe, it, expect } from 'vitest';
import { zoneForIssue, timerColor, isToday, hasTicketLabel } from '../board';
import { Issue } from '@camtom/shared';

function issueWith(stateType: string, extra: Partial<Issue> = {}): Issue {
  return {
    id: 'x',
    identifier: 'CAM-1',
    title: 't',
    priority: 0,
    priorityLabel: 'No Priority',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: { id: 's', name: stateType, type: stateType },
    ...extra,
  };
}

describe('zoneForIssue', () => {
  it('routes started → active', () => {
    expect(zoneForIssue(issueWith('started'))).toBe('active');
  });
  it('routes completed → done', () => {
    expect(zoneForIssue(issueWith('completed'))).toBe('done');
  });
  it('routes canceled → hidden', () => {
    expect(zoneForIssue(issueWith('canceled'))).toBe('hidden');
  });
  it('routes backlog/unstarted/triaged/unknown → new (hero)', () => {
    for (const t of ['backlog', 'unstarted', 'triaged', 'weird']) {
      expect(zoneForIssue(issueWith(t))).toBe('new');
    }
  });
});

describe('timerColor', () => {
  it('collapses 5 states into 3 colours', () => {
    expect(timerColor('FRESH')).toBe('green');
    expect(timerColor('WARMING')).toBe('green');
    expect(timerColor('HEATING')).toBe('amber');
    expect(timerColor('CRITICAL')).toBe('red');
    expect(timerColor('EXPIRED')).toBe('red');
  });
});

describe('isToday', () => {
  const now = new Date('2026-07-15T12:00:00.000Z').getTime();
  it('true for same calendar day', () => {
    expect(isToday('2026-07-15T09:30:00.000Z', now)).toBe(true);
  });
  it('false for a different day', () => {
    expect(isToday('2026-07-14T23:59:00.000Z', now)).toBe(false);
  });
  it('false for missing timestamp', () => {
    expect(isToday(undefined, now)).toBe(false);
    expect(isToday(null, now)).toBe(false);
  });
});

describe('hasTicketLabel', () => {
  it('detects the ticket label', () => {
    expect(hasTicketLabel(issueWith('started', { labels: { nodes: [{ id: 'l', name: 'ticket' }] } }))).toBe(true);
  });
  it('false without it', () => {
    expect(hasTicketLabel(issueWith('started'))).toBe(false);
    expect(hasTicketLabel(issueWith('started', { labels: { nodes: [{ id: 'l', name: 'bug' }] } }))).toBe(false);
  });
});
