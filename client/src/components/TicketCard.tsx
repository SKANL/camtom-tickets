import React, { useState, useEffect, useRef } from 'react';
import { Issue, TimerInfo, ConfigResponse, TimerState } from '@camtom/shared';
import { SLATimer } from './SLATimer';
import { IconPerson, resolveIcon } from './Icons';
import { timerColor, TIMER_COLOR_VAR } from '../lib/board';

interface TicketCardProps {
  issue: Issue;
  timer?: TimerInfo;
  config?: ConfigResponse | null;
  /** 'hero' = big untaken card (default). 'compact' = in-progress strip card. */
  variant?: 'hero' | 'compact';
}

function shortState(s: TimerState): string {
  const map: Record<TimerState, string> = {
    FRESH: 'Fresco',
    WARMING: 'Tibio',
    HEATING: 'Caliente',
    CRITICAL: 'Crítico',
    EXPIRED: 'Quemado',
  };
  return map[s] ?? s;
}

function hashRotation(id: string): number {
  let hash = 0;
  for (let i = 0; i < Math.min(id.length, 8); i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
  }
  return (hash % 3) - 1.5;
}

const defaultStateLabels: Record<string, { label: string; icon: string }> = {
  completed: { label: 'Listo', icon: 'check' },
  started: { label: 'En prep', icon: 'forkKnife' },
  unstarted: { label: 'Entró', icon: 'edit' },
  canceled: { label: 'Cancelado', icon: 'x' },
  triaged: { label: 'Triage', icon: 'search' },
};

export function TicketCard({ issue, timer, config, variant = 'hero' }: TicketCardProps) {
  const stateLabels = config?.dashboard?.stateLabels ?? defaultStateLabels;
  const animationIntensity = config?.dashboard?.displayOptions?.animationIntensity ?? 'full';
  const compact = variant === 'compact';

  const stateType = stateLabels[issue.state.type] || { label: issue.state.name, icon: 'clipboard' };
  const [rotation] = useState(() => (compact ? 0 : hashRotation(issue.id)));
  const [isNew, setIsNew] = useState(true);
  const [hasArrived, setHasArrived] = useState(false);
  const mountedRef = useRef(false);

  // Arrival animation — fires once on mount
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      const t = setTimeout(() => setHasArrived(true), 50);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    if (hasArrived) {
      const t = setTimeout(() => setIsNew(false), 2500);
      return () => clearTimeout(t);
    }
  }, [hasArrived]);

  const timerState = timer?.state;
  const expired = timerState === 'EXPIRED';
  const critical = timerState === 'CRITICAL';
  const heating = timerState === 'HEATING';
  const burntPct = timer ? timer.remaining / (timer.maxMinutes * 60_000) : 1;
  const isBurnt = burntPct < 0.15 && !expired;

  // Accent colour = SLA traffic light (green/amber/red). No timer → neutral.
  const accent = timer ? TIMER_COLOR_VAR[timerColor(timer.state)] : 'rgba(255,255,255,0.25)';
  const cssVars = { '--ticket-rotation': `${rotation}deg` } as React.CSSProperties;

  const classes = ['ticket-card', compact ? 'ticket-card-compact' : 'ticket-card-hero'];
  if (expired && animationIntensity !== 'off') classes.push('siren-flash');
  if (hasArrived && isNew && animationIntensity !== 'off') {
    classes.push('arrival-bounce');
    if (animationIntensity === 'full' && !compact) classes.push('arrival-glow');
  }
  if (isBurnt && animationIntensity !== 'off') classes.push('burnt-fade');
  if (critical && animationIntensity !== 'off') classes.push('ticket-critical-pulse');
  if (heating && animationIntensity !== 'off') classes.push('ticket-heating-pulse');

  return (
    <div
      className={classes.join(' ')}
      style={{
        background: 'var(--bg-card)',
        border: '2px dashed rgba(255,255,255,0.12)',
        borderTop: `4px solid ${accent}`,
        borderRadius: 'var(--radius-card)',
        padding: compact ? 'var(--space-md)' : 'var(--space-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 'var(--space-xs)' : 'var(--space-sm)',
        boxShadow: 'var(--shadow-card)',
        position: 'relative',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        transform: `rotate(${rotation}deg)`,
        opacity: isBurnt ? 0.6 : 1,
        ...cssVars,
      }}
    >
      {/* State chip row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--text-xs)', color: issue.state.type === 'completed' ? 'var(--color-lettuce)' : 'rgba(255,255,255,0.55)', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          {resolveIcon(stateType.icon, 14)}
          <span style={{ whiteSpace: 'nowrap' }}>{stateType.label}</span>
        </span>
        <a
          href={`https://linear.app/issue/${issue.identifier}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}
          onClick={(e) => e.stopPropagation()}
        >
          #{issue.identifier}
        </a>
      </div>

      {/* Title */}
      <h3
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: compact ? 'var(--text-sm)' : 'var(--text-base)',
          fontWeight: 600,
          lineHeight: 1.35,
          color: 'var(--color-mayo)',
          display: '-webkit-box',
          WebkitLineClamp: compact ? 2 : 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          // Reserve the clamped lines — a -webkit-box collapses to ~0 height as a flex child otherwise.
          minHeight: compact ? '2.7em' : '4.05em',
          flexShrink: 0,
          margin: 0,
        }}
      >
        {issue.title}
      </h3>

      {/* Project — hero only */}
      {!compact && issue.project && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.55)', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <svg viewBox="0 0 24 24" fill="currentColor" width={10} height={10} style={{ flexShrink: 0 }}><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.project.name}</span>
        </div>
      )}

      {/* Labels — hero only */}
      {!compact && issue.labels && issue.labels.nodes.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {issue.labels.nodes.slice(0, 3).map((label) => {
            const bgOpacity = label.color ? '44' : '15';
            const borderOpacity = label.color ? '77' : '25';
            const textColor = label.color
              ? (() => {
                  const hex = label.color.replace('#', '');
                  const r = parseInt(hex.slice(0, 2), 16);
                  const g = parseInt(hex.slice(2, 4), 16);
                  const b = parseInt(hex.slice(4, 6), 16);
                  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                  return lum < 0.4 ? '#fff' : label.color;
                })()
              : 'rgba(255,255,255,0.75)';
            return (
              <span key={label.id} style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: label.color ? `${label.color}${bgOpacity}` : 'rgba(255,255,255,0.08)', color: textColor, border: `1px solid ${label.color ? `${label.color}${borderOpacity}` : 'rgba(255,255,255,0.15)'}`, fontWeight: 500, lineHeight: 1.4, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {label.name}
              </span>
            );
          })}
          {issue.labels.nodes.length > 3 && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)' }}>+{issue.labels.nodes.length - 3}</span>
          )}
        </div>
      )}

      {/* Footer: assignee + timer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: compact ? 4 : 'var(--space-sm)' }}>
        {issue.assignee ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', minWidth: 0, color: 'rgba(255,255,255,0.75)' }}>
            <IconPerson size={14} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.assignee.name}</span>
          </div>
        ) : (
          <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>Sin asignar</span>
        )}
        {timer && (
          <SLATimer
            key={timer.slaId}
            timer={timer}
            size={compact ? 44 : 64}
            strokeWidth={compact ? 4 : 5}
            label={compact ? undefined : shortState(timer.state)}
            timerStyle={config?.dashboard?.displayOptions?.timerStyle}
          />
        )}
      </div>
    </div>
  );
}
