import React from 'react';
import { DisplayOptions } from '@camtom/shared';
import type { SettingsOverrides } from '../SettingsPanel';
import { Section, FieldRow, selectStyle } from './layout';

interface DisplayTabProps {
  displayOptions: Partial<DisplayOptions>;
  setNestedOverride: <K extends keyof SettingsOverrides>(key: K, subKey: string, value: any) => void;
}

export function DisplayTab({ displayOptions, setNestedOverride }: DisplayTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <Section label="Estilo del timer">
        <FieldRow label="Visualización">
          <select
            value={displayOptions.timerStyle ?? 'circle'}
            onChange={(e) => setNestedOverride('displayOptions', 'timerStyle', e.target.value)}
            style={{ ...selectStyle, width: 140 }}
          >
            <option value="circle">Círculo</option>
            <option value="bar">Barra</option>
          </select>
        </FieldRow>
      </Section>

      <Section label="Intensidad de animación">
        <FieldRow label="Animaciones">
          <select
            value={displayOptions.animationIntensity ?? 'full'}
            onChange={(e) => setNestedOverride('displayOptions', 'animationIntensity', e.target.value)}
            style={{ ...selectStyle, width: 140 }}
          >
            <option value="off">Apagadas</option>
            <option value="subtle">Sutil</option>
            <option value="full">Completa</option>
          </select>
        </FieldRow>
      </Section>
    </div>
  );
}
