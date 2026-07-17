import { ConfigResponse, Issue } from '@camtom/shared';

/** Normalize the configured Linear team allowlist. Empty means fail closed. */
export function configuredTeamIds(config: ConfigResponse): string[] {
  const teams = (config.dashboard as { teams?: unknown } | null)?.teams;
  if (!Array.isArray(teams)) return [];
  const ids: string[] = [];
  for (const team of teams) {
    if (!team || typeof team !== 'object') return [];
    const id = (team as { id?: unknown }).id;
    if (typeof id !== 'string' || !id.trim()) return [];
    const normalized = id.trim();
    if (ids.includes(normalized)) return [];
    ids.push(normalized);
  }
  return ids.sort();
}

export function isIssueInConfiguredScope(issue: Pick<Issue, 'team'>, teamIds: readonly string[]): boolean {
  return typeof issue.team?.id === 'string' && teamIds.includes(issue.team.id);
}
