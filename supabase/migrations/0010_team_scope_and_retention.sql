-- Enforce the configured Linear-team allowlist at ingestion, storage, RLS, and Realtime.
-- The service role remains the only writer. Empty/malformed configuration fails closed.

alter table public.tickets
  add column if not exists team_id text generated always as (team ->> 'id') stored;

create index if not exists tickets_team_id_idx on public.tickets (team_id);

alter table public.reconcile_runs
  add column if not exists config_updated_at timestamptz;

-- Scope transitions are reversible, but they still need durable ordering. Keep
-- these watermarks separate from true delete/archive tombstones so a configured
-- team can be re-added without allowing an older Linear state to win.
create table if not exists public.ticket_scope_evictions (
  ticket_id text primary key,
  watermark_updated_at timestamptz not null,
  team_id text,
  cause text not null check (cause in ('event-move-out', 'config-scope-purge')),
  config_updated_at timestamptz,
  evicted_at timestamptz not null default now(),
  check (
    (cause = 'event-move-out' and config_updated_at is null)
    or (cause = 'config-scope-purge' and config_updated_at is not null)
  )
);

alter table public.ticket_scope_evictions enable row level security;
revoke all privileges on table public.ticket_scope_evictions from public, anon, authenticated;
grant select, insert, update, delete on table public.ticket_scope_evictions to service_role;

create or replace function public.ticket_team_config_valid(p_dashboard jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  with teams as (
    select value
    from jsonb_array_elements(
      case when jsonb_typeof(p_dashboard -> 'teams') = 'array'
        then p_dashboard -> 'teams' else '[]'::jsonb end
    )
  ), normalized as (
    select nullif(btrim(value ->> 'id'), '') as id, value
    from teams
  )
  select coalesce(jsonb_typeof(p_dashboard -> 'teams') = 'array', false)
    and not exists (
      select 1 from normalized
      where jsonb_typeof(value) <> 'object'
        or jsonb_typeof(value -> 'id') <> 'string'
        or id is null
        or (value ->> 'id') is distinct from btrim(value ->> 'id')
    )
    and (select count(*) from normalized) = (select count(distinct id) from normalized);
$$;

revoke all on function public.ticket_team_config_valid(jsonb) from public, anon, authenticated;
grant execute on function public.ticket_team_config_valid(jsonb) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'app_config_teams_valid' and conrelid = 'public.app_config'::regclass
  ) then
    alter table public.app_config
      add constraint app_config_teams_valid
      check (public.ticket_team_config_valid(dashboard)) not valid;
  end if;
end;
$$;

create or replace function public.configured_ticket_team_ids()
returns table(team_id text)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select btrim(team.value ->> 'id')
  from public.app_config config
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(config.dashboard -> 'teams') = 'array' then config.dashboard -> 'teams'
      else '[]'::jsonb
    end
  ) as team(value)
  where config.id = 1
    and public.ticket_team_config_valid(config.dashboard);
$$;

