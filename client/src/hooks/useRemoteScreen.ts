import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigResponse, ScreenControlFeatures, ScreenDevice, ScreenState } from '@camtom/shared';
import {
  SCREEN_HEARTBEAT_INTERVAL_MS,
  SCREEN_STATE_POLL_INTERVAL_MS,
  shouldApplyScreenVersion,
  validateAllowedScreenState,
  withoutPresentationCommand,
} from '@camtom/shared';
import { screenSupabase } from '../lib/supabase';
import {
  createRequestId,
  deviceCapabilities,
  fetchDeviceConfig,
  fetchScreenFeatures,
  requestScreenCaptchaToken,
  startPairing,
} from '../lib/screen-control';

const PAIRING_REQUEST_KEY = 'camtom-screen-pairing-request-v1';
const DEVICE_TICKET_CACHE_PREFIX = 'camtom-tickets:issues:screen:';
const DEVICE_ALERT_CACHE_PREFIX = 'camtom-alert-memory-v1:screen:';
const SCREEN_FEATURE_POLL_INTERVAL_MS = 30_000;

export interface ScreenDeviceRow {
  id: string;
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
}

export type RemoteScreenPhase = 'checking' | 'local' | 'authenticating' | 'pairing' | 'paired' | 'revoked' | 'error';

export interface RemoteScreenModel {
  phase: RemoteScreenPhase;
  features: ScreenControlFeatures | null;
  device: ScreenDevice | null;
  config: ConfigResponse | null;
  screenState: ScreenState | null;
  pairing: { code: string; expiresAt: string } | null;
  transport: 'realtime' | 'polling' | 'offline';
  message: string | null;
  restartPairing: () => void;
  acknowledgePresentationCommand: (commandId: string) => Promise<void>;
}

interface PendingPresentationAck {
  commandId: string;
  deviceId: string;
  version: number;
  epoch: number;
  committed: boolean;
}

export function shouldAcceptDeviceUpdate(currentVersion: number, row: ScreenDeviceRow): boolean {
  return !!row.desired_state && shouldApplyScreenVersion(currentVersion, Number(row.state_version));
}

