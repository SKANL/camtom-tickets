-- Add normalized per-team dashboard configuration without removing the v1
-- app_config contract. Old workers continue reading dashboard/sla while v2
-- clients receive team-specific settings from team_dashboard_config.

create table if not exists public.team_dashboard_config (
  team_id text primary key,
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.team_dashboard_config enable row level security;
revoke all privileges on table public.team_dashboard_config from public, anon, authenticated;
grant select, insert, update, delete on table public.team_dashboard_config to service_role;

create table if not exists public.app_config_v2_state (
  id smallint primary key default 1 check (id = 1),
  active boolean not null default false
);
insert into public.app_config_v2_state(id, active) values (1, false) on conflict (id) do nothing;
alter table public.app_config_v2_state enable row level security;
revoke all privileges on table public.app_config_v2_state from public, anon, authenticated;
grant select, insert, update on table public.app_config_v2_state to service_role;

-- Supabase CLI applies each migration transactionally. Take this lock before
-- both the copy and trigger activation: concurrent 0010 writers block until
-- commit, at which point the trigger is installed, so no committed legacy
-- write can escape normalization.
lock table public.app_config in share row exclusive mode;

-- Preserve the exact v1 behavior for every existing team. Each row is the sole,
-- complete authority for that team's behavior; there is no second defaults layer.
insert into public.team_dashboard_config(team_id, settings, updated_at)
select
  team.value ->> 'id',
  jsonb_strip_nulls(jsonb_build_object(
    'filter', coalesce(team.value ->> 'filter', 'active-states'),
    'timer', case
      when jsonb_typeof(team.value -> 'timer') = 'boolean' then (team.value ->> 'timer')::boolean
      else true
    end,
    'accent', team.value -> 'accent',
    'slas', config.sla,
    'teamMembers', config.dashboard -> 'teamMembers',
    'displayOrder', config.dashboard -> 'displayOrder',
    'priorityLabels', config.dashboard -> 'priorityLabels',
    'stateLabels', config.dashboard -> 'stateLabels',
    'report', config.dashboard -> 'report',
    'kitchenPhrases', config.dashboard -> 'kitchenPhrases',
    'zoneLabels', coalesce(
      config.dashboard -> 'zoneLabels',
      '{"new":"Sin tomar","active":"En progreso","done":"Servidos hoy"}'::jsonb
    ),
    'displayOptions', coalesce(config.dashboard -> 'displayOptions', '{}'::jsonb)
  )),
  config.updated_at
from public.app_config config
cross join lateral jsonb_array_elements(config.dashboard -> 'teams') team(value)
where config.id = 1
  and public.ticket_team_config_valid(config.dashboard)
on conflict (team_id) do nothing;

-- During the expand/deploy window, legacy servers still call the 0010 RPC.
-- Keep normalized team rows synchronized with those v1 writes so a later v2
-- read cannot observe stale team settings. The first v2 write activates the new
-- contract; later legacy writes fail closed instead of flattening independent rows.
create or replace function public.sync_team_dashboard_config_from_app_config()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if current_setting('camtom.config_v2_write', true) = 'on' then
    return new;
  end if;
  if exists (select 1 from public.app_config_v2_state where id = 1 and active) then
    raise exception 'config v2 is active; legacy config writes are disabled';
  end if;

  insert into public.team_dashboard_config(team_id, settings, updated_at)
  select
    team.value ->> 'id',
    jsonb_strip_nulls(jsonb_build_object(
      'filter', coalesce(team.value ->> 'filter', 'active-states'),
      'timer', case
        when jsonb_typeof(team.value -> 'timer') = 'boolean' then (team.value ->> 'timer')::boolean
        else true
      end,
      'accent', team.value -> 'accent',
      'slas', new.sla,
      'teamMembers', new.dashboard -> 'teamMembers',
      'displayOrder', new.dashboard -> 'displayOrder',
      'priorityLabels', new.dashboard -> 'priorityLabels',
      'stateLabels', new.dashboard -> 'stateLabels',
      'report', new.dashboard -> 'report',
      'kitchenPhrases', new.dashboard -> 'kitchenPhrases',
      'zoneLabels', coalesce(
        new.dashboard -> 'zoneLabels',
        '{"new":"Sin tomar","active":"En progreso","done":"Servidos hoy"}'::jsonb
      ),
      'displayOptions', coalesce(new.dashboard -> 'displayOptions', '{}'::jsonb)
    )),
    new.updated_at
  from jsonb_array_elements(new.dashboard -> 'teams') team(value)
  on conflict (team_id) do update
    set settings = excluded.settings,
        updated_at = excluded.updated_at;

  delete from public.team_dashboard_config
  where team_id not in (
    select team.value ->> 'id'
    from jsonb_array_elements(new.dashboard -> 'teams') team(value)
  );
  return new;
end;
$$;

revoke all on function public.sync_team_dashboard_config_from_app_config() from public;

drop trigger if exists sync_team_dashboard_config_from_app_config on public.app_config;
create trigger sync_team_dashboard_config_from_app_config
after insert or update of dashboard, sla on public.app_config
for each row when (new.id = 1)
execute function public.sync_team_dashboard_config_from_app_config();

create or replace function public.get_app_config_v2_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'dashboard', config.dashboard,
    'sla', config.sla,
    'updatedAt', config.updated_at,
    'teamConfigs', coalesce((
      select jsonb_object_agg(team.team_id, team.settings order by team.team_id)
      from public.team_dashboard_config team
    ), '{}'::jsonb)
  )
  from public.app_config config
  where config.id = 1;
