# Reconciliation operations

The ingestion path has one authoritative scheduler and defense in depth:

- Linear webhooks are authenticated with `WEBHOOK_SECRET`, deduplicated by `Linear-Delivery`, and written with a database-side newer-row-wins RPC.
- Incremental reconcile runs every five minutes and advances its cursor only after every write succeeds.
- Full reconcile runs daily with a stable, archived-inclusive snapshot of the teams in `app_config.dashboard.teams`.
- Durable ticket tombstones prevent delayed snapshots or webhook retries from resurrecting a deleted issue unless Linear supplies a strictly newer `updatedAt`.
- The authoritative `app_config.dashboard.teams` row is the allowlist. Active webhook and incremental rows are sent to a database RPC that atomically upserts allowed teams or evicts an out-of-scope stored row. RLS/Realtime expose only rows whose indexed `team_id` remains configured.

An empty team list is a valid fail-closed scope and evicts every stored ticket. A malformed list is rejected on config writes and is fail-closed if inherited from older data. Scope eviction uses a separate durable, cause-aware watermark rather than a deletion tombstone. An event-driven team move requires a strictly newer move-back, while a config-scope purge permits the same unchanged issue to return when its original team is re-added. True Linear delete/archive events still create tombstones to reject stale resurrection.

## Secrets and authorization

`CRON_SECRET` authenticates both reconcile endpoints and must match the Vault secret named `reconcile_cron_secret`. `CONFIG_ADMIN_TOKEN` is different: it authorizes human configuration writes from Settings and must never be reused as the scheduler secret.

Store the complete incremental endpoint in Vault as `reconcile_url` (for example, the production origin plus `/api/cron/reconcile`). Migration `0007_reconcile_scheduler.sql` derives the full endpoint by appending `/full`.

Create or rotate the two Vault entries through the Supabase dashboard or `vault.create_secret`; do not place values in SQL, Git, logs, or shell history. After rotation, confirm the names exist without selecting decrypted values:

```sql
select name, created_at, updated_at
from vault.secrets
where name in ('reconcile_url', 'reconcile_cron_secret');
```

## Jobs

Migration `0007` replaces jobs by name, so it is safe to reapply:

- `camtom-reconcile-incremental`: every five minutes.
- `camtom-reconcile-full`: daily at 03:17 UTC.

Inspect schedules and recent HTTP responses:

```sql
select jobid, jobname, schedule, active from cron.job
where jobname like 'camtom-reconcile-%';

select * from net._http_response order by created desc limit 20;
```

Supabase `pg_cron` is the only automatic scheduler. `vercel.json` has no cron, and
`.github/workflows/reconcile.yml` is manual break-glass only (it requires the literal
confirmation `RECONCILE`). Do not add another recurring scheduler: leases prevent
corruption, but duplicate schedulers obscure ownership and health.

## Full reconcile rollout

`FULL_RECONCILE_APPLY` defaults to false. In this mode the full endpoint only records a `reconcile_runs` preview; it does not mutate tickets, missing-candidate state, or the scope cursor.

1. Leave apply disabled and inspect several successful daily previews.
2. Confirm the configured team IDs, snapshot counts, archived counts, and missing candidates.
3. Investigate every blocked run. Completeness errors and empty scope are never bypassed.
4. Set `FULL_RECONCILE_APPLY=true` only after previews are stable.

An applied first run establishes a baseline. An issue absent from Linear is eligible for deletion only after two later successful full snapshots and at least 24 hours. Explicitly archived issues may be deleted immediately, but only when the stored row predates the run. Tickets outside configured teams are never touched.

Both missing and archived delete counts are subject to the absolute and percentage anomaly guards. The archived guard counts only archived Linear IDs that currently exist in the configured Supabase scope; the full archived snapshot count remains in the run audit, while `preview.archivedDeletionCandidates` exposes the actual intersection. Dry-run still records these warnings for review, but apply mode performs no deletes when any guard is active.

The full worker has a 20-second internal deadline, below the scheduler's 25-second HTTP timeout and the current 30-second Vercel function limit. The deadline is propagated through Linear requests, retry backoff, and every Supabase operation. Supabase calls also have per-operation abort caps; the long database RPCs enforce shorter `statement_timeout` and `lock_timeout` limits.

Every new full run stores the authoritative `app_config.updated_at`. Finalization locks the run and verifies both that version and the normalized live team IDs in the same database transaction before any delete. Legacy workers that omit the version remain rollout-compatible, but finalization still verifies their exact live team-ID set.

On failure, marking the run failed and releasing the lease are immediate best-effort cleanup attempts with fresh one-second abort signals. Network loss can prevent that cleanup from reaching Supabase, so the lease TTL is the recovery fallback: full leases expire within 90 seconds (and are database-capped at two minutes), while incremental leases expire within four minutes so the next five-minute cadence can recover. A timeout leaves the reconciliation cursor unchanged; the next job starts a fresh snapshot. Current capacity is therefore bounded by the number of Linear pages and Supabase batches that can finish within 20 seconds. Keep apply disabled if dry-run duration approaches that limit.

