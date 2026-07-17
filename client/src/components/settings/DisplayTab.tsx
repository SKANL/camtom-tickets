import React from 'react';
import { DisplayOptions } from '@camtom/shared';
import { Section, FieldRow, selectStyle } from './layout';

interface DisplayTabProps {
  displayOptions: Partial<DisplayOptions>;
  displayOrder: number[];
  onChange: (key: keyof DisplayOptions, value: unknown) => void;
  onDisplayOrderChange: (value: number[]) => void;
}

export function DisplayTab({ displayOptions, displayOrder, onChange, onDisplayOrderChange }: DisplayTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <Section label="Estilo del timer">
        <FieldRow label="Visualización">
          <select
            value={displayOptions.timerStyle ?? 'circle'}
            onChange={(e) => onChange('timerStyle', e.target.value)}
            style={{ ...selectStyle, width: 140 }}
          >
            <option value="circle">Círculo</option>
            <option value="bar">Barra</option>
          </select>
        </FieldRow>
      </Section>

      <Section label="Columnas">
        <FieldRow label="Orden (0–4)">
          <input
            value={displayOrder.join(',')}
            onChange={(event) => {
              const next = event.target.value.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 0 && value <= 4);
              onDisplayOrderChange([...new Set(next)]);
            }}
            style={{ ...selectStyle, width: 180 }}
          />
        </FieldRow>
        {[1, 2, 3, 4, 0].map((priority) => (
          <FieldRow key={priority} label={`Prioridad ${priority}`}>
            <input
              type="checkbox"
              checked={displayOptions.columnVisibility?.[priority] !== false}
              onChange={(event) => onChange('columnVisibility', { ...displayOptions.columnVisibility, [priority]: event.target.checked })}
            />
          </FieldRow>
        ))}
      </Section>

      <Section label="Intensidad de animación">
        <FieldRow label="Animaciones">
          <select
            value={displayOptions.animationIntensity ?? 'full'}
            onChange={(e) => onChange('animationIntensity', e.target.value)}
            style={{ ...selectStyle, width: 140 }}
          >
            <option value="off">Apagadas</option>
            <option value="subtle">Sutil</option>
            <option value="full">Completa</option>
          </select>
        </FieldRow>
      </Section>

      <Section label="Audio automático">
        <FieldRow label="Silenciar automáticamente">
          <input type="checkbox" checked={displayOptions.autoMute === true} onChange={(event) => onChange('autoMute', event.target.checked)} />
        </FieldRow>
      </Section>
    </div>
  );
}
