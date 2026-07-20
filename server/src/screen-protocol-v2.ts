import { randomBytes, randomInt, randomUUID } from 'crypto';
import type {
  ClaimDisplayPairingV2Request,
  ConfigResponse,
  CreateDisplayPairingResponse,
  DisplayPairingStatusResponse,
  DisplaySyncRequest,
  DisplaySyncResponse,
  DisplayV2Capabilities,
  RotateDisplayCredentialResponse,
  ScreenDevice,
  TicketRow,
} from '@camtom/shared';
import {
  createConfigV2,
  DISPLAY_PROTOCOL_VERSION,
  DISPLAY_SYNC_INTERVAL_MS,
  validateConfigV2,
  validateScreenState,
} from '@camtom/shared';
import { filterConfigForScreen, mapScreenDevice } from './screen-control';
import { getSupabaseAdmin } from './supabase';
import { constantTimeSecretHash, compareSecretHash, signSession, verifySession } from './signed-session';
import { configuredTeamIds } from './team-scope';

const PAIRING_LIFETIME_MS = 5 * 60_000;
const DEVICE_TOKEN_LIFETIME_MS = 15 * 60_000;
const MAX_CAPABILITIES_BYTES = 8_192;
const TICKET_PAGE_SIZE = 1_000;
const MAX_DISPLAY_TICKETS = 10_000;

interface PairingV2Row {
  id: string;
  device_id: string | null;
  installation_id: string;
  poll_secret_hash: string;
  expires_at: string;
  claimed_at: string | null;
}

interface CredentialRow {
  id: string;
  device_id: string;
  generation: number;
  credential_hash: string;
  revoked_at: string | null;
}

interface AuthoritativeConfigSnapshot {
  dashboard: ConfigResponse['dashboard'];
  sla: ConfigResponse['slas'];
  updatedAt: string;
  teamConfigs?: Record<string, unknown> | null;
}

export function protocolSecret(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.SCREEN_PAIRING_SECRET;
  if (!value || value.length < 32) throw new Error('SCREEN_PAIRING_SECRET is not configured');
  return value;
}

export function generateInstallationSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInstallationSecret(value: string, secret = protocolSecret()): string {
  return constantTimeSecretHash(value, secret, 'display-installation-v2');
}

export function sanitizeCapabilities(value: unknown): DisplayV2Capabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_CAPABILITIES_BYTES) throw new Error('capabilities too large');
  return JSON.parse(json) as DisplayV2Capabilities;
}

function codeHash(code: string, secret = protocolSecret()): string {
  return constantTimeSecretHash(code, secret, 'display-pairing-code-v2');
}

function ipHash(ip: string | null, secret = protocolSecret()): string | null {
  return ip ? constantTimeSecretHash(ip, secret, 'display-pairing-ip-v2') : null;
}

