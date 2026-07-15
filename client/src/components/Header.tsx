import React, { useState, useEffect } from 'react';
import { SoundToggle } from './SoundToggle';
import { formatTime } from '../utils/format';
import { ConfigResponse, TeamBoardConfig } from '@camtom/shared';
import { IconChefHat, IconClipboard, IconChart, IconSettings } from './Icons';
import { priorityIcons } from '../lib/priorities';

interface HeaderProps {
  title: string;
  isMuted: boolean;
  onToggleMute: () => void;
  onToggleReport: () => void;
  showReport: boolean;
  isFriday: boolean;
  config?: ConfigResponse | null;
  activeTeam?: TeamBoardConfig;
  onOpenSettings?: () => void;
}

export function Header({ title, isMuted, onToggleMute, onToggleReport, showReport, isFriday, config, activeTeam, onOpenSettings }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Active-team accent — signals which board you're looking at. Falls back to the
  // brand tomato when a team has no accent configured.
  const teamAccent = activeTeam?.accent || 'var(--color-tomato)';

  return (
    <header
      className="app-header"
      style={{
        background: 'linear-gradient(180deg, var(--bg-header) 0%, #2C1810 100%)',
        padding: 'var(--space-md) var(--space-xl)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `3px solid ${teamAccent}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        zIndex: 10,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Decorative top line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'linear-gradient(90deg, var(--color-tomato), var(--color-mustard), var(--color-lettuce), var(--color-oil))',
        }}
      />

      {/* Left: Branding */}
      <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', minWidth: 0 }}>
        <div
          style={{
            width: 44,
            height: 44,
            background: 'var(--color-tomato)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(255, 99, 71, 0.4)',
            fontSize: '1.5rem',
          }}
          data-cuelume-press="chime"
        >
          <IconChefHat size={24} />
        </div>
        <div>
          <h1
            className="header-title"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-3xl)',
              color: 'var(--color-tomato)',
              letterSpacing: '0.05em',
              margin: 0,
              lineHeight: 1,
              textShadow: '2px 2px 0 rgba(0,0,0,0.3)',
            }}
          >
            {title}
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--text-xs)',
              color: 'rgba(255,255,255,0.35)',
              margin: 0,
              letterSpacing: '0.1em',
            }}
          >
            TABLERO · EN VIVO
          </p>
        </div>

        {/* Active-team badge — colour + name make the current board unmistakable */}
        {activeTeam && (
          <span
            className="header-team-badge"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginLeft: 'var(--space-sm)',
              padding: '5px 14px 5px 10px',
              borderRadius: 'var(--radius-pill)',
              background: `${teamAccent}1F`,
              border: `1.5px solid ${teamAccent}66`,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-lg)',
              letterSpacing: '0.04em',
              color: '#fff',
              textShadow: '1px 1px 0 rgba(0,0,0,0.35)',
              transition: 'background 0.3s ease, border-color 0.3s ease',
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: teamAccent,
                boxShadow: `0 0 8px ${teamAccent}AA`,
                flexShrink: 0,
              }}
            />
            {activeTeam.name}
          </span>
        )}
      </div>

      <div
        className="header-priorities"
        style={{
          display: 'flex',
          gap: 'var(--space-xl)',
          alignItems: 'center',
        }}
      >
        {Object.entries(config?.dashboard?.priorityLabels ?? {}).map(([priority, pl]) => {
          const IconComp = priorityIcons[Number(priority)];
          return (
            <span key={priority} style={{ display: 'flex', alignItems: 'center', gap: 6, color: pl.color, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-display)', letterSpacing: '0.05em', opacity: 0.85 }}>
              <span className="priority-dot" style={{ color: pl.color, width: 8, height: 8 }} />
              {IconComp ? <IconComp size={16} /> : null}
              <span style={{ marginLeft: 2 }}>{pl.label}</span>
            </span>
          );
        })}
      </div>

      {/* Right: Time, Report toggle, Sound */}
      <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
        {/* Friday indicator */}
        {isFriday && !showReport && (
          <span
            className="header-friday"
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-mustard)',
              fontFamily: 'var(--font-display)',
              animation: 'pulseWarning 2s ease-in-out infinite',
            }}
          >
            <IconChart size={16} /> ¡Reporte del viernes!
          </span>
        )}

        {/* Toggle report button */}
        <button
          className="header-report-button"
          data-cuelume-press="toggle"
          onClick={onToggleReport}
          style={{
            background: showReport ? 'var(--color-avocado)' : 'rgba(255,255,255,0.08)',
            border: `2px solid ${showReport ? 'var(--color-avocado)' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 'var(--radius-pill)',
            padding: '8px 20px',
            cursor: 'pointer',
            color: '#fff',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-sm)',
            letterSpacing: '0.05em',
            transition: 'all 0.2s ease',
            textShadow: '1px 1px 0 rgba(0,0,0,0.3)',
            minHeight: 44,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = showReport ? 'var(--color-avocado)' : 'rgba(255,255,255,0.15)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = showReport ? 'var(--color-avocado)' : 'rgba(255,255,255,0.08)';
          }}
        >
          {showReport ? (
            <><IconClipboard size={16} /><span className="control-label">Tablero</span></>
          ) : (
            <><IconChart size={16} /><span className="control-label">Reporte</span></>
          )}
        </button>

        {/* Current time — styled like a kitchen clock, less competing orange */}
        <div
          className="header-clock"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            color: 'rgba(255,255,255,0.85)',
            letterSpacing: '0.08em',
            minWidth: 110,
            textAlign: 'center',
            textShadow: '1px 1px 0 rgba(0,0,0,0.3)',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 12px',
          }}
        >
          {formatTime(currentTime)}
        </div>

        {/* Settings */}
        {onOpenSettings && (
          <button
            className="header-settings-button"
            data-cuelume-press="toggle"
            onClick={onOpenSettings}
            title="Configuración"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 'var(--radius-pill)',
              width: 44,
              height: 44,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.5)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
          >
            <IconSettings size={20} />
          </button>
        )}

        {/* Sound toggle */}
        <SoundToggle isMuted={isMuted} onToggle={onToggleMute} />
      </div>
    </header>
  );
}
