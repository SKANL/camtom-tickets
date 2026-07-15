import React from 'react';
import { PriorityLabelConfig, KitchenPhrases } from '@camtom/shared';
import { PRIORITY_LEVELS, PRIORITY_BY_LEVEL } from '../../lib/priorities';
import { Section, FieldRow, inputStyle } from './layout';

interface LabelsTabProps {
  priorityLabels: Record<number, Partial<PriorityLabelConfig>>;
  kitchenPhrases: KitchenPhrases;
  setPriorityOverride: (priority: number, field: keyof PriorityLabelConfig, value: string) => void;
  setPhrase: (key: keyof KitchenPhrases, value: string) => void;
}

export function LabelsTab({ priorityLabels, kitchenPhrases, setPriorityOverride, setPhrase }: LabelsTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <Section label="Priority Labels & Colors">
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
                placeholder="Label"
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
                placeholder="CSS var"
                style={{ ...inputStyle, width: 120, fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}
              />
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: pl.dotColor ?? '#888', flexShrink: 0 }} />
            </div>
          );
        })}
      </Section>

      <Section label="Kitchen Phrases">
        <FieldRow label="Empty state">
          <input
            value={kitchenPhrases.emptyState ?? ''}
            onChange={(e) => setPhrase('emptyState', e.target.value)}
            style={inputStyle}
          />
        </FieldRow>
        <FieldRow label="Warning timer">
          <input
            value={kitchenPhrases.warningTimer ?? ''}
            onChange={(e) => setPhrase('warningTimer', e.target.value)}
            style={inputStyle}
          />
        </FieldRow>
        <FieldRow label="Breached timer">
          <input
            value={kitchenPhrases.breachedTimer ?? ''}
            onChange={(e) => setPhrase('breachedTimer', e.target.value)}
            style={inputStyle}
          />
        </FieldRow>
      </Section>
    </div>
  );
}
