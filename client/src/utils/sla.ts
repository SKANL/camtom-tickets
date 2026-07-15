import { TimerState, TimerInfo, SLAWarningThresholds } from '@camtom/shared';

/**
 * Compute countdown deadline from the anchor timestamp + maxMinutes.
 * Clamps future anchors to now (never show negative elapsed).
 */
export function computeDeadline(anchor: string, maxMinutes: number): number {
  const anchorTime = new Date(anchor).getTime();
  const now = Date.now();
  const clamped = anchorTime > now ? now : anchorTime;
  return clamped + maxMinutes * 60_000;
}

/**
 * Determine the timer state based on remaining time and threshold tiers.
 *
 * States:
 *   FRESH    >  warming%  (–)  green, calm
 *   WARMING  >  heating%       amber, subtle pulse
 *   HEATING  >  critical%      orange, stronger pulse
 *   CRITICAL ≤  critical%      red, shake + warning sound
 *   EXPIRED  ≤  0              deep red, breach, dramatic
 */
export function getTimerState(
  remaining: number,
  maxMinutes: number,
  thresholds: SLAWarningThresholds,
): TimerState {
  if (remaining <= 0) return 'EXPIRED';
  const pct = remaining / (maxMinutes * 60_000);
  if (pct <= thresholds.critical) return 'CRITICAL';
  if (pct <= thresholds.heating) return 'HEATING';
  if (pct <= thresholds.warming) return 'WARMING';
  return 'FRESH';
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
 * Compute the single timer info for a ticket.
 */
export function computeTimerInfo(
  anchor: string,
  timerConfig: {
    id: string;
    maxMinutes: number;
    warningThresholds: SLAWarningThresholds;
  },
): TimerInfo {
  const deadline = computeDeadline(anchor, timerConfig.maxMinutes);
  const remaining = Math.max(0, deadline - Date.now());
  const state = getTimerState(remaining, timerConfig.maxMinutes, timerConfig.warningThresholds);
  return {
    deadline,
    remaining,
    state,
    slaId: timerConfig.id,
    maxMinutes: timerConfig.maxMinutes,
  };
}
