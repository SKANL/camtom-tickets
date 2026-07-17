import { useCallback, useEffect, useState } from 'react';
import { EMPTY_FILTER, ScreenPaneState, ScreenState, validateScreenState } from '@camtom/shared';

export const SCREEN_STATE_STORAGE_KEY = 'camtom-screen-state-v1';

export function createDefaultScreenState(teamIds: readonly string[], legacyActiveTeamId?: string): ScreenState {
  const leftId = teamIds.includes(legacyActiveTeamId ?? '') ? legacyActiveTeamId! : (teamIds[0] ?? '');
  const rightId = teamIds.find((id) => id !== leftId) ?? leftId;
  return {
    schemaVersion: 1,
    layout: 'single',
    panes: {
      left: createPane(leftId),
      right: createPane(rightId),
    },
  };
}

export function loadScreenState(teamIds: readonly string[], legacyActiveTeamId?: string): ScreenState {
  try {
    const raw = localStorage.getItem(SCREEN_STATE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (validateScreenState(parsed, teamIds).length === 0) return parsed;
    }
  } catch {
    // Fall through to a safe compatible default.
  }
  return createDefaultScreenState(teamIds, legacyActiveTeamId);
}

export function reconcileScreenState(
  current: ScreenState,
  teamIds: readonly string[],
  legacyActiveTeamId?: string,
): ScreenState {
  if (validateScreenState(current, teamIds).length === 0) return current;
  const fallback = createDefaultScreenState(teamIds, legacyActiveTeamId);
  const left = isValidPane(current.panes.left, teamIds) ? current.panes.left : fallback.panes.left;
  const right = isValidPane(current.panes.right, teamIds)
    ? current.panes.right
    : fallback.panes.right;
  return {
    schemaVersion: 1,
    layout: current.layout === 'split-vertical' && teamIds.length > 0 ? 'split-vertical' : 'single',
    panes: { left, right },
  };
}

function isValidPane(pane: ScreenPaneState | undefined, teamIds: readonly string[]): pane is ScreenPaneState {
  if (!pane) return false;
  return validateScreenState({
    schemaVersion: 1,
    layout: 'single',
    panes: { left: pane, right: pane },
  }, teamIds).length === 0;
}

export function useScreenState(teamIds: readonly string[], legacyActiveTeamId?: string) {
  const [state, setState] = useState<ScreenState>(() => loadScreenState(teamIds, legacyActiveTeamId));

  useEffect(() => {
    setState((current) => reconcileScreenState(current, teamIds, legacyActiveTeamId));
  }, [teamIds.join('|'), legacyActiveTeamId]);

  useEffect(() => {
    try {
      localStorage.setItem(SCREEN_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Screen state remains usable for this tab if persistence is unavailable.
    }
  }, [state]);

  const updatePane = useCallback((pane: 'left' | 'right', update: Partial<ScreenPaneState>) => {
    setState((current) => {
      const existing = pane === 'left' ? current.panes.left : (current.panes.right ?? createPane(current.panes.left.teamId));
      return { ...current, panes: { ...current.panes, [pane]: { ...existing, ...update } } };
    });
  }, []);

  return { state, setState, updatePane };
}

function createPane(teamId: string): ScreenPaneState {
  return { teamId, view: 'board', filter: { ...EMPTY_FILTER } };
}
