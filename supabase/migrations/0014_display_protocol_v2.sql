-- Protocol v2 removes Supabase Auth, CAPTCHA, storage, and Realtime from the
-- display's required path. All v2 access is mediated by same-origin server routes.

alter table public.screen_devices alter column auth_user_id drop not null;
alter table public.screen_devices add column if not exists protocol_version smallint not null default 1;
alter table public.screen_devices add column if not exists installation_id uuid;
alter table public.screen_devices add column if not exists superseded_by uuid references public.screen_devices(id) on delete set null;
alter table public.screen_devices add column if not exists replacement_for_device_id uuid references public.screen_devices(id) on delete set null;
alter table public.screen_devices add column if not exists migration_state text not null default 'legacy';
alter table public.screen_devices add constraint screen_devices_protocol_version_check
  check (protocol_version in (1, 2));
alter table public.screen_devices add constraint screen_devices_v2_identity_check
  check ((protocol_version = 1 and auth_user_id is not null)
    or (protocol_version = 2 and installation_id is not null));
alter table public.screen_devices add constraint screen_devices_migration_state_check
  check (migration_state in ('legacy', 'v2_pending', 'v2_active'));
create unique index if not exists screen_devices_installation_id_unique
  on public.screen_devices(installation_id) where installation_id is not null;
create index if not exists screen_devices_replacement_idx
  on public.screen_devices(replacement_for_device_id) where replacement_for_device_id is not null;

alter table public.screen_pairings alter column auth_user_id drop not null;
alter table public.screen_pairings add column if not exists protocol_version smallint not null default 1;
alter table public.screen_pairings add column if not exists installation_id uuid;
alter table public.screen_pairings add column if not exists poll_secret_hash text;
alter table public.screen_pairings add column if not exists replacement_for_device_id uuid references public.screen_devices(id) on delete set null;
alter table public.screen_pairings add column if not exists status_delivered_at timestamptz;
alter table public.screen_pairings add constraint screen_pairings_protocol_version_check
  check (protocol_version in (1, 2));
alter table public.screen_pairings add constraint screen_pairings_v2_identity_check
  check ((protocol_version = 1 and auth_user_id is not null)
    or (protocol_version = 2 and auth_user_id is null and installation_id is not null
      and poll_secret_hash ~ '^[0-9a-f]{64}$'));
create unique index if not exists screen_pairings_installation_id_unique
  on public.screen_pairings(installation_id) where installation_id is not null;
create unique index if not exists screen_pairings_v2_start_request_unique
  on public.screen_pairings(start_request_id) where protocol_version = 2;

create table if not exists public.screen_device_credentials (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.screen_devices(id) on delete cascade,
  credential_hash text not null check (credential_hash ~ '^[0-9a-f]{64}$'),
  generation integer not null check (generation > 0),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (device_id, generation),
  unique (credential_hash)
);
create unique index if not exists screen_device_credentials_one_active
  on public.screen_device_credentials(device_id) where revoked_at is null;
create index if not exists screen_device_credentials_last_used_idx
  on public.screen_device_credentials(last_used_at desc);

alter table public.screen_device_credentials enable row level security;
revoke all privileges on table public.screen_device_credentials from public, anon, authenticated;
grant select, insert, update, delete on table public.screen_device_credentials to service_role;

