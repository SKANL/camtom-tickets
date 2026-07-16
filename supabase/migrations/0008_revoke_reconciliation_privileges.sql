-- Forward-only privilege hardening for reconciliation objects created by 0006/0007.
-- This migration changes grants only; it does not modify data or scheduled jobs.

revoke all privileges on table public.webhook_deliveries from anon, authenticated, public;
revoke all privileges on table public.ticket_tombstones from anon, authenticated, public;
revoke all privileges on table public.reconcile_runs from anon, authenticated, public;
revoke all privileges on table public.reconcile_scope_state from anon, authenticated, public;
revoke all privileges on table public.reconcile_missing from anon, authenticated, public;

grant select, insert, update, delete on table public.webhook_deliveries to service_role;
grant select, insert, update, delete on table public.ticket_tombstones to service_role;
grant select, insert, update, delete on table public.reconcile_runs to service_role;
grant select, insert, update, delete on table public.reconcile_scope_state to service_role;
grant select, insert, update, delete on table public.reconcile_missing to service_role;

-- 0006 uses UUID keys today, but cover any owned identity/serial sequences so a
-- future forward migration cannot inherit API-role privileges accidentally.
do $$
declare
  owned_sequence record;
begin
  for owned_sequence in
    select format('%I.%I', sequence_namespace.nspname, sequence_relation.relname) as qualified_name
    from pg_catalog.pg_class as sequence_relation
    join pg_catalog.pg_namespace as sequence_namespace
      on sequence_namespace.oid = sequence_relation.relnamespace
    join pg_catalog.pg_depend as dependency
      on dependency.objid = sequence_relation.oid
      and dependency.classid = 'pg_catalog.pg_class'::regclass
      and dependency.deptype in ('a', 'i')
    join pg_catalog.pg_class as table_relation
      on table_relation.oid = dependency.refobjid
    join pg_catalog.pg_namespace as table_namespace
      on table_namespace.oid = table_relation.relnamespace
    where sequence_relation.relkind = 'S'
      and table_namespace.nspname = 'public'
      and table_relation.relname = any(array[
        'webhook_deliveries',
        'ticket_tombstones',
        'reconcile_runs',
        'reconcile_scope_state',
        'reconcile_missing'
      ])
  loop
    execute format(
      'revoke all privileges on sequence %s from anon, authenticated, public',
      owned_sequence.qualified_name
    );
    execute format(
      'grant usage, select on sequence %s to service_role',
      owned_sequence.qualified_name
    );
  end loop;
end;
$$;

revoke execute on function public.upsert_tickets_if_newer(jsonb) from anon, authenticated, public;
revoke execute on function public.delete_ticket_if_not_newer(text, timestamptz) from anon, authenticated, public;
revoke execute on function public.claim_webhook_delivery(text, text) from anon, authenticated, public;
revoke execute on function public.complete_webhook_delivery(text, text, uuid) from anon, authenticated, public;
revoke execute on function public.release_webhook_delivery(text, text, uuid) from anon, authenticated, public;
revoke execute on function public.acquire_reconcile_lease(text, uuid, integer) from anon, authenticated, public;
revoke execute on function public.release_reconcile_lease(text, uuid) from anon, authenticated, public;
revoke execute on function public.finalize_full_reconcile(uuid, uuid, text, text[], timestamptz, timestamptz, timestamptz, text[], jsonb, text[]) from anon, authenticated, public;
revoke execute on function public.invoke_reconcile_job(boolean) from anon, authenticated, public;

grant execute on function public.upsert_tickets_if_newer(jsonb) to service_role;
grant execute on function public.delete_ticket_if_not_newer(text, timestamptz) to service_role;
grant execute on function public.claim_webhook_delivery(text, text) to service_role;
grant execute on function public.complete_webhook_delivery(text, text, uuid) to service_role;
grant execute on function public.release_webhook_delivery(text, text, uuid) to service_role;
grant execute on function public.acquire_reconcile_lease(text, uuid, integer) to service_role;
grant execute on function public.release_reconcile_lease(text, uuid) to service_role;
grant execute on function public.finalize_full_reconcile(uuid, uuid, text, text[], timestamptz, timestamptz, timestamptz, text[], jsonb, text[]) to service_role;
grant execute on function public.invoke_reconcile_job(boolean) to service_role;

-- Some deployed environments may retain an older text overload. Harden it
-- when present without making this forward migration fail where it never existed.
do $$
begin
  if pg_catalog.to_regprocedure('public.invoke_reconcile_job(text)') is not null then
    execute 'revoke execute on function public.invoke_reconcile_job(text) from anon, authenticated, public';
    execute 'grant execute on function public.invoke_reconcile_job(text) to service_role';
  end if;
end;
$$;
