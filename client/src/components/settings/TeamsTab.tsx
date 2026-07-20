import React from 'react';
import { ScreenState, TeamBoardConfig, TeamDashboardSettings } from '@camtom/shared';
import { FieldRow, Section, inputStyle, selectStyle } from './layout';

interface TeamsTabProps {
  teams: TeamBoardConfig[];
  selectedTeamId: string;
  settings: TeamDashboardSettings;
  screenState: ScreenState;
  onSelectTeam: (id: string) => void;
  onTeamChange: (patch: Partial<TeamDashboardSettings>) => void;
  onScreenChange: (state: ScreenState) => void;
}

export function TeamsTab({
  teams,
  selectedTeamId,
  settings,
  screenState,
  onSelectTeam,
  onTeamChange,
  onScreenChange,
}: TeamsTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
      <Section label="Pantalla de este navegador">
        <FieldRow label="Layout">
          <select
            value={screenState.layout}
            onChange={(event) => onScreenChange({ ...screenState, layout: event.target.value as ScreenState['layout'] })}
            style={selectStyle}
          >
            <option value="single">Vista simple</option>
            <option value="split-vertical">División vertical</option>
          </select>
        </FieldRow>
        <FieldRow label="Panel izquierdo">
          <TeamSelect
            value={screenState.panes.left.teamId}
            teams={teams}
            onChange={(teamId) => onScreenChange({
              ...screenState,
              panes: { ...screenState.panes, left: { ...screenState.panes.left, teamId } },
            })}
          />
        </FieldRow>
        {screenState.layout === 'split-vertical' && (
          <FieldRow label="Panel derecho">
            <TeamSelect
              value={screenState.panes.right?.teamId ?? teams[0]?.id ?? ''}
              teams={teams}
              onChange={(teamId) => onScreenChange({
                ...screenState,
                panes: {
                  ...screenState.panes,
                  right: {
                    ...(screenState.panes.right ?? screenState.panes.left),
                    teamId,
                  },
                },
              })}
            />
          </FieldRow>
        )}
        <p style={{ color: 'rgba(255,255,255,.5)', fontSize: 'var(--text-xs)' }}>
          Esta selección pertenece sólo a este navegador. Para cambiar una TV vinculada usá <strong>/control</strong>; sus equipos y layout se guardan de forma independiente.
        </p>
      </Section>

      <Section label="Configuración independiente por team">
        <FieldRow label="Editar team">
          <TeamSelect value={selectedTeamId} teams={teams} onChange={onSelectTeam} />
        </FieldRow>
        <FieldRow label="Criterio">
          <select
            value={settings.filter}
            onChange={(event) => onTeamChange({ filter: event.target.value as TeamDashboardSettings['filter'] })}
            style={selectStyle}
          >
            <option value="active-states">Todos los estados activos</option>
            <option value="ticket-label">Sólo con label ticket</option>
          </select>
        </FieldRow>
        <FieldRow label="Timer">
          <input type="checkbox" checked={settings.timer} onChange={(event) => onTeamChange({ timer: event.target.checked })} />
        </FieldRow>
        <FieldRow label="Color">
          <input
            type="color"
            value={settings.accent ?? '#ff6347'}
            onChange={(event) => onTeamChange({ accent: event.target.value })}
            style={{ ...inputStyle, width: 56, padding: 2 }}
          />
        </FieldRow>
      </Section>
    </div>
  );
}

function TeamSelect({ value, teams, onChange }: { value: string; teams: TeamBoardConfig[]; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
    </select>
  );
}
