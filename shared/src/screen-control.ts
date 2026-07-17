import { ScreenDeviceHealth, ScreenState } from './types';
import { validateScreenState } from './config-v2';

export const SCREEN_HEARTBEAT_INTERVAL_MS = 30_000;
export const SCREEN_STATE_POLL_INTERVAL_MS = 20_000;

export function deriveScreenDeviceHealth(input: {
  lastSeenAt: string | null;
  stateVersion: number;
  lastAppliedVersion: number;
  now?: number;
}): ScreenDeviceHealth {
  const now = input.now ?? Date.now();
  const seenAt = input.lastSeenAt ? Date.parse(input.lastSeenAt) : Number.NaN;
  if (!Number.isFinite(seenAt) || now - seenAt > 5 * 60_000) return 'stale';
  if (now - seenAt > 90_000) return 'offline';
  if (input.lastAppliedVersion < input.stateVersion || now - seenAt > 45_000) return 'unstable';
  return 'online';
}

export function validateAllowedScreenState(
  value: unknown,
  allowedTeamIds: readonly string[],
): value is ScreenState {
  return validateScreenState(value, allowedTeamIds).length === 0;
}

export function shouldApplyScreenVersion(currentVersion: number, incomingVersion: number): boolean {
  return Number.isSafeInteger(incomingVersion) && incomingVersion > currentVersion;
}
