import React from 'react';
import { TeamBoardConfig } from '@camtom/shared';
import { Section, FieldRow, selectStyle } from './layout';

interface TeamsTabProps {
  teams: TeamBoardConfig[];
  activeTeamId: string | undefined;
  setActiveTeam: (id: string) => void;
  setTeamField: (teamId: string, field: 'filter' | 'timer', value: string | boolean) => void;
}

const FILTER_LABELS: Record<TeamBoardConfig['filter'], string> = {
  'ticket-label': "Solo con label 'ticket'",
  'active-states': 'Todos los del team',
};

export function TeamsTab({ teams, activeTeamId, setActiveTeam, setTeamField }: TeamsTabProps) {
  if (teams.length === 0) {
    return (
      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 'var(--text-sm)' }}>
        No hay teams configurados. Definilos en <code>config/dashboard.yaml</code>.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <Section label="Team activo">
        <FieldRow label="Mostrar en el board">
          <select
            value={activeTeamId ?? teams[0]?.id}
            onChange={(e) => setActiveTeam(e.target.value)}
            style={{ ...selectStyle, minWidth: 200 }}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </FieldRow>
      </Section>

      <Section label="Criterio por team">
        {teams.map((t) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ minWidth: 150, fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.7)' }}>
              {t.name}
            </span>
            <select
              value={t.filter}
              onChange={(e) => setTeamField(t.id, 'filter', e.target.value)}
              style={{ ...selectStyle, minWidth: 190 }}
            >
              <option value="active-states">{FILTER_LABELS['active-states']}</option>
              <option value="ticket-label">{FILTER_LABELS['ticket-label']}</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 'var(--text-sm)' }}>
              <input
                type="checkbox"
                checked={t.timer !== false}
                onChange={(e) => setTeamField(t.id, 'timer', e.target.checked)}
                style={{ accentColor: 'var(--color-tomato)' }}
              />
              Timer
            </label>
          </div>
        ))}
      </Section>
    </div>
  );
}
