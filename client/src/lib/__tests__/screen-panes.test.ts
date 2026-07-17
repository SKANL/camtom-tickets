import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_FILTER, Issue, createConfigV2 } from '@camtom/shared';
import { buildPaneIssueView } from '../panes';
import { createDefaultScreenState, loadScreenState, reconcileScreenState, SCREEN_STATE_STORAGE_KEY } from '../../hooks/useScreenState';
import { configFixture } from '../../test/config-fixture';

const issue = (id: string, teamId: string, labels: string[] = []): Issue => ({
  id,
  identifier: id.toUpperCase(),
  title: id,
  priority: 1,
  priorityLabel: 'Urgent',
  createdAt: '2026-07-16T10:00:00.000Z',
  updatedAt: '2026-07-16T10:00:00.000Z',
  state: { id: 'open', name: 'Open', type: 'started' },
  team: { id: teamId, name: teamId },
  labels: { nodes: labels.map((name) => ({ id: name, name })) },
});

describe('screen and pane state', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to single using the legacy active team and persists valid split choices', () => {
    expect(createDefaultScreenState(['a', 'b'], 'b').panes.left.teamId).toBe('b');
    const split = createDefaultScreenState(['a', 'b'], 'a');
    split.layout = 'split-vertical';
    localStorage.setItem(SCREEN_STATE_STORAGE_KEY, JSON.stringify(split));
    expect(loadScreenState(['a', 'b']).layout).toBe('split-vertical');
    expect(loadScreenState(['a', 'b']).panes.right?.teamId).toBe('b');
  });

  it('filters the two panes independently from one ticket snapshot', () => {
    const config = configFixture();
    const v2 = createConfigV2(config);
    const issues = [issue('a-1', 'a'), issue('b-plain', 'b'), issue('b-ticket', 'b', ['ticket'])];
    const left = buildPaneIssueView(issues, 'a', v2.teams.a, EMPTY_FILTER);
    const right = buildPaneIssueView(issues, 'b', v2.teams.b, { ...EMPTY_FILTER, textSearch: 'ticket' });
    expect(left.filteredIssues.map((item) => item.id)).toEqual(['a-1']);
    expect(right.filteredIssues.map((item) => item.id)).toEqual(['b-ticket']);
  });

  it('normalizes a corrupted hidden right pane before switching out of single mode', () => {
    const state = createDefaultScreenState(['a', 'b'], 'a');
    (state.panes.right!.filter as any).priorities = ['invalid'];
    localStorage.setItem(SCREEN_STATE_STORAGE_KEY, JSON.stringify(state));
    const loaded = loadScreenState(['a', 'b'], 'a');
    expect(loaded.panes.right?.teamId).toBe('b');
    expect(loaded.panes.right?.filter.priorities).toEqual([]);

    const reconciled = reconcileScreenState(state, ['a', 'b'], 'a');
    expect(reconciled.panes.left.teamId).toBe('a');
    expect(reconciled.panes.right?.filter.priorities).toEqual([]);
  });
});
