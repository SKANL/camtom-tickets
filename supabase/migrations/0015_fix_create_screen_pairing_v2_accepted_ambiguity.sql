-- Fix SQLSTATE 42702 in the deployed v2 pairing function without rewriting migration 0014.
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
  is_accepted boolean := false;
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
    select 1
    from public.screen_pairings as pairing
    where pairing.protocol_version = 2
      and pairing.start_request_id = p_request_id
  ) then
    return jsonb_build_object('status', 'replay');
  end if;

  delete from public.screen_pairings as pairing
  where pairing.protocol_version = 2
    and pairing.claimed_at is null
    and pairing.expires_at < clock_timestamp();

  delete from public.screen_pairing_attempts as attempt
  where attempt.attempted_at < clock_timestamp() - interval '24 hours';

  select count(*) into global_count
  from public.screen_pairing_attempts as attempt
  where attempt.action = 'start'
    and attempt.bucket_type = 'global'
    and attempt.actor_hash = p_global_hash
    and attempt.accepted is true
    and attempt.attempted_at >= clock_timestamp() - interval '15 minutes';

  if p_ip_hash is not null then
    select count(*) into ip_count
    from public.screen_pairing_attempts as attempt
    where attempt.action = 'start'
      and attempt.bucket_type = 'ip'
      and attempt.actor_hash = p_ip_hash
      and attempt.accepted is true
      and attempt.attempted_at >= clock_timestamp() - interval '15 minutes';
  end if;

  select count(*) into pending_count
  from public.screen_pairings as pairing
  where pairing.protocol_version = 2
    and pairing.claimed_at is null
    and pairing.expires_at >= clock_timestamp();

  is_accepted := global_count < 100
    and pending_count < 100
    and (p_ip_hash is null or ip_count < 5);

  if not is_accepted then
    return jsonb_build_object(
      'status',
      case when pending_count >= 100 then 'capacity' else 'rate_limited' end
    );
  end if;

  -- Rejected traffic must not create unbounded audit rows. Accepted rows alone
  -- consume and document the fixed rolling IP/global quotas.
  insert into public.screen_pairing_attempts(action, bucket_type, actor_hash, accepted)
  values ('start', 'global', p_global_hash, true);

  if p_ip_hash is not null then
    insert into public.screen_pairing_attempts(action, bucket_type, actor_hash, accepted)
    values ('start', 'ip', p_ip_hash, true);
  end if;

  insert into public.screen_pairings as pairing(
    auth_user_id, start_request_id, code_hash, code_nonce, expires_at,
    protocol_version, installation_id, poll_secret_hash
  ) values (
    null, p_request_id, p_code_hash, 0, p_expires_at,
    2, p_installation_id, p_poll_secret_hash
  ) returning pairing.id into pairing_id;

  return jsonb_build_object('status', 'created', 'pairing_id', pairing_id);
end;
$$;

revoke all on function public.create_screen_pairing_v2(uuid, uuid, text, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.create_screen_pairing_v2(uuid, uuid, text, text, timestamptz, text, text)
  to service_role;
