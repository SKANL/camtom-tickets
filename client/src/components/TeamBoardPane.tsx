import React, { useMemo } from 'react';
import {
  ConfigResponse,
  Issue,
  MetadataCatalog,
  ScreenPaneState,
  TeamBoardConfig,
  TeamDashboardSettings,
  TimerInfo,
  materializeTeamConfig,
} from '@camtom/shared';
import { Dashboard } from './Dashboard';
import { FilterBar } from './FilterBar';
import { FridayReport } from './FridayReport';
import { buildPaneIssueView } from '../lib/panes';

interface TeamBoardPaneProps {
  paneId: 'left' | 'right';
  pane: ScreenPaneState;
  teams: TeamBoardConfig[];
  settingsByTeam: Record<string, TeamDashboardSettings>;
  config: ConfigResponse;
  issues: Issue[];
  timers: Map<string, TimerInfo>;
  metadata: MetadataCatalog | null;
  loading: boolean;
  error: string | null;
  readOnly?: boolean;
  onChange: (update: Partial<ScreenPaneState>) => void;
}

const NO_SOUND = () => {};

export function TeamBoardPane({
  paneId,
  pane,
  teams,
  settingsByTeam,
  config,
  issues,
  timers,
  metadata,
  loading,
  error,
  readOnly = false,
  onChange,
}: TeamBoardPaneProps) {
  const settings = settingsByTeam[pane.teamId];
  const team = teams.find((candidate) => candidate.id === pane.teamId);
  const view = useMemo(
    () => settings ? buildPaneIssueView(issues, pane.teamId, settings, pane.filter) : null,
    [issues, pane.teamId, pane.filter, settings],
  );
  const effectiveConfig = useMemo(
    () => settings ? materializeTeamConfig(config, pane.teamId) : config,
    [config, pane.teamId, settings],
  );
  const accent = settings?.accent ?? team?.accent ?? 'var(--color-tomato)';

  return (
    <section
      className="team-board-pane"
      aria-label={`${paneId === 'left' ? 'Panel izquierdo' : 'Panel derecho'}: ${team?.name ?? 'sin team'}`}
      style={{ '--pane-accent': accent } as React.CSSProperties}
    >
      <div className="pane-toolbar">
        {!readOnly && (
          <label>
            <span className="sr-only">Team del {paneId === 'left' ? 'panel izquierdo' : 'panel derecho'}</span>
            <select
              aria-label={`Team del panel ${paneId === 'left' ? 'izquierdo' : 'derecho'}`}
              value={pane.teamId}
              onChange={(event) => onChange({ teamId: event.target.value })}
            >
              {teams.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
        )}
        <span className="pane-team-name">{team?.name ?? 'Team no disponible'}</span>
        {readOnly ? (
          <span className="pane-controlled-state" aria-label="Vista controlada remotamente">
            {pane.view === 'report' ? 'Reporte' : 'Tablero'} · Controlado desde la laptop
          </span>
        ) : (
          <button
            type="button"
            aria-pressed={pane.view === 'report'}
            onClick={() => onChange({ view: pane.view === 'board' ? 'report' : 'board' })}
          >
            {pane.view === 'board' ? 'Reporte' : 'Tablero'}
          </button>
        )}
      </div>

      {!settings || !view ? (
        <div role="alert" className="pane-empty">La configuración de este team no está disponible.</div>
      ) : pane.view === 'report' ? (
        <FridayReport issues={view.teamIssues} playSuccess={NO_SOUND} config={effectiveConfig} />
      ) : (
        <>
          {!readOnly && <FilterBar metadata={metadata} filter={pane.filter} onChange={(filter) => onChange({ filter })} />}
          <Dashboard
            issues={view.filteredIssues}
            doneToday={view.doneToday}
            timers={timers}
            loading={loading}
            error={error}
            config={effectiveConfig}
          />
        </>
      )}
    </section>
  );
}
