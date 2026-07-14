import { useState, useEffect, useRef } from 'react';
import { Issue, SLAConfig, TimerInfo } from '@camtom/shared';
import { findAllApplicableSLAs, computeMultiSLAInfo } from '../utils/sla';

interface SLAState {
  timers: Map<string, TimerInfo[]>; // issueId → array of TimerInfo (one per applicable SLA)
}

export function useSLA(issues: Issue[], slas: SLAConfig[] | undefined) {
  const [state, setState] = useState<SLAState>({ timers: new Map() });
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!slas || slas.length === 0) return;

    const computeTimers = () => {
      const timers = new Map<string, TimerInfo[]>();

      for (const issue of issues) {
        // No timer for unassigned tickets — SLA starts when someone picks it up
        if (!issue.assignee) continue;

        const applicableSLAs = findAllApplicableSLAs(slas, issue.priority);
        if (applicableSLAs.length === 0) continue;

        const anchor = issue.assignedAt ?? issue.createdAt;
        const timerInfos = computeMultiSLAInfo(anchor, applicableSLAs);
        timers.set(issue.id, timerInfos);
      }

      setState({ timers });
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
