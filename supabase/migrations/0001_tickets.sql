-- Tickets: the dashboard's single source of truth, fed by the Linear webhook and
-- the reconcile job, read by the browser over Realtime.

create table if not exists public.tickets (
  id             text primary key,          -- Linear issue id
  identifier     text not null,
  title          text not null default '',
  description    text,
  priority       smallint not null default 0,
  priority_label text not null default '',
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  assigned_at    timestamptz,               -- timer anchor: when the 'ticket' label was applied
  due_date       timestamptz,
  assignee       jsonb,
  state          jsonb not null default '{}'::jsonb,
  labels         jsonb,
  project        jsonb,
  team           jsonb,
  cycle          jsonb,
  estimate       real,
  synced_at      timestamptz not null default now()
);

create index if not exists tickets_priority_idx on public.tickets (priority);

-- Single-row bookkeeping for the reconcile job's incremental cursor.
create table if not exists public.sync_state (
  id             int primary key default 1,
  last_synced_at timestamptz,
  constraint sync_state_singleton check (id = 1)
);
insert into public.sync_state (id, last_synced_at)
  values (1, null) on conflict (id) do nothing;

-- Timer anchor lives in ONE place: this trigger. Writers (webhook, reconcile) just
-- write raw Linear fields; the DB decides assigned_at so the anchor never drifts.
--   * has 'ticket' label + already anchored (update) -> keep the existing anchor
--   * has 'ticket' label + not yet anchored          -> use the value the writer passed
--                                                        (updated_at ≈ label-apply time),
--                                                        falling back to now()
--   * no 'ticket' label                              -> clear the anchor
create or replace function public.stamp_assigned_at() returns trigger as $$
declare
  has_label boolean;
begin
  has_label := exists (
    select 1
    from jsonb_array_elements(coalesce(new.labels -> 'nodes', '[]'::jsonb)) e
    where e ->> 'name' = 'ticket'
  );

  if has_label then
    if tg_op = 'UPDATE' and old.assigned_at is not null then
      new.assigned_at := old.assigned_at;
    else
      new.assigned_at := coalesce(new.assigned_at, now());
    end if;
  else
    new.assigned_at := null;
  end if;

  new.synced_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tickets_stamp_assigned_at on public.tickets;
create trigger tickets_stamp_assigned_at
  before insert or update on public.tickets
  for each row execute function public.stamp_assigned_at();

-- RLS: the browser (anon) can read; it can never write. All writes go through the
-- service_role key (webhook / reconcile), which bypasses RLS entirely.
alter table public.tickets enable row level security;
drop policy if exists tickets_read_anon on public.tickets;
create policy tickets_read_anon on public.tickets
  for select using (true);

alter table public.sync_state enable row level security;  -- no anon policy => anon cannot touch it

-- Push row changes to subscribed browsers.
alter publication supabase_realtime add table public.tickets;
