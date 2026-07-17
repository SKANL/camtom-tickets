import React from 'react';
import { Section, FieldRow, inputStyle } from './layout';
import { Button } from '../ui/Button';

interface GeneralTabProps {
  title: string;
  slaWindowHours: number;
  reportEnabled: boolean;
  teamMembers: string[];
  newMemberName: string;
  setNewMemberName: (value: string) => void;
  addTeamMember: (name: string) => void;
  removeTeamMember: (index: number) => void;
  onTitleChange: (value: string) => void;
  onSlaWindowHoursChange: (value: number) => void;
  onReportEnabledChange: (value: boolean) => void;
}

export function GeneralTab({
  title,
  slaWindowHours,
  reportEnabled,
  teamMembers,
  newMemberName,
  setNewMemberName,
  addTeamMember,
  removeTeamMember,
  onTitleChange,
  onSlaWindowHoursChange,
  onReportEnabledChange,
}: GeneralTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <Section label="General">
        <FieldRow label="Título del panel">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            style={inputStyle}
          />
        </FieldRow>
        <FieldRow label="Reporte habilitado">
          <input type="checkbox" checked={reportEnabled} onChange={(e) => onReportEnabledChange(e.target.checked)} />
        </FieldRow>
        <FieldRow label="Ventana SLA (horas)">
          <input
            type="number"
            min={1}
            max={168}
            value={slaWindowHours}
            onChange={(e) => onSlaWindowHoursChange(Number(e.target.value))}
            style={{ ...inputStyle, width: 80 }}
          />
        </FieldRow>
      </Section>

      <Section label="Integrantes">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {teamMembers.map((name, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'var(--color-mayo)' }}>{name}</span>
              <Button
                variant="danger"
                onClick={() => removeTeamMember(i)}
                style={{ padding: '2px 8px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-display)' }}
              >
                Quitar
</Button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input
              placeholder="Agregar integrante..."
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newMemberName.trim()) {
                  addTeamMember(newMemberName);
                  setNewMemberName('');
                }
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
            <Button
              variant="primary"
              onClick={() => {
                if (newMemberName.trim()) {
                  addTeamMember(newMemberName);
                  setNewMemberName('');
                }
              }}
              style={{ padding: '4px 16px', fontSize: 'var(--text-sm)', letterSpacing: '0.05em' }}
            >
              Agregar
</Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
