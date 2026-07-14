import React from 'react';
import { TimerInfo, TimerState } from '@camtom/shared';

interface SLATimerProps {
  timer: TimerInfo;
  size?: number;
  strokeWidth?: number;
  label?: string;
  timerStyle?: 'circle' | 'bar';
}

const STROKE_WIDTH = 6;
const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const stateColors: Record<TimerState, string> = {
  OK: 'var(--sla-ok)',
  WARNING: 'var(--sla-warning)',
  BREACHED: 'var(--sla-breached)',
};

export function SLATimer({ timer, size = 96, strokeWidth = STROKE_WIDTH, label, timerStyle = 'circle' }: SLATimerProps) {
  const { remaining, state, deadline, maxMinutes } = timer;
  const totalMinutes = maxMinutes ?? Math.max(1, remaining / 60_000);
  const totalMs = totalMinutes * 60_000;
  const pct = Math.max(0, Math.min(1, remaining / totalMs));
  const color = stateColors[state];

  const formatTime = (ms: number): string => {
    if (ms <= 0) return '00:00';
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Bar mode
  if (timerStyle === 'bar') {
    const tickCount = 10;
    const ticks = Array.from({ length: tickCount }, (_, i) => i / tickCount);
    const tickInterval = Math.max(0.5, pct * 6); // accelerate as time runs out

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
        {/* Bar track */}
        <div
          style={{
            width: '100%',
            height: 'var(--timer-bar-height, 8px)',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 4,
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Gradient fill */}
          <div
            style={{
              width: `${pct * 100}%`,
              height: '100%',
              background: state === 'OK'
                ? 'linear-gradient(90deg, var(--color-lettuce), #66BB6A)'
                : state === 'WARNING'
                  ? 'linear-gradient(90deg, var(--color-mustard), #FFA000)'
                  : 'linear-gradient(90deg, var(--color-ketchup), #B71C1C)',
              borderRadius: 4,
              transition: 'width 1s linear',
            }}
          />
          {/* Tick marks — accelerate on WARNING */}
          {state === 'WARNING' && (
            <div
              className="urgent-pulse"
              style={{
                position: 'absolute',
                right: `${(1 - pct) * 100}%`,
                top: 0,
                bottom: 0,
                width: 3,
                background: '#fff',
                opacity: 0.8,
                borderRadius: 1,
                animationDuration: `${Math.max(0.3, tickInterval)}s`,
              }}
            />
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            width: '100%',
            fontSize: 8,
            color: 'rgba(255,255,255,0.35)',
            fontFamily: 'var(--font-body)',
          }}
        >
          <span>{formatTime(remaining)}</span>
          {label && <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>}
        </div>
      </div>
    );
  }

  // Circle mode (existing)
  const center = size / 2;
  const r = center - strokeWidth;
  const offset = CIRCUMFERENCE * (1 - pct);
  const viewBox = `0 0 ${size} ${size}`;

  return (
    <div
      className={`sla-timer sla-timer--${state.toLowerCase()}${state === 'WARNING' ? ' pulse-warning' : ''}${state === 'BREACHED' ? ' shake-breach' : ''}`}
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
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{
            transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease',
          }}
        />
        {/* Timer dots decoration */}
        {state === 'BREACHED' && (
          <>
            <circle cx={center - 10} cy={center - 12} r={3} fill={color} opacity={0.6} />
            <circle cx={center + 10} cy={center + 10} r={2} fill={color} opacity={0.4} />
          </>
        )}
      </svg>
      {/* Time text */}
      <span
        style={{
          position: 'absolute',
          fontFamily: 'var(--font-display)',
          fontSize: state === 'BREACHED' ? '0.9rem' : '1rem',
          color,
          textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
          lineHeight: 1,
        }}
      >
        {formatTime(remaining)}
      </span>
      {label && (
        <span
          style={{
            position: 'absolute',
            bottom: -2,
            fontFamily: 'var(--font-body)',
            fontSize: 8,
            color: 'rgba(255,255,255,0.35)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
