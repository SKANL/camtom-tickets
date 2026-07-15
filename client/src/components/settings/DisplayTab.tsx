import React from 'react';
import { DisplayOptions } from '@camtom/shared';
import type { SettingsOverrides } from '../SettingsPanel';
import { PRIORITY_LEVELS, PRIORITY_BY_LEVEL } from '../../lib/priorities';
import { Section, FieldRow, selectStyle } from './layout';

interface DisplayTabProps {
  displayOptions: Partial<DisplayOptions>;
  setNestedOverride: <K extends keyof SettingsOverrides>(key: K, subKey: string, value: any) => void;
}

export function DisplayTab({ displayOptions, setNestedOverride }: DisplayTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <Section label="Timer Style">
        <FieldRow label="Timer display">
          <select
            value={displayOptions.timerStyle ?? 'circle'}
            onChange={(e) => setNestedOverride('displayOptions', 'timerStyle', e.target.value)}
            style={{ ...selectStyle, width: 140 }}
          >
            <option value="circle">Circle</option>
            <option value="bar">Bar</option>
          </select>
        </FieldRow>
      </Section>

      <Section label="Animation Intensity">
        <FieldRow label="Animations">
          <select
            value={displayOptions.animationIntensity ?? 'full'}
            onChange={(e) => setNestedOverride('displayOptions', 'animationIntensity', e.target.value)}
            style={{ ...selectStyle, width: 140 }}
          >
            <option value="off">Off</option>
            <option value="subtle">Subtle</option>
            <option value="full">Full</option>
          </select>
        </FieldRow>
      </Section>

      <Section label="Column Visibility">
        {PRIORITY_LEVELS.map((pk) => {
          const visible = displayOptions.columnVisibility?.[pk] ?? true;
          return (
            <FieldRow key={pk} label={PRIORITY_BY_LEVEL[pk].name}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 'var(--text-sm)' }}>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => {
                    const current = displayOptions.columnVisibility ?? {};
                    setNestedOverride('displayOptions', 'columnVisibility', {
                      ...current,
                      [pk]: !visible,
                    });
                  }}
                  style={{ accentColor: 'var(--color-tomato)' }}
                />
                {visible ? 'Visible' : 'Hidden'}
              </label>
            </FieldRow>
          );
        })}
      </Section>
    </div>
  );
}