create or replace function public.is_ticket_team_configured(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p_team_id is not null and exists (
    select 1 from public.configured_ticket_team_ids() configured
    where configured.team_id = p_team_id
  );
$$;

revoke all on function public.configured_ticket_team_ids() from public, anon, authenticated;
revoke all on function public.is_ticket_team_configured(text) from public;
grant execute on function public.is_ticket_team_configured(text) to anon, authenticated, service_role;
grant execute on function public.configured_ticket_team_ids() to service_role;

create or replace function public.purge_tickets_outside_configured_scope()
returns integer
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
  affected integer := 0;
  config_version timestamptz;
  ticket_row record;
begin
  select updated_at into config_version from public.app_config
  where id = 1 and public.ticket_team_config_valid(dashboard)
  for share;
  if not found then
    raise exception 'configured team scope is missing or malformed';
  end if;

  -- The config row lock serializes the whole purge with every scoped upsert.
  -- Per-ticket locks preserve the same ordering if another server-only writer
  -- also follows the ticket mutation protocol.
  for ticket_row in
    select id, team_id, updated_at
    from public.tickets
    where not public.is_ticket_team_configured(team_id)
    order by id
  loop
    perform pg_advisory_xact_lock(hashtextextended(ticket_row.id, 0));

    insert into public.ticket_scope_evictions (
      ticket_id, watermark_updated_at, team_id, cause, config_updated_at, evicted_at
    ) values (
      ticket_row.id, ticket_row.updated_at, ticket_row.team_id,
      'config-scope-purge', config_version, clock_timestamp()
    )
    on conflict (ticket_id) do update set
      watermark_updated_at = excluded.watermark_updated_at,
      team_id = excluded.team_id,
      cause = excluded.cause,
      config_updated_at = excluded.config_updated_at,
      evicted_at = excluded.evicted_at
    where public.ticket_scope_evictions.cause = 'config-scope-purge'
      and excluded.watermark_updated_at >= public.ticket_scope_evictions.watermark_updated_at;

    delete from public.tickets where id = ticket_row.id;
    if found then
      affected := affected + 1;
    end if;
  end loop;

  return affected;
end;
$$;

create or replace function public.purge_tickets_on_config_scope_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform public.purge_tickets_outside_configured_scope();
  return new;
end;
$$;

create or replace function public.stamp_app_config_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
    and (new.dashboard is distinct from old.dashboard or new.sla is distinct from old.sla)
    and new.updated_at is not distinct from old.updated_at then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists app_config_stamp_updated_at on public.app_config;
create trigger app_config_stamp_updated_at
  before update of dashboard, sla on public.app_config
  for each row execute function public.stamp_app_config_updated_at();

drop trigger if exists app_config_purge_ticket_scope on public.app_config;
create trigger app_config_purge_ticket_scope
  after insert or update of dashboard on public.app_config
  for each row execute function public.purge_tickets_on_config_scope_change();

drop policy if exists tickets_read_anon on public.tickets;
drop policy if exists tickets_read_configured_teams on public.tickets;
create policy tickets_read_configured_teams on public.tickets
  for select to anon, authenticated
  using (public.is_ticket_team_configured(team_id));

revoke insert, update, delete, truncate, references, trigger on table public.tickets from anon, authenticated;
grant select on table public.tickets to anon, authenticated;
grant select, insert, update, delete on table public.tickets to service_role;

-- Scope eviction is deliberately not a deletion tombstone. Its separate,
-- cause-aware watermark lets an unchanged row return after a config re-add,
-- while an event move-out still requires a strictly newer move-back.
do $$
begin
  if exists (
    select 1 from public.app_config
    where id = 1 and public.ticket_team_config_valid(dashboard)
  ) then
    perform public.purge_tickets_outside_configured_scope();
  end if;
end;
$$;

-- Defense in depth: even service-role writers cannot persist a row outside scope.
create or replace function public.upsert_tickets_if_newer(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '3500ms'
set lock_timeout = '1s'
as $$
declare
  affected integer := 0;
  row_affected integer;
  incoming record;
  tombstone_at timestamptz;
  current_ticket_updated_at timestamptz;
  scope_eviction record;
begin
  perform 1 from public.app_config
  where id = 1 and public.ticket_team_config_valid(dashboard)
  for share;
  if not found then
    raise exception 'configured team scope is missing or malformed';
  end if;

  for incoming in
    select * from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      id text, identifier text, title text, description text, priority smallint,
      priority_label text, created_at timestamptz, updated_at timestamptz,
      completed_at timestamptz, assigned_at timestamptz, due_date timestamptz,
      assignee jsonb, state jsonb, labels jsonb, project jsonb, team jsonb, cycle jsonb,
      estimate real
    )
  loop
    if incoming.id is null or incoming.updated_at is null then
      raise exception 'ticket row is invalid';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(incoming.id, 0));
    if not public.is_ticket_team_configured(incoming.team ->> 'id') then
      select updated_at into current_ticket_updated_at
      from public.tickets where id = incoming.id;

      -- A delayed move-out must not create a marker or evict a newer move-back.
      if current_ticket_updated_at is not null
        and incoming.updated_at <= current_ticket_updated_at then
        continue;
      end if;

      insert into public.ticket_scope_evictions (
        ticket_id, watermark_updated_at, team_id, cause, config_updated_at, evicted_at
      ) values (
        incoming.id, incoming.updated_at, incoming.team ->> 'id',
        'event-move-out', null, clock_timestamp()
      )
      on conflict (ticket_id) do update set
        watermark_updated_at = excluded.watermark_updated_at,
        team_id = excluded.team_id,
        cause = excluded.cause,
        config_updated_at = null,
        evicted_at = excluded.evicted_at
      where excluded.watermark_updated_at > public.ticket_scope_evictions.watermark_updated_at;

      -- This is a reversible scope transition, not a true delete tombstone.
      delete from public.tickets
      where id = incoming.id and updated_at < incoming.updated_at;
      get diagnostics row_affected = row_count;
      affected := affected + row_affected;
      continue;
    end if;

    select watermark_updated_at, team_id, cause
    into scope_eviction
    from public.ticket_scope_evictions
    where ticket_id = incoming.id;

    if found
      and not (
        incoming.updated_at > scope_eviction.watermark_updated_at
        or (
          scope_eviction.cause = 'config-scope-purge'
          and incoming.updated_at = scope_eviction.watermark_updated_at
          and (incoming.team ->> 'id') is not distinct from scope_eviction.team_id
        )
      ) then
      continue;
    end if;

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
        identifier = excluded.identifier, title = excluded.title, description = excluded.description,
        priority = excluded.priority, priority_label = excluded.priority_label,
        created_at = excluded.created_at, updated_at = excluded.updated_at,
        completed_at = excluded.completed_at, assigned_at = excluded.assigned_at,
        due_date = excluded.due_date, assignee = excluded.assignee, state = excluded.state,
        labels = excluded.labels, project = excluded.project, team = excluded.team,
        cycle = excluded.cycle, estimate = excluded.estimate
      where excluded.updated_at > public.tickets.updated_at;

      get diagnostics row_affected = row_count;
      affected := affected + row_affected;
      delete from public.ticket_tombstones
      where ticket_id = incoming.id and incoming.updated_at > deleted_updated_at;

      -- Clear only after this state passed both the scope watermark and the
      -- distinct true-deletion tombstone. A newer stored row may make the
      -- upsert a no-op, but still proves this marker is obsolete.
      delete from public.ticket_scope_evictions
      where ticket_id = incoming.id;
    end if;
  end loop;
  return affected;
