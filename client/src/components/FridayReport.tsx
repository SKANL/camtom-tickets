import React, { useEffect, useMemo } from 'react';
import { Issue, ConfigResponse } from '@camtom/shared';
import { IconChart, IconFire, IconFlash, IconClipboard, IconCheck, IconChefHat } from './Icons';

interface FridayReportProps {
  issues: Issue[];
  playSuccess: () => void;
  config?: ConfigResponse | null;
}

interface TeamMemberStats {
  name: string;
  resolved: number;
  breaches: number;
}

export function FridayReport({ issues, playSuccess, config }: FridayReportProps) {
  const TEAM_MEMBERS = config?.dashboard?.teamMembers ?? ['Román', 'Pedro', 'Lucía', 'Carlos', 'Ana'];
  // Play success sound on mount
  useEffect(() => {
    playSuccess();
  }, [playSuccess]);

  const { metrics, teamStats } = useMemo(() => {
    // Consider issues in "completed" state as resolved
    const resolvedIssues = issues.filter((i) => i.state.type === 'completed');

    // Calculate weekly date range (last 7 days)
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyResolved = resolvedIssues.filter(
      (i) => new Date(i.updatedAt).getTime() > oneWeekAgo,
    );

    // Priority breakdown of weekly resolved
    const priorityBreakdown = {
      urgent: weeklyResolved.filter((i) => i.priority === 1).length,
      high: weeklyResolved.filter((i) => i.priority === 2).length,
      medium: weeklyResolved.filter((i) => i.priority === 3).length,
      low: weeklyResolved.filter((i) => i.priority === 4 || i.priority === 0).length,
    };

    // Compute SLA compliance from actual timestamps
    // An issue is SLA compliant if completed (updatedAt) within 24h of creation
    const slaWindowHours = config?.dashboard?.report?.slaWindowHours ?? 24;
    const SLA_WINDOW_MS = slaWindowHours * 60 * 60 * 1000;
    let slaCompliant = 0;
    let totalResolutionMs = 0;

    const assigneeMap = new Map<string, { resolved: number; breaches: number }>();

    // Initialize all team members
    for (const name of TEAM_MEMBERS) {
      assigneeMap.set(name, { resolved: 0, breaches: 0 });
    }
    assigneeMap.set('Unassigned', { resolved: 0, breaches: 0 });

    for (const issue of weeklyResolved) {
      const created = new Date(issue.createdAt).getTime();
      const updated = new Date(issue.updatedAt).getTime();
      const resolutionTime = Math.max(0, updated - created);
      const isCompliant = resolutionTime <= SLA_WINDOW_MS;

      if (isCompliant) slaCompliant++;
      totalResolutionMs += resolutionTime;

      const name = issue.assignee?.name || 'Unassigned';
      const stats = assigneeMap.get(name);
      if (stats) {
        stats.resolved += 1;
        if (!isCompliant) stats.breaches += 1;
      } else {
        assigneeMap.set(name, { resolved: 1, breaches: isCompliant ? 0 : 1 });
      }
    }

    const totalResolved = weeklyResolved.length;
    const slaRate = totalResolved > 0 ? Math.round((slaCompliant / totalResolved) * 100) : null;
    const avgMinutes = totalResolved > 0 ? Math.round(totalResolutionMs / totalResolved / 60000) : 0;
    const avgTime = totalResolved > 0
      ? `${Math.floor(avgMinutes / 60)}h ${avgMinutes % 60}m`
      : 'N/A';

    const teamStats: TeamMemberStats[] = Array.from(assigneeMap.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.resolved - a.resolved);

    return {
      metrics: {
        totalResolved,
        slaRate,
        avgTime,
        priorityBreakdown,
      },
      teamStats,
    };
  }, [issues, config]);

  const { totalResolved, slaRate, avgTime, priorityBreakdown } = metrics;

  return (
    <div
      style={{
        flex: 1,
        padding: 'var(--space-xl)',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-xl)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-4xl)',
            color: 'var(--color-mustard)',
            letterSpacing: '0.05em',
            textShadow: '2px 2px 0 rgba(0,0,0,0.3)',
          }}
        >
          <IconChart size={32} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Friday Report
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            color: 'rgba(255,255,255,0.5)',
            fontSize: 'var(--text-sm)',
          }}
        >
          Weekly Resolution Summary
        </p>
      </div>

      {/* Metric cards row */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-lg)',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}
      >
        <MetricCard label="Resolved" value={String(totalResolved)} color="var(--color-lettuce)" />
        <MetricCard
          label="SLA Compliance"
          value={slaRate !== null ? `${slaRate}%` : 'N/A'}
          color={slaRate !== null && slaRate >= 80 ? 'var(--color-lettuce)' : 'var(--color-oil)'}
        />
        <MetricCard label="Avg Resolution" value={avgTime} color="var(--color-oil)" />
      </div>

      {/* Priority breakdown */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-card)',
          padding: 'var(--space-lg)',
          border: '2px dashed rgba(255,255,255,0.1)',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-xl)',
            color: 'var(--color-mayo)',
            marginBottom: 'var(--space-md)',
          }}
        >
          By Priority
        </h3>
        <div style={{ display: 'flex', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
          <PriorityStat icon={<IconFire size={20} />} label="Urgent" value={priorityBreakdown.urgent} color="var(--priority-urgent)" />
          <PriorityStat icon={<IconFlash size={20} />} label="High" value={priorityBreakdown.high} color="var(--priority-high)" />
          <PriorityStat icon={<IconClipboard size={20} />} label="Medium" value={priorityBreakdown.medium} color="var(--priority-medium)" />
          <PriorityStat icon={<IconCheck size={20} />} label="Low/None" value={priorityBreakdown.low} color="var(--priority-low)" />
        </div>
      </div>

      {/* Team table */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-card)',
          padding: 'var(--space-lg)',
          border: '2px dashed rgba(255,255,255,0.1)',
        }}
      >
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-xl)',
            color: 'var(--color-mayo)',
            marginBottom: 'var(--space-md)',
          }}
        >
          <IconChefHat size={24} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Team Performance
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr',
            gap: 'var(--space-sm)',
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-base)',
          }}
        >
          {/* Header */}
          <div style={{ fontWeight: 700, color: 'var(--color-mustard)', borderBottom: '2px solid rgba(255,255,255,0.2)', paddingBottom: 'var(--space-sm)' }}>
            Chef
          </div>
          <div style={{ fontWeight: 700, color: 'var(--color-mustard)', textAlign: 'center', borderBottom: '2px solid rgba(255,255,255,0.2)', paddingBottom: 'var(--space-sm)' }}>
            Resolved
          </div>
          <div style={{ fontWeight: 700, color: 'var(--color-mustard)', textAlign: 'center', borderBottom: '2px solid rgba(255,255,255,0.2)', paddingBottom: 'var(--space-sm)' }}>
            Breaches
          </div>

          {/* Rows */}
          {teamStats.map((member) => (
            <React.Fragment key={member.name}>
              <div
                style={{
                  padding: 'var(--space-sm) 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  color: member.name === 'Unassigned' ? 'rgba(255,255,255,0.4)' : 'var(--color-mayo)',
                }}
              >
                {member.name}
              </div>
              <div
                style={{
                  padding: 'var(--space-sm) 0',
                  textAlign: 'center',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  color: member.resolved > 0 ? 'var(--color-lettuce)' : 'rgba(255,255,255,0.4)',
                }}
              >
                {member.resolved}
              </div>
              <div
                style={{
                  padding: 'var(--space-sm) 0',
                  textAlign: 'center',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  color: member.breaches > 0 ? 'var(--color-ketchup)' : 'rgba(255,255,255,0.4)',
                }}
              >
                {member.breaches}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-card)',
        padding: 'var(--space-lg) var(--space-xl)',
        minWidth: 180,
        textAlign: 'center',
        border: `2px dashed ${color}`,
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-3xl)',
          color,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-sm)',
          color: 'rgba(255,255,255,0.6)',
          marginTop: 'var(--space-xs)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function PriorityStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {icon}
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', color }}>
        {value}
      </span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)' }}>{label}</span>
    </div>
  );
}
