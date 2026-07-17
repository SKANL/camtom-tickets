import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TicketRow } from '@camtom/shared';
import { configuredTeamIds } from './team-scope';

let admin: SupabaseClient | null = null;

/** Service-role client (server only). Bypasses RLS — never expose this key to the browser. */
export function getSupabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables are not set');
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export async function upsertTickets(rows: TicketRow[], signal?: AbortSignal): Promise<void> {
  if (rows.length === 0) return;
  const request = getSupabaseAdmin().rpc('upsert_tickets_if_newer', { p_rows: rows });
  if (signal) request.abortSignal(signal);
  const { error } = await request;
  if (error) throw new Error(`upsertTickets failed: ${error.message}`);
}

export async function deleteTicket(id: string, eventUpdatedAt: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc('delete_ticket_if_not_newer', {
    p_id: id,
    p_event_updated_at: eventUpdatedAt,
  });
  if (error) throw new Error(`deleteTicket failed: ${error.message}`);
}

export interface WebhookDeliveryClaim {
  status: 'claimed' | 'processed' | 'busy' | 'conflict';
  claimToken?: string;
}

export async function claimWebhookDelivery(deliveryId: string, payloadHash: string): Promise<WebhookDeliveryClaim> {
  const { data, error } = await getSupabaseAdmin().rpc('claim_webhook_delivery', {
    p_delivery_id: deliveryId,
    p_payload_hash: payloadHash,
  });
  if (error) throw new Error(`claimWebhookDelivery failed: ${error.message}`);
  return data as WebhookDeliveryClaim;
}

export async function completeWebhookDelivery(deliveryId: string, payloadHash: string, claimToken: string): Promise<void> {
  const { data, error } = await getSupabaseAdmin().rpc('complete_webhook_delivery', {
    p_delivery_id: deliveryId,
    p_payload_hash: payloadHash,
    p_claim_token: claimToken,
  });
  if (error) throw new Error(`completeWebhookDelivery failed: ${error.message}`);
  if (data !== true) throw new Error('completeWebhookDelivery failed: claim is no longer owned');
}

export async function releaseWebhookDelivery(deliveryId: string, payloadHash: string, claimToken: string): Promise<void> {
  const { data, error } = await getSupabaseAdmin().rpc('release_webhook_delivery', {
    p_delivery_id: deliveryId,
    p_payload_hash: payloadHash,
    p_claim_token: claimToken,
  });
  if (error) throw new Error(`releaseWebhookDelivery failed: ${error.message}`);
  if (data !== true) throw new Error('releaseWebhookDelivery failed: claim is no longer owned');
}

export async function acquireReconcileLease(
  name: string,
  owner: string,
  leaseSeconds = 120,
  signal?: AbortSignal,
): Promise<boolean> {
  const request = getSupabaseAdmin().rpc('acquire_reconcile_lease', {
    p_name: name,
    p_owner: owner,
    p_lease_seconds: leaseSeconds,
  });
  if (signal) request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw new Error(`acquireReconcileLease failed: ${error.message}`);
  return data === true;
}

export async function releaseReconcileLease(name: string, owner: string, signal?: AbortSignal): Promise<void> {
  const request = getSupabaseAdmin().rpc('release_reconcile_lease', {
    p_name: name,
    p_owner: owner,
  });
  if (signal) request.abortSignal(signal);
  const { error } = await request;
  if (error) throw new Error(`releaseReconcileLease failed: ${error.message}`);
}

export interface ScopedTicket {
  id: string;
  team: { id?: string } | null;
  team_id?: string | null;
  synced_at: string;
}

export interface ReconcileScopeState {
  last_snapshot_count: number | null;
  successful_snapshots: number;
}

export interface ConfiguredReconcileScope {
  teamIds: string[];
  configUpdatedAt: string;
}

/** Always reads the authoritative DB row; never use the warm config cache for destructive scope. */
export async function getConfiguredReconcileScope(signal?: AbortSignal): Promise<ConfiguredReconcileScope | null> {
  const config = await getAppConfig(signal);
  if (!config) return null;
  return {
    teamIds: configuredTeamIds({ dashboard: config.dashboard, slas: [], version: '' }),
    configUpdatedAt: config.updatedAt,
  };
}

