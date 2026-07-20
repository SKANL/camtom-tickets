import { createHmac } from 'crypto';
import {
  ConfigResponse,
  ScreenControlFeatures,
  ScreenDevice,
  ScreenState,
  deriveScreenDeviceHealth,
  materializeTeamConfig,
} from '@camtom/shared';
import { getSupabaseAdmin } from './supabase';

export interface ScreenDeviceRow {
  id: string;
  auth_user_id: string | null;
  display_name: string | null;
  desired_state: ScreenState | null;
  state_version: number;
  last_applied_version: number;
  last_seen_at: string | null;
  capabilities: Record<string, unknown> | null;
  allowed_team_ids: string[] | null;
  paired_at: string | null;
  revoked_at: string | null;
  created_at: string;
  protocol_version?: number;
  installation_id?: string | null;
  superseded_by?: string | null;
  replacement_for_device_id?: string | null;
}

interface PairingRow {
  id: string;
  device_id: string | null;
  auth_user_id: string;
  start_request_id: string;
  code_nonce: number;
  expires_at: string;
  claimed_at: string | null;
}

function pairingSecret(): string {
  const value = process.env.SCREEN_PAIRING_SECRET;
  if (!value || value.length < 32) throw new Error('SCREEN_PAIRING_SECRET is not configured');
  return value;
}

export function getScreenControlFeatures(env: NodeJS.ProcessEnv = process.env): ScreenControlFeatures {
  const screenControlEnabled = env.SCREEN_CONTROL_ENABLED === 'true';
  const requirePairing = env.SCREEN_REQUIRE_PAIRING === 'true';
  const captchaProvider = env.SCREEN_CAPTCHA_PROVIDER === 'turnstile' ? 'turnstile' : null;
  const captchaSiteKey = env.SCREEN_CAPTCHA_SITE_KEY?.trim() || null;
  const captchaConfigured = captchaProvider === 'turnstile' && captchaSiteKey !== null;
  const production = env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
  const captchaRequired = requirePairing || (screenControlEnabled && production);
  return {
    screenControlEnabled,
    requirePairing,
    captchaProvider,
    captchaSiteKey,
    configurationError: captchaRequired && !captchaConfigured
      ? 'La vinculación de pantallas requiere CAPTCHA Turnstile configurado en el servidor.'
      : null,
  };
}

export function derivePairingCode(authUserId: string, requestId: string, nonce: number, secret = pairingSecret()): string {
  const digest = createHmac('sha256', secret)
    .update(`pairing-code:${authUserId}:${requestId}:${nonce}`, 'utf8')
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export function hashPairingCode(code: string, secret = pairingSecret()): string {
  return createHmac('sha256', secret).update(`pairing-lookup:${code}`, 'utf8').digest('hex');
}

export function hashRateActor(value: string, secret = pairingSecret()): string {
  return createHmac('sha256', secret).update(`pairing-rate:${value}`, 'utf8').digest('hex');
}

export async function authorizeScreenIdentity(accessToken: string): Promise<string> {
  if (!accessToken) throw new Error('screen authentication required');
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
  if (error || !data.user?.id || !data.user.is_anonymous) {
    throw new Error('anonymous screen authentication required');
  }
  return data.user.id;
}

async function acceptPairingAttempt(
  action: 'start' | 'claim',
  context: { authUserId?: string; trustedIp?: string | null },
): Promise<boolean> {
  const params = buildPairingRateParams(action, context);
  const { data, error } = await getSupabaseAdmin().rpc('check_screen_pairing_limits', params);
  if (error) throw new Error(`pairing rate limit failed: ${error.message}`);
  return data === true;
}

export function buildPairingRateParams(
  action: 'start' | 'claim',
  context: { authUserId?: string; trustedIp?: string | null },
  secret = pairingSecret(),
) {
  const limits = action === 'start'
    ? { uid: 4, ip: 12, global: 30 }
    : { uid: 12, ip: 20, global: 40 };
  return {
    p_action: action,
    p_uid_hash: context.authUserId ? hashRateActor(`uid:${context.authUserId}`, secret) : null,
    p_ip_hash: context.trustedIp ? hashRateActor(`ip:${context.trustedIp}`, secret) : null,
    p_global_hash: hashRateActor('global:v1', secret),
    p_uid_limit: limits.uid,
    p_ip_limit: limits.ip,
    p_global_limit: limits.global,
    p_window_seconds: 300,
  };
}

export async function startScreenPairing(authUserId: string, requestId: string, trustedIp?: string | null): Promise<{
  pairingId: string;
  code: string;
  expiresAt: string;
}> {
  const admin = getSupabaseAdmin();
  const existing = await admin.from('screen_pairings').select('*')
    .eq('auth_user_id', authUserId).eq('start_request_id', requestId).maybeSingle();
  if (existing.error) throw new Error(`pairing lookup failed: ${existing.error.message}`);
  if (existing.data) {
    const row = existing.data as PairingRow;
    if (!row.claimed_at && Date.parse(row.expires_at) > Date.now()) {
      return {
        pairingId: row.id,
        code: derivePairingCode(authUserId, requestId, row.code_nonce),
        expiresAt: row.expires_at,
      };
    }
    if (!row.claimed_at) {
      const removed = await admin.from('screen_pairings').delete().eq('id', row.id);
      if (removed.error) throw new Error(`expired pairing cleanup failed: ${removed.error.message}`);
    } else throw new Error('pairing request already used');
  }
  if (!await acceptPairingAttempt('start', { authUserId, trustedIp })) throw new Error('pairing rate limit exceeded');
  const active = await admin.from('screen_devices').select('id')
    .eq('auth_user_id', authUserId).is('revoked_at', null).maybeSingle();
  if (active.error) throw new Error(`screen device lookup failed: ${active.error.message}`);
  if (active.data) throw new Error('screen is already paired');

  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  for (let nonce = 0; nonce <= 20; nonce++) {
    const code = derivePairingCode(authUserId, requestId, nonce);
    const inserted = await admin.from('screen_pairings').insert({
      auth_user_id: authUserId,
      start_request_id: requestId,
      code_hash: hashPairingCode(code),
      code_nonce: nonce,
      expires_at: expiresAt,
    }).select('id').single();
    if (!inserted.error) return { pairingId: inserted.data.id, code, expiresAt };
    if (inserted.error.code !== '23505') throw new Error(`pairing creation failed: ${inserted.error.message}`);
  }
  throw new Error('pairing code space is busy; retry with a new request');
}

export async function claimScreenPairing(input: {
  code: string;
  requestId: string;
  name: string;
  allowedTeamIds: string[];
  desiredState: ScreenState;
  trustedIp?: string | null;
}): Promise<ScreenDevice | null> {
  if (!await acceptPairingAttempt('claim', { trustedIp: input.trustedIp })) throw new Error('pairing rate limit exceeded');
  const normalizedCode = normalizePairingCode(input.code);
  const { data, error } = await getSupabaseAdmin().rpc('claim_screen_pairing', {
    p_code_hash: hashPairingCode(normalizedCode),
    p_request_id: input.requestId,
    p_display_name: input.name,
    p_allowed_team_ids: input.allowedTeamIds,
    p_desired_state: input.desiredState,
  });
  if (error) throw new Error(`pairing claim failed: ${error.message}`);
  if (data?.status !== 'claimed' || !data.device) return null;
  return mapScreenDevice(data.device as ScreenDeviceRow);
}

export function normalizePairingCode(value: string): string {
  const normalized = value.normalize('NFKC').replace(/[\s-]/g, '');
  return /^\d{6}$/.test(normalized) ? normalized : 'invalid';
}

export async function listScreenDevices(): Promise<ScreenDevice[]> {
  const { data, error } = await getSupabaseAdmin().from('screen_devices').select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`screen devices failed: ${error.message}`);
  return (data ?? []).map((row) => mapScreenDevice(row as ScreenDeviceRow));
}

