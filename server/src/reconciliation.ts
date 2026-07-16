import { createHash } from 'crypto';
import { ReconcileIssue } from './linear-client';
import { ReconcileScopeState, ScopedTicket } from './supabase';

export interface FullReconcilePlan {
  active: ReconcileIssue[];
  archived: ReconcileIssue[];
  archivedDeletionIds: string[];
  missingIds: string[];
  snapshotCount: number;
  baseline: boolean;
  blockedReasons: string[];
}

export function reconcileScopeKey(teamIds: string[]): string {
  return createHash('sha256').update([...teamIds].sort().join('\n')).digest('hex');
}

export function buildFullReconcilePlan(
  issues: ReconcileIssue[],
  teamIds: string[],
  currentTickets: ScopedTicket[],
  state: ReconcileScopeState | null,
): FullReconcilePlan {
  if (teamIds.length === 0) throw new Error('Empty reconciliation scope');
  const scope = new Set(teamIds);
  const ids = new Set<string>();
  for (const issue of issues) {
    if (!issue.id || ids.has(issue.id)) throw new Error(`Duplicate Linear issue id: ${issue.id || '<empty>'}`);
    if (!issue.team?.id || !scope.has(issue.team.id)) throw new Error(`Issue ${issue.id} is outside the configured scope`);
    ids.add(issue.id);
  }

  const active = issues.filter((issue) => !issue.archivedAt);
  const archived = issues.filter((issue) => !!issue.archivedAt);
  const currentInScope = currentTickets.filter((ticket) => !!ticket.team?.id && scope.has(ticket.team.id));
  const currentInScopeIds = new Set(currentInScope.map((ticket) => ticket.id));
  const archivedDeletionIds = archived.map((issue) => issue.id).filter((id) => currentInScopeIds.has(id));
  const missingIds = currentInScope.map((ticket) => ticket.id).filter((id) => !ids.has(id));
  const snapshotCount = issues.length;
  const blockedReasons: string[] = [];
  const previousCount = state?.last_snapshot_count ?? null;

  if (previousCount !== null && previousCount > 0 && snapshotCount < previousCount * 0.9) {
    blockedReasons.push(`Snapshot count dropped more than 10% (${previousCount} -> ${snapshotCount})`);
  }
  const candidateRatio = currentInScope.length === 0 ? 0 : missingIds.length / currentInScope.length;
  if (missingIds.length > 25) blockedReasons.push(`Missing candidates exceed 25 (${missingIds.length})`);
  if (candidateRatio > 0.05) blockedReasons.push(`Missing candidates exceed 5% (${(candidateRatio * 100).toFixed(1)}%)`);
  const archivedRatio = currentInScope.length === 0 ? 0 : archivedDeletionIds.length / currentInScope.length;
  if (archivedDeletionIds.length > 25) {
    blockedReasons.push(`Archived candidates exceed 25 (${archivedDeletionIds.length})`);
  }
  if (archivedRatio > 0.05) blockedReasons.push(`Archived candidates exceed 5% (${(archivedRatio * 100).toFixed(1)}%)`);

  return {
    active,
    archived,
    archivedDeletionIds,
    missingIds,
    snapshotCount,
    baseline: !state || state.successful_snapshots === 0,
    blockedReasons,
  };
}

export function batches<T>(values: T[], size = 200): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