$$;

revoke all on function public.get_app_config_v2_snapshot() from public, anon, authenticated;
grant execute on function public.get_app_config_v2_snapshot() to service_role;

create or replace function public.set_app_config_v2_if_version(
  p_dashboard jsonb,
  p_sla jsonb,
  p_team_configs jsonb,
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
  team_config record;
  configured_ids text[];
  supplied_ids text[];
begin
  if not public.ticket_team_config_valid(p_dashboard) then
    raise exception 'dashboard teams are malformed';
  end if;
  if jsonb_typeof(p_team_configs) <> 'object' then
    raise exception 'team configs must be an object';
  end if;

  select updated_at into current_updated_at
  from public.app_config where id = 1 for update;
  if not found
    or p_expected_updated_at is null
    or current_updated_at is distinct from p_expected_updated_at then
    raise exception 'app config version conflict';
  end if;

  select coalesce(array_agg(team.value ->> 'id' order by team.value ->> 'id'), array[]::text[])
  into configured_ids
  from jsonb_array_elements(p_dashboard -> 'teams') team(value);

  select coalesce(array_agg(key order by key), array[]::text[])
  into supplied_ids
  from jsonb_each(p_team_configs);

  if configured_ids is distinct from supplied_ids then
    raise exception 'team configs must match configured dashboard teams';
  end if;

  -- Bypass the legacy projection for this exact v2 payload. Once this first v2 write
  -- commits, legacy writers fail closed instead of flattening independent rows.
  perform set_config('camtom.config_v2_write', 'on', true);
  update public.app_config
  set dashboard = p_dashboard,
      sla = p_sla,
      updated_at = next_updated_at
  where id = 1;

  for team_config in select key, value from jsonb_each(p_team_configs)
  loop
    if jsonb_typeof(team_config.value) <> 'object' then
      raise exception 'team config % must be an object', team_config.key;
    end if;
    insert into public.team_dashboard_config(team_id, settings, updated_at)
    values (team_config.key, team_config.value, next_updated_at)
    on conflict (team_id) do update
      set settings = excluded.settings,
          updated_at = excluded.updated_at;
  end loop;

  delete from public.team_dashboard_config
  where not (team_id = any(configured_ids));

  update public.app_config_v2_state set active = true where id = 1;

  return next_updated_at::text;
end;
$$;

revoke all on function public.set_app_config_v2_if_version(jsonb, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_app_config_v2_if_version(jsonb, jsonb, jsonb, timestamptz)
  to service_role;
