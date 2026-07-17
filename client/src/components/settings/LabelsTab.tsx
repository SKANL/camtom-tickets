import React from 'react';
import { PriorityLabelConfig, KitchenPhrases, StateLabelConfig, ZoneLabels } from '@camtom/shared';
import { PRIORITY_LEVELS, PRIORITY_BY_LEVEL } from '../../lib/priorities';
import { Section, FieldRow, inputStyle } from './layout';

interface LabelsTabProps {
  priorityLabels: Record<number, Partial<PriorityLabelConfig>>;
  kitchenPhrases: KitchenPhrases;
  zoneLabels: ZoneLabels;
  stateLabels: Record<string, StateLabelConfig>;
  setPriorityOverride: (priority: number, field: keyof PriorityLabelConfig, value: string) => void;
  setPhrase: (key: keyof KitchenPhrases, value: string) => void;
  setZone: (key: keyof ZoneLabels, value: string) => void;
  setStateLabel: (state: string, field: keyof StateLabelConfig, value: string) => void;
}

export function LabelsTab({ priorityLabels, kitchenPhrases, zoneLabels, stateLabels, setPriorityOverride, setPhrase, setZone, setStateLabel }: LabelsTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <Section label="Etiquetas de prioridad y colores">
        {PRIORITY_LEVELS.map((pk) => {
          const pl = priorityLabels[pk] || { label: PRIORITY_BY_LEVEL[pk].name, color: '#888', dotColor: '#888' };
          return (
            <div key={pk} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ minWidth: 80, fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.7)' }}>
                {PRIORITY_BY_LEVEL[pk].name}
              </span>
              <input
                value={pl.label ?? ''}
                onChange={(e) => setPriorityOverride(pk, 'label', e.target.value)}
                placeholder="Etiqueta"
                style={{ ...inputStyle, width: 120 }}
              />
              <input
                type="color"
                value={pl.dotColor ?? '#888'}
                onChange={(e) => setPriorityOverride(pk, 'dotColor', e.target.value)}
                style={{ width: 32, height: 32, border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0 }}
              />
              <input
                value={pl.color ?? ''}
                onChange={(e) => setPriorityOverride(pk, 'color', e.target.value)}
                placeholder="Variable CSS"
                style={{ ...inputStyle, width: 120, fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}
              />
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: pl.dotColor ?? '#888', flexShrink: 0 }} />
            </div>
          );
        })}
      </Section>

      <Section label="Etiquetas de estado">
        {Object.entries(stateLabels).map(([state, label]) => (
          <div key={state} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ minWidth: 110, color: 'rgba(255,255,255,.55)', fontSize: 'var(--text-xs)' }}>{state}</span>
            <input value={label.label} onChange={(event) => setStateLabel(state, 'label', event.target.value)} style={{ ...inputStyle, width: 150 }} />
            <input value={label.icon} onChange={(event) => setStateLabel(state, 'icon', event.target.value)} style={{ ...inputStyle, width: 120 }} />
          </div>
        ))}
      </Section>

      <Section label="Títulos de zonas">
        <FieldRow label="Sin tomar">
          <input value={zoneLabels.new ?? ''} onChange={(e) => setZone('new', e.target.value)} style={inputStyle} />
        </FieldRow>
        <FieldRow label="En progreso">
          <input value={zoneLabels.active ?? ''} onChange={(e) => setZone('active', e.target.value)} style={inputStyle} />
        </FieldRow>
        <FieldRow label="Servidos hoy">
          <input value={zoneLabels.done ?? ''} onChange={(e) => setZone('done', e.target.value)} style={inputStyle} />
        </FieldRow>
      </Section>

      <Section label="Frases de cocina">
        <FieldRow label="Vacío — título">
          <input value={kitchenPhrases.emptyState ?? ''} onChange={(e) => setPhrase('emptyState', e.target.value)} style={inputStyle} />
        </FieldRow>
        <FieldRow label="Vacío — subtítulo">
          <input value={kitchenPhrases.emptyStateSub ?? ''} onChange={(e) => setPhrase('emptyStateSub', e.target.value)} style={inputStyle} />
        </FieldRow>
        <FieldRow label="Error — título">
          <input value={kitchenPhrases.errorState ?? ''} onChange={(e) => setPhrase('errorState', e.target.value)} style={inputStyle} />
        </FieldRow>
        <FieldRow label="Error — subtítulo">
          <input value={kitchenPhrases.errorStateSub ?? ''} onChange={(e) => setPhrase('errorStateSub', e.target.value)} style={inputStyle} />
        </FieldRow>
        <FieldRow label="Timer en aviso">
          <input value={kitchenPhrases.warningTimer ?? ''} onChange={(e) => setPhrase('warningTimer', e.target.value)} style={inputStyle} />
        </FieldRow>
        <FieldRow label="Timer vencido">
          <input value={kitchenPhrases.breachedTimer ?? ''} onChange={(e) => setPhrase('breachedTimer', e.target.value)} style={inputStyle} />
        </FieldRow>
      </Section>
    </div>
  );
}
