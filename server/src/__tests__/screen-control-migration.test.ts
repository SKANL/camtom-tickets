import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('screen control migration', () => {
  const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/0012_screen_remote_control.sql'), 'utf8');

  it('stores versioned device state and hashed, one-time expiring pairings', () => {
    for (const table of ['screen_devices', 'screen_pairings', 'screen_state_commands', 'screen_pairing_attempts']) {
      expect(sql).toContain(`create table if not exists public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain('code_hash text not null');
    expect(sql).not.toMatch(/code_plain|pairing_code text/i);
    expect(sql).toContain('unique (code_hash)');
    expect(sql).toContain('unique (claimed_request_id)');
    expect(sql).toContain('expires_at timestamptz not null');
    expect(sql).toContain("action in ('start', 'claim')");
    expect(sql).toContain("bucket_type in ('uid', 'ip', 'global')");
    expect(sql).toContain('create or replace function public.check_screen_pairing_limits');
    expect(sql).toContain('actor_hash, accepted, attempted_at desc');
    expect(sql).toMatch(/p_uid_hash[\s\S]*p_ip_hash[\s\S]*p_global_hash/);
    expect(sql).toMatch(/bucket_type = 'global'[\s\S]*bucket_type = 'uid'[\s\S]*bucket_type = 'ip'/);
    const limiter = sql.slice(
      sql.indexOf('create or replace function public.check_screen_pairing_limits'),
      sql.indexOf('create or replace function public.claim_screen_pairing'),
    );
    expect(limiter.match(/and accepted is true/g)).toHaveLength(3);
    expect(limiter).toContain("values (p_action, 'global', p_global_hash, accepted_attempt)");
  });

  it('keeps pending pairings bounded and allocates a device only on admin claim', () => {
    expect(sql).toContain('device_id uuid references public.screen_devices');
    const claimAt = sql.indexOf('create or replace function public.claim_screen_pairing');
    const deviceInsertAt = sql.indexOf('insert into public.screen_devices(', claimAt);
    expect(deviceInsertAt).toBeGreaterThan(claimAt);
    expect(sql.slice(0, claimAt)).not.toContain('insert into public.screen_devices(');
    expect(sql).toContain('claimed_at is null and expires_at < clock_timestamp()');
    expect(sql).toContain("claimed_at is not null and claimed_at < clock_timestamp() - interval '24 hours'");
  });

  it('allows TVs to select only their device and ACK through auth-uid RPCs', () => {
    expect(sql).toMatch(/create policy screen_devices_select_own_identity[\s\S]*auth\.uid\(\) = auth_user_id/);
    expect(sql).toContain('revoke all privileges on table public.screen_devices from public, anon, authenticated');
    expect(sql).toContain('grant select on table public.screen_devices to authenticated');
    expect(sql).toMatch(/screen_device_ack[\s\S]*auth_user_id = auth\.uid\(\)/);
    expect(sql).toMatch(/screen_device_heartbeat[\s\S]*auth_user_id = auth\.uid\(\)/);
    expect(sql).toContain('revoke all on function public.screen_device_ack(uuid, bigint, jsonb) from public, anon');
    expect(sql).toContain('grant execute on function public.screen_device_ack(uuid, bigint, jsonb) to authenticated');
    expect(sql).not.toContain('grant update on table public.screen_devices to authenticated');
  });

  it('narrows authenticated ticket reads to the paired device allowlist', () => {
    expect(sql).toContain('create policy tickets_read_legacy_anon');
    expect(sql).toContain('create policy tickets_read_screen_devices');
    expect(sql).toMatch(/tickets_read_screen_devices[\s\S]*device\.auth_user_id = auth\.uid\(\)[\s\S]*tickets\.team_id = any\(device\.allowed_team_ids\)/);
    expect(sql).toMatch(/device\.revoked_at is null[\s\S]*device\.paired_at is not null/);
  });

  it('implements CAS, idempotent request audit, realtime, and bounded retention', () => {
    expect(sql).toContain('unique (device_id, request_id)');
    expect(sql).toContain('device.state_version is distinct from p_expected_version');
    expect(sql).toContain("raise exception 'screen state version conflict'");
    expect(sql).toContain("raise exception 'request id payload conflict'");
    expect(sql).toContain('alter publication supabase_realtime add table public.screen_devices');
    expect(sql).toContain("created_at < clock_timestamp() - interval '30 days'");
    expect(sql).toContain("jobname = 'cleanup-screen-control-history'");
  });

  it('deletes only bounded, old orphaned anonymous Auth users and reports cleanup metrics', () => {
    const cleanupAt = sql.indexOf('create or replace function public.cleanup_screen_control_history()');
    const cleanup = sql.slice(cleanupAt, sql.indexOf('alter table public.screen_devices replica identity full', cleanupAt));
    expect(cleanup).toContain('returns jsonb');
    expect(cleanup).toContain("pg_try_advisory_xact_lock(hashtextextended('screen-control-history-cleanup', 0))");
    expect(cleanup).toContain('from auth.users as users');
    expect(cleanup).toContain('users.is_anonymous is true');
    expect(cleanup).toContain("users.created_at < clock_timestamp() - interval '30 days'");
    expect(cleanup).toMatch(/not exists \([\s\S]*screen_devices[\s\S]*auth_user_id = users\.id/);
    expect(cleanup).toMatch(/not exists \([\s\S]*screen_pairings[\s\S]*expires_at >= clock_timestamp\(\)/);
    expect(cleanup).toContain('limit 100');
    expect(cleanup).toContain('for update of users skip locked');
    expect(cleanup).toContain("'anonymous_users_deleted', anonymous_users_deleted");
    expect(cleanup).toContain("'status', 'skipped_locked'");
    expect(cleanup).toContain('revoke all on function public.cleanup_screen_control_history() from public, anon, authenticated');
    expect(cleanup).toContain('grant execute on function public.cleanup_screen_control_history() to service_role');
  });
});
