import { describe, expect, it } from 'vitest';
import { ReconcileIssue } from '../linear-client';
import { buildFullReconcilePlan } from '../reconciliation';

function issue(id: string, teamId = 'team', archivedAt?: string): ReconcileIssue {
  return {
    id,
    identifier: id,
    title: id,
    priority: 1,
    priorityLabel: 'Urgent',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt,
    state: { id: 'state', name: 'Open', type: 'started' },
    team: { id: teamId, name: teamId },
  };
}

describe('full reconciliation planning', () => {
  it('separates active and archived issues within configured scope', () => {
    const plan = buildFullReconcilePlan(
      [issue('active'), issue('archived', 'team', '2026-01-02T00:00:00.000Z')],
      ['team'],
      [{ id: 'active', team: { id: 'team' }, synced_at: '2026-01-01T00:00:00.000Z' }],
      null,
    );
    expect(plan.active.map((value) => value.id)).toEqual(['active']);
    expect(plan.archived.map((value) => value.id)).toEqual(['archived']);
    expect(plan.baseline).toBe(true);
  });

  it('rejects duplicate and out-of-scope snapshots as incomplete', () => {
    expect(() => buildFullReconcilePlan([issue('one'), issue('one')], ['team'], [], null)).toThrow('Duplicate');
    expect(() => buildFullReconcilePlan([issue('one', 'other')], ['team'], [], null)).toThrow('outside');
  });

  it('blocks excessive count drops and missing candidates', () => {
    const current = Array.from({ length: 30 }, (_, index) => ({
      id: `current-${index}`,
      team: { id: 'team' },
      synced_at: '2026-01-01T00:00:00.000Z',
    }));
    const plan = buildFullReconcilePlan(
      [issue('current-0')],
      ['team'],
      current,
      { last_snapshot_count: 30, successful_snapshots: 1 },
    );
    expect(plan.blockedReasons).toEqual(expect.arrayContaining([
      expect.stringContaining('10%'),
      expect.stringContaining('25'),
      expect.stringContaining('5%'),
    ]));
  });

  it('blocks anomalous archived deletes even on a baseline apply plan', () => {
    const current = Array.from({ length: 10 }, (_, index) => ({
      id: `current-${index}`,
      team: { id: 'team' },
      synced_at: '2026-01-01T00:00:00.000Z',
    }));
    const plan = buildFullReconcilePlan(
      [issue('current-0', 'team', '2026-01-02T00:00:00.000Z')],
      ['team'],
      current,
      null,
    );
    expect(plan.baseline).toBe(true);
    expect(plan.blockedReasons).toContainEqual(expect.stringContaining('Archived candidates exceed 5%'));
  });
});