end;
$$;

revoke execute on function public.upsert_tickets_if_newer(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_tickets_if_newer(jsonb) to service_role;

create or replace function public.set_app_config_if_version(
  p_dashboard jsonb,
  p_sla jsonb,
  p_expected_updated_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
  current_updated_at timestamptz;
  next_updated_at timestamptz := clock_timestamp();
begin
  if not public.ticket_team_config_valid(p_dashboard) then
    raise exception 'dashboard teams are malformed';
  end if;

  select updated_at into current_updated_at
  from public.app_config where id = 1 for update;

  if found then
    if p_expected_updated_at is null or current_updated_at is distinct from p_expected_updated_at then
      raise exception 'app config version conflict';
    end if;
    update public.app_config
    set dashboard = p_dashboard, sla = p_sla, updated_at = next_updated_at
    where id = 1;
  else
    if p_expected_updated_at is not null then raise exception 'app config version conflict'; end if;
    insert into public.app_config(id, dashboard, sla, updated_at)
    values (1, p_dashboard, p_sla, next_updated_at);
  end if;

  return next_updated_at::text;
end;
$$;

revoke all on function public.set_app_config_if_version(jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.set_app_config_if_version(jsonb, jsonb, timestamptz) to service_role;

revoke all on function public.purge_tickets_outside_configured_scope() from public, anon, authenticated;
revoke all on function public.purge_tickets_on_config_scope_change() from public, anon, authenticated;
revoke all on function public.stamp_app_config_updated_at() from public, anon, authenticated;
grant execute on function public.purge_tickets_outside_configured_scope() to service_role;

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
  current_config_updated_at timestamptz;
  current_team_ids text[];
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

  select updated_at into current_config_updated_at
  from public.app_config
  where id = 1 and public.ticket_team_config_valid(dashboard)
  for share;
  if not found then raise exception 'configured team scope is missing or malformed'; end if;

  select coalesce(array_agg(team_id order by team_id), array[]::text[])
  into current_team_ids
  from public.configured_ticket_team_ids();
  if current_team_ids is distinct from p_team_ids then
    raise exception 'configured team scope changed during reconciliation';
  end if;
  if run_row.config_updated_at is not null
    and current_config_updated_at is distinct from run_row.config_updated_at then
    raise exception 'configured team scope version changed during reconciliation';
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

create or replace function public.cleanup_operational_history()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '10s'
set lock_timeout = '1s'
as $$
declare
  deliveries_deleted integer;
  runs_deleted integer;
  tombstones_deleted integer;
begin
  with expired as (
    select delivery_id from public.webhook_deliveries
    where (processed_at is not null and processed_at < now() - interval '30 days')
       or (processed_at is null and received_at < now() - interval '7 days')
    order by received_at limit 10000
  )
  delete from public.webhook_deliveries delivery using expired
  where delivery.delivery_id = expired.delivery_id;
  get diagnostics deliveries_deleted = row_count;

  with expired as (
    select id from public.reconcile_runs
    where finished_at < now() - interval '90 days'
    order by finished_at limit 10000
  )
  delete from public.reconcile_runs run using expired where run.id = expired.id;
  get diagnostics runs_deleted = row_count;

  with expired as (
    select tombstone.ticket_id
    from public.ticket_tombstones tombstone
    where tombstone.deleted_at < now() - interval '730 days'
      and not exists (select 1 from public.tickets ticket where ticket.id = tombstone.ticket_id)
    order by tombstone.deleted_at limit 10000
  )
  delete from public.ticket_tombstones tombstone using expired
  where tombstone.ticket_id = expired.ticket_id;
  get diagnostics tombstones_deleted = row_count;

  return jsonb_build_object(
    'webhookDeliveries', deliveries_deleted,
    'reconcileRuns', runs_deleted,
    'ticketTombstones', tombstones_deleted
  );
end;
$$;

revoke all on function public.cleanup_operational_history() from public, anon, authenticated;
grant execute on function public.cleanup_operational_history() to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'camtom-operational-retention'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'camtom-operational-retention',
    '41 4 * * 0',
    $job$select public.cleanup_operational_history();$job$
  );
end;
$$;
