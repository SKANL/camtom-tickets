import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScreenDevice, ScreenState, TeamBoardConfig } from '@camtom/shared';
import { EMPTY_FILTER, withoutPresentationCommand } from '@camtom/shared';
import { useConfig } from '../hooks/useConfig';
import { loadControlSelection, saveControlSelection } from '../lib/control-selection';
import {
  ScreenControlError,
  claimDisplayPairingV2,
  createControlSession,
  createRequestId,
  deleteControlSession,
  getControlSession,
  listDevices,
  replaceDisplayDeviceV2,
  revokeDevice,
  revokeDisplayDeviceV2,
  rotateDisplayCredentialV2,
  updateDevice,
} from '../lib/screen-control';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Button } from './ui/Button';

interface DeviceDraft {
  state: ScreenState;
  allowedTeamIds: string[];
}

type ControllerSession = 'checking' | 'authenticated' | 'anonymous';
type ControlHealth = 'online' | 'degraded' | 'offline' | 'replaced' | 'revoked';

export const CONTROL_REFRESH_INTERVAL_MS = 15_000;
export const CONTROL_ACK_REFRESH_INTERVAL_MS = 3_000;

export function controlRefreshInterval(pendingAckCount: number): number {
  return pendingAckCount > 0 ? CONTROL_ACK_REFRESH_INTERVAL_MS : CONTROL_REFRESH_INTERVAL_MS;
}

function initialState(teamIds: string[]): ScreenState {
  const left = teamIds[0] ?? '';
  const right = teamIds[1] ?? left;
  return {
    schemaVersion: 1,
    layout: teamIds.length > 1 ? 'split-vertical' : 'single',
    muted: false,
    rotation: { enabled: true, intervalSeconds: 12, paused: false },
    panes: {
      left: { teamId: left, view: 'board', filter: { ...EMPTY_FILTER } },
      right: { teamId: right, view: 'board', filter: { ...EMPTY_FILTER } },
    },
  };
}

function draftFor(device: ScreenDevice, teams: TeamBoardConfig[]): DeviceDraft {
  const configured = new Set(teams.map((team) => team.id));
  const allowed = device.allowedTeamIds.filter((id) => configured.has(id));
  return {
    allowedTeamIds: allowed,
    state: withoutPresentationCommand(device.desiredState ?? initialState(allowed)),
  };
}

export function pendingAckFeedback(device: ScreenDevice | undefined, version: number): { waiting: boolean; message: string } {
  if (!device) return { waiting: false, message: 'No confirmado: la pantalla ya no está disponible.' };
  if (device.supersededBy) return { waiting: false, message: 'No confirmado: la pantalla fue reemplazada antes del ACK.' };
  if (device.revokedAt) return { waiting: false, message: 'No confirmado: la pantalla fue revocada antes del ACK.' };
  if (device.lastAppliedVersion < version) return { waiting: true, message: `Esperando confirmación de la TV para v${version}.` };
  return { waiting: false, message: `Confirmado por la TV · aplicada v${device.lastAppliedVersion}` };
}

export function controlHealth(device: ScreenDevice): ControlHealth {
  if (device.supersededBy) return 'replaced';
  if (device.revokedAt) return 'revoked';
  if (device.health === 'online') return 'online';
  if (device.health === 'unstable') return 'degraded';
  return 'offline';
}

function capability(device: ScreenDevice, key: string): string {
  const value = device.capabilities?.[key];
  if (typeof value === 'string' && !value.trim()) return 'ninguno';
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : 'no informado';
}

