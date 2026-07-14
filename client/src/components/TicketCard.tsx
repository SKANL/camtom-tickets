import React, { useState, useEffect, useRef } from 'react';
import { Issue, TimerInfo, ConfigResponse } from '@camtom/shared';
import { SLATimer } from './SLATimer';
import { IconPerson, resolveIcon, priorityIcons } from './Icons';

interface TicketCardProps {
  issue: Issue;
  timers?: TimerInfo[];
  config?: ConfigResponse | null;
}

function slaShortLabel(slaId: string): string {
  const map: Record<string, string> = {
    responder_usuario: 'Responder',
    recuperar_usuario: 'Recuperar',
    avisar_equipo: 'Avisar',
    resolver_iniciar: 'Iniciar',
    resolver_definitiva: 'Resolver',
  };
  return map[slaId] || slaId;
}

function hashRotation(id: string): number {
  let hash = 0;
  for (let i = 0; i < Math.min(id.length, 8); i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
  }
  return (hash % 3) - 1.5;
}

const defaultPriorityConfig: Record<number, { label: string; color: string; dotColor: string }> = {
  1: { label: 'Urgent', color: 'var(--priority-urgent)', dotColor: '#D32F2F' },
  2: { label: 'High', color: 'var(--priority-high)', dotColor: '#FF8C00' },
  3: { label: 'Medium', color: 'var(--priority-medium)', dotColor: '#3B82F6' },
  4: { label: 'Low', color: 'var(--priority-low)', dotColor: '#4CAF50' },
  0: { label: 'None', color: 'var(--priority-none)', dotColor: '#9E9E9E' },
};

const defaultStateLabels: Record<string, { label: string; icon: string }> = {
  completed: { label: 'Done', icon: 'check' },
  started: { label: 'Prep', icon: 'forkKnife' },
  unstarted: { label: 'Order In', icon: 'edit' },
  canceled: { label: "86'd", icon: 'x' },
  triaged: { label: 'Triaged', icon: 'search' },
};

function isBreached(timers?: TimerInfo[]): boolean {
  return timers?.some((t) => t.state === 'BREACHED') ?? false;
}

function isWarning(timers?: TimerInfo[]): boolean {
  return timers?.some((t) => t.state === 'WARNING') ?? false;
}

function getMinRemainingPct(timers?: TimerInfo[]): number {
  if (!timers || timers.length === 0) return 1;
  const worst = Math.min(...timers.map((t) => t.remaining / Math.max(1, t.deadline - Date.now() + t.remaining)));
  return Math.max(0, worst);
}

