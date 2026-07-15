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
import { ConfigResponse, DashboardConfig, FilterState, DisplayOptions, ZoneLabels } from '@camtom/shared';
import { isToday, hasTicketLabel, zoneForIssue } from './lib/board';

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
  const { config: serverConfig } = useConfig();
  const config = mergeConfig(serverConfig, settingsOverrides);
  const { issues, loading, error } = useIssues();
  const timers = useSLA(issues, config?.slas);
  const sound = useSound();
  const prevIssuesRef = useRef<Set<string>>(new Set());
  const alertedTimersRef = useRef<Set<string>>(new Set());
  const servedIdsRef = useRef<Set<string>>(new Set());
  const { catalog: metadata } = useMetadata();

  // Filter state — App is the single owner. Restored from localStorage; persisted below.
  const [filter, setFilter] = useState<FilterState>(() => loadSavedFilter() ?? EMPTY_FILTER);

  // Metadata-derived defaults apply once, and only on a fresh visit (nothing restored),
  // so they never fight a filter the user has already customized.
  const defaultsAppliedRef = useRef(loadSavedFilter() !== null);

  // Persist the filter so it survives reloads (single writer — no FilterBar race).
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
    } catch {
      // ignore full/unavailable storage
    }
  }, [filter]);

  useEffect(() => {
    if (!metadata || defaultsAppliedRef.current) return;

    const doneState = metadata.workflowStates.find((s) =>
      s.name.toLowerCase().includes('done'),
    );
    const prState = metadata.workflowStates.find((s) =>
      s.name.toLowerCase().includes('pull request'),
    );
    const excludeIds = [doneState?.id, prState?.id].filter(Boolean) as string[];

    // Default active states: In Progress, Backlog, Todo (across all teams/projects)
    const activeNames = ['in progress', 'backlog', 'todo', 'to-do'];
    const activeIds = metadata.workflowStates
      .filter((s) => activeNames.includes(s.name.toLowerCase()))
      .map((s) => s.id);

    const ticketLabel = metadata.labels.find(
      (l) => l.name.toLowerCase() === 'ticket',
    );

    setFilter((prev) => ({
      ...prev,
      states:
        prev.states.length > 0 ? prev.states : activeIds,
      excludeStates:
        prev.excludeStates.length > 0 ? prev.excludeStates : excludeIds,
      labels:
        prev.labels.length > 0
          ? prev.labels
          : ticketLabel
            ? [ticketLabel.id]
            : [],
    }));
    defaultsAppliedRef.current = true;
  }, [metadata]);

  // Client-side filter chain
  const filteredIssues = useMemo(() => {
    let result = issues;

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
  }, [issues, filter]);

  // Served-today shelf — computed from the UNFILTERED set (Done is excluded by the
  // default state filter) so completions show regardless of the user's active-state filter.
  const doneToday = useMemo(
    () =>
      issues
        .filter((i) => i.state.type === 'completed' && hasTicketLabel(i) && isToday(i.completedAt))
        .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()),
    [issues],
  );

  const handleSettingsApply = useCallback((overrides: SettingsOverrides) => {
    setSettingsOverrides(overrides);
  }, []);

  useEffect(() => {
    import('cuelume').then((mod) => mod.bind()).catch(() => {});
  }, []);

  useEffect(() => {
    if (loading || issues.length === 0) return;
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

    // Completed-today ticket ids (drives the "served" celebration sound)
    const servedNow = new Set(
      issues
        .filter((i) => i.state.type === 'completed' && hasTicketLabel(i) && isToday(i.completedAt))
        .map((i) => i.id),
    );

    if (prevIds.size > 0) {
      // Arrival — any new ticket that lands in the untaken hero zone (once per batch)
      const arrivals = issues.filter(
        (i) => hasTicketLabel(i) && !prevIds.has(i.id) && zoneForIssue(i) === 'new',
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
  }, [issues, loading, timers, sound]);

  const isFriday = new Date().getDay() === 5;
  const toggleReport = () => setShowReport((prev) => !prev);
  const title = config?.dashboard?.title || 'Panel de Soporte Camtom';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Header
        title={title}
        isMuted={sound.isMuted}
        onToggleMute={sound.toggleMute}
        onToggleReport={toggleReport}
        showReport={showReport}
        isFriday={isFriday}
        config={config}
        onOpenSettings={() => setShowSettings(true)}
      />
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
      {showReport ? (
        <FridayReport issues={issues} playSuccess={sound.playSuccess} config={config} />
      ) : (
        <>
          <FilterBar metadata={metadata} filter={filter} onChange={setFilter} />
          <Dashboard issues={filteredIssues} doneToday={doneToday} timers={timers} loading={loading} error={error} config={config} />
        </>
      )}

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
