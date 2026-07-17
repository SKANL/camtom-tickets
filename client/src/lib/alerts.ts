import { Issue, TeamDashboardSettings, TimerInfo } from '@camtom/shared';
import { isToday, matchesTeam, zoneForIssue } from './board';

export const ALERT_MEMORY_STORAGE_KEY = 'camtom-alert-memory-v1';
const MAX_PENDING = 200;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type AlertKind = 'arrival' | 'warning' | 'breach' | 'success';
type AlertTimerState = 'CRITICAL' | 'EXPIRED' | null;

export interface AlertIssueState {
  teamId: string;
  urgent: boolean;
  served: boolean;
  /** undefined means the timer hook has not hydrated this expected timer yet. */
  timerState?: AlertTimerState;
  version: string;
  observedAt: number;
}

export interface AlertPendingEvent {
  key: string;
  issueId: string;
  teamId: string;
  kind: AlertKind;
  version: string;
  createdAt: number;
}

export interface AlertSnapshot {
  issues: Record<string, AlertIssueState>;
}

export interface AlertMemory {
  schemaVersion: 1;
  initialized: boolean;
  issues: Record<string, AlertIssueState>;
  pending: AlertPendingEvent[];
}

export interface AlertActions {
  arrival: boolean;
  warning: boolean;
  breach: boolean;
  success: boolean;
  next: AlertMemory;
}

export function buildAlertSnapshot(
  issues: Issue[],
  settingsByTeam: Record<string, TeamDashboardSettings>,
  timers: Map<string, TimerInfo>,
  now = Date.now(),
): AlertSnapshot {
  const snapshot: AlertSnapshot = { issues: {} };
  for (const issue of issues) {
    const teamId = issue.team?.id;
    const settings = teamId ? settingsByTeam[teamId] : undefined;
    if (!teamId || !settings || !matchesTeam(issue, {
      id: teamId,
      name: teamId,
      filter: settings.filter,
      timer: settings.timer,
    })) continue;
    const timer = timers.get(issue.id);
    const timerExpected = settings.timer
      && settings.slas.some((sla) => sla.applicablePriorities.includes(issue.priority));
    const timerState = timer?.state;
    snapshot.issues[issue.id] = {
      teamId,
      urgent: zoneForIssue(issue) === 'new',
      served: issue.state.type === 'completed' && isToday(issue.completedAt),
      timerState: timer
        ? (timerState === 'CRITICAL' || timerState === 'EXPIRED' ? timerState : null)
        : (timerExpected ? undefined : null),
      version: issue.updatedAt,
      observedAt: now,
    };
  }
  return snapshot;
}

export function diffAlerts(
  memory: AlertMemory,
  snapshot: AlertSnapshot,
  visibleTeamIds: readonly string[],
  now = Date.now(),
): AlertActions {
  if (!memory.initialized) {
    return noActions({
      schemaVersion: 1,
      initialized: true,
      issues: retainActiveIssues(Object.fromEntries(
        Object.entries(snapshot.issues).map(([id, issue]) => [id, {
          ...issue,
          timerState: issue.timerState ?? null,
        }]),
      )),
      pending: [],
    });
  }

  const pendingByKey = new Map(
    memory.pending
      .filter((event) => now - event.createdAt <= RETENTION_MS)
      .map((event) => [event.key, event]),
  );
  const nextIssues: Record<string, AlertIssueState> = {};

  for (const [issueId, current] of Object.entries(snapshot.issues)) {
    const previous = memory.issues[issueId];
    // Ignore an out-of-order snapshot and preserve the newest observed state.
    if (previous && current.version < previous.version) {
      nextIssues[issueId] = previous;
      continue;
    }
    const normalizedCurrent: AlertIssueState = {
      ...current,
      timerState: current.timerState === undefined ? (previous?.timerState ?? null) : current.timerState,
    };
    nextIssues[issueId] = normalizedCurrent;
    if (!previous) {
      if (normalizedCurrent.urgent) addPending(pendingByKey, issueId, normalizedCurrent, 'arrival', normalizedCurrent.version, now);
      continue;
    }
    if (normalizedCurrent.urgent && !previous.urgent) {
      addPending(pendingByKey, issueId, normalizedCurrent, 'arrival', normalizedCurrent.version, now);
    }
    if (normalizedCurrent.served && !previous.served) {
      addPending(pendingByKey, issueId, normalizedCurrent, 'success', normalizedCurrent.version, now);
    }
    if (normalizedCurrent.timerState && normalizedCurrent.timerState !== previous.timerState) {
      addPending(
        pendingByKey,
        issueId,
        normalizedCurrent,
        normalizedCurrent.timerState === 'EXPIRED' ? 'breach' : 'warning',
        `${normalizedCurrent.version}:${normalizedCurrent.timerState}`,
        now,
      );
    }
  }

  const visible = new Set(visibleTeamIds);
  const actions = { arrival: false, warning: false, breach: false, success: false };
  const remaining: AlertPendingEvent[] = [];
  for (const event of [...pendingByKey.values()].sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key))) {
    if (visible.has(event.teamId)) actions[event.kind] = true;
    else remaining.push(event);
  }

  return {
    ...actions,
    next: {
      schemaVersion: 1,
      initialized: true,
      issues: retainActiveIssues(nextIssues),
      pending: remaining.slice(-MAX_PENDING),
    },
  };
}

export function emptyAlertMemory(): AlertMemory {
  return { schemaVersion: 1, initialized: false, issues: {}, pending: [] };
}

export function alertMemoryStorageKey(scope = 'legacy'): string {
  return scope === 'legacy' ? ALERT_MEMORY_STORAGE_KEY : `${ALERT_MEMORY_STORAGE_KEY}:${scope}`;
}

export function loadAlertMemory(
  scope = 'legacy',
  storage: Pick<Storage, 'getItem'> = localStorage,
): AlertMemory {
  try {
    const value = JSON.parse(storage.getItem(alertMemoryStorageKey(scope)) ?? 'null');
    if (value?.schemaVersion !== 1 || typeof value.initialized !== 'boolean'
      || !value.issues || typeof value.issues !== 'object' || !Array.isArray(value.pending)) {
      return emptyAlertMemory();
    }
    return value as AlertMemory;
  } catch {
    return emptyAlertMemory();
  }
}

export function saveAlertMemory(
  memory: AlertMemory,
  scope = 'legacy',
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(alertMemoryStorageKey(scope), JSON.stringify(memory));
  } catch {
    // Alerting remains correct for this tab when storage is unavailable.
  }
}

function addPending(
  pending: Map<string, AlertPendingEvent>,
  issueId: string,
  issue: AlertIssueState,
  kind: AlertKind,
  version: string,
  now: number,
): void {
  const key = `${issueId}:${kind}:${version}`;
  if (!pending.has(key)) pending.set(key, { key, issueId, teamId: issue.teamId, kind, version, createdAt: now });
}

function retainActiveIssues(issues: Record<string, AlertIssueState>): Record<string, AlertIssueState> {
  // Exact dedupe requires one baseline per currently active ticket. History for
  // tickets no longer in the current snapshot is dropped; only pending events
  // retain bounded/expiring history. Never evict an active baseline by capacity.
  return issues;
}

function noActions(next: AlertMemory): AlertActions {
  return { arrival: false, warning: false, breach: false, success: false, next };
}
