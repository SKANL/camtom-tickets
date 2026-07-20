import type { ConfigResponse, ScreenDevice, ScreenState } from './types';
import type { TicketRow } from './tickets';

export const DISPLAY_PROTOCOL_VERSION = 2 as const;
export const DISPLAY_SYNC_INTERVAL_MS = 10_000;

export interface DisplayV2Capabilities {
  userAgent?: string;
  viewport?: { width: number; height: number };
  cookies?: boolean;
  localStorage?: boolean;
  webSocket?: boolean;
  fetch?: boolean;
  [key: string]: unknown;
}

export interface CreateDisplayPairingRequest {
  requestId: string;
  capabilities?: DisplayV2Capabilities;
}

export interface CreateDisplayPairingResponse {
  protocolVersion: typeof DISPLAY_PROTOCOL_VERSION;
  pairingId: string;
  installationId: string;
  /** Returned exactly once. Keep it in the URL fragment, never a query string. */
  installationSecret: string;
  code: string;
  expiresAt: string;
}

export interface DisplayPairingStatusResponse {
  status: 'pending' | 'claimed' | 'expired' | 'revoked';
  deviceId?: string;
  deviceToken?: string;
  tokenExpiresAt?: string;
}

export interface CreateDisplaySessionRequest {
  installationId: string;
}

export interface CreateDisplaySessionResponse {
  deviceId: string;
  deviceToken: string;
  tokenExpiresAt: string;
}

export interface DisplaySyncRequest {
  appliedStateVersion: number;
  ticketVersion?: string | null;
  configVersion?: string | null;
  capabilities?: DisplayV2Capabilities;
}

export interface DisplaySyncResponse {
  protocolVersion: typeof DISPLAY_PROTOCOL_VERSION;
  device: ScreenDevice;
  desiredState: ScreenState | null;
  config: ConfigResponse | null;
  configVersion: string;
  tickets: TicketRow[] | null;
  /** Changes whenever the authoritative ticket snapshot changes, including deletions. */
  ticketVersion: string;
  ticketsFullSnapshot: boolean;
  nextPollMs: number;
  tokenExpiresAt: string;
  deviceToken?: string;
}

export interface ClaimDisplayPairingV2Request {
  code: string;
  requestId: string;
  name: string;
  allowedTeamIds: string[];
  desiredState: ScreenState;
  replacementForDeviceId?: string;
}

export interface RotateDisplayCredentialResponse {
  installationId: string;
  installationSecret: string;
  generation: number;
}
