import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { validateConfigUpdate } from '../routes/config';

describe('config v2 migration', () => {
  const migration = readFileSync(resolve(__dirname, '../../../supabase/migrations/0011_config_v2_team_settings.sql'), 'utf8');

  it('adds private normalized team settings and backfills legacy behavior', () => {
    expect(migration).toContain('create table if not exists public.team_dashboard_config');
    expect(migration).toContain('alter table public.team_dashboard_config enable row level security');
    expect(migration).toContain('revoke all privileges on table public.team_dashboard_config from public, anon, authenticated');
    for (const field of ['slas', 'teamMembers', 'displayOrder', 'priorityLabels', 'stateLabels', 'report', 'kitchenPhrases', 'zoneLabels', 'displayOptions']) {
      expect(migration).toContain(`'${field}'`);
    }
    expect(migration).toContain('on conflict (team_id) do nothing');
    expect(migration.match(/'zoneLabels', coalesce\(/g)).toHaveLength(2);
    expect(migration.match(/'displayOptions', coalesce\(/g)).toHaveLength(2);
    expect(migration).toContain('{"new":"Sin tomar","active":"En progreso","done":"Servidos hoy"}');
  });

  it('keeps optimistic concurrency and the v1 app_config contract in one transaction', () => {
    expect(migration).toContain('create or replace function public.set_app_config_v2_if_version');
    expect(migration).toMatch(/from public\.app_config where id = 1 for update;/);
    expect(migration).toContain("raise exception 'app config version conflict'");
    expect(migration).toContain('team configs must match configured dashboard teams');
    expect(migration).toMatch(/update public\.app_config[\s\S]*dashboard = p_dashboard[\s\S]*sla = p_sla/);
    expect(migration).toContain('grant execute on function public.set_app_config_v2_if_version');
  });

  it('reads an atomic snapshot and synchronizes legacy writes during rollout', () => {
    expect(migration).toContain('create or replace function public.get_app_config_v2_snapshot()');
    expect(migration).toMatch(/jsonb_build_object\([\s\S]*'dashboard'[\s\S]*'teamConfigs'/);
    expect(migration).toContain('create trigger sync_team_dashboard_config_from_app_config');
    expect(migration).toContain('after insert or update of dashboard, sla on public.app_config');
    expect(migration).toContain("raise exception 'config v2 is active; legacy config writes are disabled'");
    expect(migration).toContain("set_config('camtom.config_v2_write', 'on', true)");
    expect(migration).toContain('update public.app_config_v2_state set active = true');
    const triggerDropAt = migration.indexOf('drop trigger if exists sync_team_dashboard_config_from_app_config on public.app_config');
    const backfillCommentAt = migration.indexOf('-- Preserve the exact v1 behavior');
    const backfillAt = migration.indexOf('insert into public.team_dashboard_config(team_id, settings, updated_at)', backfillCommentAt);
    const triggerFunctionAt = migration.indexOf('create or replace function public.sync_team_dashboard_config_from_app_config()');
    const triggerAt = migration.indexOf('create trigger sync_team_dashboard_config_from_app_config');
    expect(triggerFunctionAt).toBeGreaterThan(-1);
    expect(triggerDropAt).toBeGreaterThan(-1);
    expect(triggerDropAt).toBeGreaterThan(triggerFunctionAt);
    expect(triggerAt).toBeGreaterThan(triggerDropAt);
    expect(triggerAt).toBeGreaterThan(triggerFunctionAt);
    expect(backfillAt).toBeGreaterThan(-1);
    expect(triggerAt).toBeLessThan(backfillAt);
    expect(migration).not.toMatch(/lock\s+table\s+public\.app_config/i);
    expect(migration).toMatch(/update public\.app_config[\s\S]*for team_config in select key, value from jsonb_each\(p_team_configs\)/);
  });

  it('returns useful shared-validator paths for invalid v2 writes', () => {
    expect(validateConfigUpdate({ expectedVersion: 'v1', configV2: { schemaVersion: 2 } })).toContain('configV2.global');
  });
});
