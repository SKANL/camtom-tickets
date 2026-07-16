-- Forward-only repair for SQLSTATE 42804 in finalize_full_reconcile.
-- Replaces the function body without changing arguments, guards, locks, or behavior.

create or replace function public.finalize_full_reconcile(
  p_run_id uuid,
  p_lease_token uuid,
  p_scope_key text,
  p_team_ids text[],
  p_started_at timestamptz,
  p_upper_bound timestamptz,
  p_deadline_at timestamptz,
  p_active_ids text[],
  p_archived jsonb,
  p_missing_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '12s'
set lock_timeout = '2s'
as $$
declare
  run_row public.reconcile_runs%rowtype;
  state_row public.reconcile_scope_state%rowtype;
  previous_successes integer := 0;
  archived_deleted integer := 0;
  missing_deleted integer := 0;
  row_affected integer := 0;
  archived_item jsonb;
  archived_id text;
  archived_team_id text;
  archived_updated_at timestamptz;
  archived_ids text[] := array[]::text[];
  missing_ticket record;
begin
  if clock_timestamp() >= p_deadline_at then raise exception 'full reconciliation deadline expired'; end if;
  if coalesce(array_length(p_team_ids, 1), 0) = 0 then
    raise exception 'empty reconciliation scope';
  end if;

  select * into run_row from public.reconcile_runs where id = p_run_id for update;
  if not found
    or run_row.kind <> 'full'
    or run_row.status <> 'running'
    or run_row.dry_run
    or run_row.scope_key is distinct from p_scope_key
    or run_row.team_ids is distinct from p_team_ids
    or run_row.started_at is distinct from p_started_at
    or run_row.upper_bound is distinct from p_upper_bound then
    raise exception 'reconciliation run metadata mismatch';
  end if;

  perform 1 from public.reconcile_scope_state
  where scope_key = 'lease:full'
    and lease_owner = p_lease_token
    and lease_expires_at > clock_timestamp()
  for update;
  if not found then raise exception 'full reconciliation lease is not current'; end if;

  insert into public.reconcile_scope_state(scope_key, team_ids)
  values (p_scope_key, p_team_ids)
  on conflict (scope_key) do nothing;

  select * into state_row
  from public.reconcile_scope_state where scope_key = p_scope_key for update;
  if coalesce(array_length(state_row.team_ids, 1), 0) > 0 and state_row.team_ids is distinct from p_team_ids then
    raise exception 'reconciliation scope metadata mismatch';
  end if;
  if state_row.last_upper_bound is not null and p_upper_bound <= state_row.last_upper_bound then
    raise exception 'reconciliation upper bound is not monotonic';
  end if;
  previous_successes := state_row.successful_snapshots;

  for archived_item in select value from jsonb_array_elements(coalesce(p_archived, '[]'::jsonb))
  loop
    archived_id := archived_item ->> 'id';
    archived_team_id := archived_item ->> 'teamId';
    archived_updated_at := (archived_item ->> 'updatedAt')::timestamptz;
    if archived_id is null or archived_team_id is null or archived_updated_at is null
      or not (archived_team_id = any(p_team_ids)) then
      raise exception 'archived issue metadata mismatch';
    end if;
    archived_ids := array_append(archived_ids, archived_id);
    perform pg_advisory_xact_lock(hashtextextended(archived_id, 0));
    insert into public.ticket_tombstones(ticket_id, deleted_updated_at, reason)
    values (archived_id, archived_updated_at, 'linear-archived')
    on conflict (ticket_id) do update
      set deleted_updated_at = excluded.deleted_updated_at,
          deleted_at = now(),
          reason = excluded.reason
      where excluded.deleted_updated_at > public.ticket_tombstones.deleted_updated_at;

    delete from public.tickets
    where id = archived_id
      and team ->> 'id' = archived_team_id
      and synced_at < p_started_at
      and updated_at <= (select deleted_updated_at from public.ticket_tombstones where ticket_id = archived_id);
    get diagnostics row_affected = row_count;
    archived_deleted := archived_deleted + row_affected;
  end loop;

  delete from public.reconcile_missing
  where scope_key = p_scope_key
    and ticket_id = any(coalesce(p_active_ids, '{}'::text[]) || archived_ids);

  if previous_successes > 0 then
    insert into public.reconcile_missing(scope_key, ticket_id, first_missing_at, last_missing_at, missing_count)
    select p_scope_key, ticket_id, p_started_at, p_started_at, 1
    from unnest(coalesce(p_missing_ids, '{}'::text[])) ticket_id
    on conflict (scope_key, ticket_id) do update
      set last_missing_at = excluded.last_missing_at,
          missing_count = public.reconcile_missing.missing_count + 1;

    for missing_ticket in
      select t.id
      from public.tickets t
      join public.reconcile_missing m on m.ticket_id = t.id and m.scope_key = p_scope_key
      where m.missing_count >= 2
        and m.first_missing_at <= p_started_at - interval '24 hours'
        and t.team ->> 'id' = any(p_team_ids)
        and t.synced_at < p_started_at
        and t.updated_at <= p_upper_bound
      order by t.id
    loop
      perform pg_advisory_xact_lock(hashtextextended(missing_ticket.id, 0));
      insert into public.ticket_tombstones(ticket_id, deleted_updated_at, reason)
      values (missing_ticket.id, p_upper_bound, 'full-missing')
      on conflict (ticket_id) do update
        set deleted_updated_at = excluded.deleted_updated_at,
            deleted_at = now(),
            reason = excluded.reason
        where excluded.deleted_updated_at > public.ticket_tombstones.deleted_updated_at;

      delete from public.tickets t
      using public.reconcile_missing m
      where t.id = missing_ticket.id
        and m.scope_key = p_scope_key
        and m.ticket_id = t.id
        and m.missing_count >= 2
        and m.first_missing_at <= p_started_at - interval '24 hours'
        and t.team ->> 'id' = any(p_team_ids)
        and t.synced_at < p_started_at
        and t.updated_at <= p_upper_bound;
      get diagnostics row_affected = row_count;
      missing_deleted := missing_deleted + row_affected;
    end loop;

    delete from public.reconcile_missing m
    where m.scope_key = p_scope_key
      and not exists (select 1 from public.tickets t where t.id = m.ticket_id);
  end if;

  perform 1 from public.reconcile_scope_state
  where scope_key = 'lease:full'
    and lease_owner = p_lease_token
    and lease_expires_at > clock_timestamp();
  if not found or clock_timestamp() >= p_deadline_at then
    raise exception 'full reconciliation lease or deadline expired before finalize';
  end if;

  update public.reconcile_scope_state
  set team_ids = p_team_ids,
      last_upper_bound = p_upper_bound,
      last_snapshot_count = coalesce(array_length(p_active_ids, 1), 0) + coalesce(jsonb_array_length(p_archived), 0),
      successful_snapshots = successful_snapshots + 1,
      updated_at = now()
  where scope_key = p_scope_key;

  update public.reconcile_runs
  set status = 'completed',
      snapshot_count = coalesce(array_length(p_active_ids, 1), 0) + coalesce(jsonb_array_length(p_archived), 0),
      active_count = coalesce(array_length(p_active_ids, 1), 0),
      archived_count = coalesce(jsonb_array_length(p_archived), 0),
      missing_count = coalesce(array_length(p_missing_ids, 1), 0),
      deleted_count = archived_deleted + missing_deleted,
      finished_at = now(),
      preview = jsonb_build_object('archivedDeleted', archived_deleted, 'missingDeleted', missing_deleted)
  where id = p_run_id;

  return jsonb_build_object('archivedDeleted', archived_deleted, 'missingDeleted', missing_deleted);
end;
$$;

revoke execute on function public.finalize_full_reconcile(uuid, uuid, text, text[], timestamptz, timestamptz, timestamptz, text[], jsonb, text[]) from anon, authenticated, public;
grant execute on function public.finalize_full_reconcile(uuid, uuid, text, text[], timestamptz, timestamptz, timestamptz, text[], jsonb, text[]) to service_role;
