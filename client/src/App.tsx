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
import { ConfigResponse, DashboardConfig, FilterState, DisplayOptions } from '@camtom/shared';


interface SettingsOverrides {
  title?: string;
  pollingInterval?: number;
  teamMembers?: string[];
  priorityLabels?: Record<number, Partial<import('@camtom/shared').PriorityLabelConfig>>;
  kitchenPhrases?: Partial<import('@camtom/shared').KitchenPhrases>;
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
  const { issues, loading } = useIssues();
  const timers = useSLA(issues, config?.slas);
  const sound = useSound();
  const prevIssuesRef = useRef<Set<string>>(new Set());
  const alertedTimersRef = useRef<Set<string>>(new Set());
  const { catalog: metadata } = useMetadata();

  // Filter state — Phase 1: all empty, excludeStates initialized
  const [filter, setFilter] = useState<FilterState>({
    projects: [],
    assignees: [],
    states: [],
    labels: [],
    priorities: [],
    textSearch: '',
    excludeStates: [],
  });

  // Phase 2: resolve defaults from metadata once it's available
  const defaultsAppliedRef = useRef(false);

  useEffect(() => {
    if (!metadata || defaultsAppliedRef.current) return;

    const doneState = metadata.workflowStates.find((s) =>
      s.name.toLowerCase().includes('done'),
    );
    const prState = metadata.workflowStates.find((s) =>
      s.name.toLowerCase().includes('pull request'),
    );
    const excludeIds = [doneState?.id, prState?.id].filter(Boolean) as string[];
    const ticketLabel = metadata.labels.find(
      (l) => l.name.toLowerCase() === 'ticket',
    );

    setFilter((prev) => ({
      ...prev,
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

  const handleSettingsApply = useCallback((overrides: SettingsOverrides) => {
    setSettingsOverrides(overrides);
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    import('cuelume').then((mod) => {
      mod.bind();
    }).catch(() => {});
    return () => { cleanup?.(); };
  }, []);

  useEffect(() => {
    if (loading || issues.length === 0) return;
    const currentIds = new Set(issues.map((i) => i.id));
    const prevIds = prevIssuesRef.current;

    // Clean up alerted states that no longer apply
    const activeKeys = new Set<string>();
    for (const issue of issues) {
      const issueTimers = timers.get(issue.id);
      if (!issueTimers) continue;
      for (const t of issueTimers) {
        if (t.state !== 'OK') {
          activeKeys.add(`${issue.id}:${t.slaId}:${t.state}`);
        }
      }
    }
    // Remove stale entries from alertedTimers
    for (const key of alertedTimersRef.current) {
      if (!activeKeys.has(key)) {
        alertedTimersRef.current.delete(key);
      }
    }

    if (prevIds.size > 0) {
      const newUrgent = issues.filter((i) => i.priority === 1 && !prevIds.has(i.id));
      if (newUrgent.length > 0) sound.playNewUrgent();
      for (const issue of issues) {
        const issueTimers = timers.get(issue.id);
        if (!issueTimers) continue;
        // Play sound once per issue per timer state change
        for (const t of issueTimers) {
          const key = `${issue.id}:${t.slaId}:${t.state}`;
          if (alertedTimersRef.current.has(key)) continue;
          alertedTimersRef.current.add(key);
          if (t.state === 'BREACHED') sound.playBreach();
          else if (t.state === 'WARNING') sound.playWarning();
        }
      }
    }
    prevIssuesRef.current = currentIds;
  }, [issues, loading, timers, sound]);

  const isFriday = new Date().getDay() === 5;
  const toggleReport = () => setShowReport((prev) => !prev);
  const title = config?.dashboard?.title || 'Camtom Ticket Dashboard';

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
      {showReport ? (
        <FridayReport issues={issues} playSuccess={sound.playSuccess} config={config} />
      ) : (
        <>
          <FilterBar metadata={metadata} filter={filter} onChange={setFilter} />
          <Dashboard issues={filteredIssues} timers={timers} loading={loading} config={config} />
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
