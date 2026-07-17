-- Universal screen remote control. The browser applies versioned application
-- state; this does not attempt to control the TV, browser process, power, or volume.

create table if not exists public.screen_devices (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text check (display_name is null or length(display_name) between 1 and 80),
  desired_state jsonb,
  state_version bigint not null default 0 check (state_version >= 0),
  last_applied_version bigint not null default 0 check (last_applied_version >= 0),
  last_seen_at timestamptz,
  capabilities jsonb not null default '{}'::jsonb check (
    jsonb_typeof(capabilities) = 'object' and octet_length(capabilities::text) <= 8192
  ),
  allowed_team_ids text[] not null default '{}'::text[],
  paired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (desired_state is null or jsonb_typeof(desired_state) = 'object'),
  check (last_applied_version <= state_version)
);

create unique index if not exists screen_devices_one_active_identity
  on public.screen_devices(auth_user_id) where revoked_at is null;
create index if not exists screen_devices_last_seen_idx on public.screen_devices(last_seen_at desc);

create table if not exists public.screen_pairings (
  id uuid primary key default gen_random_uuid(),
  -- Pending pairings do not allocate permanent devices. The device is created
  -- atomically only after an authenticated administrator claims the code.
  device_id uuid references public.screen_devices(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  start_request_id uuid not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  code_nonce integer not null default 0 check (code_nonce between 0 and 100),
  expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  claimed_at timestamptz,
  claimed_request_id uuid,
  created_at timestamptz not null default now(),
  unique (auth_user_id, start_request_id),
  unique (code_hash),
  unique (claimed_request_id)
);
create index if not exists screen_pairings_expiry_idx on public.screen_pairings(expires_at);

create table if not exists public.screen_state_commands (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.screen_devices(id) on delete cascade,
  request_id uuid not null,
  expected_version bigint not null check (expected_version >= 0),
  state_version bigint not null check (state_version > 0),
  desired_state jsonb not null check (jsonb_typeof(desired_state) = 'object'),
  allowed_team_ids text[] not null,
  created_at timestamptz not null default now(),
  unique (device_id, request_id),
  unique (device_id, state_version)
);
create index if not exists screen_state_commands_created_idx on public.screen_state_commands(created_at);

create table if not exists public.screen_pairing_attempts (
  id bigint generated always as identity primary key,
  action text not null check (action in ('start', 'claim')),
  bucket_type text not null check (bucket_type in ('uid', 'ip', 'global')),
  actor_hash text not null check (actor_hash ~ '^[0-9a-f]{64}$'),
  accepted boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists screen_pairing_attempts_lookup_idx
  on public.screen_pairing_attempts(action, bucket_type, actor_hash, accepted, attempted_at desc);

alter table public.screen_devices enable row level security;
alter table public.screen_pairings enable row level security;
alter table public.screen_state_commands enable row level security;
alter table public.screen_pairing_attempts enable row level security;

revoke all privileges on table public.screen_devices from public, anon, authenticated;
revoke all privileges on table public.screen_pairings from public, anon, authenticated;
revoke all privileges on table public.screen_state_commands from public, anon, authenticated;
revoke all privileges on table public.screen_pairing_attempts from public, anon, authenticated;
revoke all privileges on all sequences in schema public from public, anon, authenticated;

grant select on table public.screen_devices to authenticated;
grant select, insert, update, delete on table public.screen_devices to service_role;
grant select, insert, update, delete on table public.screen_pairings to service_role;
grant select, insert, update, delete on table public.screen_state_commands to service_role;
grant select, insert, update, delete on table public.screen_pairing_attempts to service_role;
grant usage, select on all sequences in schema public to service_role;

drop policy if exists screen_devices_select_own_identity on public.screen_devices;
create policy screen_devices_select_own_identity on public.screen_devices
  for select to authenticated
  using (auth.uid() = auth_user_id);

-- Legacy unauthenticated dashboards retain configured-team access. Once a TV
-- has an anonymous Auth identity, its ticket scope is narrowed to that device.
drop policy if exists tickets_read_configured_teams on public.tickets;
drop policy if exists tickets_read_legacy_anon on public.tickets;
drop policy if exists tickets_read_screen_devices on public.tickets;
create policy tickets_read_legacy_anon on public.tickets
  for select to anon
  using (public.is_ticket_team_configured(team_id));
create policy tickets_read_screen_devices on public.tickets
  for select to authenticated
  using (
    public.is_ticket_team_configured(team_id)
    and exists (
      select 1 from public.screen_devices device
      where device.auth_user_id = auth.uid()
        and device.revoked_at is null
        and device.paired_at is not null
        and public.tickets.team_id = any(device.allowed_team_ids)
    )
  );

create or replace function public.check_screen_pairing_limits(
  p_action text,
  p_uid_hash text,
  p_ip_hash text,
  p_global_hash text,
  p_uid_limit integer,
  p_ip_limit integer,
  p_global_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '2s'
as $$
declare
  uid_count integer := 0;
  ip_count integer := 0;
  global_count integer := 0;
  accepted_attempt boolean := false;
begin
  if p_action not in ('start', 'claim')
    or p_global_hash !~ '^[0-9a-f]{64}$'
    or (p_uid_hash is not null and p_uid_hash !~ '^[0-9a-f]{64}$')
    or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$')
    or p_uid_limit < 1 or p_ip_limit < 1 or p_global_limit < 1
    or p_uid_limit > 100 or p_ip_limit > 100 or p_global_limit > 1000
    or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid pairing rate-limit input';
  end if;
  -- One global lock makes the three bucket decisions atomic. Raw UIDs/IPs are
  -- never passed: callers provide dedicated HMAC bucket identifiers.
  perform pg_advisory_xact_lock(hashtextextended('screen-pairing:' || p_action, 0));
  select count(*) into global_count
  from public.screen_pairing_attempts
  where action = p_action and bucket_type = 'global' and actor_hash = p_global_hash
    and accepted is true
    and attempted_at >= clock_timestamp() - make_interval(secs => p_window_seconds);
  if p_uid_hash is not null then
    select count(*) into uid_count from public.screen_pairing_attempts
    where action = p_action and bucket_type = 'uid' and actor_hash = p_uid_hash
      and accepted is true
      and attempted_at >= clock_timestamp() - make_interval(secs => p_window_seconds);
  end if;
  if p_ip_hash is not null then
    select count(*) into ip_count from public.screen_pairing_attempts
    where action = p_action and bucket_type = 'ip' and actor_hash = p_ip_hash
      and accepted is true
      and attempted_at >= clock_timestamp() - make_interval(secs => p_window_seconds);
  end if;
  accepted_attempt := global_count < p_global_limit
    and (p_uid_hash is null or uid_count < p_uid_limit)
    and (p_ip_hash is null or ip_count < p_ip_limit);
  insert into public.screen_pairing_attempts(action, bucket_type, actor_hash, accepted)
  values (p_action, 'global', p_global_hash, accepted_attempt);
  if p_uid_hash is not null then
    insert into public.screen_pairing_attempts(action, bucket_type, actor_hash, accepted)
    values (p_action, 'uid', p_uid_hash, accepted_attempt);
  end if;
  if p_ip_hash is not null then
    insert into public.screen_pairing_attempts(action, bucket_type, actor_hash, accepted)
    values (p_action, 'ip', p_ip_hash, accepted_attempt);
  end if;
  return accepted_attempt;
end;
$$;

create or replace function public.claim_screen_pairing(
  p_code_hash text,
  p_request_id uuid,
  p_display_name text,
  p_allowed_team_ids text[],
  p_desired_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
  pairing public.screen_pairings%rowtype;
  device public.screen_devices%rowtype;
  configured_ids text[];
  left_team text;
  right_team text;
begin
  select * into pairing from public.screen_pairings
  where claimed_request_id = p_request_id;
  if found then
    select * into device from public.screen_devices where id = pairing.device_id;
    return jsonb_build_object('status', 'claimed', 'device', to_jsonb(device));
  end if;

  select * into pairing from public.screen_pairings where code_hash = p_code_hash for update;
  if not found or pairing.claimed_at is not null then
    return jsonb_build_object('status', 'invalid');
  end if;
  update public.screen_pairings set attempt_count = attempt_count + 1 where id = pairing.id;
  if pairing.expires_at <= clock_timestamp() or pairing.attempt_count >= pairing.max_attempts then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_display_name is null or length(trim(p_display_name)) not between 1 and 80
    or jsonb_typeof(p_desired_state) <> 'object' then
    raise exception 'invalid screen pairing payload';
  end if;

  select coalesce(array_agg(team.value ->> 'id'), array[]::text[]) into configured_ids
  from public.app_config config
  cross join lateral jsonb_array_elements(config.dashboard -> 'teams') team(value)
  where config.id = 1 and public.ticket_team_config_valid(config.dashboard);
  if p_allowed_team_ids is null or cardinality(p_allowed_team_ids) < 1
    or not (p_allowed_team_ids <@ configured_ids) then
    raise exception 'screen teams are outside configured scope';
  end if;
  left_team := p_desired_state #>> '{panes,left,teamId}';
  right_team := p_desired_state #>> '{panes,right,teamId}';
  if left_team is null or right_team is null
    or not (left_team = any(p_allowed_team_ids))
    or not (right_team = any(p_allowed_team_ids)) then
    raise exception 'screen state is outside allowed teams';
  end if;

  if exists (select 1 from public.screen_devices where auth_user_id = pairing.auth_user_id and revoked_at is null) then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.screen_devices(
    auth_user_id, display_name, allowed_team_ids, desired_state,
    state_version, last_applied_version, paired_at
  ) values (
    pairing.auth_user_id, trim(p_display_name), p_allowed_team_ids, p_desired_state,
    1, 0, clock_timestamp()
  ) returning * into device;

  update public.screen_pairings
  set device_id = device.id, claimed_at = clock_timestamp(), claimed_request_id = p_request_id
  where id = pairing.id;
  insert into public.screen_state_commands(
    device_id, request_id, expected_version, state_version, desired_state, allowed_team_ids
  ) values (device.id, p_request_id, 0, 1, p_desired_state, p_allowed_team_ids);
  return jsonb_build_object('status', 'claimed', 'device', to_jsonb(device));
end;
$$;

create or replace function public.set_screen_desired_state(
  p_device_id uuid,
  p_desired_state jsonb,
  p_allowed_team_ids text[],
  p_expected_version bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
  device public.screen_devices%rowtype;
  existing public.screen_state_commands%rowtype;
  configured_ids text[];
  next_version bigint;
  left_team text := p_desired_state #>> '{panes,left,teamId}';
  right_team text := p_desired_state #>> '{panes,right,teamId}';
begin
  select * into existing from public.screen_state_commands
  where device_id = p_device_id and request_id = p_request_id;
  if found then
    if existing.desired_state is distinct from p_desired_state
      or existing.expected_version is distinct from p_expected_version
      or existing.allowed_team_ids is distinct from p_allowed_team_ids then
      raise exception 'request id payload conflict';
    end if;
    select * into device from public.screen_devices where id = p_device_id;
    return to_jsonb(device);
  end if;

  select * into device from public.screen_devices where id = p_device_id for update;
  if not found or device.revoked_at is not null or device.paired_at is null then
    raise exception 'screen device unavailable';
  end if;
  if device.state_version is distinct from p_expected_version then
    raise exception 'screen state version conflict';
  end if;
  if jsonb_typeof(p_desired_state) <> 'object' then raise exception 'invalid screen state'; end if;

  select coalesce(array_agg(team.value ->> 'id'), array[]::text[]) into configured_ids
  from public.app_config config
  cross join lateral jsonb_array_elements(config.dashboard -> 'teams') team(value)
  where config.id = 1 and public.ticket_team_config_valid(config.dashboard);
  if p_allowed_team_ids is null or cardinality(p_allowed_team_ids) < 1
    or not (p_allowed_team_ids <@ configured_ids)
    or left_team is null or right_team is null
    or not (left_team = any(p_allowed_team_ids))
    or not (right_team = any(p_allowed_team_ids)) then
    raise exception 'screen state is outside allowed teams';
  end if;

  next_version := device.state_version + 1;
  update public.screen_devices
  set desired_state = p_desired_state, allowed_team_ids = p_allowed_team_ids,
      state_version = next_version, updated_at = clock_timestamp()
  where id = p_device_id returning * into device;
  insert into public.screen_state_commands(
    device_id, request_id, expected_version, state_version, desired_state, allowed_team_ids
  ) values (p_device_id, p_request_id, p_expected_version, next_version, p_desired_state, p_allowed_team_ids);
  return to_jsonb(device);
end;
$$;

create or replace function public.screen_device_ack(
  p_device_id uuid,
  p_applied_version bigint,
  p_capabilities jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or jsonb_typeof(p_capabilities) <> 'object'
    or octet_length(p_capabilities::text) > 8192 then return false; end if;
  update public.screen_devices
  set last_applied_version = greatest(last_applied_version, p_applied_version),
      last_seen_at = clock_timestamp(), capabilities = p_capabilities,
      updated_at = clock_timestamp()
  where id = p_device_id and auth_user_id = auth.uid()
    and revoked_at is null and paired_at is not null
    and p_applied_version between 0 and state_version;
  return found;
end;
$$;

create or replace function public.screen_device_heartbeat(
  p_device_id uuid,
  p_capabilities jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null or jsonb_typeof(p_capabilities) <> 'object'
    or octet_length(p_capabilities::text) > 8192 then return false; end if;
  update public.screen_devices
  set last_seen_at = clock_timestamp(), capabilities = p_capabilities,
      updated_at = clock_timestamp()
  where id = p_device_id and auth_user_id = auth.uid()
    and revoked_at is null and paired_at is not null;
  return found;
end;
$$;

create or replace function public.cleanup_screen_control_history()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '10s'
set lock_timeout = '1s'
as $$
declare
  pairings_deleted integer := 0;
  attempts_deleted integer := 0;
  commands_deleted integer := 0;
  anonymous_users_deleted integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('screen-control-history-cleanup', 0)) then
    return jsonb_build_object(
      'status', 'skipped_locked',
      'pairings_deleted', 0,
      'attempts_deleted', 0,
      'commands_deleted', 0,
      'anonymous_users_deleted', 0
    );
  end if;

  delete from public.screen_pairings
  where (claimed_at is null and expires_at < clock_timestamp())
     or (claimed_at is not null and claimed_at < clock_timestamp() - interval '24 hours');
  get diagnostics pairings_deleted = row_count;
  delete from public.screen_pairing_attempts
  where attempted_at < clock_timestamp() - interval '24 hours';
  get diagnostics attempts_deleted = row_count;
  delete from public.screen_state_commands
  where created_at < clock_timestamp() - interval '30 days';
  get diagnostics commands_deleted = row_count;

  -- Bound anonymous Auth growth without touching identities that own a device or
  -- still have an unexpired pending pairing. The batch limit prevents an hourly
  -- cleanup from holding auth.users locks for an unbounded amount of time.
  with orphaned as (
    select users.id
    from auth.users as users
    where users.is_anonymous is true
      and users.created_at < clock_timestamp() - interval '30 days'
      and not exists (
        select 1 from public.screen_devices as devices
        where devices.auth_user_id = users.id
      )
      and not exists (
        select 1 from public.screen_pairings as pairings
        where pairings.auth_user_id = users.id
          and pairings.claimed_at is null
          and pairings.expires_at >= clock_timestamp()
      )
    order by users.created_at
    limit 100
    for update of users skip locked
  )
  delete from auth.users as users
  using orphaned
  where users.id = orphaned.id;
  get diagnostics anonymous_users_deleted = row_count;

  return jsonb_build_object(
    'status', 'completed',
    'pairings_deleted', pairings_deleted,
    'attempts_deleted', attempts_deleted,
    'commands_deleted', commands_deleted,
    'anonymous_users_deleted', anonymous_users_deleted
  );
end;
$$;

revoke all on function public.check_screen_pairing_limits(text, text, text, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_screen_pairing(text, uuid, text, text[], jsonb) from public, anon, authenticated;
revoke all on function public.set_screen_desired_state(uuid, jsonb, text[], bigint, uuid) from public, anon, authenticated;
revoke all on function public.screen_device_ack(uuid, bigint, jsonb) from public, anon;
revoke all on function public.screen_device_heartbeat(uuid, jsonb) from public, anon;
revoke all on function public.cleanup_screen_control_history() from public, anon, authenticated;
grant execute on function public.check_screen_pairing_limits(text, text, text, text, integer, integer, integer, integer) to service_role;
grant execute on function public.claim_screen_pairing(text, uuid, text, text[], jsonb) to service_role;
grant execute on function public.set_screen_desired_state(uuid, jsonb, text[], bigint, uuid) to service_role;
grant execute on function public.screen_device_ack(uuid, bigint, jsonb) to authenticated;
grant execute on function public.screen_device_heartbeat(uuid, jsonb) to authenticated;
grant execute on function public.cleanup_screen_control_history() to service_role;

alter table public.screen_devices replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'screen_devices'
    ) then
    alter publication supabase_realtime add table public.screen_devices;
  end if;
end;
$$;

do $$
declare job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for job_id in select jobid from cron.job where jobname = 'cleanup-screen-control-history'
    loop perform cron.unschedule(job_id); end loop;
    perform cron.schedule(
      'cleanup-screen-control-history', '17 * * * *',
      'select public.cleanup_screen_control_history()'
    );
  end if;
end;
$$;
