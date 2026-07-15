import { Issue, TicketRow, rowToIssue } from '@camtom/shared';

type SyncedTicketRow = TicketRow & { synced_at?: string };

export type TicketChange =
  | { kind: 'upsert'; row: TicketRow; version: number; order?: string; sequence?: number }
  | { kind: 'delete'; id: string; version: number; order?: string; sequence?: number };

interface ChangeClock {
  version: number;
  order: string;
  sequence: number;
}

export interface TicketStore {
  tickets: Map<string, Issue>;
  clocks: Map<string, ChangeClock>;
  tombstones: Map<string, ChangeClock>;
}

function timestamp(value: string | undefined | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createTicketStore(rows: TicketRow[] = []): TicketStore {
  return {
    tickets: new Map(rows.map((row) => [row.id, rowToIssue(row)])),
    clocks: new Map(rows.map((row) => [
      row.id,
      clock(timestamp(row.updated_at), (row as SyncedTicketRow).synced_at ?? ''),
    ])),
    tombstones: new Map(),
  };
}

export function createTicketStoreFromIssues(issues: Issue[]): TicketStore {
  return {
    tickets: new Map(issues.map((issue) => [issue.id, issue])),
    clocks: new Map(issues.map((issue) => [issue.id, clock(timestamp(issue.updatedAt))])),
    tombstones: new Map(),
  };
}

function clock(version: number, order = '', sequence = 0): ChangeClock {
  return { version, order, sequence };
}

function compareClock(a: ChangeClock, b: ChangeClock): number {
  if (a.version !== b.version) return a.version - b.version;
  if (a.order !== b.order) return a.order.localeCompare(b.order);
  return a.sequence - b.sequence;
}

export function ticketChangeFromPayload(payload: {
  eventType: string;
  new: unknown;
  old: unknown;
  commit_timestamp?: string;
}, sequence = 0): TicketChange | null {
  if (payload.eventType === 'DELETE') {
    const oldRow = payload.old as Partial<SyncedTicketRow> | null;
    if (!oldRow?.id) return null;
    return {
      kind: 'delete',
      id: oldRow.id,
      version: timestamp(oldRow.updated_at) || timestamp(payload.commit_timestamp) || Date.now(),
      order: oldRow.synced_at ?? payload.commit_timestamp ?? '',
      sequence,
    };
  }

  const row = payload.new as SyncedTicketRow | null;
  if (!row?.id) return null;
  return {
    kind: 'upsert',
    row,
    version: timestamp(row.updated_at),
    order: row.synced_at ?? payload.commit_timestamp ?? '',
    sequence,
  };
}

/** Apply one ordered database change without allowing stale data to win. */
export function applyTicketChange(store: TicketStore, change: TicketChange): boolean {
  const incomingClock = clock(change.version, change.order, change.sequence);
  if (change.kind === 'delete') {
    const currentClock = store.clocks.get(change.id);
    if (currentClock && compareClock(currentClock, incomingClock) > 0) return false;

    const tombstone = store.tombstones.get(change.id);
    if (!tombstone || compareClock(incomingClock, tombstone) > 0) store.tombstones.set(change.id, incomingClock);
    store.clocks.delete(change.id);
    return store.tickets.delete(change.id);
  }

  const issue = rowToIssue(change.row);
  const tombstone = store.tombstones.get(issue.id);
  const currentClock = store.clocks.get(issue.id);
  if ((tombstone && compareClock(tombstone, incomingClock) >= 0)
    || (currentClock && compareClock(currentClock, incomingClock) > 0)) {
    return false;
  }

  store.tickets.set(issue.id, issue);
  store.clocks.set(issue.id, incomingClock);
  if (tombstone && compareClock(incomingClock, tombstone) > 0) store.tombstones.delete(issue.id);
  return true;
}

/** Build the authoritative snapshot, then replay changes received while it loaded. */
export function mergeSnapshot(rows: TicketRow[], buffered: TicketChange[]): TicketStore {
  const store = createTicketStore(rows);
  for (const change of buffered) applyTicketChange(store, change);
  return store;
}

export function issuesFromStore(store: TicketStore): Issue[] {
  return Array.from(store.tickets.values()).sort((a, b) => a.priority - b.priority);
}
