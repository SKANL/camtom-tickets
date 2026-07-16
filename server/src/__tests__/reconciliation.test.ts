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

  it('does not block archived snapshot history that is absent from Supabase', () => {
    const current = Array.from({ length: 398 }, (_, index) => ({
      id: `active-${index}`,
      team: { id: 'team' },
      synced_at: '2026-01-01T00:00:00.000Z',
    }));
    const active = Array.from({ length: 412 }, (_, index) => issue(`active-${index}`));
    const archived = Array.from({ length: 184 }, (_, index) => (
      issue(`archived-${index}`, 'team', '2026-01-02T00:00:00.000Z')
    ));
    const plan = buildFullReconcilePlan(
      [...active, ...archived],
      ['team'],
      current,
      { last_snapshot_count: 596, successful_snapshots: 1 },
    );

    expect(plan.archived).toHaveLength(184);
    expect(plan.archivedDeletionIds).toEqual([]);
    expect(plan.missingIds).toEqual([]);
    expect(plan.blockedReasons).not.toContainEqual(expect.stringContaining('Archived candidates'));
  });

  it('blocks more than 25 archived issues that are present in Supabase', () => {
    const current = Array.from({ length: 26 }, (_, index) => ({
      id: `archived-${index}`,
      team: { id: 'team' },
      synced_at: '2026-01-01T00:00:00.000Z',
    }));
    const archived = current.map((ticket) => (
      issue(ticket.id, 'team', '2026-01-02T00:00:00.000Z')
    ));
    const plan = buildFullReconcilePlan(archived, ['team'], current, null);

    expect(plan.archivedDeletionIds).toHaveLength(26);
    expect(plan.blockedReasons).toContainEqual(expect.stringContaining('Archived candidates exceed 25 (26)'));
  });

  it('blocks archived issues present in more than 5% of the Supabase scope', () => {
    const current = Array.from({ length: 100 }, (_, index) => ({
      id: `current-${index}`,
      team: { id: 'team' },
      synced_at: '2026-01-01T00:00:00.000Z',
    }));
    const snapshot = current.map((ticket, index) => (
      issue(ticket.id, 'team', index < 6 ? '2026-01-02T00:00:00.000Z' : undefined)
    ));
    const plan = buildFullReconcilePlan(snapshot, ['team'], current, null);

    expect(plan.archivedDeletionIds).toHaveLength(6);
    expect(plan.blockedReasons).toContainEqual(expect.stringContaining('Archived candidates exceed 5%'));
    expect(plan.blockedReasons).not.toContainEqual(expect.stringContaining('Archived candidates exceed 25'));
  });
});
