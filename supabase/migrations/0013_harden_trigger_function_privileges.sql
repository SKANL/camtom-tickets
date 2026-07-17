-- Trigger functions run through their owning table triggers and do not need to
-- be directly callable through PostgREST by application roles.
alter function public.stamp_assigned_at()
  set search_path = pg_catalog;

revoke execute on function public.stamp_assigned_at()
  from public, anon, authenticated;

revoke execute on function public.sync_team_dashboard_config_from_app_config()
  from public, anon, authenticated;

-- Deliberately keep the configured-team predicate executable by anon and
-- authenticated because ticket RLS policies call it. Screen heartbeat and ACK
-- RPCs also intentionally remain executable by authenticated identities; their
-- implementations enforce auth.uid() ownership for the target device.
