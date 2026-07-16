# Reconciliation operations

The ingestion path has three independent safety nets:

- Linear webhooks are authenticated with `WEBHOOK_SECRET`, deduplicated by `Linear-Delivery`, and written with a database-side newer-row-wins RPC.
- Incremental reconcile runs every five minutes and advances its cursor only after every write succeeds.
- Full reconcile runs daily with a stable, archived-inclusive snapshot of the teams in `app_config.dashboard.teams`.
- Durable ticket tombstones prevent delayed snapshots or webhook retries from resurrecting a deleted issue unless Linear supplies a strictly newer `updatedAt`.

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

The existing daily Vercel cron remains enabled as a temporary incremental backup.

## Full reconcile rollout

`FULL_RECONCILE_APPLY` defaults to false. In this mode the full endpoint only records a `reconcile_runs` preview; it does not mutate tickets, missing-candidate state, or the scope cursor.

1. Leave apply disabled and inspect several successful daily previews.
2. Confirm the configured team IDs, snapshot counts, archived counts, and missing candidates.
3. Investigate every blocked run. Completeness errors and empty scope are never bypassed.
4. Set `FULL_RECONCILE_APPLY=true` only after previews are stable.

An applied first run establishes a baseline. An issue absent from Linear is eligible for deletion only after two later successful full snapshots and at least 24 hours. Explicitly archived issues may be deleted immediately, but only when the stored row predates the run. Tickets outside configured teams are never touched.

Both missing and archived delete counts are subject to the absolute and percentage anomaly guards. Dry-run still records these warnings for review, but apply mode performs no deletes when any guard is active.

The full worker has a 20-second internal deadline, below the scheduler's 25-second HTTP timeout and the current 30-second Vercel function limit. The deadline is propagated through Linear requests, retry backoff, and every Supabase operation. Supabase calls also have per-operation abort caps; the long database RPCs enforce shorter `statement_timeout` and `lock_timeout` limits.

On failure, marking the run failed and releasing the lease are immediate best-effort cleanup attempts with fresh one-second abort signals. Network loss can prevent that cleanup from reaching Supabase, so the lease TTL is the recovery fallback: full leases expire within 90 seconds (and are database-capped at two minutes), while incremental leases expire within four minutes so the next five-minute cadence can recover. A timeout leaves the reconciliation cursor unchanged; the next job starts a fresh snapshot. Current capacity is therefore bounded by the number of Linear pages and Supabase batches that can finish within 20 seconds. Keep apply disabled if dry-run duration approaches that limit.

## Observability and recovery

Use these server-only tables:

- `reconcile_runs`: status, scope, counts, dry-run previews, and errors.
- `reconcile_scope_state`: last successful upper bound, count baseline, and leases.
- `reconcile_missing`: quarantined absent candidates and grace counters.
- `webhook_deliveries`: delivery hashes, processing leases, and completion timestamps.
- `ticket_tombstones`: per-ticket delete watermarks used to reject stale resurrection.

A `409` from an incremental endpoint means another lease is active and the cursor did not advance. A full `409` means empty scope, an active lease, or a safety guard. A webhook `503` with `Retry-After` means another claim owner is still processing that delivery; Linear should retry it. Only a delivery already marked processed receives duplicate `200`. Failed webhook deliveries keep `processed_at` null and are retryable.