function issueDeviceToken(credential: CredentialRow, now = Date.now()): { token: string; expiresAt: string } {
  const expiresAt = now + DEVICE_TOKEN_LIFETIME_MS;
  return {
    token: signSession({
      kind: 'display', issuedAt: now, expiresAt,
      deviceId: credential.device_id, credentialId: credential.id, generation: credential.generation,
    }, protocolSecret()),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function createDisplayPairingV2(requestId: string, trustedIp: string | null): Promise<CreateDisplayPairingResponse> {
  const admin = getSupabaseAdmin();
  const existing = await admin.from('screen_pairings').select('id, installation_id, expires_at')
    .eq('start_request_id', requestId).eq('protocol_version', 2).maybeSingle();
  if (existing.error) throw new Error(`pairing lookup failed: ${existing.error.message}`);
  if (existing.data) throw new Error('pairing request replay requires the original installation secret');

  for (let attempt = 0; attempt < 8; attempt++) {
    const installationId = randomUUID();
    const installationSecret = generateInstallationSecret();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + PAIRING_LIFETIME_MS).toISOString();
    const result = await admin.rpc('create_screen_pairing_v2', {
      p_request_id: requestId,
      p_installation_id: installationId,
      p_poll_secret_hash: hashInstallationSecret(installationSecret),
      p_code_hash: codeHash(code),
      p_expires_at: expiresAt,
      p_ip_hash: ipHash(trustedIp),
      p_global_hash: constantTimeSecretHash('global', protocolSecret(), 'display-pairing-global-v2'),
    });
    if (!result.error && result.data?.status === 'created') {
      return {
        protocolVersion: DISPLAY_PROTOCOL_VERSION,
        pairingId: result.data.pairing_id,
        installationId,
        installationSecret,
        code,
        expiresAt,
      };
    }
    if (!result.error && result.data?.status === 'replay') throw new Error('pairing request replay requires the original installation secret');
    if (!result.error && result.data?.status === 'rate_limited') throw new Error('pairing rate limit exceeded');
    if (!result.error && result.data?.status === 'capacity') throw new Error('pairing pending capacity exceeded');
    if (result.error?.code !== '23505') throw new Error(`pairing creation failed: ${result.error?.message ?? 'unknown'}`);
  }
  throw new Error('pairing code space is busy');
}

async function pairingById(pairingId: string): Promise<PairingV2Row | null> {
  const { data, error } = await getSupabaseAdmin().from('screen_pairings')
    .select('id, device_id, installation_id, poll_secret_hash, expires_at, claimed_at')
    .eq('id', pairingId).eq('protocol_version', 2).maybeSingle();
  if (error) throw new Error(`pairing status failed: ${error.message}`);
  return data as PairingV2Row | null;
}

async function activeCredential(deviceId: string): Promise<CredentialRow | null> {
  const { data, error } = await getSupabaseAdmin().from('screen_device_credentials').select('*')
    .eq('device_id', deviceId).is('revoked_at', null).order('generation', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`credential lookup failed: ${error.message}`);
  return data as CredentialRow | null;
}

export async function getDisplayPairingStatusV2(pairingId: string, installationSecret: string): Promise<DisplayPairingStatusResponse & { cookieToken?: string }> {
  const row = await pairingById(pairingId);
  if (!row) {
    throw new Error('display credential invalid');
  }
  if (!row.device_id || !row.claimed_at) {
    if (!compareSecretHash(installationSecret, row.poll_secret_hash, protocolSecret(), 'display-installation-v2')) {
      throw new Error('display credential invalid');
    }
    return Date.parse(row.expires_at) <= Date.now() ? { status: 'expired' } : { status: 'pending' };
  }
  const credential = await activeCredential(row.device_id);
  if (!credential) {
    if (!compareSecretHash(installationSecret, row.poll_secret_hash, protocolSecret(), 'display-installation-v2')) {
      throw new Error('display credential invalid');
    }
    return { status: 'revoked' };
  }
  // After a rotation, the original pairing secret must not mint a session for
  // the replacement credential. Always authenticate against the active hash.
  if (!compareSecretHash(installationSecret, credential.credential_hash, protocolSecret(), 'display-installation-v2')) {
    throw new Error('display credential invalid');
  }
  const issued = issueDeviceToken(credential);
  const delivered = await getSupabaseAdmin().from('screen_pairings')
    .update({ status_delivered_at: new Date().toISOString() })
    .eq('id', row.id).is('status_delivered_at', null);
  if (delivered.error) throw new Error(`pairing delivery state failed: ${delivered.error.message}`);
  return {
    status: 'claimed', deviceId: row.device_id,
    deviceToken: issued.token, cookieToken: issued.token, tokenExpiresAt: issued.expiresAt,
  };
}

export async function createDisplaySessionV2(installationId: string, installationSecret: string) {
  const { data, error } = await getSupabaseAdmin().from('screen_devices')
    .select('id, revoked_at').eq('installation_id', installationId).eq('protocol_version', 2).maybeSingle();
  if (error) throw new Error(`display lookup failed: ${error.message}`);
  if (!data || data.revoked_at) throw new Error('display credential invalid');
  const credential = await activeCredential(data.id);
  if (!credential || !compareSecretHash(installationSecret, credential.credential_hash, protocolSecret(), 'display-installation-v2')) {
    throw new Error('display credential invalid');
  }
  const issued = issueDeviceToken(credential);
  return { deviceId: data.id, deviceToken: issued.token, cookieToken: issued.token, tokenExpiresAt: issued.expiresAt };
}

export async function authorizeDisplayTokenV2(token: string): Promise<CredentialRow> {
  const payload = verifySession(token, protocolSecret(), 'display');
  if (!payload?.deviceId || !payload.credentialId || !Number.isSafeInteger(payload.generation)) {
    throw new Error('display session invalid');
  }
  const { data, error } = await getSupabaseAdmin().from('screen_device_credentials').select('*')
    .eq('id', payload.credentialId).eq('device_id', payload.deviceId)
    .eq('generation', payload.generation).is('revoked_at', null).maybeSingle();
  if (error) throw new Error(`display session lookup failed: ${error.message}`);
  if (!data) throw new Error('display session invalid');
  return data as CredentialRow;
}

/** Read every scoped row before labeling the response an authoritative snapshot. */
function configFromAuthoritativeSnapshot(snapshot: AuthoritativeConfigSnapshot): ConfigResponse {
  if (!snapshot || typeof snapshot.updatedAt !== 'string' || !snapshot.updatedAt
    || !snapshot.dashboard || !Array.isArray(snapshot.sla)) {
    throw new Error('authoritative display config is invalid');
  }
  const config: ConfigResponse = {
    version: snapshot.updatedAt,
    dashboard: snapshot.dashboard,
    slas: snapshot.sla,
  };
  const teamIds = configuredTeamIds(config);
  if (teamIds.length === 0) throw new Error('authoritative display config has no teams');
  if (snapshot.teamConfigs && Object.keys(snapshot.teamConfigs).length > 0) {
    const configV2 = createConfigV2(config);
    configV2.teams = snapshot.teamConfigs as NonNullable<ConfigResponse['configV2']>['teams'];
    const errors = validateConfigV2(configV2, teamIds);
    if (errors.length > 0) throw new Error(`authoritative config v2 is invalid: ${errors.join('; ')}`);
    config.configV2 = configV2;
  }
  return config;
}

export async function loadDisplayTicketSnapshot(
  credentialId: string,
  expectedTeamIds: string[],
  configVersion: string,
): Promise<TicketRow[]> {
  const tickets: TicketRow[] = [];
  for (let offset = 0; ; offset += TICKET_PAGE_SIZE) {
    const result = await getSupabaseAdmin().rpc('read_screen_ticket_page_v2', {
      p_credential_id: credentialId,
      p_expected_config_updated_at: configVersion,
      p_offset: offset,
      p_limit: TICKET_PAGE_SIZE,
    });
    if (result.error) throw new Error(`display tickets failed: ${result.error.message}`);
    if (result.data?.status !== 'ok') throw new Error(`display ticket scope unavailable: ${result.data?.status ?? 'invalid'}`);
    const pageTeamIds = result.data.effective_team_ids;
    if (!Array.isArray(pageTeamIds) || pageTeamIds.length !== expectedTeamIds.length
      || pageTeamIds.some((id: unknown, index: number) => id !== expectedTeamIds[index])) {
      throw new Error('display ticket scope changed during snapshot');
    }
    const page = (result.data.tickets ?? []) as TicketRow[];
    if (!Array.isArray(page)) throw new Error('display ticket page is invalid');
    if (tickets.length + page.length > MAX_DISPLAY_TICKETS) {
      throw new Error('display ticket snapshot exceeds safe limit');
    }
    tickets.push(...page);
    if (page.length < TICKET_PAGE_SIZE) return tickets;
  }
}

export async function syncDisplayV2(credential: CredentialRow, input: DisplaySyncRequest): Promise<DisplaySyncResponse> {
  const capabilities = sanitizeCapabilities(input.capabilities);
  const synced = await getSupabaseAdmin().rpc('sync_screen_device_v2', {
    p_credential_id: credential.id,
    p_applied_version: input.appliedStateVersion,
    p_capabilities: capabilities,
  });
  if (synced.error) throw new Error(`display sync failed: ${synced.error.message}`);
  if (synced.data?.status === 'revoked') throw new Error('display session revoked');
  if (synced.data?.status !== 'ok' || !synced.data.device || !synced.data.config_snapshot) {
    throw new Error(`authoritative display scope unavailable: ${synced.data?.status ?? 'invalid'}`);
  }
  const row = synced.data.device as any;
  const authoritativeConfig = configFromAuthoritativeSnapshot(synced.data.config_snapshot);
  const configured = new Set(configuredTeamIds(authoritativeConfig));
  const effectiveTeamIds = synced.data.effective_team_ids;
  if (!Array.isArray(effectiveTeamIds) || effectiveTeamIds.length === 0
    || effectiveTeamIds.some((id: unknown) => typeof id !== 'string' || !configured.has(id))) {
    throw new Error('display has no authoritative configured team scope');
  }
  const desiredStateErrors = validateScreenState(row.desired_state, effectiveTeamIds);
  if (desiredStateErrors.length > 0) throw new Error('display desired state is outside configured team scope');
  const scopedRow = { ...row, allowed_team_ids: effectiveTeamIds };
  const device = mapScreenDevice(scopedRow);
  const config = filterConfigForScreen(authoritativeConfig, effectiveTeamIds);
  const revisionResult = await getSupabaseAdmin().from('screen_ticket_revision').select('revision').eq('id', 1).single();
  if (revisionResult.error) throw new Error(`ticket revision failed: ${revisionResult.error.message}`);
  const ticketVersion = String(revisionResult.data.revision);
  let tickets: TicketRow[] | null = null;
  if (input.ticketVersion !== ticketVersion) {
    tickets = await loadDisplayTicketSnapshot(credential.id, effectiveTeamIds, authoritativeConfig.version);
  }
  const refreshed = issueDeviceToken(credential);
  return {
    protocolVersion: DISPLAY_PROTOCOL_VERSION,
    device,
    desiredState: scopedRow.desired_state,
    config: input.configVersion === config.version ? null : config,
    configVersion: config.version,
    tickets,
    ticketVersion,
    ticketsFullSnapshot: tickets !== null,
    nextPollMs: DISPLAY_SYNC_INTERVAL_MS,
    tokenExpiresAt: refreshed.expiresAt,
    deviceToken: refreshed.token,
  };
}

export async function claimDisplayPairingV2(input: ClaimDisplayPairingV2Request): Promise<ScreenDevice | null> {
  const result = await getSupabaseAdmin().rpc('claim_screen_pairing_v2', {
    p_code_hash: codeHash(input.code),
    p_request_id: input.requestId,
    p_display_name: input.name,
    p_allowed_team_ids: input.allowedTeamIds,
    p_desired_state: input.desiredState,
    p_replacement_for_device_id: input.replacementForDeviceId ?? null,
  });
  if (result.error) throw new Error(`v2 pairing claim failed: ${result.error.message}`);
  return result.data?.status === 'claimed' ? mapScreenDevice(result.data.device) : null;
}

export async function revokeDisplayDeviceV2(deviceId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc('revoke_screen_device_v2', { p_device_id: deviceId });
  if (error) throw new Error(`v2 revoke failed: ${error.message}`);
  return data === true;
}

export async function rotateDisplayCredentialV2(deviceId: string): Promise<RotateDisplayCredentialResponse | null> {
  const installationSecret = generateInstallationSecret();
  const result = await getSupabaseAdmin().rpc('rotate_screen_device_credential_v2', {
    p_device_id: deviceId,
    p_credential_hash: hashInstallationSecret(installationSecret),
  });
  if (result.error) throw new Error(`v2 credential rotation failed: ${result.error.message}`);
  if (result.data?.status !== 'rotated') return null;
  return { installationId: result.data.installation_id, installationSecret, generation: result.data.generation };
}