export function clearRemoteDeviceCaches(deviceId: string): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${DEVICE_TICKET_CACHE_PREFIX}${deviceId}:`)
        || key?.startsWith(`${DEVICE_ALERT_CACHE_PREFIX}${deviceId}:`)) localStorage.removeItem(key);
    }
    localStorage.removeItem(PAIRING_REQUEST_KEY);
  } catch {
    // Revocation remains enforced by RLS even when browser storage is unavailable.
  }
}

function mapRow(row: ScreenDeviceRow): ScreenDevice {
  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : Number.NaN;
  const age = Number.isFinite(lastSeen) ? Date.now() - lastSeen : Infinity;
  const health = age > 5 * 60_000 ? 'stale'
    : age > 90_000 ? 'offline'
      : Number(row.last_applied_version) < Number(row.state_version) || age > 45_000 ? 'unstable' : 'online';
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
    health,
  };
}

function pairingRequestId(reset = false): string {
  try {
    if (!reset) {
      const existing = localStorage.getItem(PAIRING_REQUEST_KEY);
      if (existing) return existing;
    }
    const created = createRequestId();
    localStorage.setItem(PAIRING_REQUEST_KEY, created);
    return created;
  } catch {
    return createRequestId();
  }
}

export function useRemoteScreen(allowLocalWithoutPairing = false): RemoteScreenModel {
  const [phase, setPhase] = useState<RemoteScreenPhase>('checking');
  const [features, setFeatures] = useState<ScreenControlFeatures | null>(null);
  const [device, setDevice] = useState<ScreenDevice | null>(null);
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [screenState, setScreenState] = useState<ScreenState | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [transport, setTransport] = useState<'realtime' | 'polling' | 'offline'>('polling');
  const [message, setMessage] = useState<string | null>(null);
  const [restartEpoch, setRestartEpoch] = useState(0);
  const appliedVersionRef = useRef(-1);
  const latestObservedVersionRef = useRef(-1);
  const operationEpochRef = useRef(0);
  const accessTokenRef = useRef('');
  const authUserIdRef = useRef('');
  const deviceIdRef = useRef('');
  const hasScreenStateRef = useRef(false);
  const mountedRef = useRef(false);
  const revokedRef = useRef(false);
  const terminateTransportRef = useRef<() => void>(() => {});
  const configVersionRef = useRef('');
  const configRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const pendingPresentationAckRef = useRef<PendingPresentationAck | null>(null);
  const presentationAckInFlightRef = useRef(false);

  const isCurrent = useCallback((epoch: number, version?: number) => mountedRef.current
    && !revokedRef.current
    && operationEpochRef.current === epoch
    && (version === undefined || latestObservedVersionRef.current === version), []);

  const handleRevocation = useCallback(() => {
    if (revokedRef.current) return;
    revokedRef.current = true;
    operationEpochRef.current++;
    latestObservedVersionRef.current = Number.MAX_SAFE_INTEGER;
    hasScreenStateRef.current = false;
    pendingPresentationAckRef.current = null;
    presentationAckInFlightRef.current = false;
    const revokedDeviceId = deviceIdRef.current;
    if (revokedDeviceId) clearRemoteDeviceCaches(revokedDeviceId);
    terminateTransportRef.current();
    if (!mountedRef.current) return;
    setDevice(null);
    setScreenState(null);
    setConfig(null);
    configVersionRef.current = '';
    setPairing(null);
    setMessage(null);
    setTransport('offline');
    setPhase('revoked');
  }, []);

  const attemptPendingPresentationAck = useCallback(async (commandId: string) => {
    const pending = pendingPresentationAckRef.current;
    if (!pending || !pending.committed || pending.commandId !== commandId || presentationAckInFlightRef.current) return;
    if (!isCurrent(pending.epoch, pending.version)) return;
    presentationAckInFlightRef.current = true;
    try {
      const { data, error } = await screenSupabase.rpc('screen_device_ack', {
        p_device_id: pending.deviceId,
        p_applied_version: pending.version,
        p_capabilities: deviceCapabilities(),
      });
      if (!isCurrent(pending.epoch, pending.version)) return;
      if (error || data !== true) throw new Error(error?.message ?? 'ACK rechazado');
      appliedVersionRef.current = pending.version;
      pendingPresentationAckRef.current = null;
      setDevice((current) => current && current.id === pending.deviceId
        ? { ...current, lastAppliedVersion: Math.max(current.lastAppliedVersion, pending.version) }
        : current);
      setScreenState((current) => current?.presentationCommand?.id === commandId
        ? withoutPresentationCommand(current)
        : current);
      setMessage(null);
    } catch (error) {
      if (!isCurrent(pending.epoch, pending.version)) return;
      setMessage(error instanceof Error ? error.message : 'No se pudo confirmar el comando aplicado');
      setTransport('polling');
    } finally {
      presentationAckInFlightRef.current = false;
    }
  }, [isCurrent]);

  const acknowledgePresentationCommand = useCallback(async (commandId: string) => {
    const pending = pendingPresentationAckRef.current;
    if (!pending || pending.commandId !== commandId) return;
    pending.committed = true;
    setScreenState((current) => current?.presentationCommand?.id === commandId
      ? withoutPresentationCommand(current)
      : current);
    await attemptPendingPresentationAck(commandId);
  }, [attemptPendingPresentationAck]);

  const beginPairing = useCallback(async (resetRequest = false) => {
    const token = accessTokenRef.current;
    if (!token || revokedRef.current || !mountedRef.current) return;
    const epoch = ++operationEpochRef.current;
    setPhase('pairing');
    setMessage(null);
    try {
      let result;
      try {
        result = await startPairing(token, pairingRequestId(resetRequest));
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('ya fue utilizada')) throw error;
        if (!isCurrent(epoch)) return;
        result = await startPairing(token, pairingRequestId(true));
      }
      if (!isCurrent(epoch)) return;
      setPairing({ code: result.code, expiresAt: result.expiresAt });
    } catch (error) {
      if (!isCurrent(epoch)) return;
      const text = error instanceof Error ? error.message : 'No se pudo iniciar la vinculación';
      if (text.includes('ya está vinculada')) return;
      setMessage(text);
      setPhase('error');
    }
  }, [isCurrent]);

  const refreshEffectiveConfig = useCallback((row: ScreenDeviceRow): Promise<void> => {
    if (configRefreshInFlightRef.current) return configRefreshInFlightRef.current;
    const version = Number(row.state_version);
    const epoch = operationEpochRef.current;
    const desiredState = row.desired_state;
    const promise = (async () => {
      try {
        const nextConfig = await fetchDeviceConfig(accessTokenRef.current);
        if (!desiredState || !isCurrent(epoch, version)) return;
        const configuredIds = (nextConfig.dashboard.teams ?? []).map((team) => team.id);
        if (!validateAllowedScreenState(desiredState, row.allowed_team_ids ?? [])
          || !validateAllowedScreenState(desiredState, configuredIds)) {
          hasScreenStateRef.current = false;
          configVersionRef.current = '';
          setConfig(null);
          setScreenState(null);
          setMessage('La configuración actual ya no autoriza el estado de esta pantalla.');
          setPhase('error');
          return;
        }
        if (nextConfig.version !== configVersionRef.current) {
          configVersionRef.current = nextConfig.version;
          setConfig(nextConfig);
        }
        if (!hasScreenStateRef.current) {
          setScreenState(Number(row.last_applied_version) >= version
            ? withoutPresentationCommand(desiredState)
            : desiredState);
          hasScreenStateRef.current = true;
          setPairing(null);
        }
        setMessage(null);
        setPhase('paired');
      } catch (error) {
        if (!isCurrent(epoch, version)) return;
        setMessage(error instanceof Error ? error.message : 'No se pudo actualizar la configuración remota');
      }
    })().finally(() => {
      if (configRefreshInFlightRef.current === promise) configRefreshInFlightRef.current = null;
    });
    configRefreshInFlightRef.current = promise;
    return promise;
  }, [isCurrent]);

  const applyRow = useCallback(async (row: ScreenDeviceRow) => {
    if (!mountedRef.current) return;
    if (row.revoked_at) {
      deviceIdRef.current = row.id;
      handleRevocation();
      return;
    }
    if (revokedRef.current) return;

    const version = Number(row.state_version);
    if (!Number.isSafeInteger(version) || version < latestObservedVersionRef.current) return;
    deviceIdRef.current = row.id;
    setDevice(mapRow(row));

    if (!row.paired_at || !row.desired_state) {
      await beginPairing(false);
      return;
    }
    if (version === latestObservedVersionRef.current
      && pendingPresentationAckRef.current?.version === version
      && pendingPresentationAckRef.current.commandId === row.desired_state.presentationCommand?.id
      && Number(row.last_applied_version) < version) {
      if (pendingPresentationAckRef.current.committed) {
        await attemptPendingPresentationAck(pendingPresentationAckRef.current.commandId);
      }
      return;
    }
    if (version === latestObservedVersionRef.current && !shouldAcceptDeviceUpdate(appliedVersionRef.current, row)) {
      await refreshEffectiveConfig(row);
      return;
    }

    latestObservedVersionRef.current = version;
    const epoch = ++operationEpochRef.current;
    const allowed = row.allowed_team_ids ?? [];
    if (!validateAllowedScreenState(row.desired_state, allowed)) {
      if (!isCurrent(epoch, version)) return;
      setMessage('El servidor envió un estado inválido o fuera de los teams autorizados.');
      setPhase('error');
      return;
    }

    try {
      const nextConfig = await fetchDeviceConfig(accessTokenRef.current);
      if (!isCurrent(epoch, version)) return;
      const configuredIds = (nextConfig.dashboard.teams ?? []).map((team) => team.id);
      if (!validateAllowedScreenState(row.desired_state, configuredIds)) {
        throw new Error('El estado remoto no coincide con la configuración autorizada');
      }
      if (!isCurrent(epoch, version)) return;
      configVersionRef.current = nextConfig.version;
      setConfig(nextConfig);
      const command = row.desired_state.presentationCommand;
      const commandPending = !!command && Number(row.last_applied_version) < version;
      setScreenState(commandPending ? row.desired_state : withoutPresentationCommand(row.desired_state));
      hasScreenStateRef.current = true;
      setPairing(null);
      setPhase('paired');
      setMessage(null);

      if (commandPending && command) {
        pendingPresentationAckRef.current = {
          commandId: command.id,
          deviceId: row.id,
          version,
          epoch,
          committed: false,
        };
        return;
      }

      pendingPresentationAckRef.current = null;
      if (Number(row.last_applied_version) >= version) {
        appliedVersionRef.current = version;
        return;
      }
      if (!isCurrent(epoch, version)) return;
      const { data, error } = await screenSupabase.rpc('screen_device_ack', {
        p_device_id: row.id,
        p_applied_version: version,
        p_capabilities: deviceCapabilities(),
      });
      if (!isCurrent(epoch, version)) return;
      if (error || data !== true) throw new Error(error?.message ?? 'ACK rechazado');
      appliedVersionRef.current = version;
    } catch (error) {
      if (!isCurrent(epoch, version)) return;
      setMessage(error instanceof Error ? error.message : 'No se pudo aplicar el estado remoto');
      setPhase('error');
    }
  }, [attemptPendingPresentationAck, beginPairing, handleRevocation, isCurrent, refreshEffectiveConfig]);

  useEffect(() => {
    mountedRef.current = true;
    revokedRef.current = false;
    let cancelled = false;
    let transportStopped = false;
    let channel: ReturnType<typeof screenSupabase.channel> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let featureTimer: ReturnType<typeof setInterval> | null = null;
    let selectInFlight = false;
    let featureCheckInFlight = false;
    let disabledByFlag = false;
    const authListener = screenSupabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) accessTokenRef.current = session.access_token;
    });

    const stopTransport = () => {
      if (transportStopped) return;
      transportStopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      pollTimer = null;
      heartbeatTimer = null;
      if (channel) void screenSupabase.removeChannel(channel);
      channel = null;
    };
    terminateTransportRef.current = stopTransport;

    const selectAuthoritative = async () => {
      const userId = authUserIdRef.current;
      if (!userId || cancelled || transportStopped || revokedRef.current || selectInFlight) return;
      selectInFlight = true;
      try {
        const selectEpoch = operationEpochRef.current;
        const { data, error } = await screenSupabase.from('screen_devices').select('*')
          .eq('auth_user_id', userId).is('revoked_at', null)
          .order('created_at', { ascending: false }).limit(1);
        if (cancelled || transportStopped || revokedRef.current || selectEpoch !== operationEpochRef.current) return;
        if (error) {
          setTransport('offline');
          setMessage(`Polling sin respuesta: ${error.message}`);
          return;
        }
        setTransport((current) => current === 'realtime' ? current : 'polling');
        const row = data?.[0] as ScreenDeviceRow | undefined;
        if (row) await applyRow(row);
        else if (deviceIdRef.current) handleRevocation();
        else await beginPairing(false);
      } finally {
        selectInFlight = false;
      }
    };

    const recheckFeatures = async () => {
      if (cancelled || revokedRef.current || featureCheckInFlight) return;
      featureCheckInFlight = true;
      try {
        const nextFeatures = await fetchScreenFeatures();
        if (cancelled || revokedRef.current) return;
        setFeatures(nextFeatures);
        if (nextFeatures.configurationError || !nextFeatures.screenControlEnabled) {
          disabledByFlag = true;
          operationEpochRef.current++;
          stopTransport();
          setTransport('offline');
          setMessage(nextFeatures.configurationError ?? 'El control remoto fue deshabilitado por un administrador.');
          setPhase(nextFeatures.configurationError ? 'error' : 'local');
        } else if (disabledByFlag) {
          disabledByFlag = false;
          setRestartEpoch((value) => value + 1);
        }
      } catch {
        // A transient feature-discovery failure does not discard a valid paired session.
      } finally {
        featureCheckInFlight = false;
      }
    };

    const boot = async () => {
      try {
        const nextFeatures = await fetchScreenFeatures();
        if (cancelled || transportStopped) return;
        setFeatures(nextFeatures);
        if (nextFeatures.configurationError) {
          setMessage(nextFeatures.configurationError);
          setPhase('error');
          setTransport('offline');
          return;
        }
        if (!nextFeatures.screenControlEnabled || (allowLocalWithoutPairing && !nextFeatures.requirePairing)) {
          setPhase('local');
          return;
        }
        featureTimer = setInterval(recheckFeatures, SCREEN_FEATURE_POLL_INTERVAL_MS);
        setPhase('authenticating');
        let session = (await screenSupabase.auth.getSession()).data.session;
        if (cancelled || transportStopped) return;
        if (!session?.user?.is_anonymous) {
          const captchaToken = await requestScreenCaptchaToken(nextFeatures);
          if (cancelled || transportStopped) return;
          const signed = await screenSupabase.auth.signInAnonymously(captchaToken
            ? { options: { captchaToken } }
            : undefined);
          if (cancelled || transportStopped) return;
          if (signed.error) throw signed.error;
          session = signed.data.session;
        }
        if (!session?.access_token || !session.user.id) throw new Error('No se pudo crear la identidad anónima');
        accessTokenRef.current = session.access_token;
        authUserIdRef.current = session.user.id;

        if (typeof WebSocket !== 'undefined') {
          channel = screenSupabase.channel(`screen-device:${session.user.id}`)
            .on('postgres_changes', {
              event: '*', schema: 'public', table: 'screen_devices',
              filter: `auth_user_id=eq.${session.user.id}`,
            }, (payload) => { void applyRow(payload.new as ScreenDeviceRow); })
            .subscribe((status) => {
              if (cancelled || transportStopped || revokedRef.current) return;
              if (status === 'SUBSCRIBED') {
                setTransport('realtime');
                void selectAuthoritative();
              } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                setTransport('polling');
              }
            });
        }
        await selectAuthoritative();
        if (cancelled || transportStopped || revokedRef.current) return;
        pollTimer = setInterval(selectAuthoritative, SCREEN_STATE_POLL_INTERVAL_MS);
        heartbeatTimer = setInterval(async () => {
          const currentId = deviceIdRef.current;
          if (!currentId || cancelled || transportStopped || revokedRef.current) return;
          const heartbeatEpoch = operationEpochRef.current;
          const { error } = await screenSupabase.rpc('screen_device_heartbeat', {
            p_device_id: currentId,
            p_capabilities: deviceCapabilities(),
          });
          if (cancelled || transportStopped || revokedRef.current
            || heartbeatEpoch !== operationEpochRef.current) return;
          if (error) setTransport('polling');
        }, SCREEN_HEARTBEAT_INTERVAL_MS);
      } catch (error) {
        if (cancelled || transportStopped || revokedRef.current) return;
        if (allowLocalWithoutPairing) {
          setPhase('local');
          return;
        }
        setMessage(error instanceof Error ? error.message : 'No se pudo inicializar la pantalla');
        setPhase('error');
        setTransport('offline');
      }
    };
    void boot();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      operationEpochRef.current++;
      pendingPresentationAckRef.current = null;
      presentationAckInFlightRef.current = false;
      stopTransport();
      if (featureTimer) clearInterval(featureTimer);
      featureTimer = null;
      authListener.data.subscription.unsubscribe();
      if (terminateTransportRef.current === stopTransport) terminateTransportRef.current = () => {};
    };
  }, [allowLocalWithoutPairing, applyRow, beginPairing, handleRevocation, restartEpoch]);

  const restartPairing = useCallback(() => {
    const previousDeviceId = deviceIdRef.current;
    if (previousDeviceId) clearRemoteDeviceCaches(previousDeviceId);
    operationEpochRef.current++;
    appliedVersionRef.current = -1;
    latestObservedVersionRef.current = -1;
    revokedRef.current = false;
    deviceIdRef.current = '';
    hasScreenStateRef.current = false;
    pendingPresentationAckRef.current = null;
    presentationAckInFlightRef.current = false;
    setDevice(null);
    setConfig(null);
    configVersionRef.current = '';
    setScreenState(null);
    setPairing(null);
    setMessage(null);
    setPhase('checking');
    setRestartEpoch((value) => value + 1);
  }, []);

  return {
    phase,
    features,
    device,
    config,
    screenState,
    pairing,
    transport,
    message,
    restartPairing,
    acknowledgePresentationCommand,
  };
}
