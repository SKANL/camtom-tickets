import { Issue, TimerState } from '@camtom/shared';

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
