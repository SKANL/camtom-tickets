import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('reconciliation reliability migrations', () => {
  const reliability = readFileSync(resolve(__dirname, '../../../supabase/migrations/0006_reconciliation_reliability.sql'), 'utf8');
  const scheduler = readFileSync(resolve(__dirname, '../../../supabase/migrations/0007_reconcile_scheduler.sql'), 'utf8');
  const privileges = readFileSync(resolve(__dirname, '../../../supabase/migrations/0008_revoke_reconciliation_privileges.sql'), 'utf8');
  const finalizeRepair = readFileSync(resolve(__dirname, '../../../supabase/migrations/0009_fix_finalize_archived_ids.sql'), 'utf8');
  const teamScope = readFileSync(resolve(__dirname, '../../../supabase/migrations/0010_team_scope_and_retention.sql'), 'utf8');

  it('keeps newer ticket rows and finalizes missing deletion with grace in one RPC', () => {
    expect(reliability).toContain('where excluded.updated_at > public.tickets.updated_at');
    expect(reliability).toContain('create table if not exists public.ticket_tombstones');
    expect(reliability).toContain('incoming.updated_at > tombstone_at');
    expect(reliability).toContain('incoming.updated_at > deleted_updated_at');
    expect(reliability).toContain('create or replace function public.finalize_full_reconcile');
    expect(reliability).toContain('m.missing_count >= 2');
    expect(reliability).toContain("m.first_missing_at <= p_started_at - interval '24 hours'");
    expect(reliability).toContain('t.synced_at < p_started_at');
    expect(reliability).toContain("t.team ->> 'id' = any(p_team_ids)");
  });

  it('persists webhook claims and reconcile leases only in private server tables', () => {
    expect(reliability).toContain('create table if not exists public.webhook_deliveries');
    expect(reliability).toContain('processed_at timestamptz');
    expect(reliability).toContain('create or replace function public.claim_webhook_delivery');
    expect(reliability).toContain("jsonb_build_object('status', 'claimed', 'claimToken', new_token)");
    expect(reliability).toMatch(/complete_webhook_delivery[\s\S]*claim_token = p_claim_token/);
    expect(reliability).toMatch(/release_webhook_delivery[\s\S]*claim_token = p_claim_token/);
    expect(reliability).toContain('create or replace function public.acquire_reconcile_lease');
    expect(reliability).toContain("scope_key = 'lease:full'");
    expect(reliability).toContain('lease_owner = p_lease_token');
    expect(reliability).toContain('p_upper_bound <= state_row.last_upper_bound');
    expect(reliability).toContain('reconciliation run metadata mismatch');
    expect(reliability).toContain('alter table public.webhook_deliveries enable row level security');
  });

  it('bounds database work and lease recovery below the serverless deadline', () => {
    expect(reliability).toMatch(/upsert_tickets_if_newer[\s\S]*set statement_timeout = '3500ms'[\s\S]*set lock_timeout = '1s'/);
    expect(reliability).toMatch(/finalize_full_reconcile[\s\S]*set statement_timeout = '12s'[\s\S]*set lock_timeout = '2s'/);
    expect(reliability).toContain('p_lease_seconds integer default 120');
    expect(reliability).toContain("when p_name = 'full' then least(greatest(30, p_lease_seconds), 120)");
    expect(reliability).toContain("when p_name = 'incremental' then least(greatest(30, p_lease_seconds), 240)");
    expect(reliability).toContain('make_interval(secs => effective_lease_seconds)');
  });

  it('schedules idempotent Vault-backed jobs without embedding secrets', () => {
    expect(scheduler).toContain("jobname in ('camtom-reconcile-incremental', 'camtom-reconcile-full')");
    expect(scheduler).toContain("name = 'reconcile_url'");
    expect(scheduler).toContain("name = 'reconcile_cron_secret'");
    expect(scheduler).toContain("'*/5 * * * *'");
    expect(scheduler).toContain("'17 3 * * *'");
    expect(scheduler).toContain('create extension if not exists pg_cron;');
    expect(scheduler).toContain('create extension if not exists pg_net;');
    expect(scheduler).toContain('security definer');
    expect(scheduler).toContain("url_count <> 1 or nullif(btrim(reconcile_url), '') is null");
    expect(scheduler).toContain("secret_count <> 1 or nullif(btrim(reconcile_secret), '') is null");
    expect(scheduler).toContain('select public.invoke_reconcile_job(false)');
    expect(scheduler).toContain('select public.invoke_reconcile_job(true)');
    expect(scheduler).not.toMatch(/Bearer [A-Za-z0-9_-]{8,}/);
  });

  it('revokes every reconciliation table and function from API roles', () => {
    const tables = [
      'webhook_deliveries',
      'ticket_tombstones',
      'reconcile_runs',
      'reconcile_scope_state',
      'reconcile_missing',
    ];
    const functions = [
      'upsert_tickets_if_newer(jsonb)',
      'delete_ticket_if_not_newer(text, timestamptz)',
      'claim_webhook_delivery(text, text)',
      'complete_webhook_delivery(text, text, uuid)',
      'release_webhook_delivery(text, text, uuid)',
      'acquire_reconcile_lease(text, uuid, integer)',
      'release_reconcile_lease(text, uuid)',
      'finalize_full_reconcile(uuid, uuid, text, text[], timestamptz, timestamptz, timestamptz, text[], jsonb, text[])',
      'invoke_reconcile_job(boolean)',
    ];

    for (const table of tables) {
      expect(privileges).toContain(
        `revoke all privileges on table public.${table} from anon, authenticated, public;`,
      );
      expect(privileges).toContain(
        `grant select, insert, update, delete on table public.${table} to service_role;`,
      );
    }
    for (const signature of functions) {
      expect(privileges).toContain(
        `revoke execute on function public.${signature} from anon, authenticated, public;`,
      );
      expect(privileges).toContain(
        `grant execute on function public.${signature} to service_role;`,
      );
    }

    expect(privileges).toContain("dependency.deptype in ('a', 'i')");
    expect(privileges).toContain(
      "'revoke all privileges on sequence %s from anon, authenticated, public'",
    );
    expect(privileges).toContain("'grant usage, select on sequence %s to service_role'");
    expect(privileges).toContain("to_regprocedure('public.invoke_reconcile_job(text)')");
    expect(privileges).toContain(
      "'revoke execute on function public.invoke_reconcile_job(text) from anon, authenticated, public'",
    );
    expect(privileges).not.toContain('cron.schedule');
  });

  it('repairs archived ID array typing without weakening finalize guards', () => {
    const signature = 'public.finalize_full_reconcile(uuid, uuid, text, text[], timestamptz, timestamptz, timestamptz, text[], jsonb, text[])';
    const functionMarker = 'create or replace function public.finalize_full_reconcile(';
    const originalStart = reliability.indexOf(functionMarker);
    const originalEnd = reliability.indexOf('\n\nrevoke all on function public.upsert_tickets_if_newer', originalStart);
    const repairStart = finalizeRepair.indexOf(functionMarker);
    const repairEnd = finalizeRepair.indexOf('\n\nrevoke execute on function public.finalize_full_reconcile', repairStart);
    const normalize = (sql: string) => sql.replace(/\r\n/g, '\n').trim();
    const expectedFunction = reliability
      .slice(originalStart, originalEnd)
      .replace("archived_ids text[] := '{}';", 'archived_ids text[] := array[]::text[];');

    expect(normalize(finalizeRepair.slice(repairStart, repairEnd))).toBe(normalize(expectedFunction));
    expect(finalizeRepair).toContain('archived_ids text[] := array[]::text[];');
    expect(finalizeRepair).toContain('archived_ids := array_append(archived_ids, archived_id);');
    expect(finalizeRepair).toContain("jsonb_array_elements(coalesce(p_archived, '[]'::jsonb))");
    expect(finalizeRepair).toContain("ticket_id = any(coalesce(p_active_ids, '{}'::text[]) || archived_ids)");
    expect(finalizeRepair).toContain("scope_key = 'lease:full'");
    expect(finalizeRepair).toContain('lease_owner = p_lease_token');
    expect(finalizeRepair).toContain('lease_expires_at > clock_timestamp()');
    expect(finalizeRepair).toContain('p_upper_bound <= state_row.last_upper_bound');
    expect(finalizeRepair).toContain('perform pg_advisory_xact_lock');
    expect(finalizeRepair).toContain("set statement_timeout = '12s'");
    expect(finalizeRepair).toContain("set lock_timeout = '2s'");
    expect(finalizeRepair).toContain('set search_path = pg_catalog');
    expect(finalizeRepair).toContain('security definer');
    expect(finalizeRepair).toContain(
      `revoke execute on function ${signature} from anon, authenticated, public;`,
    );
    expect(finalizeRepair).toContain(`grant execute on function ${signature} to service_role;`);
    expect(finalizeRepair).not.toContain("archived_ids text[] := '{}';");
  });

  it('fails closed to configured teams and bounds operational retention', () => {
    const purgeScope = teamScope.slice(
      teamScope.indexOf('create or replace function public.purge_tickets_outside_configured_scope'),
      teamScope.indexOf('create or replace function public.purge_tickets_on_config_scope_change'),
    );
    expect(teamScope).toContain("add column if not exists team_id text generated always as (team ->> 'id') stored");
    expect(teamScope).toContain('using (public.is_ticket_team_configured(team_id))');
    expect(teamScope).toContain("raise exception 'configured team scope is missing or malformed'");
    expect(teamScope).toMatch(/delete from public\.tickets\s+where id = incoming\.id and updated_at < incoming\.updated_at/);
    expect(teamScope).toContain('Scope eviction is deliberately not a deletion tombstone');
    expect(purgeScope).not.toContain('ticket_tombstones');
    expect(teamScope).toContain('create trigger app_config_purge_ticket_scope');
    expect(teamScope).toContain('create or replace function public.set_app_config_if_version');
    expect(teamScope).toContain("raise exception 'app config version conflict'");
    expect(teamScope).toContain('add column if not exists config_updated_at timestamptz');
    expect(teamScope).toContain('current_config_updated_at is distinct from run_row.config_updated_at');
    expect(teamScope).toContain("raise exception 'configured team scope version changed during reconciliation'");
    expect(teamScope).toMatch(/select updated_at into current_config_updated_at[\s\S]*for share;/);
    expect(teamScope).toMatch(/perform 1 from public\.app_config[\s\S]*for share;[\s\S]*for incoming in/);
    expect(teamScope).toContain("processed_at < now() - interval '30 days'");
    expect(teamScope).toContain("finished_at < now() - interval '90 days'");
    expect(teamScope).toContain("deleted_at < now() - interval '730 days'");
    expect(teamScope).toContain("'camtom-operational-retention'");
    expect(teamScope).toContain('revoke all on function public.cleanup_operational_history() from public, anon, authenticated');
  });

  it('uses a durable event watermark to reject a late T1 snapshot after a T2 move-out', () => {
    const upsert = teamScope.slice(
      teamScope.indexOf('create or replace function public.upsert_tickets_if_newer'),
      teamScope.indexOf('create or replace function public.set_app_config_if_version'),
    );

    expect(teamScope).toContain('create table if not exists public.ticket_scope_evictions');
    expect(teamScope).toContain("cause in ('event-move-out', 'config-scope-purge')");
    expect(teamScope).toContain('alter table public.ticket_scope_evictions enable row level security');
    expect(teamScope).toContain(
      'revoke all privileges on table public.ticket_scope_evictions from public, anon, authenticated',
    );
    expect(upsert).toMatch(/'event-move-out', null, clock_timestamp\(\)/);
    expect(upsert).toContain(
      'where excluded.watermark_updated_at > public.ticket_scope_evictions.watermark_updated_at',
    );
    expect(upsert).toMatch(
      /scope_eviction\.cause = 'config-scope-purge'[\s\S]*incoming\.updated_at = scope_eviction\.watermark_updated_at/,
    );
    expect(upsert).toContain('incoming.updated_at > scope_eviction.watermark_updated_at');
  });

  it('allows a newer move-back and rejects delayed move-out events after restoration', () => {
    const upsert = teamScope.slice(
      teamScope.indexOf('create or replace function public.upsert_tickets_if_newer'),
      teamScope.indexOf('create or replace function public.set_app_config_if_version'),
    );

    expect(upsert).toMatch(
      /current_ticket_updated_at is not null\s+and incoming\.updated_at <= current_ticket_updated_at then\s+continue;/,
    );
    expect(upsert).toContain('where excluded.updated_at > public.tickets.updated_at');
    expect(upsert).toMatch(
      /if tombstone_at is null or incoming\.updated_at > tombstone_at then[\s\S]*delete from public\.ticket_scope_evictions\s+where ticket_id = incoming\.id;/,
    );
  });

  it('restores an unchanged ticket after config re-add without weakening event move-out ordering', () => {
    const purgeScope = teamScope.slice(
      teamScope.indexOf('create or replace function public.purge_tickets_outside_configured_scope'),
      teamScope.indexOf('create or replace function public.purge_tickets_on_config_scope_change'),
    );
    const upsert = teamScope.slice(
      teamScope.indexOf('create or replace function public.upsert_tickets_if_newer'),
      teamScope.indexOf('create or replace function public.set_app_config_if_version'),
    );

    expect(purgeScope).toContain("'config-scope-purge', config_version, clock_timestamp()");
    expect(purgeScope).toMatch(/select updated_at into config_version[\s\S]*for share;/);
    expect(purgeScope).toContain('perform pg_advisory_xact_lock(hashtextextended(ticket_row.id, 0))');
    expect(purgeScope).toContain(
      "where public.ticket_scope_evictions.cause = 'config-scope-purge'",
    );
    expect(purgeScope).not.toContain('ticket_tombstones');
    expect(upsert).toMatch(
      /scope_eviction\.cause = 'config-scope-purge'[\s\S]*incoming\.updated_at = scope_eviction\.watermark_updated_at[\s\S]*incoming\.team ->> 'id'\) is not distinct from scope_eviction\.team_id/,
    );
  });

  it('keeps scope ordering markers outside retention and true delete tombstones distinct', () => {
    const cleanup = teamScope.slice(
      teamScope.indexOf('create or replace function public.cleanup_operational_history'),
      teamScope.indexOf('do $$', teamScope.indexOf('create or replace function public.cleanup_operational_history')),
    );
    const finalize = teamScope.slice(
      teamScope.indexOf('create or replace function public.finalize_full_reconcile'),
      teamScope.indexOf('create or replace function public.cleanup_operational_history'),
    );

    expect(cleanup).not.toContain('ticket_scope_evictions');
    expect(cleanup).toContain('ticket_tombstones');
    expect(finalize).toContain('insert into public.ticket_tombstones');
    expect(finalize).toContain("'linear-archived'");
    expect(finalize).not.toContain('ticket_scope_evictions');
  });
});
