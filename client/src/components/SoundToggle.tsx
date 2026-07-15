import React from 'react';
import { IconVolume, IconVolumeMute } from './Icons';

interface SoundToggleProps {
  isMuted: boolean;
  onToggle: () => void;
}

export function SoundToggle({ isMuted, onToggle }: SoundToggleProps) {
  return (
    <button
      className="sound-toggle"
      onClick={onToggle}
      title={isMuted ? 'Activar sonidos' : 'Silenciar sonidos'}
      aria-label={isMuted ? 'Activar sonidos' : 'Silenciar sonidos'}
      style={{
        background: 'rgba(255,255,255,0.1)',
        border: '2px solid rgba(255,255,255,0.2)',
        borderRadius: 'var(--radius-pill)',
        padding: '8px 12px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        color: 'var(--color-mayo)',
        fontFamily: 'var(--font-body)',
        fontSize: 'var(--text-sm)',
        transition: 'all 0.2s ease',
        minHeight: 44,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
      }}
    >
      {isMuted ? <IconVolumeMute size={20} /> : <IconVolume size={20} />}
      <span className="control-label">{isMuted ? 'Silenciado' : 'Sonido'}</span>
    </button>
  );
}
