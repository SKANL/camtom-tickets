-- Keep the realtime table useful for the public dashboard without retaining PII.
create or replace function public.redact_ticket_pii() returns trigger as $$
begin
  new.description := null;
  if new.assignee is not null then
    new.assignee := jsonb_build_object(
      'id', new.assignee -> 'id',
      'name', new.assignee -> 'name'
    );
  end if;
  return new;
end;
$$ language plpgsql
security invoker
set search_path = pg_catalog;

drop trigger if exists tickets_redact_pii on public.tickets;
create trigger tickets_redact_pii
  before insert or update on public.tickets
  for each row execute function public.redact_ticket_pii();

revoke all on function public.redact_ticket_pii() from public;

-- Redact rows written before this invariant existed. The trigger keeps this idempotent.
update public.tickets
set description = null,
    assignee = case
      when assignee is null then null
      else jsonb_build_object('id', assignee -> 'id', 'name', assignee -> 'name')
    end
where description is not null
   or (
     assignee is not null
     and assignee is distinct from jsonb_build_object(
       'id', assignee -> 'id',
       'name', assignee -> 'name'
     )
   );
