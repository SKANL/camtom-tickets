import { describe, expect, it } from 'vitest';
import { Issue, SLAConfig } from '@camtom/shared';
import { selectSlaForIssue } from '../useTeamSLA';

const rules: SLAConfig[] = [
  { id: 'low', label: 'Low', applicablePriorities: [4], maxMinutes: 120, warningThresholds: { warming: .6, heating: .3, critical: .1 } },
  { id: 'urgent', label: 'Urgent', applicablePriorities: [1], maxMinutes: 10, warningThresholds: { warming: .6, heating: .3, critical: .1 } },
  { id: 'fallback', label: 'Fallback', applicablePriorities: [0, 1, 2, 3, 4], maxMinutes: 30, warningThresholds: { warming: .6, heating: .3, critical: .1 } },
];

function issue(priority: Issue['priority']): Issue {
  return {
    id: 'one', identifier: 'ONE', title: 'One', priority, priorityLabel: 'Priority',
    createdAt: '2026-07-16T10:00:00.000Z', updatedAt: '2026-07-16T10:00:00.000Z',
    state: { id: 'open', name: 'Open', type: 'started' }, team: { id: 'a', name: 'A' },
  };
}

describe('team SLA rule selection', () => {
  it('selects the first configured rule whose applicable priorities contain the issue priority', () => {
    expect(selectSlaForIssue(issue(1), rules)?.id).toBe('urgent');
    expect(selectSlaForIssue(issue(4), rules)?.id).toBe('low');
    expect(selectSlaForIssue(issue(3), rules)?.id).toBe('fallback');
  });

  it('returns no timer rule when no priority matches', () => {
    expect(selectSlaForIssue(issue(2), rules.slice(0, 2))).toBeUndefined();
  });
});
