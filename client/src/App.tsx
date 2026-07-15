import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useIssues } from './hooks/useIssues';
import { useConfig } from './hooks/useConfig';
import { useSLA } from './hooks/useSLA';
import { useSound } from './hooks/useSound';
import { useMetadata } from './hooks/useMetadata';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { FridayReport } from './components/FridayReport';
import { SettingsPanel } from './components/SettingsPanel';
import { FilterBar } from './components/FilterBar';
import { ConfigResponse, DashboardConfig, FilterState, DisplayOptions, ZoneLabels, TeamBoardConfig } from '@camtom/shared';
import { isToday, zoneForIssue, matchesTeam, activeTeamOf } from './lib/board';

const FILTER_STORAGE_KEY = 'camtom-filter-state';

const EMPTY_FILTER: FilterState = {
  projects: [], assignees: [], states: [], labels: [], priorities: [], textSearch: '', excludeStates: [],
};

function loadSavedFilter(): FilterState | null {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw) return { ...EMPTY_FILTER, ...JSON.parse(raw) };
  } catch {
    // ignore malformed storage
  }
  return null;
}

interface SettingsOverrides {
  title?: string;
  pollingInterval?: number;
  teamMembers?: string[];
  priorityLabels?: Record<number, Partial<import('@camtom/shared').PriorityLabelConfig>>;
  kitchenPhrases?: Partial<import('@camtom/shared').KitchenPhrases>;
  zoneLabels?: Partial<ZoneLabels>;
  teams?: TeamBoardConfig[];
  activeTeamId?: string;
  slaWindowHours?: number;
  displayOptions?: Partial<DisplayOptions>;
}

function mergeConfig(base: ConfigResponse | null, overrides: SettingsOverrides): ConfigResponse | null {
  if (!base) return null;
  return {
    ...base,
    dashboard: {
      ...base.dashboard,
      ...(overrides.title !== undefined ? { title: overrides.title } : {}),
      ...(overrides.pollingInterval !== undefined ? { pollingInterval: overrides.pollingInterval } : {}),
      ...(overrides.teamMembers !== undefined ? { teamMembers: overrides.teamMembers } : {}),
      ...(overrides.kitchenPhrases !== undefined ? { kitchenPhrases: { ...base.dashboard.kitchenPhrases, ...overrides.kitchenPhrases } } : {}),
      ...(overrides.zoneLabels !== undefined ? { zoneLabels: { ...base.dashboard.zoneLabels, ...overrides.zoneLabels } as ZoneLabels } : {}),
      ...(overrides.teams !== undefined ? { teams: overrides.teams } : {}),
      ...(overrides.activeTeamId !== undefined ? { activeTeamId: overrides.activeTeamId } : {}),
      ...(overrides.slaWindowHours !== undefined ? { report: { ...base.dashboard.report, slaWindowHours: overrides.slaWindowHours } } : {}),
      ...(overrides.displayOptions !== undefined ? { displayOptions: { ...base.dashboard.displayOptions, ...overrides.displayOptions } } : {}),
      ...(overrides.priorityLabels !== undefined ? {
        priorityLabels: {
          ...base.dashboard.priorityLabels,
          ...Object.fromEntries(
            Object.entries(overrides.priorityLabels).map(([k, v]) => [
              k,
              { ...base.dashboard.priorityLabels[Number(k)], ...v },
            ])
          ),
        } as Record<number, import('@camtom/shared').PriorityLabelConfig>,
      } : {}),
    },
  };
}

