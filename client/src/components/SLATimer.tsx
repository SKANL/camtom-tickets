import React, { useId } from 'react';
import { TimerInfo, TimerState } from '@camtom/shared';
import { formatRemaining } from '../utils/sla';
import { IconFire } from './Icons';

interface SLATimerProps {
  timer: TimerInfo;
  size?: number;
  strokeWidth?: number;
  label?: string;
  timerStyle?: 'circle' | 'bar';
}

const STROKE_WIDTH = 6;

// State metadata for the 5-tier timer
interface StateMeta {
  color: string;
  glowColor: string;
  label: string;
}

const stateMeta: Record<TimerState, StateMeta> = {
  FRESH:    { color: 'var(--sla-ok, #4CAF50)',       glowColor: 'rgba(76,175,80,0.4)',   label: 'Fresco' },
  WARMING:  { color: 'var(--sla-warming, #FFC107)',   glowColor: 'rgba(255,193,7,0.4)',   label: 'Tibio' },
  HEATING:  { color: 'var(--sla-heating, #FF9800)',   glowColor: 'rgba(255,152,0,0.5)',   label: 'Caliente' },
  CRITICAL: { color: 'var(--sla-critical, #F44336)',  glowColor: 'rgba(244,67,54,0.6)',   label: 'Crítico' },
  EXPIRED:  { color: 'var(--sla-expired, #B71C1C)',   glowColor: 'rgba(183,28,28,0.7)',   label: 'Vencido' },
};

/**
 * Interpolate between two hex colors — used for smooth gradient progress.
 */
function lerpColor(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 0xff) * (1 - t) + ((pb >> 16) & 0xff) * t);
  const g = Math.round(((pa >> 8) & 0xff) * (1 - t) + ((pb >> 8) & 0xff) * t);
  const bl = Math.round((pa & 0xff) * (1 - t) + (pb & 0xff) * t);
  return `rgb(${r},${g},${bl})`;
}

/**
 * Get a smooth progress color from green → amber → orange → red based on pct.
 */
function progressColor(pct: number): string {
  if (pct > 0.6) {
    // Green → Amber (100% – 60%)
    const t = (pct - 0.6) / 0.4;
    return lerpColor('#FFC107', '#4CAF50', t);
  }
  if (pct > 0.3) {
    // Amber → Orange (60% – 30%)
    const t = (pct - 0.3) / 0.3;
    return lerpColor('#FF9800', '#FFC107', t);
  }
  if (pct > 0.1) {
    // Orange → Red (30% – 10%)
    const t = (pct - 0.1) / 0.2;
    return lerpColor('#F44336', '#FF9800', t);
  }
  // Red → Deep Red (10% – 0%)
  const t = pct / 0.1;
  return lerpColor('#B71C1C', '#F44336', t);
}

