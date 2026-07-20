import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('display protocol v2 migration', () => {
  const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/0014_display_protocol_v2.sql'), 'utf8');
  const pairingFixSql = readFileSync(
    resolve(__dirname, '../../../supabase/migrations/0015_fix_create_screen_pairing_v2_accepted_ambiguity.sql'),
    'utf8',
  );

  it('keeps v1 while adding nullable Auth identity and hashed v2 credentials', () => {
    expect(sql).toContain('alter column auth_user_id drop not null');
    expect(sql).toContain('protocol_version smallint not null default 1');
    expect(sql).toContain('create table if not exists public.screen_device_credentials');
    expect(sql).toContain("credential_hash text not null check (credential_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain("poll_secret_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain('screen_pairings_v2_start_request_unique');
    expect(sql).not.toMatch(/installation_secret\s+text|credential_plain|poll_secret\s+text/i);
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('revoke all privileges on table public.screen_device_credentials from public, anon, authenticated');
  });

  it('enforces durable 5-per-IP rate limiting and bounded pending cleanup', () => {
    const create = sql.slice(sql.indexOf('create or replace function public.create_screen_pairing_v2'), sql.indexOf('create or replace function public.claim_screen_pairing_v2'));
    expect(create).toContain("interval '15 minutes'");
    expect(create).toContain('ip_count < 5');
    expect(create).toContain('pending_count < 100');
    expect(create).toContain("claimed_at is null and expires_at < clock_timestamp()");
    expect(create).toContain("values ('start', 'ip', p_ip_hash, true)");
    expect(create).toContain('pg_advisory_xact_lock');
    expect(create).toMatch(/protocol_version = 2 and start_request_id = p_request_id[\s\S]*?'status', 'replay'/);
    const rejectionAt = create.indexOf('if not accepted then');
    const acceptedInsertAt = create.indexOf('insert into public.screen_pairing_attempts', rejectionAt);
    expect(create.slice(0, rejectionAt)).not.toContain('insert into public.screen_pairing_attempts');
    expect(acceptedInsertAt).toBeGreaterThan(rejectionAt);
    expect(create.slice(acceptedInsertAt)).toContain("values ('start', 'global', p_global_hash, true)");
  });

  it('claims devices atomically and revokes replacements only on first successful sync', () => {
    const claimAt = sql.indexOf('create or replace function public.claim_screen_pairing_v2');
    const syncAt = sql.indexOf('create or replace function public.sync_screen_device_v2');
    const claim = sql.slice(claimAt, syncAt);
    const sync = sql.slice(syncAt, sql.indexOf('create or replace function public.revoke_screen_device_v2'));
    expect(claim).toContain('insert into public.screen_devices(');
    expect(claim).toContain('insert into public.screen_device_credentials');
    expect(claim).not.toContain('superseded_by = device.id');
    expect(sync).toContain("device.migration_state = 'v2_pending'");
    expect(sync).toContain('superseded_by = device.id');
    expect(sync).toContain('device_id = device.replacement_for_device_id');
  });

  it('derives display authorization from live DB config and pins every ticket page to it', () => {
    const syncAt = sql.indexOf('create or replace function public.sync_screen_device_v2');
    const pageAt = sql.indexOf('create or replace function public.read_screen_ticket_page_v2');
    const revokeAt = sql.indexOf('create or replace function public.revoke_screen_device_v2');
    const sync = sql.slice(syncAt, pageAt);
    const page = sql.slice(pageAt, revokeAt);
    expect(sync).toContain('select public.get_app_config_v2_snapshot() into config_snapshot');
    expect(sync).toMatch(/unnest\(device\.allowed_team_ids\)[\s\S]*scope\.team_id = any\(configured_ids\)/);
    expect(sync).toMatch(/cardinality\(effective_team_ids\) = 0[\s\S]*'scope_revoked'/);
    expect(sync).toMatch(/left_team[\s\S]*right_team[\s\S]*any\(effective_team_ids\)/);
    expect(sync.indexOf('config_snapshot')).toBeLessThan(sync.indexOf('replacement_for_device_id is not null'));
    expect(page).toContain('p_expected_config_updated_at timestamptz');
    expect(page).toContain('config_updated_at is distinct from p_expected_config_updated_at');
    expect(page).toContain('ticket.team_id = any(effective_team_ids)');
    expect(page).toContain("return jsonb_build_object('status', 'scope_revoked')");
  });

  it('uses a ticket revision so deletions trigger a new full snapshot', () => {
    expect(sql).toContain('create table if not exists public.screen_ticket_revision');
    expect(sql).toContain('after insert or update or delete or truncate on public.tickets');
    expect(sql).toContain('set revision = revision + 1');
  });

  it('keeps every protocol RPC service-role-only', () => {
    for (const name of [
      'create_screen_pairing_v2', 'claim_screen_pairing_v2', 'sync_screen_device_v2',
      'read_screen_ticket_page_v2', 'revoke_screen_device_v2', 'rotate_screen_device_credential_v2',
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`));
    }
  });

  it('revokes a v2 device and every active credential in one database transaction', () => {
    const revokeAt = sql.indexOf('create or replace function public.revoke_screen_device_v2');
    const revoke = sql.slice(revokeAt, sql.indexOf('create or replace function public.rotate_screen_device_credential_v2'));
    expect(revoke).toMatch(/update public\.screen_devices[\s\S]*revoked_at = now_at/);
    expect(revoke).toMatch(/update public\.screen_device_credentials[\s\S]*device_id = p_device_id[\s\S]*revoked_at is null/);
  });

  it('replaces the pairing RPC without ambiguous accepted references', () => {
    expect(pairingFixSql).toMatch(/create or replace function public\.create_screen_pairing_v2\(\s*p_request_id uuid,\s*p_installation_id uuid,\s*p_poll_secret_hash text,\s*p_code_hash text,\s*p_expires_at timestamptz,\s*p_ip_hash text,\s*p_global_hash text\s*\)/);
    expect(pairingFixSql).toContain('security definer');
    expect(pairingFixSql).toContain('set search_path = pg_catalog');
    expect(pairingFixSql).toContain("set statement_timeout = '3s'");
    expect(pairingFixSql).toContain("set lock_timeout = '1s'");
    expect(pairingFixSql).toContain('is_accepted boolean := false');
    expect(pairingFixSql).toContain('is_accepted := global_count < 100');
    expect(pairingFixSql).toContain('if not is_accepted then');
    expect(pairingFixSql).not.toMatch(/\baccepted boolean\b|\bif not accepted\b/);
    expect(pairingFixSql).toContain("attempt.attempted_at < clock_timestamp() - interval '24 hours'");
    expect(pairingFixSql).toContain("attempt.attempted_at >= clock_timestamp() - interval '15 minutes'");
    expect(pairingFixSql).toContain('pending_count < 100');
    expect(pairingFixSql).toContain('ip_count < 5');
    expect(pairingFixSql).toContain("values ('start', 'global', p_global_hash, true)");
    expect(pairingFixSql).toContain("values ('start', 'ip', p_ip_hash, true)");
    expect(pairingFixSql).toMatch(/pairing\.start_request_id = p_request_id[\s\S]*?'status', 'replay'/);

    const predicateLines = pairingFixSql
      .split('\n')
      .filter((line) => /^\s*(where|and)\b/i.test(line))
      .join('\n');
    for (const column of [
      'protocol_version', 'start_request_id', 'claimed_at', 'expires_at',
      'attempted_at', 'action', 'bucket_type', 'actor_hash', 'accepted',
    ]) {
      expect(predicateLines, `${column} must be qualified in every predicate`)
        .not.toMatch(new RegExp(`(?<!\\.)\\b${column}\\b`, 'i'));
    }

    expect(pairingFixSql).toContain('attempt.accepted is true');
    expect(pairingFixSql).toContain('pairing.protocol_version = 2');
    expect(pairingFixSql).toMatch(/revoke all on function public\.create_screen_pairing_v2\([\s\S]*?from public, anon, authenticated/);
    expect(pairingFixSql).toMatch(/grant execute on function public\.create_screen_pairing_v2\([\s\S]*?to service_role/);
  });
});