-- A statement-level revision makes full ticket snapshots deletion-safe without
-- forcing every 10-second sync to resend all tickets.
create table if not exists public.screen_ticket_revision (
  id integer primary key default 1 check (id = 1),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
insert into public.screen_ticket_revision(id, revision) values (1, 1)
on conflict (id) do nothing;
alter table public.screen_ticket_revision enable row level security;
revoke all privileges on table public.screen_ticket_revision from public, anon, authenticated;
grant select, update on table public.screen_ticket_revision to service_role;

create or replace function public.bump_screen_ticket_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  update public.screen_ticket_revision
  set revision = revision + 1, updated_at = clock_timestamp()
  where id = 1;
  return null;
end;
$$;
drop trigger if exists tickets_bump_screen_revision on public.tickets;
create trigger tickets_bump_screen_revision
after insert or update or delete or truncate on public.tickets
for each statement execute function public.bump_screen_ticket_revision();
revoke all on function public.bump_screen_ticket_revision() from public, anon, authenticated;

create or replace function public.create_screen_pairing_v2(
  p_request_id uuid,
  p_installation_id uuid,
  p_poll_secret_hash text,
  p_code_hash text,
  p_expires_at timestamptz,
  p_ip_hash text,
  p_global_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '3s'
set lock_timeout = '1s'
as $$
declare
  ip_count integer := 0;
  global_count integer := 0;
  pending_count integer := 0;
  pairing_id uuid;
  accepted boolean := false;
begin
  if p_poll_secret_hash !~ '^[0-9a-f]{64}$' or p_code_hash !~ '^[0-9a-f]{64}$'
    or p_global_hash !~ '^[0-9a-f]{64}$'
    or (p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$')
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '10 minutes' then
    raise exception 'invalid v2 pairing input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('screen-pairing:v2:create', 0));
  if exists (
    select 1 from public.screen_pairings
    where protocol_version = 2 and start_request_id = p_request_id
  ) then
    return jsonb_build_object('status', 'replay');
  end if;
  delete from public.screen_pairings
  where protocol_version = 2 and claimed_at is null and expires_at < clock_timestamp();
  delete from public.screen_pairing_attempts
  where attempted_at < clock_timestamp() - interval '24 hours';

  select count(*) into global_count from public.screen_pairing_attempts
  where action = 'start' and bucket_type = 'global' and actor_hash = p_global_hash
    and accepted is true and attempted_at >= clock_timestamp() - interval '15 minutes';
  if p_ip_hash is not null then
    select count(*) into ip_count from public.screen_pairing_attempts
    where action = 'start' and bucket_type = 'ip' and actor_hash = p_ip_hash
      and accepted is true and attempted_at >= clock_timestamp() - interval '15 minutes';
  end if;
  select count(*) into pending_count from public.screen_pairings
  where protocol_version = 2 and claimed_at is null and expires_at >= clock_timestamp();
  accepted := global_count < 100 and pending_count < 100 and (p_ip_hash is null or ip_count < 5);

  if not accepted then
    return jsonb_build_object('status', case when pending_count >= 100 then 'capacity' else 'rate_limited' end);
  end if;

  -- Rejected traffic must not create unbounded audit rows. Accepted rows alone
  -- consume and document the fixed rolling IP/global quotas.
  insert into public.screen_pairing_attempts(action, bucket_type, actor_hash, accepted)
  values ('start', 'global', p_global_hash, true);
  if p_ip_hash is not null then
    insert into public.screen_pairing_attempts(action, bucket_type, actor_hash, accepted)
    values ('start', 'ip', p_ip_hash, true);
  end if;

  insert into public.screen_pairings(
    auth_user_id, start_request_id, code_hash, code_nonce, expires_at,
    protocol_version, installation_id, poll_secret_hash
  ) values (
    null, p_request_id, p_code_hash, 0, p_expires_at,
    2, p_installation_id, p_poll_secret_hash
  ) returning id into pairing_id;
  return jsonb_build_object('status', 'created', 'pairing_id', pairing_id);
end;
$$;

create or replace function public.claim_screen_pairing_v2(
  p_code_hash text,
  p_request_id uuid,
  p_display_name text,
  p_allowed_team_ids text[],
  p_desired_state jsonb,
  p_replacement_for_device_id uuid default null
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
  existing_replacement public.screen_devices%rowtype;
  configured_ids text[];
  left_team text;
  right_team text;
begin
  select * into pairing from public.screen_pairings
  where claimed_request_id = p_request_id and protocol_version = 2;
  if found then
    select * into device from public.screen_devices where id = pairing.device_id;
    return jsonb_build_object('status', 'claimed', 'device', to_jsonb(device));
  end if;

  select * into pairing from public.screen_pairings
  where code_hash = p_code_hash and protocol_version = 2 for update;
  if not found or pairing.claimed_at is not null then return jsonb_build_object('status', 'invalid'); end if;
  update public.screen_pairings set attempt_count = attempt_count + 1 where id = pairing.id;
  if pairing.expires_at <= clock_timestamp() or pairing.attempt_count >= pairing.max_attempts then
    return jsonb_build_object('status', 'invalid');
  end if;
  if p_display_name is null or length(trim(p_display_name)) not between 1 and 80
    or jsonb_typeof(p_desired_state) <> 'object' then raise exception 'invalid screen pairing payload'; end if;

  select coalesce(array_agg(team.value ->> 'id'), array[]::text[]) into configured_ids
  from public.app_config config
  cross join lateral jsonb_array_elements(config.dashboard -> 'teams') team(value)
  where config.id = 1 and public.ticket_team_config_valid(config.dashboard);
  left_team := p_desired_state #>> '{panes,left,teamId}';
  right_team := p_desired_state #>> '{panes,right,teamId}';
  if p_allowed_team_ids is null or cardinality(p_allowed_team_ids) < 1
    or not (p_allowed_team_ids <@ configured_ids)
    or left_team is null or right_team is null
    or not (left_team = any(p_allowed_team_ids)) or not (right_team = any(p_allowed_team_ids)) then
    raise exception 'screen state is outside allowed teams';
  end if;
  if p_replacement_for_device_id is not null then
    select * into existing_replacement from public.screen_devices
    where id = p_replacement_for_device_id and revoked_at is null for update;
    if not found then raise exception 'replacement screen unavailable'; end if;
  end if;

  insert into public.screen_devices(
    auth_user_id, display_name, allowed_team_ids, desired_state, state_version,
    last_applied_version, paired_at, protocol_version, installation_id,
    replacement_for_device_id, migration_state
  ) values (
    null, trim(p_display_name), p_allowed_team_ids, p_desired_state, 1,
    0, clock_timestamp(), 2, pairing.installation_id,
    p_replacement_for_device_id, 'v2_pending'
  ) returning * into device;
  insert into public.screen_device_credentials(device_id, credential_hash, generation)
  values (device.id, pairing.poll_secret_hash, 1);
  update public.screen_pairings
  set device_id = device.id, claimed_at = clock_timestamp(), claimed_request_id = p_request_id,
      replacement_for_device_id = p_replacement_for_device_id
  where id = pairing.id;
  insert into public.screen_state_commands(
    device_id, request_id, expected_version, state_version, desired_state, allowed_team_ids
  ) values (device.id, p_request_id, 0, 1, p_desired_state, p_allowed_team_ids);
  return jsonb_build_object('status', 'claimed', 'device', to_jsonb(device));
end;
$$;

create or replace function public.sync_screen_device_v2(
  p_credential_id uuid,
  p_applied_version bigint,
  p_capabilities jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '5s'
set lock_timeout = '1s'
as $$
declare
  credential public.screen_device_credentials%rowtype;
  device public.screen_devices%rowtype;
  now_at timestamptz := clock_timestamp();
  config_snapshot jsonb;
  configured_ids text[];
  effective_team_ids text[];
  left_team text;
  right_team text;
begin
  if p_applied_version < 0 or jsonb_typeof(p_capabilities) <> 'object'
    or octet_length(p_capabilities::text) > 8192 then return jsonb_build_object('status', 'invalid'); end if;
  select * into credential from public.screen_device_credentials
  where id = p_credential_id and revoked_at is null
    and (expires_at is null or expires_at > now_at) for update;
  if not found then return jsonb_build_object('status', 'revoked'); end if;
  select * into device from public.screen_devices
  where id = credential.device_id and protocol_version = 2 and paired_at is not null
    and revoked_at is null for update;
  if not found or p_applied_version > device.state_version then return jsonb_build_object('status', 'revoked'); end if;

  -- Authorization and configuration come from the live persisted DB snapshot,
  -- never from a warm application cache. A removed team takes effect here on
  -- the very next sync, before heartbeat/ACK or replacement side effects.
  select public.get_app_config_v2_snapshot() into config_snapshot;
  if config_snapshot is null
    or not public.ticket_team_config_valid(config_snapshot -> 'dashboard') then
    return jsonb_build_object('status', 'config_unavailable');
  end if;
  select coalesce(array_agg(team.value ->> 'id' order by team.value ->> 'id'), array[]::text[])
  into configured_ids
  from jsonb_array_elements(config_snapshot #> '{dashboard,teams}') team(value);
  select coalesce(array_agg(scope.team_id order by scope.team_id), array[]::text[])
  into effective_team_ids
  from unnest(device.allowed_team_ids) as scope(team_id)
  where scope.team_id = any(configured_ids);
  if cardinality(effective_team_ids) = 0 then
    return jsonb_build_object('status', 'scope_revoked');
  end if;
  left_team := device.desired_state #>> '{panes,left,teamId}';
  right_team := device.desired_state #>> '{panes,right,teamId}';
  if left_team is null or right_team is null
    or not (left_team = any(effective_team_ids))
    or not (right_team = any(effective_team_ids)) then
    return jsonb_build_object('status', 'scope_revoked');
  end if;

  if device.replacement_for_device_id is not null and device.migration_state = 'v2_pending' then
    update public.screen_devices
    set revoked_at = coalesce(revoked_at, now_at), superseded_by = device.id, updated_at = now_at
    where id = device.replacement_for_device_id and revoked_at is null;
    update public.screen_device_credentials set revoked_at = coalesce(revoked_at, now_at)
    where device_id = device.replacement_for_device_id and revoked_at is null;
  end if;
  update public.screen_device_credentials
  set last_used_at = case when last_used_at is null or last_used_at < now_at - interval '1 minute' then now_at else last_used_at end
  where id = credential.id
    and (last_used_at is null or last_used_at < now_at - interval '1 minute');
  if p_applied_version > device.last_applied_version
    or device.last_seen_at is null or device.last_seen_at < now_at - interval '1 minute'
    or device.capabilities is distinct from p_capabilities
    or device.migration_state <> 'v2_active' then
    update public.screen_devices
    set last_applied_version = greatest(last_applied_version, p_applied_version),
        last_seen_at = case when last_seen_at is null or last_seen_at < now_at - interval '1 minute' then now_at else last_seen_at end,
        capabilities = p_capabilities, migration_state = 'v2_active', updated_at = now_at
    where id = device.id returning * into device;
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'device', to_jsonb(device),
    'effective_team_ids', to_jsonb(effective_team_ids),
    'config_snapshot', config_snapshot
  );
end;
$$;

create or replace function public.read_screen_ticket_page_v2(
  p_credential_id uuid,
  p_expected_config_updated_at timestamptz,
  p_offset integer,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set statement_timeout = '5s'
as $$
declare
  credential public.screen_device_credentials%rowtype;
  device public.screen_devices%rowtype;
  config_dashboard jsonb;
  config_updated_at timestamptz;
  configured_ids text[];
  effective_team_ids text[];
  ticket_page jsonb;
begin
  if p_offset < 0 or p_offset > 10000 or p_limit < 1 or p_limit > 1000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into credential from public.screen_device_credentials
  where id = p_credential_id and revoked_at is null
    and (expires_at is null or expires_at > clock_timestamp());
  if not found then return jsonb_build_object('status', 'revoked'); end if;
  select * into device from public.screen_devices
  where id = credential.device_id and protocol_version = 2
    and paired_at is not null and revoked_at is null;
  if not found then return jsonb_build_object('status', 'revoked'); end if;

  select dashboard, updated_at into config_dashboard, config_updated_at
  from public.app_config where id = 1;
  if not found or not public.ticket_team_config_valid(config_dashboard) then
    return jsonb_build_object('status', 'config_unavailable');
  end if;
  if config_updated_at is distinct from p_expected_config_updated_at then
    return jsonb_build_object('status', 'config_changed');
  end if;
  select coalesce(array_agg(team.value ->> 'id' order by team.value ->> 'id'), array[]::text[])
  into configured_ids from jsonb_array_elements(config_dashboard -> 'teams') team(value);
  select coalesce(array_agg(scope.team_id order by scope.team_id), array[]::text[])
  into effective_team_ids from unnest(device.allowed_team_ids) as scope(team_id)
  where scope.team_id = any(configured_ids);
  if cardinality(effective_team_ids) = 0 then return jsonb_build_object('status', 'scope_revoked'); end if;

  select coalesce(jsonb_agg(to_jsonb(page) order by page.updated_at, page.id), '[]'::jsonb)
  into ticket_page
  from (
    select ticket.* from public.tickets ticket
    where ticket.team_id = any(effective_team_ids)
    order by ticket.updated_at, ticket.id
    offset p_offset limit p_limit
  ) page;
  return jsonb_build_object(
    'status', 'ok',
    'effective_team_ids', to_jsonb(effective_team_ids),
    'tickets', ticket_page
  );
end;
$$;

create or replace function public.revoke_screen_device_v2(p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare now_at timestamptz := clock_timestamp();
begin
  update public.screen_devices set revoked_at = now_at, updated_at = now_at
  where id = p_device_id and protocol_version = 2 and revoked_at is null;
  if not found then return false; end if;
  update public.screen_device_credentials set revoked_at = coalesce(revoked_at, now_at)
  where device_id = p_device_id and revoked_at is null;
  return true;
end;
$$;

create or replace function public.rotate_screen_device_credential_v2(
  p_device_id uuid,
  p_credential_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
set lock_timeout = '1s'
as $$
declare
  device public.screen_devices%rowtype;
  next_generation integer;
  now_at timestamptz := clock_timestamp();
begin
  if p_credential_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid credential hash'; end if;
  select * into device from public.screen_devices
  where id = p_device_id and protocol_version = 2 and revoked_at is null for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  select coalesce(max(generation), 0) + 1 into next_generation
  from public.screen_device_credentials where device_id = p_device_id;
  update public.screen_device_credentials set revoked_at = coalesce(revoked_at, now_at)
  where device_id = p_device_id and revoked_at is null;
  insert into public.screen_device_credentials(device_id, credential_hash, generation)
  values (p_device_id, p_credential_hash, next_generation);
  return jsonb_build_object('status', 'rotated', 'installation_id', device.installation_id, 'generation', next_generation);
end;
$$;

revoke all on function public.create_screen_pairing_v2(uuid, uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.claim_screen_pairing_v2(text, uuid, text, text[], jsonb, uuid) from public, anon, authenticated;
revoke all on function public.sync_screen_device_v2(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.read_screen_ticket_page_v2(uuid, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.revoke_screen_device_v2(uuid) from public, anon, authenticated;
revoke all on function public.rotate_screen_device_credential_v2(uuid, text) from public, anon, authenticated;
grant execute on function public.create_screen_pairing_v2(uuid, uuid, text, text, timestamptz, text, text) to service_role;
grant execute on function public.claim_screen_pairing_v2(text, uuid, text, text[], jsonb, uuid) to service_role;
grant execute on function public.sync_screen_device_v2(uuid, bigint, jsonb) to service_role;
grant execute on function public.read_screen_ticket_page_v2(uuid, timestamptz, integer, integer) to service_role;
grant execute on function public.revoke_screen_device_v2(uuid) to service_role;
grant execute on function public.rotate_screen_device_credential_v2(uuid, text) to service_role;
