import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { fetchFullIssues, fetchIssuesSince } from '../linear-client';
import { issueToRow } from '../ticket-mapper';
import {
  acquireReconcileLease,
  createReconcileRun,
  deleteTicket,
  finalizeFullReconcile,
  finishReconcileRun,
  getConfiguredReconcileTeamIds,
  getLastSync,
  getReconcileScopeState,
  getTicketsForTeams,
  releaseReconcileLease,
  setLastSync,
  upsertTickets,
} from '../supabase';
import { batches, buildFullReconcilePlan, reconcileScopeKey } from '../reconciliation';

const router: Router = Router();
const FULL_RECONCILE_DEADLINE_MS = 20_000;
const SUPABASE_OPERATION_CAP_MS = 4_000;
const FINALIZE_OPERATION_CAP_MS = 15_000;
const CLEANUP_OPERATION_TIMEOUT_MS = 1_000;
const FULL_LEASE_TTL_SECONDS = 90;
const INCREMENTAL_LEASE_TTL_SECONDS = 240;

function assertBeforeDeadline(deadlineAt: number): void {
  if (Date.now() >= deadlineAt) throw new Error('Full reconcile deadline exceeded');
}

async function runWithTimeout<T>(
  label: string,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (timeoutMs <= 0) throw new Error(`${label} deadline exceeded`);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} deadline exceeded`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runSupabaseBeforeDeadline<T>(
  deadlineAt: number,
  label: string,
  operation: (signal: AbortSignal) => Promise<T>,
  capMs = SUPABASE_OPERATION_CAP_MS,
): Promise<T> {
  assertBeforeDeadline(deadlineAt);
  const timeoutMs = Math.min(capMs, deadlineAt - Date.now());
  return runWithTimeout(label, timeoutMs, (signal) => {
    assertBeforeDeadline(deadlineAt);
    return operation(signal);
  });
}

async function runBestEffortCleanup(
  label: string,
  operation: (signal: AbortSignal) => Promise<unknown>,
): Promise<void> {
  await runWithTimeout(label, CLEANUP_OPERATION_TIMEOUT_MS, operation).catch((err: Error) => {
    console.error(`[reconcile] ${label} failed: ${err.message}`);
  });
}

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

router.get('/api/cron/reconcile', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const owner = randomUUID();
  let acquired = false;
  let runId: string | null = null;
  const startedAt = new Date().toISOString();
  try {
    acquired = await acquireReconcileLease('incremental', owner, INCREMENTAL_LEASE_TTL_SECONDS);
    if (!acquired) return res.status(409).json({ error: 'Incremental reconcile already running' });

    runId = await createReconcileRun({
      kind: 'incremental',
      startedAt,
      upperBound: startedAt,
      dryRun: false,
    });
    const since = await getLastSync();
    const issues = await fetchIssuesSince(since);
    const active = issues.filter((issue) => !issue.archivedAt);
    const archived = issues.filter((issue) => !!issue.archivedAt);

    for (const batch of batches(active)) await upsertTickets(batch.map(issueToRow));
    for (const issue of archived) await deleteTicket(issue.id, issue.updatedAt);
    await setLastSync(startedAt);
    await finishReconcileRun(runId, {
      status: 'completed',
      snapshotCount: issues.length,
      activeCount: active.length,
      archivedCount: archived.length,
    });

    return res.status(200).json({ synced: active.length, archived: archived.length, since });
  } catch (err: any) {
    if (runId) await finishReconcileRun(runId, { status: 'failed', error: err.message }).catch(() => undefined);
    console.error(`[reconcile] Incremental failed: ${err.message}`);
    return res.status(500).json({ error: 'Incremental reconcile failed' });
  } finally {
    if (acquired) {
      await releaseReconcileLease('incremental', owner)
        .catch((err: Error) => console.error(`[reconcile] Lease release failed: ${err.message}`));
    }
  }
});

router.get('/api/cron/reconcile/full', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const owner = randomUUID();
  let acquired = false;
  let leaseAttempted = false;
  let runId: string | null = null;
  const startedAt = new Date().toISOString();
  const upperBound = startedAt;
  const deadlineAt = Date.now() + FULL_RECONCILE_DEADLINE_MS;
  try {
    leaseAttempted = true;
    acquired = await runSupabaseBeforeDeadline(
      deadlineAt,
      'Full reconcile lease acquisition',
      (signal) => acquireReconcileLease('full', owner, FULL_LEASE_TTL_SECONDS, signal),
    );
    if (!acquired) return res.status(409).json({ error: 'Full reconcile already running' });

    const teamIds = await runSupabaseBeforeDeadline(
      deadlineAt,
      'Full reconcile scope read',
      (signal) => getConfiguredReconcileTeamIds(signal),
    );
    if (teamIds.length === 0) return res.status(409).json({ error: 'Full reconcile scope is empty' });

    const scopeKey = reconcileScopeKey(teamIds);
    const dryRun = process.env.FULL_RECONCILE_APPLY !== 'true';
    runId = await runSupabaseBeforeDeadline(
      deadlineAt,
      'Full reconcile run creation',
      (signal) => createReconcileRun({ kind: 'full', scopeKey, teamIds, startedAt, upperBound, dryRun }, signal),
    );
    assertBeforeDeadline(deadlineAt);
    const snapshot = await fetchFullIssues(teamIds, upperBound, deadlineAt);
    assertBeforeDeadline(deadlineAt);
    const [currentTickets, state] = await Promise.all([
      runSupabaseBeforeDeadline(
        deadlineAt,
        'Full reconcile ticket read',
        (signal) => getTicketsForTeams(teamIds, signal),
      ),
      runSupabaseBeforeDeadline(
        deadlineAt,
        'Full reconcile state read',
        (signal) => getReconcileScopeState(scopeKey, signal),
      ),
    ]);
    assertBeforeDeadline(deadlineAt);
    const plan = buildFullReconcilePlan(snapshot.issues, teamIds, currentTickets, state);
    const preview = {
      pages: snapshot.pages,
      baseline: plan.baseline,
      active: plan.active.length,
      archived: plan.archived.length,
      missing: plan.missingIds.length,
      blockedReasons: plan.blockedReasons,
    };

    if (dryRun) {
      await runSupabaseBeforeDeadline(deadlineAt, 'Full reconcile dry-run completion', (signal) => (
        finishReconcileRun(runId!, {
          status: 'completed',
          snapshotCount: plan.snapshotCount,
          activeCount: plan.active.length,
          archivedCount: plan.archived.length,
          missingCount: plan.missingIds.length,
          preview,
        }, signal)
      ));
      return res.status(200).json({ applied: false, dryRun: true, preview });
    }

    if (plan.blockedReasons.length > 0) {
      await runSupabaseBeforeDeadline(deadlineAt, 'Full reconcile blocked completion', (signal) => (
        finishReconcileRun(runId!, {
          status: 'blocked',
          snapshotCount: plan.snapshotCount,
          activeCount: plan.active.length,
          archivedCount: plan.archived.length,
          missingCount: plan.missingIds.length,
          preview,
        }, signal)
      ));
      return res.status(409).json({ error: 'Full reconcile blocked by safety guards', preview });
    }

    for (const batch of batches(plan.active)) {
      await runSupabaseBeforeDeadline(
        deadlineAt,
        'Full reconcile ticket upsert',
        (signal) => upsertTickets(batch.map(issueToRow), signal),
      );
    }
    const deleted = await runSupabaseBeforeDeadline(
      deadlineAt,
      'Full reconcile finalize',
      (signal) => finalizeFullReconcile({
        runId: runId!,
        leaseToken: owner,
        scopeKey,
        teamIds,
        startedAt,
        upperBound,
        deadlineAt: new Date(deadlineAt).toISOString(),
        activeIds: plan.active.map((issue) => issue.id),
        archived: plan.archived.map((issue) => ({
          id: issue.id,
          teamId: issue.team!.id,
          updatedAt: issue.updatedAt,
        })),
        missingIds: plan.missingIds,
      }, signal),
      FINALIZE_OPERATION_CAP_MS,
    );
    return res.status(200).json({ applied: true, dryRun: false, preview, deleted });
  } catch (err: any) {
    if (runId) {
      await runBestEffortCleanup(
        'Full reconcile failed-run cleanup',
        (signal) => finishReconcileRun(runId!, { status: 'failed', error: err.message }, signal),
      );
    }
    console.error(`[reconcile] Full failed: ${err.message}`);
    return res.status(500).json({ error: 'Full reconcile failed' });
  } finally {
    if (leaseAttempted) {
      await runBestEffortCleanup(
        'Full reconcile lease cleanup',
        (signal) => releaseReconcileLease('full', owner, signal),
      );
    }
  }
});

export default router;