## Observability and recovery

`GET /api/health` returns only non-sensitive reconciliation health: scheduler owner,
whether full apply is enabled, the latest full-run status, and the last successful
applied-full timestamp. Database errors return `503`/`degraded` without SQL or secrets.

Use these server-only tables:

- `reconcile_runs`: status, scope, counts, dry-run previews, and errors.
- `reconcile_scope_state`: last successful upper bound, count baseline, and leases.
- `reconcile_missing`: quarantined absent candidates and grace counters.
- `webhook_deliveries`: delivery hashes, processing leases, and completion timestamps.
- `ticket_tombstones`: per-ticket delete watermarks used to reject stale resurrection.
- `ticket_scope_evictions`: reversible ordering watermarks for event move-outs and config-scope purges. These are not deleted by operational retention; they remain until a qualifying in-scope state supersedes them.

Migration `0010_team_scope_and_retention.sql` runs a bounded weekly cleanup at 04:41 UTC:

- processed webhook deliveries: 30 days;
- unprocessed webhook deliveries: 7 days;
- completed reconcile runs: 90 days;
- tombstones with no live ticket: 730 days.

Each category is limited to 10,000 deletions per run. Tombstones intentionally have the
longest retention because they are correctness watermarks, not ordinary logs. Scope-eviction watermarks have no age-based retention because deleting one before a qualifying move-back could permit stale resurrection.

## Release checklist

1. Run CI (`test`, `typecheck`, `build`, clean generated-file diff).
2. Review the configured team IDs and `app_config.updated_at` before applying migration `0010`.
3. Apply migrations with Supabase CLI against the linked online project; never use local Docker.
4. Confirm `tickets_team_id_idx`, the scoped SELECT policy, the config-scope purge trigger, and the three pg_cron jobs.
5. Confirm `/api/health` reports `scheduler: supabase-pg-cron`.
6. Deploy only with Vercel CLI, then verify one incremental and one full dry-run/applied result as appropriate.

Apply migration `0010` **before** deploying the matching server. It preserves the existing
RPC signatures: old workers may continue sending workspace-wide batches, and the database
will filter or evict those rows instead of failing the batch. Legacy full workers omit
`config_updated_at`; they remain compatible and receive an exact live team-set guard.
The new server records the version as well, closing the change-away/change-back race.

After Phase 1 is stable, apply **0011_config_v2_team_settings.sql** before deploying
config-v2/split-view code. See [Per-team configuration and split view](./config-v2-and-split-view.md)
for the additive rollout and compatibility contract.

### Migration-first drain and recovery order for 0010/0011

These migrations have no production down migration. Recovery is application-first and preserves the additive schema.

1. Stop rollout changes and record the current Vercel deployment ID, configured team IDs, and `app_config.updated_at` without printing credentials.
2. Apply `0010` first. Do **not** immediately assume the scope purge is final: a request already running the pre-0010 `upsert_tickets_if_newer` body, or queued behind the migration's DDL lock, can resume after commit.
3. Keep the old deployment serving while its workers drain. Wait at least the maximum Vercel function duration plus the database lock timeout, and confirm the previous deployment has no active/queued invocations before shifting traffic. Do not scale to zero or take the dashboard down.
4. After that drain, invoke `public.purge_tickets_outside_configured_scope()` once through the approved service-role operational path. Verify that no `tickets.team_id` remains outside `public.configured_ticket_team_ids()`, and verify the matching `config-scope-purge` watermarks before deploying the new worker.
5. Apply `0011`, verify its backfill and synchronization trigger, then deploy config-v2. The migration creates the synchronization trigger before the backfill; `CREATE TRIGGER` takes `SHARE ROW EXCLUSIVE` on `app_config`, and the CLI's atomic migration batch holds that lock through the backfill and commit. If an earlier `0011` attempt failed at the former bare `LOCK TABLE` statement, first confirm that `0011` is absent from migration history and that its transaction fully rolled back, then retry the corrected migration. Until the first v2 write, old and new readers remain compatible.
6. After the first v2 write, legacy reads remain available but legacy writes fail closed by design. If the application must be rolled back, disable Settings writes first, roll Vercel back without reverting either migration, and keep writes disabled until config-v2 is restored.
7. If verification after either migration fails, leave the additive objects in place, keep reconciliation/config writes disabled as applicable, restore the last known-good Vercel deployment, and investigate. Never run a destructive down migration or delete scope/config-v2 audit data during the incident.

A `409` from an incremental endpoint means another lease is active and the cursor did not advance. A full `409` means empty scope, an active lease, or a safety guard. A webhook `503` with `Retry-After` means another claim owner is still processing that delivery; Linear should retry it. Only a delivery already marked processed receives duplicate `200`. Failed webhook deliveries keep `processed_at` null and are retryable.
# Related operational guides

- [Universal browser screen control](./screen-remote-control.md) — hosted Auth setup, pairing, rollout, recovery, and rollback.