export function ControlRoute() {
  const { config } = useConfig();
  const teams = config?.dashboard.teams ?? [];
  const [session, setSession] = useState<ControllerSession>('checking');
  const [tokenInput, setTokenInput] = useState('');
  const [devices, setDevices] = useState<ScreenDevice[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DeviceDraft>>({});
  const [pendingAckVersions, setPendingAckVersions] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>(loadControlSelection);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deviceFeedback, setDeviceFeedback] = useState<Record<string, string>>({});
  const [pairingOpen, setPairingOpen] = useState(true);
  const [expandedDevices, setExpandedDevices] = useState<string[]>([]);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'revoke' | 'rotate'; device: ScreenDevice } | null>(null);
  const [rotatedUrl, setRotatedUrl] = useState<{ deviceId: string; url: string } | null>(null);
  const [claim, setClaim] = useState({
    code: '', name: 'TV', allowedTeamIds: [] as string[], replacementForDeviceId: '',
  });
  const refreshGeneration = useRef(0);
  const latestAppliedRefresh = useRef(0);
  const hasPendingAcks = Object.keys(pendingAckVersions).length > 0;

  const endSession = useCallback(() => {
    latestAppliedRefresh.current = ++refreshGeneration.current;
    setSession('anonymous');
    setDevices([]);
    setDrafts({});
    setPendingAckVersions({});
    setRotatedUrl(null);
  }, []);

  const refresh = useCallback(async () => {
    if (session !== 'authenticated') return;
    const generation = ++refreshGeneration.current;
    setLoading(true);
    try {
      const next = await listDevices();
      if (generation < latestAppliedRefresh.current) return;
      latestAppliedRefresh.current = generation;
      setDevices(next);
      setPendingAckVersions((current) => {
        const pending: Record<string, number> = {};
        const feedback: Record<string, string> = {};
        for (const [id, version] of Object.entries(current)) {
          const outcome = pendingAckFeedback(next.find((candidate) => candidate.id === id), version);
          if (outcome.waiting) pending[id] = version;
          else feedback[id] = outcome.message;
        }
        if (Object.keys(feedback).length > 0) {
          setDeviceFeedback((existing) => ({ ...existing, ...feedback }));
        }
        return pending;
      });
      setDrafts((current) => Object.fromEntries(next.map((device) => [
        device.id,
        current[device.id] ?? draftFor(device, teams),
      ])));
      setMessage(null);
    } catch (error) {
      if (generation < latestAppliedRefresh.current) return;
      latestAppliedRefresh.current = generation;
      if (error instanceof ScreenControlError && error.status === 401) endSession();
      setMessage(error instanceof Error ? error.message : 'No se pudieron cargar las pantallas');
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, [endSession, session, teams]);

  useEffect(() => {
    let active = true;
    getControlSession()
      .then(() => { if (active) setSession('authenticated'); })
      .catch(() => { if (active) setSession('anonymous'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (session !== 'authenticated' || teams.length === 0) return undefined;
    void refresh();
    return undefined;
  }, [refresh, teams.length, session]);

  useEffect(() => {
    if (session !== 'authenticated' || teams.length === 0) return undefined;
    const interval = controlRefreshInterval(hasPendingAcks ? 1 : 0);
    let nextDeadline = Date.now() + interval;
    let timer: number | undefined;
    let active = true;

    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!active) return;
        void refresh();
        const now = Date.now();
        do nextDeadline += interval; while (nextDeadline <= now);
        schedule();
      }, Math.max(0, nextDeadline - Date.now()));
    };

    schedule();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [hasPendingAcks, refresh, teams.length, session]);

  useEffect(() => { saveControlSelection(selectedIds); }, [selectedIds]);

  const selectedDevices = useMemo(
    () => devices.filter((device) => selectedIds.includes(device.id) && !device.revokedAt && !device.supersededBy),
    [devices, selectedIds],
  );

  const login = async (event: FormEvent) => {
    event.preventDefault();
    const token = tokenInput.trim();
    if (!token) return;
    setLoading(true);
    try {
      await createControlSession(token);
      setTokenInput('');
      setSession('authenticated');
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'La clave administrativa no es válida');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try { await deleteControlSession(); } catch { /* an expired cookie is already logged out */ }
    endSession();
  };

  const claimScreen = async (event: FormEvent) => {
    event.preventDefault();
    if (!claim.allowedTeamIds.length) return setMessage('Elegí al menos un team');
    setLoading(true);
    const input = {
      code: claim.code.replace(/\D/g, ''),
      requestId: createRequestId(),
      name: claim.name,
      allowedTeamIds: claim.allowedTeamIds,
      desiredState: initialState(claim.allowedTeamIds),
    };
    try {
      const device = claim.replacementForDeviceId
        ? await replaceDisplayDeviceV2(claim.replacementForDeviceId, input)
        : await claimDisplayPairingV2(input);
      setClaim((current) => ({ ...current, code: '', replacementForDeviceId: '' }));
      setSelectedIds((current) => current.includes(device.id) ? current : [...current, device.id]);
      setMessage(claim.replacementForDeviceId
        ? 'Reemplazo preparado. La TV anterior se revocará sólo después del primer sync de la nueva.'
        : 'Pantalla vinculada. Guardá su URL permanente como favorito en la TV.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo vincular');
    } finally {
      setLoading(false);
    }
  };

  const changeDraft = (deviceId: string, recipe: (draft: DeviceDraft) => DeviceDraft) => {
    setDrafts((current) => ({ ...current, [deviceId]: recipe(current[deviceId]) }));
  };

  const apply = async (device: ScreenDevice) => {
    const draft = drafts[device.id];
    if (!draft) return;
    if (!draft.allowedTeamIds.length) {
      setMessage(`Elegí al menos un team permitido para ${device.name ?? 'la pantalla'}.`);
      return;
    }
    if (!draft.allowedTeamIds.includes(draft.state.panes.left.teamId)
      || !draft.allowedTeamIds.includes(draft.state.panes.right.teamId)) {
      setMessage(`Elegí explícitamente un team permitido para cada panel de ${device.name ?? 'la pantalla'}.`);
      return;
    }
    try {
      const updated = await updateDevice('', device.id, {
        desiredState: withoutPresentationCommand(draft.state),
        allowedTeamIds: draft.allowedTeamIds,
        expectedVersion: device.stateVersion,
        requestId: createRequestId(),
      });
      setDevices((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPendingAckVersions((current) => {
        const next = { ...current };
        if (updated.lastAppliedVersion < updated.stateVersion) next[updated.id] = updated.stateVersion;
        else delete next[updated.id];
        return next;
      });
      setDeviceFeedback((current) => ({ ...current, [device.id]: `Enviado v${updated.stateVersion}; esperando confirmación de la TV.` }));
      await refresh();
    } catch (error) {
      setDeviceFeedback((current) => ({ ...current, [device.id]: error instanceof Error ? error.message : 'No se pudo aplicar' }));
      await refresh();
    }
  };

  const applySelected = async () => {
    setLoading(true);
    try {
      for (const device of selectedDevices) await apply(device);
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (device: ScreenDevice) => {
    try {
      if (device.protocolVersion === 2) await revokeDisplayDeviceV2(device.id);
      else await revokeDevice('', device.id);
      setMessage('Pantalla revocada. Su URL permanente ya no puede autenticarse.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo revocar');
    }
  };

  const rotate = async (device: ScreenDevice) => {
    try {
      const result = await rotateDisplayCredentialV2(device.id);
      setRotatedUrl({
        deviceId: device.id,
        url: `${window.location.origin}/display#installation=${result.installationId}.${result.installationSecret}`,
      });
      setMessage('Credencial rotada. Actualizá AHORA el favorito de la TV con la URL mostrada; no se guardará en la laptop.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo rotar la credencial');
    }
  };

  const sendPresentationCommand = async (
    device: ScreenDevice,
    type: 'next' | 'previous' | 'restartRotation',
  ) => {
    const serverState = withoutPresentationCommand(
      device.desiredState ?? initialState(device.allowedTeamIds),
    );
    const state: ScreenState = {
      ...serverState,
      presentationCommand: { id: createRequestId(), type },
    };
    try {
      const updated = await updateDevice('', device.id, {
        desiredState: state,
        allowedTeamIds: device.allowedTeamIds,
        expectedVersion: device.stateVersion,
        requestId: createRequestId(),
      });
      setDevices((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPendingAckVersions((current) => ({ ...current, [updated.id]: updated.stateVersion }));
      const label = type === 'next' ? 'Siguiente página' : type === 'previous' ? 'Página anterior' : 'Rotación reiniciada';
      setDeviceFeedback((current) => ({ ...current, [device.id]: `${label} · enviado v${updated.stateVersion}` }));
      await refresh();
    } catch (error) {
      setDeviceFeedback((current) => ({ ...current, [device.id]: error instanceof Error ? error.message : 'No se pudo enviar el comando' }));
      await refresh();
    }
  };

  const healthCounts = useMemo(() => devices.reduce<Record<ControlHealth, number>>((counts, device) => {
    counts[controlHealth(device)] += 1;
    return counts;
  }, { online: 0, degraded: 0, offline: 0, replaced: 0, revoked: 0 }), [devices]);

  if (session === 'checking') {
    return <main className="control-shell"><section className="control-login"><h1>Recuperando sesión…</h1></section></main>;
  }

  if (session === 'anonymous') {
    return (
      <main className="control-shell">
        <form className="control-login" onSubmit={login}>
          <h1>Control de pantallas</h1>
          <p>La clave se intercambia por una cookie HttpOnly de 30 días y NUNCA se guarda en JavaScript.</p>
          {message && <div className="control-message" role="alert">{message}</div>}
          <label>Clave administrativa<input type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} autoComplete="current-password" /></label>
          <button type="submit" disabled={loading}>Entrar</button>
        </form>
      </main>
    );
  }

  return (
    <main className="control-shell">
      <header className="control-page-header">
        <div><p className="screen-kicker">PASE DE SERVICIO · CONTROL PERSISTENTE</p><h1>Pantallas</h1><p>Tu cocina audiovisual, lista para el turno.</p></div>
        <div className="control-actions">
          <button type="button" onClick={() => void refresh()} disabled={loading}>Actualizar</button>
          <button type="button" onClick={() => setPairingOpen((open) => !open)} aria-expanded={pairingOpen} aria-controls="pairing-wizard">{pairingOpen ? 'Cerrar asistente' : 'Vincular TV'}</button>
          <button type="button" onClick={() => void logout()}>Cerrar sesión</button>
        </div>
      </header>
      <section className="control-summary" aria-label="Resumen operativo">
        <div><strong>{devices.length}</strong><span>Pantallas</span></div>
        <div className="is-online"><strong>{healthCounts.online}</strong><span>Online</span></div>
        <div className="is-degraded"><strong>{healthCounts.degraded}</strong><span>Degraded</span></div>
        <div className="is-offline"><strong>{healthCounts.offline}</strong><span>Offline</span></div>
        <div><strong>{Object.keys(pendingAckVersions).length}</strong><span>Esperando ACK</span></div>
      </section>
      <p className="control-limitations">La selección guarda sólo IDs, nunca credenciales. Este panel controla el contenido web; no puede encender la TV, cambiar volumen ni operar el sistema.</p>
      {message && <div className="control-message" role="status">{message}</div>}

      {rotatedUrl && (
        <section className="control-secret" aria-label="Nueva URL permanente">
          <strong>Nueva URL permanente (se muestra sólo en esta sesión)</strong>
          <input readOnly value={rotatedUrl.url} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" onClick={() => setRotatedUrl(null)}>Ya actualicé el favorito</button>
        </section>
      )}

      <section id="pairing-wizard" className={`control-pairing ${pairingOpen ? 'is-open' : ''}`} aria-labelledby="pair-title">
        <button type="button" className="control-pairing__toggle" onClick={() => setPairingOpen((open) => !open)} aria-expanded={pairingOpen}>
          <span><small>ASISTENTE EN 3 PASOS</small><h2 id="pair-title">Vincular o reemplazar una pantalla</h2></span><span aria-hidden="true">{pairingOpen ? '−' : '+'}</span>
        </button>
        <form onSubmit={claimScreen} hidden={!pairingOpen}>
          <p className="pair-step"><b>1</b><span>Abrí <code>/display</code> en la TV y copiá el código.</span></p>
          <label>Código de 6 dígitos<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={claim.code} onChange={(event) => setClaim({ ...claim, code: event.target.value })} required /></label>
          <label>Nombre<input maxLength={80} value={claim.name} onChange={(event) => setClaim({ ...claim, name: event.target.value })} required /></label>
          <p className="pair-step"><b>2</b><span>Elegí si es una TV nueva o reemplaza otra.</span></p>
          <label>Reemplaza a<select value={claim.replacementForDeviceId} onChange={(event) => setClaim({ ...claim, replacementForDeviceId: event.target.value })}><option value="">Ninguna (nueva TV)</option>{devices.filter((device) => !device.revokedAt && !device.supersededBy).map((device) => <option key={device.id} value={device.id}>{device.name ?? device.id}</option>)}</select></label>
          <p className="pair-step"><b>3</b><span>Autorizá los teams que podrá mostrar.</span></p>
          <fieldset><legend>Teams permitidos</legend>{teams.map((team) => (
            <label key={team.id} className="control-check"><input type="checkbox" checked={claim.allowedTeamIds.includes(team.id)} onChange={() => setClaim((current) => ({ ...current, allowedTeamIds: current.allowedTeamIds.includes(team.id) ? current.allowedTeamIds.filter((id) => id !== team.id) : [...current.allowedTeamIds, team.id] }))} />{team.name}</label>
          ))}</fieldset>
          <button type="submit" disabled={loading}>{claim.replacementForDeviceId ? 'Preparar reemplazo' : 'Vincular'}</button>
        </form>
      </section>

      {selectedDevices.length > 0 && (
        <div className="control-selection-bar" role="region" aria-label="Acciones de pantallas seleccionadas">
          <span><strong>{selectedDevices.length}</strong> TV{selectedDevices.length === 1 ? '' : 's'} seleccionada{selectedDevices.length === 1 ? '' : 's'}</span>
          <button type="button" onClick={() => void applySelected()} disabled={loading}>Aplicar a seleccionadas ({selectedDevices.length})</button>
          <button type="button" onClick={() => setSelectedIds([])}>Limpiar selección</button>
        </div>
      )}

      <section className="control-device-grid" aria-label="Pantallas vinculadas">
        {devices.map((device, index) => {
          const draft = drafts[device.id] ?? draftFor(device, teams);
          const allowedTeams = teams.filter((team) => draft.allowedTeamIds.includes(team.id));
          const updateState = (state: ScreenState) => changeDraft(device.id, (current) => ({ ...current, state }));
          const health = controlHealth(device);
          const selected = selectedIds.includes(device.id);
          return (
            <article className={`control-device-card ${selected ? 'selected' : ''}`} key={device.id} aria-label={device.name ?? `TV ${index + 1}`}>
              <header><div><h2>{device.name ?? `TV ${index + 1}`}</h2><span className={`device-health ${health}`}>{health}</span></div><small>Enviada v{device.stateVersion} · aplicada v{device.lastAppliedVersion}{pendingAckVersions[device.id] ? ' · esperando ACK' : ''}</small></header>
              <div className="control-device-preview" aria-label={`Vista previa de ${draft.state.layout === 'single' ? 'una pantalla' : 'pantalla dividida'}`}>
                <span>{allowedTeams.find((team) => team.id === draft.state.panes.left.teamId)?.name ?? 'Sin team'}</span>
                {draft.state.layout === 'split-vertical' && <span>{allowedTeams.find((team) => team.id === draft.state.panes.right.teamId)?.name ?? 'Sin team'}</span>}
              </div>
              <label className="control-check control-target"><input type="checkbox" checked={selected} onChange={() => setSelectedIds((current) => current.includes(device.id) ? current.filter((id) => id !== device.id) : [...current, device.id])} />Controlar esta TV</label>
              {deviceFeedback[device.id] && <div className="device-feedback" role="status">{deviceFeedback[device.id]}</div>}
              {!device.revokedAt && !device.supersededBy && <>
                <div className="control-rotation-actions" aria-label="Navegación del contenido">
                  <button type="button" onClick={() => void sendPresentationCommand(device, 'previous')}>← Anterior</button>
                  <button type="button" onClick={() => void sendPresentationCommand(device, 'restartRotation')}>Reiniciar rotación</button>
                  <button type="button" onClick={() => void sendPresentationCommand(device, 'next')}>Siguiente →</button>
                </div>
                <details className="control-device-settings" open={expandedDevices.includes(device.id)} onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setExpandedDevices((current) => open ? [...new Set([...current, device.id])] : current.filter((id) => id !== device.id));
                }}>
                  <summary>Configurar contenido y equipos</summary>
                  <fieldset><legend>Teams permitidos</legend>{teams.map((team) => <label className="control-check" key={team.id}><input type="checkbox" checked={draft.allowedTeamIds.includes(team.id)} onChange={() => changeDraft(device.id, (current) => {
                  const nextAllowed = current.allowedTeamIds.includes(team.id) ? current.allowedTeamIds.filter((id) => id !== team.id) : [...current.allowedTeamIds, team.id];
                  return { ...current, allowedTeamIds: nextAllowed };
                })} />{team.name}</label>)}</fieldset>
                <label>Vista<select value={draft.state.layout} onChange={(event) => updateState({ ...draft.state, layout: event.target.value as ScreenState['layout'] })}><option value="single">Simple</option><option value="split-vertical">Dividida vertical</option></select></label>
                {(['left', 'right'] as const).map((pane) => <fieldset key={pane}><legend>{pane === 'left' ? 'Panel izquierdo' : `Panel derecho${draft.state.layout === 'single' ? ' (preconfiguración)' : ''}`}</legend>
                  <label>Team<select value={draft.state.panes[pane].teamId} onChange={(event) => updateState({ ...draft.state, panes: { ...draft.state.panes, [pane]: { ...draft.state.panes[pane], teamId: event.target.value } } })}>{allowedTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
                  <label>Contenido<select value={draft.state.panes[pane].view} onChange={(event) => updateState({ ...draft.state, panes: { ...draft.state.panes, [pane]: { ...draft.state.panes[pane], view: event.target.value as 'board' | 'report' } } })}><option value="board">Tablero</option><option value="report">Reporte</option></select></label>
                  <label>Buscar<input value={draft.state.panes[pane].filter.textSearch} onChange={(event) => updateState({ ...draft.state, panes: { ...draft.state.panes, [pane]: { ...draft.state.panes[pane], filter: { ...draft.state.panes[pane].filter, textSearch: event.target.value } } } })} /></label>
                  <label>Prioridades<input placeholder="1,2,3" value={draft.state.panes[pane].filter.priorities.join(',')} onChange={(event) => updateState({ ...draft.state, panes: { ...draft.state.panes, [pane]: { ...draft.state.panes[pane], filter: { ...draft.state.panes[pane].filter, priorities: event.target.value.split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 4) } } } })} /></label>
                </fieldset>)}
                  <div className="control-rotation-settings" role="group" aria-labelledby={`rotation-${device.id}`}><strong id={`rotation-${device.id}`}>Rotación automática</strong>
                    <label className="control-check"><input type="checkbox" checked={(draft.state.rotation ?? { enabled: true }).enabled} onChange={(event) => updateState({ ...draft.state, rotation: { ...(draft.state.rotation ?? { intervalSeconds: 12, paused: false }), enabled: event.target.checked } })} />Activada</label>
                    <label>Intervalo (segundos)<input type="number" min={5} max={300} value={draft.state.rotation?.intervalSeconds ?? 12} onChange={(event) => updateState({ ...draft.state, rotation: { ...(draft.state.rotation ?? { enabled: true, paused: false }), intervalSeconds: Math.max(5, Math.min(300, Number(event.target.value) || 12)) } })} /></label>
                    <label className="control-check"><input type="checkbox" checked={draft.state.rotation?.paused ?? false} onChange={(event) => updateState({ ...draft.state, rotation: { ...(draft.state.rotation ?? { enabled: true, intervalSeconds: 12 }), paused: event.target.checked } })} />Pausada</label>
                  </div>
                  <label className="control-check"><input type="checkbox" checked={draft.state.muted ?? false} onChange={(event) => updateState({ ...draft.state, muted: event.target.checked })} />Silenciar sonidos de la app</label>
                </details>
                <div className="control-card-footer"><span>{JSON.stringify(draft) === JSON.stringify(draftFor(device, teams)) ? 'Sin cambios pendientes' : 'Borrador pendiente'}</span><button type="button" onClick={() => void apply(device)}>Aplicar</button></div>
                <details className="control-advanced"><summary>Avanzado y diagnóstico</summary>
                  <dl className="device-diagnostics">
                    <dt>Último heartbeat</dt><dd>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('es-MX') : 'nunca'}</dd>
                    <dt>Protocolo</dt><dd>v{device.protocolVersion ?? 1}</dd>
                    <dt>Navegador</dt><dd>{capability(device, 'userAgent')}</dd>
                    <dt>Transporte</dt><dd>{device.protocolVersion === 2 ? 'HTTPS + XHR/polling' : 'Supabase v1'}</dd>
                    <dt>Último error</dt><dd>{capability(device, 'lastError')}</dd>
                  </dl>
                  <div className="control-actions"><button type="button" onClick={() => updateState({ ...draft.state, reloadNonce: createRequestId() })}>Preparar recarga interna</button>{device.protocolVersion === 2 && <button type="button" onClick={() => setConfirmAction({ kind: 'rotate', device })}>Rotar URL</button>}<button type="button" className="danger" onClick={() => setConfirmAction({ kind: 'revoke', device })}>Revocar</button></div>
                </details>
              </>}
            </article>
          );
        })}
      </section>
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.kind === 'revoke' ? '¿Retirar esta TV del servicio?' : '¿Cambiar la llave de esta TV?'}
        description={confirmAction?.kind === 'revoke'
          ? `${confirmAction.device.name ?? 'La pantalla'} dejará de recibir tickets inmediatamente.`
          : 'La URL favorita actual dejará de funcionar. Tendrás que guardar la nueva URL en la TV.'}
        confirmLabel={confirmAction?.kind === 'revoke' ? 'Revocar pantalla' : 'Rotar URL'}
        destructive
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (!action) return;
          if (action.kind === 'revoke') void revoke(action.device);
          else void rotate(action.device);
        }}
      />
    </main>
  );
}
