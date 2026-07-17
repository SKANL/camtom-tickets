import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_FILTER, ScreenState } from '@camtom/shared';
import { assertScreenControlProbeTarget } from '../screen-control-probe-guard';
import { cleanupScreenProbeResources, ScreenProbeResources } from '../screen-control-probe-cleanup';
import { ScreenProbeWaiter, waitForProbeSubscription } from '../screen-control-probe-waiter';

async function adminLinkClient(
  url: string,
  anonKey: string,
  tokenHash: string,
  expectedUserId: string,
): Promise<SupabaseClient> {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error || data.user?.id !== expectedUserId || !data.session) {
    throw new Error(`synthetic auth failed: ${error?.message ?? 'unexpected user or missing session'}`);
  }
  return client;
}

async function main() {
  const target = assertScreenControlProbeTarget(process.env);
  const admin = createClient(target.url, target.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const resources: ScreenProbeResources = {
    admin, firstClient: null, firstUserId: '', secondUserId: '', deviceId: '', channel: null,
  };
  let primaryFailure: unknown = null;
  let changeWaiter: ScreenProbeWaiter | null = null;
  try {
    const firstEmail = `screen-probe-${randomUUID()}@example.invalid`;
    const firstCreated = await admin.auth.admin.createUser({
      email: firstEmail, email_confirm: true,
      user_metadata: { screen_control_probe: true },
    });
    if (firstCreated.error || !firstCreated.data.user?.id) {
      throw new Error(`first synthetic user creation failed: ${firstCreated.error?.message ?? 'missing user'}`);
    }
    resources.firstUserId = firstCreated.data.user.id;
    const firstLink = await admin.auth.admin.generateLink({ type: 'magiclink', email: firstEmail });
    if (firstLink.error || !firstLink.data.properties?.hashed_token) {
      throw new Error(`first synthetic session link failed: ${firstLink.error?.message ?? 'missing token'}`);
    }
    resources.firstClient = await adminLinkClient(
      target.url, target.anonKey, firstLink.data.properties.hashed_token, resources.firstUserId,
    );

    const secondEmail = `screen-probe-${randomUUID()}@example.invalid`;
    const secondCreated = await admin.auth.admin.createUser({
      email: secondEmail, email_confirm: true,
      user_metadata: { screen_control_probe: true },
    });
    if (secondCreated.error || !secondCreated.data.user?.id) {
      throw new Error(`second synthetic user creation failed: ${secondCreated.error?.message ?? 'missing user'}`);
    }
    resources.secondUserId = secondCreated.data.user.id;
    const secondLink = await admin.auth.admin.generateLink({ type: 'magiclink', email: secondEmail });
    if (secondLink.error || !secondLink.data.properties?.hashed_token) {
      throw new Error(`second synthetic session link failed: ${secondLink.error?.message ?? 'missing token'}`);
    }
    const secondClient = await adminLinkClient(
      target.url, target.anonKey, secondLink.data.properties.hashed_token, resources.secondUserId,
    );
    const config = await admin.from('app_config').select('dashboard').eq('id', 1).single();
    if (config.error) throw config.error;
    const teamId = config.data.dashboard?.teams?.[0]?.id;
    if (typeof teamId !== 'string' || !teamId) throw new Error('Non-production config needs one enabled team');
    const screenState: ScreenState = {
      schemaVersion: 1,
      layout: 'single',
      reloadNonce: 'probe-v1',
      panes: {
        left: { teamId, view: 'board', filter: { ...EMPTY_FILTER } },
        right: { teamId, view: 'board', filter: { ...EMPTY_FILTER } },
      },
    };
    const inserted = await admin.from('screen_devices').insert({
      auth_user_id: resources.firstUserId,
      display_name: 'Hosted integration probe',
      desired_state: screenState,
      state_version: 1,
      allowed_team_ids: [teamId],
      paired_at: new Date().toISOString(),
    }).select('id').single();
    if (inserted.error) throw inserted.error;
    resources.deviceId = inserted.data.id;
    const deviceId = resources.deviceId;

    const own = await resources.firstClient.from('screen_devices').select('id').eq('id', deviceId);
    if (own.error || own.data?.length !== 1) throw new Error('own-device RLS probe failed');
    const foreign = await secondClient.from('screen_devices').select('id').eq('id', deviceId);
    if (foreign.error || foreign.data?.length !== 0) throw new Error('cross-device RLS probe failed');

    resources.channel = resources.firstClient.channel(`screen-probe:${deviceId}`);
    resources.channel
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'screen_devices', filter: `id=eq.${deviceId}`,
      }, () => changeWaiter?.resolve());
    changeWaiter = await waitForProbeSubscription(
      (onStatus) => { resources.channel!.subscribe(onStatus); },
      15_000,
      15_000,
    );

    const nextState = { ...screenState, reloadNonce: 'probe-v2' };
    const requestId = randomUUID();
    const updated = await admin.rpc('set_screen_desired_state', {
      p_device_id: deviceId,
      p_desired_state: nextState,
      p_allowed_team_ids: [teamId],
      p_expected_version: 1,
      p_request_id: requestId,
    });
    if (updated.error) throw updated.error;
    await changeWaiter.promise;

    const replay = await admin.rpc('set_screen_desired_state', {
      p_device_id: deviceId,
      p_desired_state: nextState,
      p_allowed_team_ids: [teamId],
      p_expected_version: 1,
      p_request_id: requestId,
    });
    if (replay.error) throw new Error(`idempotent replay failed: ${replay.error.message}`);
    const stale = await admin.rpc('set_screen_desired_state', {
      p_device_id: deviceId,
      p_desired_state: nextState,
      p_allowed_team_ids: [teamId],
      p_expected_version: 1,
      p_request_id: randomUUID(),
    });
    if (!stale.error) throw new Error('stale CAS unexpectedly succeeded');

    const ack = await resources.firstClient.rpc('screen_device_ack', {
      p_device_id: deviceId,
      p_applied_version: 2,
      p_capabilities: { hostedProbe: true },
    });
    if (ack.error || ack.data !== true) throw new Error(`ACK probe failed: ${ack.error?.message ?? 'rejected'}`);
    const verified = await admin.from('screen_devices').select('last_applied_version').eq('id', deviceId).single();
    if (verified.error || Number(verified.data.last_applied_version) !== 2) throw new Error('ACK persistence probe failed');
    console.log(`[screen-probe] non-production RLS/Realtime/CAS/ACK passed for ${target.projectRef}`);
  } catch (error) {
    primaryFailure = error;
  } finally {
    changeWaiter?.cancel();
    const cleanupFailures = await cleanupScreenProbeResources(resources);
    if (primaryFailure || cleanupFailures.length > 0) {
      const primary = primaryFailure instanceof Error ? primaryFailure.message
        : primaryFailure ? String(primaryFailure) : null;
      const details = [primary, ...cleanupFailures.map((failure) => `cleanup ${failure}`)].filter(Boolean);
      throw new Error(details.join('; '));
    }
  }
}

main().catch((error) => {
  console.error('[screen-probe] failed:', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
