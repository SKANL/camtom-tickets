import { useEffect, useState } from 'react';
import { Issue, SLAConfig, TeamDashboardSettings, TimerInfo } from '@camtom/shared';
import { computeTimerInfo } from '../utils/sla';

export function useTeamSLA(
  issues: Issue[],
  settingsByTeam: Record<string, TeamDashboardSettings>,
): Map<string, TimerInfo> {
  const [timers, setTimers] = useState<Map<string, TimerInfo>>(new Map());

  useEffect(() => {
    const compute = () => {
      const next = new Map<string, TimerInfo>();
      for (const issue of issues) {
        const teamId = issue.team?.id;
        const settings = teamId ? settingsByTeam[teamId] : undefined;
        const sla = settings?.timer ? selectSlaForIssue(issue, settings.slas) : undefined;
        if (!sla) continue;
        next.set(issue.id, computeTimerInfo(issue.assignedAt ?? issue.createdAt, {
          id: sla.id,
          maxMinutes: sla.maxMinutes,
          warningThresholds: sla.warningThresholds,
        }));
      }
      setTimers((current) => sameTimers(current, next) ? current : next);
    };
    compute();
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [issues, settingsByTeam]);

  return timers;
}

/** Config order is the explicit tie-breaker when more than one rule matches. */
export function selectSlaForIssue(issue: Issue, slas: readonly SLAConfig[]): SLAConfig | undefined {
  return slas.find((sla) => sla.applicablePriorities.includes(issue.priority));
}

function sameTimers(left: Map<string, TimerInfo>, right: Map<string, TimerInfo>): boolean {
  if (left.size !== right.size) return false;
  for (const [id, value] of right) {
    const existing = left.get(id);
    if (!existing || existing.state !== value.state || existing.remaining !== value.remaining) return false;
  }
  return true;
}