export function SLATimer({
  timer,
  size = 96,
  strokeWidth = STROKE_WIDTH,
  label,
  timerStyle = 'circle',
}: SLATimerProps) {
  const { remaining, state, maxMinutes } = timer;
  const totalMs = maxMinutes * 60_000;
  const pct = Math.max(0, Math.min(1, remaining / totalMs));
  // Unique id so multiple EXPIRED timers don't collide on one SVG filter.
  const filterId = `glow-${useId()}`;

  const meta = stateMeta[state];
  const smoothColor = progressColor(pct);

  // EXPIRED gets a slow burning pulse
  const stateClass =
    state === 'CRITICAL' ? 'pulse-critical' :
    state === 'HEATING' ? 'pulse-heating' :
    state === 'WARMING' ? 'pulse-warming' :
    state === 'EXPIRED' ? 'expired-burn' : '';

  // ---- Bar mode ----
  if (timerStyle === 'bar') {
    return (
      <div
        style={{
          width: 120,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          alignItems: 'center',
        }}
      >
        <div
          className={stateClass}
          style={{
            width: '100%',
            height: 'var(--timer-bar-height, 8px)',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 4,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: `${pct * 100}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${meta.color}, ${smoothColor})`,
              borderRadius: 4,
              transition: 'width 1s linear, background 0.5s ease',
              boxShadow: state === 'EXPIRED' || state === 'CRITICAL'
                ? `0 0 6px ${meta.glowColor}`
                : 'none',
            }}
          />
          {/* Glowing indicator dot on the leading edge (CRITICAL+) */}
          {(state === 'CRITICAL' || state === 'EXPIRED') && (
            <div
              style={{
                position: 'absolute',
                right: `${(1 - pct) * 100}%`,
                top: -2,
                width: 4,
                height: 12,
                background: '#fff',
                borderRadius: 2,
                opacity: 0.7,
                boxShadow: `0 0 8px ${meta.color}`,
                animation: 'urgent-pulse 0.5s ease-in-out infinite',
              }}
            />
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            fontSize: 11,
            color: 'rgba(255,255,255,0.6)',
            fontFamily: 'var(--font-body)',
          }}
        >
          <span
            style={{
              color: state === 'EXPIRED' ? meta.color : undefined,
              fontWeight: state === 'EXPIRED' ? 700 : undefined,
            }}
          >
            {formatRemaining(remaining)}
          </span>
          {label && (
            <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {label}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ---- Circle mode ----
  const center = size / 2;
  const r = center - strokeWidth;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);
  const viewBox = `0 0 ${size} ${size}`;

  return (
    <div
      className={`sla-timer sla-timer--${state.toLowerCase()} ${stateClass}`}
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size} height={size} viewBox={viewBox}>
        {/* Glow filter for EXPIRED */}
        {state === 'EXPIRED' && (
          <defs>
            <filter id={filterId}>
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
        )}
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc with smooth color */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={smoothColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          filter={state === 'EXPIRED' ? `url(#${filterId})` : undefined}
          style={{
            transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease',
          }}
        />
        {/* Decorative dots on EXPIRED — like embers */}
        {state === 'EXPIRED' && (
          <>
            <circle cx={center - 12} cy={center - 14} r={3} fill={meta.color} opacity={0.7} />
            <circle cx={center + 14} cy={center + 6} r={2.5} fill={meta.color} opacity={0.5} />
            <circle cx={center - 8} cy={center + 16} r={2} fill={meta.color} opacity={0.3} />
          </>
        )}
        {/* Subtle halo ring on CRITICAL */}
        {state === 'CRITICAL' && (
          <circle
            cx={center}
            cy={center}
            r={r + 2}
            fill="none"
            stroke={meta.glowColor}
            strokeWidth={2}
            opacity={0.4}
            style={{ animation: 'urgent-pulse 1s ease-in-out infinite' }}
          />
        )}
      </svg>
      {/* Timer text */}
      <span
        style={{
          position: 'absolute',
          fontFamily: 'var(--font-display)',
          fontSize: Math.round(size * 0.24),
          fontWeight: 700,
          color: smoothColor,
          textShadow: state === 'CRITICAL' || state === 'EXPIRED'
            ? `0 0 8px ${meta.glowColor}`
            : '1px 1px 2px rgba(0,0,0,0.5)',
          lineHeight: 1,
          transition: 'color 0.5s ease, text-shadow 0.5s ease',
        }}
      >
        {state === 'EXPIRED'
          ? <IconFire size={Math.round(size * 0.34)} />
          : formatRemaining(remaining)}
      </span>
      {/* State indicator label */}
      {label && (
        <span
          style={{
            position: 'absolute',
            bottom: -2,
            fontFamily: 'var(--font-body)',
            fontSize: Math.max(10, Math.round(size * 0.13)),
            fontWeight: 700,
            color: meta.color,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
            opacity: state === 'FRESH' ? 0.5 : 1,
            transition: 'opacity 0.3s ease',
          }}
        >
          {state === 'EXPIRED' ? 'QUEMADO' : label}
        </span>
      )}
    </div>
  );
}
