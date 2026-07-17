import { describe, expect, it } from 'vitest';
import { ConfigResponse, Issue } from '@camtom/shared';
import { configuredTeamIds, isIssueInConfiguredScope } from '../team-scope';

function config(ids: string[]): ConfigResponse {
  return {
    version: 'test',
    slas: [],
    dashboard: {
      pollingInterval: 30_000,
      title: 'Test', teamMembers: [], displayOrder: [], priorityLabels: {}, stateLabels: {},
      report: { slaWindowHours: 24, enabled: true },
      kitchenPhrases: { emptyState: '', warningTimer: '', breachedTimer: '' },
      teams: ids.map((id) => ({ id, name: id, filter: 'active-states', timer: true })),
    },
  };
}

describe('configured team scope', () => {
  it('normalizes and sorts valid configured IDs', () => {
    expect(configuredTeamIds(config([' team-b ', 'team-a']))).toEqual(['team-a', 'team-b']);
  });

  it('fails closed for duplicate, empty, or malformed teams', () => {
    expect(configuredTeamIds(config(['team-a', ' team-a ']))).toEqual([]);
    expect(configuredTeamIds(config(['']))).toEqual([]);
    expect(configuredTeamIds({ ...config([]), dashboard: { ...config([]).dashboard, teams: [{}] } } as any)).toEqual([]);
  });

  it('fails closed for missing teams and accepts only the allowlist', () => {
    expect(isIssueInConfiguredScope({ team: null }, [])).toBe(false);
    expect(isIssueInConfiguredScope({ team: { id: 'team-a', name: 'A' } } as Pick<Issue, 'team'>, ['team-a'])).toBe(true);
    expect(isIssueInConfiguredScope({ team: { id: 'team-b', name: 'B' } } as Pick<Issue, 'team'>, ['team-a'])).toBe(false);
  });
});
