-- Supabase-hosted schedules. Secrets remain in Vault, never in migration text.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_reconcile_job(p_full boolean default false)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  reconcile_url text;
  reconcile_secret text;
  url_count integer;
  secret_count integer;
  request_id bigint;
begin
  select count(*), min(decrypted_secret)
  into url_count, reconcile_url
  from vault.decrypted_secrets
  where name = 'reconcile_url';

  select count(*), min(decrypted_secret)
  into secret_count, reconcile_secret
  from vault.decrypted_secrets
  where name = 'reconcile_cron_secret';

  if url_count <> 1 or nullif(btrim(reconcile_url), '') is null then
    raise exception 'Vault secret reconcile_url must exist exactly once and be non-empty';
  end if;
  if secret_count <> 1 or nullif(btrim(reconcile_secret), '') is null then
    raise exception 'Vault secret reconcile_cron_secret must exist exactly once and be non-empty';
  end if;

  if p_full then reconcile_url := rtrim(reconcile_url, '/') || '/full'; end if;
  select net.http_get(
    url := reconcile_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || reconcile_secret),
    timeout_milliseconds := 25000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.invoke_reconcile_job(boolean) from public;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname in ('camtom-reconcile-incremental', 'camtom-reconcile-full')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'camtom-reconcile-incremental',
    '*/5 * * * *',
    $job$select public.invoke_reconcile_job(false);$job$
  );

  perform cron.schedule(
    'camtom-reconcile-full',
    '17 3 * * *',
    $job$select public.invoke_reconcile_job(true);$job$
  );
end;
$$;

\n