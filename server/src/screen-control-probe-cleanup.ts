import type { SupabaseClient } from '@supabase/supabase-js';

export interface ScreenProbeResources {
  admin: SupabaseClient;
  firstClient: SupabaseClient | null;
  firstUserId: string;
  secondUserId: string;
  deviceId: string;
  channel: ReturnType<SupabaseClient['channel']> | null;
}

function cleanupMessage(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message
    : typeof error === 'object' && error && 'message' in error ? String(error.message)
      : String(error);
  return `${label}: ${message}`;
}

/** Best-effort cleanup that always attempts every registered resource and reports every failure. */
export async function cleanupScreenProbeResources(resources: ScreenProbeResources): Promise<string[]> {
  const failures: string[] = [];
  if (resources.channel && resources.firstClient) {
    try {
      const status = await resources.firstClient.removeChannel(resources.channel);
      if (status !== 'ok') failures.push(`realtime channel: ${status}`);
    } catch (error) {
      failures.push(cleanupMessage('realtime channel', error));
    }
  }
  if (resources.deviceId) {
    try {
      const result = await resources.admin.from('screen_devices').delete().eq('id', resources.deviceId);
      if (result.error) failures.push(cleanupMessage('screen device', result.error));
    } catch (error) {
      failures.push(cleanupMessage('screen device', error));
    }
  }
  for (const [label, userId] of [['first synthetic user', resources.firstUserId], ['second synthetic user', resources.secondUserId]] as const) {
    if (!userId) continue;
    try {
      const result = await resources.admin.auth.admin.deleteUser(userId);
      if (result.error) failures.push(cleanupMessage(label, result.error));
    } catch (error) {
      failures.push(cleanupMessage(label, error));
    }
  }
  return failures;
}
