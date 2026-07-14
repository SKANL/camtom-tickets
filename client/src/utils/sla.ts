import { TimerState, TimerInfo } from '@camtom/shared';

/**
 * Compute SLA deadline from createdAt and maxMinutes.
 * Future createdAt is clamped to now (never show negative elapsed).
 */
export function computeDeadline(createdAt: string, maxMinutes: number): number {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const clampedCreated = created > now ? now : created;
  return clampedCreated + maxMinutes * 60_000;
}

/**
 * Determine timer state based on remaining time and warning threshold.
 */
export function getTimerState(remaining: number, maxMinutes: number, warningThreshold: number): TimerState {
  if (remaining <= 0) return 'BREACHED';
  const pct = remaining / (maxMinutes * 60_000);
  if (pct <= warningThreshold) return 'WARNING';
  return 'OK';
}

/**
 * Format remaining milliseconds as mm:ss.
 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Compute full SLA timer info for a single ticket.
 */
export function computeSLAInfo(
  createdAt: string,
  maxMinutes: number,
  warningThreshold: number,
  slaId: string,
): TimerInfo {
  const deadline = computeDeadline(createdAt, maxMinutes);
  const remaining = Math.max(0, deadline - Date.now());
  const state = getTimerState(remaining, maxMinutes, warningThreshold);

  return { deadline, remaining, state, slaId, maxMinutes };
}

/**
 * Find the applicable SLA config for a given priority.
 */
export function findApplicableSLA(
  slas: { id: string; label: string; applicablePriorities: number[]; maxMinutes: number; warningThreshold: number }[],
  priority: number,
): { id: string; label: string; maxMinutes: number; warningThreshold: number } | undefined {
  // Find the SLA with the shortest maxMinutes that applies to this priority
  const applicable = slas
    .filter((sla) => sla.applicablePriorities.includes(priority))
    .sort((a, b) => a.maxMinutes - b.maxMinutes);

  return applicable.length > 0
    ? { id: applicable[0].id, label: applicable[0].label, maxMinutes: applicable[0].maxMinutes, warningThreshold: applicable[0].warningThreshold }
    : undefined;
}

/**
 * Find ALL applicable SLA configs for a given priority (for multi-SLA display).
 */
/**
 * Compute SLA info for ALL applicable SLA definitions for an issue.
 * Returns an array of TimerInfo, one per applicable SLA.
 */
export function computeMultiSLAInfo(
  createdAt: string,
  applicableSLAs: { id: string; label: string; maxMinutes: number; warningThreshold: number }[],
): TimerInfo[] {
  return applicableSLAs.map((sla) => computeSLAInfo(createdAt, sla.maxMinutes, sla.warningThreshold, sla.id));
}

export function findAllApplicableSLAs(
  slas: { id: string; label: string; applicablePriorities: number[]; maxMinutes: number; warningThreshold: number }[],
  priority: number,
): { id: string; label: string; maxMinutes: number; warningThreshold: number }[] {
  return slas
    .filter((sla) => sla.applicablePriorities.includes(priority))
    .map((sla) => ({
      id: sla.id,
      label: sla.label,
      maxMinutes: sla.maxMinutes,
      warningThreshold: sla.warningThreshold,
    }))
    .sort((a, b) => a.maxMinutes - b.maxMinutes);
}
