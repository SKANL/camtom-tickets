-- Server-only reliability primitives for webhook ingestion and reconciliation.

create table if not exists public.webhook_deliveries (
  delivery_id text primary key,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processing_at timestamptz,
  claim_token uuid,
  processed_at timestamptz
);

create table if not exists public.ticket_tombstones (
  ticket_id text primary key,
  deleted_updated_at timestamptz not null,
  deleted_at timestamptz not null default now(),
  reason text not null
);

create table if not exists public.reconcile_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('incremental', 'full')),
  scope_key text,
  team_ids text[] not null default '{}',
  started_at timestamptz not null,
  upper_bound timestamptz not null,
  dry_run boolean not null default false,
  status text not null default 'running' check (status in ('running', 'completed', 'blocked', 'failed')),
  snapshot_count integer,
  active_count integer,
  archived_count integer,
  missing_count integer,
  deleted_count integer,
  preview jsonb,
  error text,
  finished_at timestamptz
);

create table if not exists public.reconcile_scope_state (
  scope_key text primary key,
  team_ids text[] not null default '{}',
  last_upper_bound timestamptz,
  last_snapshot_count integer,
  successful_snapshots integer not null default 0,
  lease_owner uuid,
  lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.reconcile_missing (
  scope_key text not null references public.reconcile_scope_state(scope_key) on delete cascade,
  ticket_id text not null,
  first_missing_at timestamptz not null,
  last_missing_at timestamptz not null,
  missing_count integer not null default 1,
  primary key (scope_key, ticket_id)
);

alter table public.webhook_deliveries enable row level security;
alter table public.ticket_tombstones enable row level security;
alter table public.reconcile_runs enable row level security;
alter table public.reconcile_scope_state enable row level security;
alter table public.reconcile_missing enable row level security;

create or replace function public.upsert_tickets_if_newer(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '3500ms'
set lock_timeout = '1s'
as $$
declare
  affected integer;
  row_affected integer;
  incoming record;
  tombstone_at timestamptz;
begin
  affected := 0;
  for incoming in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    id text, identifier text, title text, description text, priority smallint,
    priority_label text, created_at timestamptz, updated_at timestamptz,
    completed_at timestamptz, assigned_at timestamptz, due_date timestamptz,
    assignee jsonb, state jsonb, labels jsonb, project jsonb, team jsonb, cycle jsonb,
    estimate real
    )
  loop
    perform pg_advisory_xact_lock(hashtextextended(incoming.id, 0));
    select deleted_updated_at into tombstone_at
    from public.ticket_tombstones where ticket_id = incoming.id;

    if tombstone_at is null or incoming.updated_at > tombstone_at then
      insert into public.tickets (
        id, identifier, title, description, priority, priority_label, created_at, updated_at,
        completed_at, assigned_at, due_date, assignee, state, labels, project, team, cycle, estimate
      ) values (
        incoming.id, incoming.identifier, incoming.title, incoming.description, incoming.priority,
        incoming.priority_label, incoming.created_at, incoming.updated_at, incoming.completed_at,
        incoming.assigned_at, incoming.due_date, incoming.assignee, incoming.state, incoming.labels,
        incoming.project, incoming.team, incoming.cycle, incoming.estimate
      )
      on conflict (id) do update set
        identifier = excluded.identifier,
        title = excluded.title,
        description = excluded.description,
        priority = excluded.priority,
        priority_label = excluded.priority_label,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        assigned_at = excluded.assigned_at,
        due_date = excluded.due_date,
        assignee = excluded.assignee,
        state = excluded.state,
        labels = excluded.labels,
        project = excluded.project,
        team = excluded.team,
        cycle = excluded.cycle,
        estimate = excluded.estimate
      where excluded.updated_at > public.tickets.updated_at;

      get diagnostics row_affected = row_count;
      affected := affected + row_affected;
      delete from public.ticket_tombstones
      where ticket_id = incoming.id and incoming.updated_at > deleted_updated_at;
    end if;
  end loop;
  return affected;
end;
$$;

create or replace function public.delete_ticket_if_not_newer(p_id text, p_event_updated_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '3s'
set lock_timeout = '1s'
as $$
declare
  affected integer;
  watermark timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id, 0));
  insert into public.ticket_tombstones(ticket_id, deleted_updated_at, reason)
  values (p_id, p_event_updated_at, 'webhook')
  on conflict (ticket_id) do update
    set deleted_updated_at = excluded.deleted_updated_at,
        deleted_at = now(),
        reason = excluded.reason
    where excluded.deleted_updated_at > public.ticket_tombstones.deleted_updated_at;

  select deleted_updated_at into watermark
  from public.ticket_tombstones where ticket_id = p_id;
  delete from public.tickets
  where id = p_id
    and updated_at <= watermark;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function public.claim_webhook_delivery(p_delivery_id text, p_payload_hash text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  current_row public.webhook_deliveries%rowtype;
  new_token uuid := gen_random_uuid();
begin
  insert into public.webhook_deliveries(delivery_id, payload_hash, processing_at, claim_token)
  values (p_delivery_id, p_payload_hash, now(), new_token)
  on conflict (delivery_id) do nothing;
  if found then return jsonb_build_object('status', 'claimed', 'claimToken', new_token); end if;

  select * into current_row
  from public.webhook_deliveries
  where delivery_id = p_delivery_id
  for update;

  if current_row.payload_hash <> p_payload_hash then return jsonb_build_object('status', 'conflict'); end if;
  if current_row.processed_at is not null then return jsonb_build_object('status', 'processed'); end if;
  if current_row.processing_at is not null and current_row.processing_at > now() - interval '5 minutes' then
    return jsonb_build_object('status', 'busy');
  end if;

  update public.webhook_deliveries
  set processing_at = now(), received_at = now(), claim_token = new_token
  where delivery_id = p_delivery_id;
  return jsonb_build_object('status', 'claimed', 'claimToken', new_token);
end;
$$;

create or replace function public.complete_webhook_delivery(p_delivery_id text, p_payload_hash text, p_claim_token uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$
  update public.webhook_deliveries
  set processed_at = now(), processing_at = null, claim_token = null
  where delivery_id = p_delivery_id
    and payload_hash = p_payload_hash
    and claim_token = p_claim_token
    and processed_at is null
  returning true;
$$;

create or replace function public.release_webhook_delivery(p_delivery_id text, p_payload_hash text, p_claim_token uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$
  update public.webhook_deliveries
  set processing_at = null, claim_token = null
  where delivery_id = p_delivery_id
    and payload_hash = p_payload_hash
    and claim_token = p_claim_token
    and processed_at is null
  returning true;
$$;

create or replace function public.acquire_reconcile_lease(
  p_name text,
  p_owner uuid,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '3s'
set lock_timeout = '1s'
as $$
declare
  acquired boolean;
  lease_key text := 'lease:' || p_name;
  effective_lease_seconds integer := case
    when p_name = 'incremental' then least(greatest(30, p_lease_seconds), 240)
    when p_name = 'full' then least(greatest(30, p_lease_seconds), 120)
    else least(greatest(30, p_lease_seconds), 120)
  end;
begin
  insert into public.reconcile_scope_state(scope_key)
  values (lease_key)
  on conflict (scope_key) do nothing;

  update public.reconcile_scope_state
  set lease_owner = p_owner,
      lease_expires_at = clock_timestamp() + make_interval(secs => effective_lease_seconds),
      updated_at = clock_timestamp()
  where scope_key = lease_key
    and (lease_expires_at is null or lease_expires_at < clock_timestamp() or lease_owner = p_owner)
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_reconcile_lease(p_name text, p_owner uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog
set statement_timeout = '750ms'
set lock_timeout = '250ms'
as $$
  update public.reconcile_scope_state
  set lease_owner = null, lease_expires_at = null, updated_at = now()
  where scope_key = 'lease:' || p_name and lease_owner = p_owner
  returning true;
$$;

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
  archived_ids text[] := '{}';
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

revoke all on function public.upsert_tickets_if_newer(jsonb) from public;
revoke all on function public.delete_ticket_if_not_newer(text, timestamptz) from public;
revoke all on function public.claim_webhook_delivery(text, text) from public;
revoke all on function public.complete_webhook_delivery(text, text, uuid) from public;
revoke all on function public.release_webhook_delivery(text, text, uuid) from public;
revoke all on function public.acquire_reconcile_lease(text, uuid, integer) from public;
revoke all on function public.release_reconcile_lease(text, uuid) from public;
revoke all on function public.finalize_full_reconcile(uuid, uuid, text, text[], timestamptz, timestamptz, timestamptz, text[], jsonb, text[]) from public;

grant execute on function public.upsert_tickets_if_newer(jsonb) to service_role;
grant execute on function public.delete_ticket_if_not_newer(text, timestamptz) to service_role;
grant execute on function public.claim_webhook_delivery(text, text) to service_role;
grant execute on function public.complete_webhook_delivery(text, text, uuid) to service_role;
grant execute on function public.release_webhook_delivery(text, text, uuid) to service_role;
grant execute on function public.acquire_reconcile_lease(text, uuid, integer) to service_role;
grant execute on function public.release_reconcile_lease(text, uuid) to service_role;
grant execute on function public.finalize_full_reconcile(uuid, uuid, text, text[], timestamptz, timestamptz, timestamptz, text[], jsonb, text[]) to service_role;