export function TicketCard({ issue, timers, config }: TicketCardProps) {
  const priorityLabels = config?.dashboard?.priorityLabels ?? defaultPriorityConfig;
  const stateLabels = config?.dashboard?.stateLabels ?? defaultStateLabels;
  const animationIntensity = config?.dashboard?.displayOptions?.animationIntensity ?? 'full';

  const priority = priorityLabels[issue.priority] || priorityLabels[0] || defaultPriorityConfig[0];
  const stateType = stateLabels[issue.state.type] || { label: issue.state.name, icon: 'clipboard' };
  const [rotation] = useState(() => hashRotation(issue.id));
  const [isNew, setIsNew] = useState(true);
  const [hasArrived, setHasArrived] = useState(false);
  const mountedRef = useRef(false);

  // Arrival animation — fires once on mount
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      // Small delay to ensure card renders before animating
      const t = setTimeout(() => {
        setHasArrived(true);
      }, 50);
      return () => clearTimeout(t);
    }
  }, []);

  // After animation completes, mark as not-new
  useEffect(() => {
    if (hasArrived) {
      const t = setTimeout(() => setIsNew(false), 2500);
      return () => clearTimeout(t);
    }
  }, [hasArrived]);

  const breached = isBreached(timers);
  const warning = isWarning(timers);
  const burntPct = getMinRemainingPct(timers);
  const isBurnt = burntPct < 0.15 && !breached;
  const cssVars = { '--ticket-rotation': `${rotation}deg` } as React.CSSProperties;

  // Build class name list
  const classes = ['ticket-card'];
  if (breached && animationIntensity !== 'off') classes.push('siren-flash');
  if (hasArrived && isNew && animationIntensity !== 'off') {
    classes.push('arrival-bounce');
    if (animationIntensity === 'full') classes.push('arrival-glow');
  }
  if (isBurnt && animationIntensity !== 'off') classes.push('burnt-fade');
  if (warning && animationIntensity !== 'off') classes.push('urgent-pulse');

  return (
    <div
      className={classes.join(' ')}
      style={{
        background: 'var(--bg-card)',
        border: `2px dashed rgba(255,255,255,0.12)`,
        borderTop: `3px solid ${priority.dotColor}`,
        borderRadius: 'var(--radius-card)',
        padding: 'var(--space-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
        boxShadow: 'var(--shadow-card)',
        position: 'relative',
        minWidth: 240,
        maxWidth: 340,
        overflow: 'hidden',
        transform: `rotate(${rotation}deg)`,
        opacity: isBurnt ? 0.6 : 1,
        clipPath: 'polygon(0% 0%, 100% 0%, 100% calc(100% - 8px), calc(100% - 4px) 100%, calc(100% - 10px) calc(100% - 8px), calc(100% - 16px) 100%, calc(100% - 22px) calc(100% - 8px), calc(100% - 28px) 100%, calc(100% - 34px) calc(100% - 8px), calc(100% - 40px) 100%, 0% calc(100% - 8px))',
        ...cssVars,
      }}
    >
      {/* Priority row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="priority-dot" style={{ color: priority.dotColor }} />
          <span style={{ color: priority.color, fontSize: 'var(--text-xs)', fontFamily: 'var(--font-display)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {priority.label}
          </span>
        </div>
        <span style={{ fontSize: 'var(--text-xs)', color: stateType.label === 'Done' ? 'var(--color-lettuce)' : 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 3 }}>
          {resolveIcon(stateType.icon, 14)}
          <span style={{ marginLeft: 4 }}>{stateType.label}</span>
        </span>
      </div>

      {/* TITLE — topmost text, var(--text-lg), 3-line clamp */}
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', lineHeight: 1.3, color: 'var(--color-oil)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '3.9em' }}>
        {issue.title}
      </div>

      {/* IDENTIFIER — var(--text-xs), clickable link to Linear, below title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <a
          href={`https://linear.app/issue/${issue.identifier}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
          onClick={(e) => e.stopPropagation()}
        >
          #{issue.identifier}
        </a>

        {/* PROJECT — subtle, shown when available */}
        {issue.project && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width={10} height={10}><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
            {issue.project.name}
          </span>
        )}
      </div>

      {/* Labels */}
      {issue.labels && issue.labels.nodes.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {issue.labels.nodes.slice(0, 3).map((label) => (
            <span key={label.id} style={{ fontSize: 'var(--text-xs)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: label.color ? `${label.color}33` : 'rgba(255,255,255,0.1)', color: label.color || 'rgba(255,255,255,0.6)', border: `1px solid ${label.color ? `${label.color}66` : 'rgba(255,255,255,0.15)'}` }}>
              {label.name}
            </span>
          ))}
          {issue.labels.nodes.length > 3 && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.3)' }}>+{issue.labels.nodes.length - 3}</span>
          )}
        </div>
      )}

      {/* ASSIGNEE — IconPerson + name, hidden when unassigned */}
      {issue.assignee && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)' }}>
          <IconPerson size={14} />
          <span>{issue.assignee.name}</span>
        </div>
      )}

      {/* Timers */}
      {timers && timers.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 'var(--space-sm)', paddingTop: 'var(--space-sm)' }}>
          {timers.map((t) => (
            <SLATimer key={t.slaId} timer={t} size={56} strokeWidth={4} label={slaShortLabel(t.slaId)} timerStyle={config?.dashboard?.displayOptions?.timerStyle} />
          ))}
        </div>
      )}

      {/* Decorative bottom */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, background: 'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(255,255,255,0.04) 4px, rgba(255,255,255,0.04) 8px)', borderBottomLeftRadius: 'var(--radius-card)', borderBottomRightRadius: 'var(--radius-card)' }} />
    </div>
  );
}
