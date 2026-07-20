import React from 'react';
import { IconVolume, IconVolumeMute } from './Icons';

interface SoundToggleProps {
  isMuted: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function SoundToggle({ isMuted, onToggle, disabled = false }: SoundToggleProps) {
  return (
    <button
      className="sound-toggle"
      onClick={onToggle}
      disabled={disabled}
      title={disabled ? 'El sonido está controlado por la configuración de pantalla' : isMuted ? 'Activar sonidos' : 'Silenciar sonidos'}
      aria-label={disabled ? 'Sonido controlado por la configuración de pantalla' : isMuted ? 'Activar sonidos' : 'Silenciar sonidos'}
    >
      {isMuted ? <IconVolumeMute size={20} /> : <IconVolume size={20} />}
      <span className="control-label">{isMuted ? 'Silenciado' : 'Sonido'}</span>
    </button>
  );
}
