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
    // Consider issues in "completed" state as resolved. Use the real completedAt
    // timestamp (falling back to updatedAt only if Linear never sent one) — updatedAt
    // bumps on any edit, so it would misdate resolutions and inflate resolution time.
    const resolvedAt = (i: Issue) => new Date(i.completedAt ?? i.updatedAt).getTime();
    const resolvedIssues = issues.filter((i) => i.state.type === 'completed');

    // Calculate weekly date range (last 7 days)
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyResolved = resolvedIssues.filter((i) => resolvedAt(i) > oneWeekAgo);

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
    assigneeMap.set('Sin asignar', { resolved: 0, breaches: 0 });

    for (const issue of weeklyResolved) {
      const created = new Date(issue.createdAt).getTime();
      const resolutionTime = Math.max(0, resolvedAt(issue) - created);
      const isCompliant = resolutionTime <= SLA_WINDOW_MS;

      if (isCompliant) slaCompliant++;
      totalResolutionMs += resolutionTime;

      const name = issue.assignee?.name || 'Sin asignar';
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
      : 'N/D';

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
    <div className="report-view">
      <header className="report-hero">
        <p className="report-kicker">PASE SEMANAL · ÚLTIMOS 7 DÍAS</p>
        <h1>
          <IconChart size={32} /> Reporte del viernes
        </h1>
        <p>Resumen semanal de resolución</p>
      </header>

      {/* Metric cards row */}
      <div className="report-metrics">
        <MetricCard label="Resueltos" value={String(totalResolved)} color="var(--color-lettuce)" />
        <MetricCard
          label="Cumplimiento SLA"
          value={slaRate !== null ? `${slaRate}%` : 'N/D'}
          color={slaRate !== null && slaRate >= 80 ? 'var(--color-lettuce)' : 'var(--color-oil)'}
        />
        <MetricCard label="Tiempo prom. de resolución" value={avgTime} color="var(--color-oil)" />
      </div>

      {/* Priority breakdown */}
      <section className="report-card report-priorities">
        <h3>Por prioridad</h3>
        <div className="report-priority-grid">
          <PriorityStat icon={<IconFire size={20} />} label="Urgente" value={priorityBreakdown.urgent} color="var(--priority-urgent)" />
          <PriorityStat icon={<IconFlash size={20} />} label="Alta" value={priorityBreakdown.high} color="var(--priority-high)" />
          <PriorityStat icon={<IconClipboard size={20} />} label="Media" value={priorityBreakdown.medium} color="var(--priority-medium)" />
          <PriorityStat icon={<IconCheck size={20} />} label="Baja/Sin" value={priorityBreakdown.low} color="var(--priority-low)" />
        </div>
      </section>

      {/* Team table */}
      <section className="report-card report-team">
        <h3><IconChefHat size={24} /> Rendimiento del equipo</h3>
        <div className="report-table-scroll">
          <table className="report-table" aria-label="Rendimiento del equipo">
            <thead>
              <tr>
                <th scope="col">Chef</th>
                <th scope="col">Resueltos</th>
                <th scope="col">Incumplimientos</th>
              </tr>
            </thead>
            <tbody>
              {teamStats.map((member) => (
                <tr key={member.name}>
                  <th scope="row" className={member.name === 'Sin asignar' ? 'is-muted' : ''}>{member.name}</th>
                  <td className={`report-table__number ${member.resolved > 0 ? 'is-success' : 'is-muted'}`}>{member.resolved}</td>
                  <td className={`report-table__number ${member.breaches > 0 ? 'is-danger' : 'is-muted'}`}>{member.breaches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <article className="report-metric" style={{ '--metric-color': color } as React.CSSProperties}>
      <div className="report-metric__value">
        {value}
      </div>
      <div className="report-metric__label">
        {label}
      </div>
    </article>
  );
}

function PriorityStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="report-priority" style={{ '--priority-color': color } as React.CSSProperties}>
      {icon}
      <span className="report-priority__value">
        {value}
      </span>
      <span className="report-priority__label">{label}</span>
    </div>
  );
}
