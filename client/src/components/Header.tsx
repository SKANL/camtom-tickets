import React, { useEffect, useState } from 'react';
import { ConfigResponse, TeamBoardConfig } from '@camtom/shared';
import { SoundToggle } from './SoundToggle';
import { formatTime } from '../utils/format';
import { IconChart, IconChefHat, IconClipboard, IconSettings } from './Icons';
import { priorityIcons } from '../lib/priorities';

interface HeaderProps {
  title: string;
  isMuted: boolean;
  onToggleMute?: () => void;
  muteLocked?: boolean;
  onToggleReport?: () => void;
  showReport?: boolean;
  isFriday: boolean;
  config?: ConfigResponse | null;
  activeTeam?: TeamBoardConfig;
  onOpenSettings?: () => void;
}

export function Header({
  title,
  isMuted,
  onToggleMute,
  muteLocked = false,
  onToggleReport,
  showReport = false,
  isFriday,
  config,
  activeTeam,
  onOpenSettings,
}: HeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const teamAccent = activeTeam?.accent || 'var(--color-tomato)';
  return (
    <header className="app-header" style={{ '--header-accent': teamAccent } as React.CSSProperties}>
      <div className="header-brand">
        <div className="header-logo" data-cuelume-press="chime" aria-hidden="true"><IconChefHat size={25} /></div>
        <div className="header-heading">
          <h1 className="header-title">{title}</h1>
          <p><span className="live-dot" /> Estación de soporte en vivo</p>
        </div>
        {activeTeam && (
          <span className="header-team-badge" style={{ '--team-accent': teamAccent } as React.CSSProperties}>
            <span />{activeTeam.name}
          </span>
        )}
      </div>

      <div className="header-priorities" aria-label="Leyenda de prioridades">
        {Object.entries(config?.dashboard?.priorityLabels ?? {}).map(([priority, label]) => {
          const Icon = priorityIcons[Number(priority)];
          return (
            <span key={priority} style={{ '--priority-color': label.color } as React.CSSProperties}>
              <span className="priority-dot" />{Icon ? <Icon size={15} /> : null}{label.label}
            </span>
          );
        })}
      </div>

      <div className="header-actions">
        {isFriday && !showReport && <span className="header-friday"><IconChart size={16} /> Reporte disponible</span>}
        {onToggleReport && (
          <button className="header-action-button header-report-button" data-cuelume-press="toggle" onClick={onToggleReport} aria-pressed={showReport}>
            {showReport ? <IconClipboard size={17} /> : <IconChart size={17} />}
            <span className="control-label">{showReport ? 'Tablero' : 'Reporte'}</span>
          </button>
        )}
        <time className="header-clock" dateTime={currentTime.toISOString()}>{formatTime(currentTime)}</time>
        {onOpenSettings && (
          <button className="header-action-button header-settings-button" onClick={onOpenSettings} title="Configuración" aria-label="Abrir configuración">
            <IconSettings size={20} />
          </button>
        )}
        {onToggleMute && <SoundToggle isMuted={isMuted} onToggle={onToggleMute} disabled={muteLocked} />}
      </div>
    </header>
  );
}