export async function getActiveScreenDevice(authUserId: string): Promise<ScreenDeviceRow | null> {
  const { data, error } = await getSupabaseAdmin().from('screen_devices').select('*')
    .eq('auth_user_id', authUserId).is('revoked_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`screen device lookup failed: ${error.message}`);
  return data as ScreenDeviceRow | null;
}

export async function setScreenDesiredState(input: {
  deviceId: string;
  desiredState: ScreenState;
  allowedTeamIds: string[];
  expectedVersion: number;
  requestId: string;
}): Promise<ScreenDevice> {
  const { data, error } = await getSupabaseAdmin().rpc('set_screen_desired_state', {
    p_device_id: input.deviceId,
    p_desired_state: input.desiredState,
    p_allowed_team_ids: input.allowedTeamIds,
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
  });
  if (error) throw new Error(`screen desired state failed: ${error.message}`);
  return mapScreenDevice(data as ScreenDeviceRow);
}

export async function revokeScreenDevice(deviceId: string): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const lookup = await admin.from('screen_devices').select('id, protocol_version')
    .eq('id', deviceId).maybeSingle();
  if (lookup.error) throw new Error(`screen revoke lookup failed: ${lookup.error.message}`);
  if (!lookup.data) return false;
  if (lookup.data.protocol_version === 2) {
    const { data, error } = await admin.rpc('revoke_screen_device_v2', { p_device_id: deviceId });
    if (error) throw new Error(`screen v2 revoke failed: ${error.message}`);
    return data === true;
  }
  const { data, error } = await admin.from('screen_devices')
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', deviceId).is('revoked_at', null).select('id');
  if (error) throw new Error(`screen revoke failed: ${error.message}`);
  return (data?.length ?? 0) === 1;
}

export function filterConfigForScreen(config: ConfigResponse, allowedTeamIds: readonly string[]): ConfigResponse {
  const allowed = new Set(allowedTeamIds);
  const teams = (config.dashboard.teams ?? []).filter((team) => allowed.has(team.id));
  const materialized = teams[0] ? materializeTeamConfig(config, teams[0].id) : config;
  const activeTeamId = allowed.has(config.dashboard.activeTeamId ?? '')
    ? config.dashboard.activeTeamId
    : teams[0]?.id;
  const configV2 = config.configV2 ? {
    ...config.configV2,
    teams: Object.fromEntries(Object.entries(config.configV2.teams).filter(([id]) => allowed.has(id))),
  } : undefined;
  return {
    ...materialized,
    dashboard: { ...materialized.dashboard, teams, activeTeamId },
    ...(configV2 ? { configV2 } : {}),
  };
}

export function mapScreenDevice(row: ScreenDeviceRow): ScreenDevice {
  return {
    id: row.id,
    name: row.display_name,
    desiredState: row.desired_state,
    stateVersion: Number(row.state_version),
    lastAppliedVersion: Number(row.last_applied_version),
    lastSeenAt: row.last_seen_at,
    capabilities: row.capabilities ?? {},
    allowedTeamIds: row.allowed_team_ids ?? [],
    pairedAt: row.paired_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    health: deriveScreenDeviceHealth({
      lastSeenAt: row.last_seen_at,
      stateVersion: Number(row.state_version),
      lastAppliedVersion: Number(row.last_applied_version),
    }),
    protocolVersion: row.protocol_version === 2 ? 2 : 1,
    installationId: row.installation_id ?? null,
    supersededBy: row.superseded_by ?? null,
    replacementForDeviceId: row.replacement_for_device_id ?? null,
  };
}
