import { describe, expect, it } from 'vitest';
import { TicketRow } from '@camtom/shared';
import { applyTicketChange, createTicketStore, mergeSnapshot } from '../ticket-sync';

function row(id: string, updatedAt: string, title = id): TicketRow {
  return {
    id,
    identifier: id,
    title,
    description: null,
    priority: 1,
    priority_label: 'Urgente',
    created_at: '2026-07-15T10:00:00.000Z',
    updated_at: updatedAt,
    completed_at: null,
    assigned_at: null,
    due_date: null,
    assignee: null,
    state: { id: 'state', name: 'Nuevo', type: 'unstarted' },
    labels: null,
    project: null,
    team: null,
    cycle: null,
    estimate: null,
  };
}

describe('ticket sync', () => {
  it('replays realtime changes received while the snapshot loads', () => {
    const snapshot = row('CAM-1', '2026-07-15T10:00:00.000Z', 'Anterior');
    const realtime = row('CAM-1', '2026-07-15T10:01:00.000Z', 'Actual');

    const store = mergeSnapshot([snapshot], [{ kind: 'upsert', row: realtime, version: Date.parse(realtime.updated_at) }]);

    expect(store.tickets.get('CAM-1')?.title).toBe('Actual');
  });

  it('rejects an upsert older than the current ticket', () => {
    const current = row('CAM-1', '2026-07-15T10:02:00.000Z', 'Actual');
    const stale = row('CAM-1', '2026-07-15T10:01:00.000Z', 'Obsoleto');
    const store = createTicketStore([current]);

    expect(applyTicketChange(store, { kind: 'upsert', row: stale, version: Date.parse(stale.updated_at) })).toBe(false);
    expect(store.tickets.get('CAM-1')?.title).toBe('Actual');
  });

  it('uses commit order to break updated_at millisecond collisions', () => {
    const sameTime = '2026-07-15T10:02:00.000Z';
    const store = createTicketStore([row('CAM-1', sameTime, 'Snapshot')]);
    const newerCommit = row('CAM-1', sameTime, 'Commit nuevo');
    const olderCommit = row('CAM-1', sameTime, 'Commit viejo');

    applyTicketChange(store, {
      kind: 'upsert', row: newerCommit, version: Date.parse(sameTime), order: '2026-07-15T10:02:02.000001Z', sequence: 2,
    });
    applyTicketChange(store, {
      kind: 'upsert', row: olderCommit, version: Date.parse(sameTime), order: '2026-07-15T10:02:01.999999Z', sequence: 3,
    });

    expect(store.tickets.get('CAM-1')?.title).toBe('Commit nuevo');
  });

  it('keeps a tombstone from being overwritten by a stale event', () => {
    const current = row('CAM-1', '2026-07-15T10:01:00.000Z');
    const store = createTicketStore([current]);
    const deletedAt = Date.parse('2026-07-15T10:02:00.000Z');

    applyTicketChange(store, { kind: 'delete', id: current.id, version: deletedAt });
    applyTicketChange(store, { kind: 'upsert', row: current, version: Date.parse(current.updated_at) });

    expect(store.tickets.has(current.id)).toBe(false);
    expect(store.tombstones.get(current.id)?.version).toBe(deletedAt);
  });
});
