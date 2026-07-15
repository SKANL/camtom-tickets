import { Issue, TimerState, TeamBoardConfig } from '@camtom/shared';

/** The three board zones, ordered by prominence. */
export type Zone = 'new' | 'active' | 'done' | 'hidden';

/**
 * Which zone an issue belongs to, based on its Linear workflow state type.
 * Untaken work (backlog/unstarted/triaged/unknown) is the hero → 'new'.
 */
export function zoneForIssue(issue: Issue): Zone {
  switch (issue.state.type) {
    case 'started':
      return 'active';
    case 'completed':
      return 'done';
    case 'canceled':
      return 'hidden';
    default:
      // backlog, unstarted, triaged, or anything unrecognised → untaken
      return 'new';
  }
}

/** The 3-colour traffic light. Priority no longer drives colour — time pressure does. */
export type TimerColor = 'green' | 'amber' | 'red';

/** Collapse the 5 SLA timer states into a 3-colour traffic light. */
export function timerColor(state: TimerState): TimerColor {
  switch (state) {
    case 'FRESH':
    case 'WARMING':
      return 'green';
    case 'HEATING':
      return 'amber';
    case 'CRITICAL':
    case 'EXPIRED':
      return 'red';
  }
}

/** CSS custom property holding the resolved colour for a traffic-light state. */
export const TIMER_COLOR_VAR: Record<TimerColor, string> = {
  green: 'var(--sla-green)',
  amber: 'var(--sla-amber)',
  red: 'var(--sla-red)',
};

/** True when an ISO timestamp falls on the same local calendar day as `now`. */
export function isToday(iso: string | undefined | null, now: number = Date.now()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date(now);
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  );
}

/** True when an issue carries the "ticket" label (the support tickets we time). */
export function hasTicketLabel(issue: Issue): boolean {
  return issue.labels?.nodes?.some((l) => l.name === 'ticket') ?? false;
}

/**
 * Whether an issue belongs on the board for the given team, applying that
 * team's board-worthiness criterion. No team configured → show everything.
 */
export function matchesTeam(issue: Issue, team: TeamBoardConfig | undefined): boolean {
  if (!team) return true;
  if (issue.team?.id !== team.id) return false;
  if (team.filter === 'ticket-label') return hasTicketLabel(issue);
  return true; // 'active-states' → any issue of the team (zones handle done/canceled)
}

/** Resolve the active team from the dashboard config. */
export function activeTeamOf(
  teams: TeamBoardConfig[] | undefined,
  activeTeamId: string | undefined,
): TeamBoardConfig | undefined {
  if (!teams || teams.length === 0) return undefined;
  return teams.find((t) => t.id === activeTeamId) ?? teams[0];
}
