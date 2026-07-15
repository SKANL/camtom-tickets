-- Dashboard + SLA config persisted server-side (replaces read-only-FS YAML writes).
-- Single row (id=1). Server writes via service_role; no anon policy (client reads via GET /api/config).
create table if not exists app_config (
  id int primary key default 1,
  dashboard jsonb not null,
  sla jsonb not null,
  updated_at timestamptz not null default now(),
  constraint app_config_singleton check (id = 1)
);
alter table app_config enable row level security;