export async function getTicketsForTeams(teamIds: string[], signal?: AbortSignal): Promise<ScopedTicket[]> {
  if (teamIds.length === 0) return [];
  const request = getSupabaseAdmin()
    .from('tickets')
    .select('id, team, team_id, synced_at')
    .in('team_id', teamIds);
  if (signal) request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw new Error(`getTicketsForTeams failed: ${error.message}`);
  return (data ?? []) as ScopedTicket[];
}

export async function getReconcileScopeState(scopeKey: string, signal?: AbortSignal): Promise<ReconcileScopeState | null> {
  const request = getSupabaseAdmin()
    .from('reconcile_scope_state')
    .select('last_snapshot_count, successful_snapshots')
    .eq('scope_key', scopeKey);
  if (signal) request.abortSignal(signal);
  const { data, error } = await request.maybeSingle();
  if (error) throw new Error(`getReconcileScopeState failed: ${error.message}`);
  return data as ReconcileScopeState | null;
}

export async function createReconcileRun(input: {
  kind: 'incremental' | 'full';
  scopeKey?: string;
  teamIds?: string[];
  startedAt: string;
  upperBound: string;
  dryRun: boolean;
  configUpdatedAt?: string;
}, signal?: AbortSignal): Promise<string> {
  const request = getSupabaseAdmin()
    .from('reconcile_runs')
    .insert({
      kind: input.kind,
      scope_key: input.scopeKey ?? null,
      team_ids: input.teamIds ?? [],
      started_at: input.startedAt,
      upper_bound: input.upperBound,
      dry_run: input.dryRun,
      config_updated_at: input.configUpdatedAt ?? null,
    })
    .select('id');
  if (signal) request.abortSignal(signal);
  const { data, error } = await request.single();
  if (error) throw new Error(`createReconcileRun failed: ${error.message}`);
  return data.id;
}

export async function finishReconcileRun(runId: string, input: {
  status: 'completed' | 'blocked' | 'failed';
  snapshotCount?: number;
  activeCount?: number;
  archivedCount?: number;
  missingCount?: number;
  preview?: Record<string, unknown>;
  error?: string;
}, signal?: AbortSignal): Promise<void> {
  const request = getSupabaseAdmin()
    .from('reconcile_runs')
    .update({
      status: input.status,
      snapshot_count: input.snapshotCount,
      active_count: input.activeCount,
      archived_count: input.archivedCount,
      missing_count: input.missingCount,
      preview: input.preview,
      error: input.error,
      finished_at: new Date().toISOString(),
    })
    .eq('id', runId);
  if (signal) request.abortSignal(signal);
  const { error } = await request;
  if (error) throw new Error(`finishReconcileRun failed: ${error.message}`);
}

export async function finalizeFullReconcile(input: {
  runId: string;
  leaseToken: string;
  scopeKey: string;
  teamIds: string[];
  startedAt: string;
  upperBound: string;
  deadlineAt: string;
  activeIds: string[];
  archived: { id: string; teamId: string; updatedAt: string }[];
  missingIds: string[];
}, signal?: AbortSignal): Promise<{ archivedDeleted: number; missingDeleted: number }> {
  const request = getSupabaseAdmin().rpc('finalize_full_reconcile', {
    p_run_id: input.runId,
    p_lease_token: input.leaseToken,
    p_scope_key: input.scopeKey,
    p_team_ids: input.teamIds,
    p_started_at: input.startedAt,
    p_upper_bound: input.upperBound,
    p_deadline_at: input.deadlineAt,
    p_active_ids: input.activeIds,
    p_archived: input.archived,
    p_missing_ids: input.missingIds,
  });
  if (signal) request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw new Error(`finalizeFullReconcile failed: ${error.message}`);
  return data as { archivedDeleted: number; missingDeleted: number };
}

export async function getLastSync(): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('sync_state')
    .select('last_synced_at')
    .eq('id', 1)
    .single();
  if (error) throw new Error(`getLastSync failed: ${error.message}`);
  return data?.last_synced_at ?? null;
}

export async function setLastSync(iso: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('sync_state')
    .update({ last_synced_at: iso })
    .eq('id', 1);
  if (error) throw new Error(`setLastSync failed: ${error.message}`);
}