function App() {
  const [showReport, setShowReport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsOverrides, setSettingsOverrides] = useState<SettingsOverrides>(() => {
    try {
      const raw = localStorage.getItem('camtom-settings-overrides');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const { config: serverConfig, loading: configLoading } = useConfig();
  const config = mergeConfig(serverConfig, settingsOverrides);
  const { issues, loading: issuesLoading, error, lastUpdated, connection } = useIssues();

  // Active team + its board-worthiness criterion (from config). The team selector
  // in Settings just changes activeTeamId; each team carries its own filter/timer.
  const activeTeam = activeTeamOf(config?.dashboard?.teams, config?.dashboard?.activeTeamId);
  const boardReady = Boolean(config && (!(config.dashboard.teams?.length) || activeTeam));
  const teamIssues = useMemo(
    () => issues.filter((i) => matchesTeam(i, activeTeam)),
    [issues, activeTeam?.id, activeTeam?.filter],
  );
  // SLA countdown only when the active team has the timer enabled.
  const timers = useSLA(teamIssues, activeTeam?.timer === false ? undefined : config?.slas);
  const sound = useSound();
  const prevIssuesRef = useRef<Set<string>>(new Set());
  const alertedTimersRef = useRef<Set<string>>(new Set());
  const servedIdsRef = useRef<Set<string>>(new Set());
  const { catalog: metadata } = useMetadata();

  // Filter state — App is the single owner. Restored from localStorage; persisted below.
  // The FilterBar is now a manual, secondary narrowing on top of the active-team filter.
  const [filter, setFilter] = useState<FilterState>(() => loadSavedFilter() ?? EMPTY_FILTER);

  // Persist the filter so it survives reloads (single writer — no FilterBar race).
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
    } catch {
      // ignore full/unavailable storage
    }
  }, [filter]);

  // Client-side filter chain — manual FilterBar narrowing on top of the active team.
  const filteredIssues = useMemo(() => {
    let result = teamIssues;

    // Priority filter
    if (filter.priorities.length > 0) {
      result = result.filter((i) => filter.priorities.includes(i.priority));
    }

    // Project filter
    if (filter.projects.length > 0) {
      result = result.filter((i) => i.project && filter.projects.includes(i.project.id));
    }

    // State filter (include)
    if (filter.states.length > 0) {
      result = result.filter((i) => filter.states.includes(i.state.id));
    }

    // Exclusion step — removes tickets whose state is in excludeStates (wins over inclusion)
    if (filter.excludeStates.length > 0) {
      result = result.filter((i) => !filter.excludeStates.includes(i.state.id));
    }

    // Assignee filter
    if (filter.assignees.length > 0) {
      result = result.filter((i) => i.assignee && filter.assignees.includes(i.assignee.id));
    }

    // Label filter
    if (filter.labels.length > 0) {
      result = result.filter((i) => {
        if (!i.labels?.nodes) return false;
        return i.labels.nodes.some((l) => filter.labels.includes(l.id));
      });
    }

    // Text search (case-insensitive substring on title + identifier)
    if (filter.textSearch.trim().length > 0) {
      const q = filter.textSearch.trim().toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.identifier.toLowerCase().includes(q),
      );
    }

    return result;
  }, [teamIssues, filter]);

  // Served-today shelf — the active team's tickets completed today (independent of
  // the manual FilterBar so completions always celebrate).
  const doneToday = useMemo(
    () =>
      issues
        .filter((i) => matchesTeam(i, activeTeam) && i.state.type === 'completed' && isToday(i.completedAt))
        .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()),
    [issues, activeTeam?.id, activeTeam?.filter],
  );

  const handleSettingsApply = useCallback((overrides: SettingsOverrides) => {
    setSettingsOverrides(overrides);
  }, []);

  useEffect(() => {
    import('cuelume').then((mod) => mod.bind()).catch(() => {});
  }, []);

  useEffect(() => {
    if (issuesLoading || !boardReady || issues.length === 0) return;
    const currentIds = new Set(issues.map((i) => i.id));
    const prevIds = prevIssuesRef.current;

    // Clean up alerted states that no longer apply
    const activeKeys = new Set<string>();
    for (const issue of issues) {
      const t = timers.get(issue.id);
      if (!t) continue;
      if (t.state === 'CRITICAL' || t.state === 'EXPIRED') {
        activeKeys.add(`${issue.id}:${t.state}`);
      }
    }
    // Remove stale entries from alertedTimers
    for (const key of alertedTimersRef.current) {
      if (!activeKeys.has(key)) {
        alertedTimersRef.current.delete(key);
      }
    }

    // Completed-today ids for the active team (drives the "served" celebration sound)
    const servedNow = new Set(
      issues
        .filter((i) => matchesTeam(i, activeTeam) && i.state.type === 'completed' && isToday(i.completedAt))
        .map((i) => i.id),
    );

    if (prevIds.size > 0) {
      // Arrival — any new board-worthy ticket that lands in the untaken hero zone (once per batch)
      const arrivals = issues.filter(
        (i) => matchesTeam(i, activeTeam) && !prevIds.has(i.id) && zoneForIssue(i) === 'new',
      );
      if (arrivals.length > 0) sound.playNewUrgent();

      // Timer escalation — once per (ticket, state) transition
      for (const issue of issues) {
        const t = timers.get(issue.id);
        if (!t) continue;
        const key = `${issue.id}:${t.state}`;
        if (alertedTimersRef.current.has(key)) continue;
        alertedTimersRef.current.add(key);
        if (t.state === 'EXPIRED') sound.playBreach();
        else if (t.state === 'CRITICAL') sound.playWarning();
      }

      // Served — dish out a success chime once when any ticket newly completes
      let served = false;
      for (const id of servedNow) {
        if (!servedIdsRef.current.has(id)) served = true;
      }
      if (served) sound.playSuccess();
    }
    servedIdsRef.current = servedNow;
    prevIssuesRef.current = currentIds;
  }, [issues, issuesLoading, boardReady, timers, sound, activeTeam?.id, activeTeam?.filter]);

  const isFriday = new Date().getDay() === 5;
  const toggleReport = () => setShowReport((prev) => !prev);
  const title = config?.dashboard?.title || 'Panel de Soporte Camtom';
  const syncLabel = connection === 'live' ? 'En vivo' : connection === 'reconnecting' ? 'Reconectando' : 'Conectando';
  const updatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'sin datos aún';
  const visibleCount = filteredIssues.filter((issue) => {
    const zone = zoneForIssue(issue);
    return zone === 'new' || zone === 'active';
  }).length + doneToday.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', width: '100vw', overflow: 'hidden' }}>
      <Header
        title={title}
        isMuted={sound.isMuted}
        onToggleMute={sound.toggleMute}
        onToggleReport={toggleReport}
        showReport={showReport}
        isFriday={isFriday}
        config={config}
        activeTeam={boardReady ? activeTeam : undefined}
        onOpenSettings={() => setShowSettings(true)}
      />
      <main style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--color-ketchup)',
            color: '#fff',
            padding: '6px var(--space-lg)',
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-sm)',
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          Problema de conexión — mostrando los últimos datos. {error}
        </div>
      )}
      <div
        role="status"
        aria-live="polite"
        className="sync-status"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '6px var(--space-lg)',
          background: 'rgba(0,0,0,0.22)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.65)',
          fontSize: 'var(--text-xs)',
          flexShrink: 0,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: connection === 'live' ? 'var(--color-lettuce)' : 'var(--color-mustard)',
              boxShadow: connection === 'live' ? '0 0 8px rgba(76,175,80,.65)' : 'none',
            }}
          />
          {syncLabel} · Última actualización: {updatedLabel}
        </span>
        <span>
          {activeTeam?.filter === 'ticket-label' ? 'Etiqueta: ticket' : 'Todos los estados activos'}
          {' · '}{boardReady ? visibleCount : 0} visibles de {issues.length}
        </span>
      </div>
      {showReport ? (
        boardReady ? <FridayReport issues={issues} playSuccess={sound.playSuccess} config={config} /> : null
      ) : (
        <>
          <FilterBar metadata={metadata} filter={filter} onChange={setFilter} />
          <Dashboard
            issues={boardReady ? filteredIssues : []}
            doneToday={boardReady ? doneToday : []}
            timers={timers}
            loading={issuesLoading || configLoading || !boardReady}
            error={error}
            config={config}
          />
        </>
      )}
      </main>

      {showSettings && config && (
        <SettingsPanel
          config={config}
          onApply={handleSettingsApply}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
