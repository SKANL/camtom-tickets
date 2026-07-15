import React, { useState, useEffect, useRef } from 'react';
import { Issue, TimerInfo, ConfigResponse, TimerState } from '@camtom/shared';
import { SLATimer } from './SLATimer';
import { IconPerson, resolveIcon } from './Icons';
import { priorityIcons, defaultPriorityConfig } from '../lib/priorities';

interface TicketCardProps {
  issue: Issue;
  timer?: TimerInfo;
  config?: ConfigResponse | null;
}

function shortState(s: TimerState): string {
  const map: Record<TimerState, string> = {
    FRESH: 'Fresh',
    WARMING: 'Warm',
    HEATING: 'Hot',
    CRITICAL: 'Critical',
    EXPIRED: 'Burned',
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
  completed: { label: 'Done', icon: 'check' },
  started: { label: 'Prep', icon: 'forkKnife' },
  unstarted: { label: 'Order In', icon: 'edit' },
  canceled: { label: "86'd", icon: 'x' },
  triaged: { label: 'Triaged', icon: 'search' },
};

export function TicketCard({ issue, timer, config }: TicketCardProps) {
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

  const timerState = timer?.state;
  const expired = timerState === 'EXPIRED';
  const critical = timerState === 'CRITICAL';
  const heating = timerState === 'HEATING';
  const burntPct = timer ? timer.remaining / (timer.maxMinutes * 60_000) : 1;
  const isBurnt = burntPct < 0.15 && !expired;
  const cssVars = { '--ticket-rotation': `${rotation}deg` } as React.CSSProperties;

  // Build class name list
  const classes = ['ticket-card'];
  if (expired && animationIntensity !== 'off') classes.push('siren-flash');
  if (hasArrived && isNew && animationIntensity !== 'off') {
    classes.push('arrival-bounce');
    if (animationIntensity === 'full') classes.push('arrival-glow');
  }
  if (isBurnt && animationIntensity !== 'off') classes.push('burnt-fade');
  if (critical && animationIntensity !== 'off') classes.push('ticket-critical-pulse');
  if (heating && animationIntensity !== 'off') classes.push('ticket-heating-pulse');

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

      {/* TITLE — h3 for semantics, readable font, sentence-case */}
      <h3
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-base)',
          fontWeight: 600,
          lineHeight: 1.35,
          color: 'var(--color-mayo)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: '4.05em',
          margin: 0,
        }}
      >
        {issue.title}
      </h3>

      {/* IDENTIFIER — var(--text-xs), clickable link to Linear, below title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <a
          href={`https://linear.app/issue/${issue.identifier}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}
          onClick={(e) => e.stopPropagation()}
        >
          #{issue.identifier}
        </a>

        {/* PROJECT — shown when available */}
        {issue.project && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.55)', display: 'flex', alignItems: 'center', gap: 3 }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width={10} height={10}><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>
            {issue.project.name}
          </span>
        )}
      </div>

      {/* Labels — better contrast, uniform padding */}
      {issue.labels && issue.labels.nodes.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {issue.labels.nodes.slice(0, 3).map((label) => {
            // Ensure readable text on colored backgrounds
            const bgOpacity = label.color ? '44' : '15';
            const borderOpacity = label.color ? '77' : '25';
            const textColor = label.color
              ? // Lighten dark label colors for readability on dark bg
                (() => {
                  const hex = label.color.replace('#', '');
                  const r = parseInt(hex.slice(0, 2), 16);
                  const g = parseInt(hex.slice(2, 4), 16);
                  const b = parseInt(hex.slice(4, 6), 16);
                  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                  return lum < 0.4 ? '#fff' : label.color;
                })()
              : 'rgba(255,255,255,0.75)';
            return (
              <span key={label.id} style={{ fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: label.color ? `${label.color}${bgOpacity}` : 'rgba(255,255,255,0.08)', color: textColor, border: `1px solid ${label.color ? `${label.color}${borderOpacity}` : 'rgba(255,255,255,0.15)'}`, fontWeight: 500, lineHeight: 1.4 }}>
                {label.name}
              </span>
            );
          })}
          {issue.labels.nodes.length > 3 && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)' }}>+{issue.labels.nodes.length - 3}</span>
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

      {/* Single timer */}
      {timer && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-sm)', paddingTop: 'var(--space-sm)' }}>
          <SLATimer
            key={timer.slaId}
            timer={timer}
            size={64}
            strokeWidth={5}
            label={shortState(timer.state)}
            timerStyle={config?.dashboard?.displayOptions?.timerStyle}
          />
        </div>
      )}

      {/* Decorative bottom */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, background: 'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(255,255,255,0.04) 4px, rgba(255,255,255,0.04) 8px)', borderBottomLeftRadius: 'var(--radius-card)', borderBottomRightRadius: 'var(--radius-card)' }} />
    </div>
  );
}
