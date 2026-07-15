import React from 'react';
import { Issue, TimerInfo, ConfigResponse } from '@camtom/shared';
import { TicketCard } from './TicketCard';
import { IconForkKnife } from './Icons';
import { priorityGaugeColors } from '../lib/priorities';

interface PriorityGroupProps {
  label: string;
  icon: React.ReactNode;
  color: string;
  issues: Issue[];
  timers: Map<string, TimerInfo>;
  collapsed?: boolean;
  config?: ConfigResponse | null;
}

export function PriorityGroup({ label, icon, color, issues, timers, collapsed, config }: PriorityGroupProps) {
  if (collapsed && issues.length === 0) {
    return null;
  }

  return (
    <div className="order-column">
      {/* Temperature gauge strip */}
      <div
        style={{
          height: 4,
          borderRadius: '2px 2px 0 0',
          background: `linear-gradient(90deg, ${priorityGaugeColors[1]} 0%, ${priorityGaugeColors[2]} 25%, ${priorityGaugeColors[3]} 50%, ${priorityGaugeColors[4]} 75%, ${priorityGaugeColors[0]} 100%)`,
          opacity: 0.6,
          marginBottom: 2,
        }}
      />

      {/* Section header — like a kitchen station label */}
      <div className="chef-section-header" style={{ color }}>
        <span className="priority-group-icon" style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            color,
            letterSpacing: '0.05em',
            margin: 0,
            lineHeight: 1,
          }}
        >
          {label}
        </h2>
        {/* Ticket count badge */}
        <span className="kitchen-badge" style={{ background: color }}>
          {issues.length}
        </span>
      </div>

      {/* Ticket cards — like orders on the rail */}
      {issues.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-md)',
            overflowY: 'auto',
            flex: 1,
            paddingRight: 'var(--space-sm)',
          }}
        >
          {issues.map((issue) => (
            <TicketCard
              key={issue.id}
              issue={issue}
              timer={timers.get(issue.id)}
              config={config}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon" style={{ opacity: 0.5 }}><IconForkKnife size={40} /></div>
          <div>No tickets — kitchen is quiet!</div>
        </div>
      )}
    </div>
  );
}
