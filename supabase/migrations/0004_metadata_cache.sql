-- L2 cache of the Linear metadata catalog (teams/projects/users/states/labels/cycles).
-- Single row (id=1). Server-only via service_role; no anon policy.
create table if not exists metadata_cache (
  id int primary key default 1,
  catalog jsonb not null,
  updated_at timestamptz not null default now(),
  constraint metadata_cache_singleton check (id = 1)
);
alter table metadata_cache enable row level security;