export async function getAppConfig(signal?: AbortSignal): Promise<{ dashboard: any; sla: any; updatedAt: string } | null> {
  const request = getSupabaseAdmin()
    .from('app_config')
    .select('dashboard, sla, updated_at')
    .eq('id', 1);
  if (signal) request.abortSignal(signal);
  const { data, error } = await request.maybeSingle();
  if (error) throw new Error(`getAppConfig failed: ${error.message}`);
  if (!data) return null;
  return { dashboard: data.dashboard, sla: data.sla, updatedAt: data.updated_at };
}

export interface AppConfigSnapshot {
  dashboard: any;
  sla: any;
  updatedAt: string;
  teamConfigs: Record<string, any> | null;
}

/** Reads app_config and normalized team settings from one PostgreSQL statement snapshot. */
export async function getAppConfigSnapshot(signal?: AbortSignal): Promise<AppConfigSnapshot | null> {
  const request = getSupabaseAdmin().rpc('get_app_config_v2_snapshot');
  if (signal) request.abortSignal(signal);
  const { data, error } = await request;
  // Expand/deploy compatibility: before 0011 exists, return a coherent v1 snapshot.
  if (error?.code === '42883' || error?.code === 'PGRST202') {
    const legacy = await getAppConfig(signal);
    return legacy ? { ...legacy, teamConfigs: null } : null;
  }
  if (error) throw new Error(`getAppConfigSnapshot failed: ${error.message}`);
  if (!data) return null;
  return data as AppConfigSnapshot;
}

export async function setAppConfig(
  dashboard: any,
  sla: any,
  expectedUpdatedAt: string | null,
): Promise<string> {
  const { data, error } = await getSupabaseAdmin().rpc('set_app_config_if_version', {
    p_dashboard: dashboard,
    p_sla: sla,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw new Error(`setAppConfig failed: ${error.message}`);
  if (typeof data !== 'string') throw new Error('setAppConfig failed: missing updated_at');
  return data;
}

export async function setAppConfigV2(
  dashboard: any,
  sla: any,
  teamConfigs: Record<string, any>,
  expectedUpdatedAt: string | null,
): Promise<string> {
  const { data, error } = await getSupabaseAdmin().rpc('set_app_config_v2_if_version', {
    p_dashboard: dashboard,
    p_sla: sla,
    p_team_configs: teamConfigs,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) throw new Error(`setAppConfigV2 failed: ${error.message}`);
  if (typeof data !== 'string') throw new Error('setAppConfigV2 failed: missing updated_at');
  return data;
}

export async function getMetadataCache(): Promise<{ catalog: any; updatedAt: string } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('metadata_cache')
    .select('catalog, updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(`getMetadataCache failed: ${error.message}`);
  if (!data) return null;
  return { catalog: data.catalog, updatedAt: data.updated_at };
}

export async function setMetadataCache(catalog: any): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('metadata_cache')
    .upsert({ id: 1, catalog, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error(`setMetadataCache failed: ${error.message}`);
}

export interface ReconciliationHealth {
  scheduler: 'supabase-pg-cron';
  fullApplyEnabled: boolean;
  lastFullRun: { status: string; finishedAt: string | null; dryRun: boolean } | null;
  lastAppliedFullSuccessAt: string | null;
}

/** Non-sensitive operational state safe to expose from /api/health. */
export async function getReconciliationHealth(): Promise<ReconciliationHealth> {
  const client = getSupabaseAdmin();
  const [latest, applied] = await Promise.all([
    client.from('reconcile_runs')
      .select('status, finished_at, dry_run')
      .eq('kind', 'full')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client.from('reconcile_runs')
      .select('finished_at')
      .eq('kind', 'full')
      .eq('status', 'completed')
      .eq('dry_run', false)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (latest.error) throw new Error(`getReconciliationHealth latest failed: ${latest.error.message}`);
  if (applied.error) throw new Error(`getReconciliationHealth applied failed: ${applied.error.message}`);
  return {
    scheduler: 'supabase-pg-cron',
    fullApplyEnabled: process.env.FULL_RECONCILE_APPLY === 'true',
    lastFullRun: latest.data ? {
      status: latest.data.status,
      finishedAt: latest.data.finished_at,
      dryRun: latest.data.dry_run,
    } : null,
    lastAppliedFullSuccessAt: applied.data?.finished_at ?? null,
  };
}
