import { useState, useEffect, useRef } from 'react';
import { Issue, SLAConfig, TimerInfo } from '@camtom/shared';
import { computeTimerInfo } from '../utils/sla';

interface SLAState {
  timers: Map<string, TimerInfo>; // issueId → single TimerInfo
}

export function useSLA(issues: Issue[], slas: SLAConfig[] | undefined) {
  const [state, setState] = useState<SLAState>({ timers: new Map() });
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!slas || slas.length === 0) return;

    // Find the first timer config (we only support one timer)
    const timerConfig = slas[0];
    if (!timerConfig) return;

    const computeTimers = () => {
      const timers = new Map<string, TimerInfo>();

      for (const issue of issues) {
        // Only show timer when the issue has the "ticket" label
        const hasTicketLabel = issue.labels?.nodes?.some(
          (l) => l.name === 'ticket',
        ) ?? false;
        if (!hasTicketLabel) continue;

        // Anchor: labelTimestamps sent by the server → stored in assignedAt
        const anchor = issue.assignedAt ?? issue.createdAt;
        const timerInfo = computeTimerInfo(anchor, {
          id: timerConfig.id,
          maxMinutes: timerConfig.maxMinutes,
          warningThresholds: timerConfig.warningThresholds,
        });
        timers.set(issue.id, timerInfo);
      }

      setState((prevState) => {
        // Only update if timers actually changed (avoid re-renders)
        const prevKeys = Array.from(prevState.timers.keys()).sort().join(',');
        const nextKeys = Array.from(timers.keys()).sort().join(',');
        if (prevKeys !== nextKeys) return { timers };

        // Check if any TimerInfo actually changed
        for (const [id, info] of timers) {
          const prevTimer = prevState.timers.get(id);
          if (!prevTimer || prevTimer.state !== info.state || prevTimer.remaining !== info.remaining) {
            return { timers };
          }
        }
        return prevState; // No changes — skip re-render
      });
    };

    // Compute immediately
    computeTimers();

    // Recompute every second
    tickRef.current = setInterval(computeTimers, 1000);

    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
      }
    };
  }, [issues, slas]);

  return state.timers;
}
