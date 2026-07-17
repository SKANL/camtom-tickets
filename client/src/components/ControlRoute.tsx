import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { ScreenDevice, ScreenState, TeamBoardConfig } from '@camtom/shared';
import { EMPTY_FILTER } from '@camtom/shared';
import { useConfig } from '../hooks/useConfig';
import { readAdminToken, storeAdminToken } from '../lib/config-admin';
import {
  ScreenControlError,
  claimPairing,
  createRequestId,
  listDevices,
  revokeDevice,
  updateDevice,
} from '../lib/screen-control';

interface DeviceDraft {
  state: ScreenState;
  allowedTeamIds: string[];
}

function initialState(teamIds: string[]): ScreenState {
  const left = teamIds[0] ?? '';
  const right = teamIds[1] ?? left;
  return {
    schemaVersion: 1,
    layout: teamIds.length > 1 ? 'split-vertical' : 'single',
    muted: false,
    panes: {
      left: { teamId: left, view: 'board', filter: { ...EMPTY_FILTER } },
      right: { teamId: right, view: 'board', filter: { ...EMPTY_FILTER } },
    },
  };
}

function draftFor(device: ScreenDevice, teams: TeamBoardConfig[]): DeviceDraft {
  const configured = new Set(teams.map((team) => team.id));
  const allowed = device.allowedTeamIds.filter((id) => configured.has(id));
  const safeAllowed = allowed.length ? allowed : teams.slice(0, 2).map((team) => team.id);
  return {
    allowedTeamIds: safeAllowed,
    state: device.desiredState ?? initialState(safeAllowed),
  };
}

export function ControlRoute() {
  const { config } = useConfig();
  const teams = config?.dashboard.teams ?? [];
  const [token, setToken] = useState(readAdminToken());
  const [tokenInput, setTokenInput] = useState(token);
  const [devices, setDevices] = useState<ScreenDevice[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DeviceDraft>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [claim, setClaim] = useState({ code: '', name: 'TV', allowedTeamIds: [] as string[] });

  const refresh = useCallback(async (activeToken = token) => {
    if (!activeToken) return;
    setLoading(true);
    try {
      const next = await listDevices(activeToken);
      setDevices(next);
      setDrafts((current) => Object.fromEntries(next.map((device) => [
        device.id,
        current[device.id] ?? draftFor(device, teams),
      ])));
      setMessage(null);
    } catch (error) {
      if (error instanceof ScreenControlError && error.status === 401) {
        storeAdminToken('');
        setToken('');
      }
      setMessage(error instanceof Error ? error.message : 'No se pudieron cargar las pantallas');
    } finally {
      setLoading(false);
    }
  }, [teams, token]);

  useEffect(() => {
    if (!token || teams.length === 0) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [refresh, teams.length, token]);

  useEffect(() => {
    if (claim.allowedTeamIds.length === 0 && teams.length) {
      setClaim((current) => ({ ...current, allowedTeamIds: teams.slice(0, 2).map((team) => team.id) }));
    }
  }, [claim.allowedTeamIds.length, teams]);

  const activeDevices = useMemo(() => devices.filter((device) => !device.revokedAt), [devices]);

  const login = (event: FormEvent) => {
    event.preventDefault();
    const next = tokenInput.trim();
    storeAdminToken(next);
    setToken(next);
  };

  const claimScreen = async (event: FormEvent) => {
    event.preventDefault();
    if (!claim.allowedTeamIds.length) return setMessage('Elegí al menos un team');
    setLoading(true);
    try {
      await claimPairing(token, {
        ...claim,
        code: claim.code.replace(/\D/g, ''),
        requestId: createRequestId(),
        desiredState: initialState(claim.allowedTeamIds),
      });
      setClaim((current) => ({ ...current, code: '' }));
      setMessage('Pantalla vinculada. Ya puede recibir estado y tickets autorizados.');
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
    try {
      const updated = await updateDevice(token, device.id, {
        desiredState: draft.state,
        allowedTeamIds: draft.allowedTeamIds,
        expectedVersion: device.stateVersion,
        requestId: createRequestId(),
      });
      setDevices((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(`Estado v${updated.stateVersion} enviado a ${updated.name ?? 'pantalla'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo aplicar');
      await refresh();
    }
  };

  const applyBoth = async () => {
    setLoading(true);
    const targets = activeDevices.slice(0, 2);
    for (const device of targets) await apply(device);
    setLoading(false);
  };

  const revoke = async (device: ScreenDevice) => {
    if (!window.confirm(`¿Revocar ${device.name ?? 'esta pantalla'}? Dejará de recibir tickets inmediatamente.`)) return;
    try {
      await revokeDevice(token, device.id);
      setMessage('Pantalla revocada. En la TV elegí “Volver a vincular” para generar otro código.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo revocar');
    }
  };

  if (!token) {
    return (
      <main className="control-shell">
        <form className="control-login" onSubmit={login}>
          <h1>Control de pantallas</h1>
          <p>Usá la clave administrativa existente. Se conserva sólo durante esta sesión del navegador.</p>
          <label>Clave administrativa<input type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} autoComplete="current-password" /></label>
          <button type="submit">Entrar</button>
        </form>
      </main>
    );
  }

  return (
    <main className="control-shell">
      <header className="control-page-header">
        <div><p className="screen-kicker">CONTROL DE ESTADO DE LA APP</p><h1>Pantallas</h1></div>
        <div className="control-actions">
          <button onClick={() => void refresh()} disabled={loading}>Actualizar</button>
          <button onClick={() => void applyBoth()} disabled={loading || activeDevices.length < 2}>Aplicar a TV1 y TV2</button>
          <button onClick={() => { storeAdminToken(''); setToken(''); }}>Cerrar sesión</button>
        </div>
      </header>
      <p className="control-limitations">Este panel controla vistas, teams, filtros, mute y recarga interna. No controla energía, volumen, pestañas ni funciones del sistema operativo.</p>
      {message && <div className="control-message" role="status">{message}</div>}

      <section className="control-pairing" aria-labelledby="pair-title">
        <h2 id="pair-title">Vincular otra pantalla</h2>
        <form onSubmit={claimScreen}>
          <label>Código de 6 dígitos<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={claim.code} onChange={(event) => setClaim({ ...claim, code: event.target.value })} required /></label>
          <label>Nombre<input maxLength={80} value={claim.name} onChange={(event) => setClaim({ ...claim, name: event.target.value })} required /></label>
          <fieldset><legend>Teams permitidos</legend>{teams.map((team) => (
            <label key={team.id} className="control-check"><input type="checkbox" checked={claim.allowedTeamIds.includes(team.id)} onChange={() => setClaim((current) => ({ ...current, allowedTeamIds: current.allowedTeamIds.includes(team.id) ? current.allowedTeamIds.filter((id) => id !== team.id) : [...current.allowedTeamIds, team.id] }))} />{team.name}</label>
          ))}</fieldset>
          <button type="submit" disabled={loading}>Vincular</button>
        </form>
      </section>

      <section className="control-device-grid" aria-label="Pantallas vinculadas">
        {devices.map((device, index) => {
          const draft = drafts[device.id] ?? draftFor(device, teams);
          const allowedTeams = teams.filter((team) => draft.allowedTeamIds.includes(team.id));
          const updateState = (state: ScreenState) => changeDraft(device.id, (current) => ({ ...current, state }));
          return (
            <article className="control-device-card" key={device.id} aria-label={device.name ?? `TV ${index + 1}`}>
              <header><div><h2>{device.name ?? `TV ${index + 1}`}</h2><span className={`device-health ${device.health}`}>{device.revokedAt ? 'revocada' : device.health}</span></div><small>Deseada v{device.stateVersion} · aplicada v{device.lastAppliedVersion}</small></header>
              {device.lastSeenAt && <p>Última señal: {new Date(device.lastSeenAt).toLocaleString('es-MX')}</p>}
              {!device.revokedAt && <>
                <fieldset><legend>Teams permitidos</legend>{teams.map((team) => <label className="control-check" key={team.id}><input type="checkbox" checked={draft.allowedTeamIds.includes(team.id)} onChange={() => changeDraft(device.id, (current) => {
                  const nextAllowed = current.allowedTeamIds.includes(team.id) ? current.allowedTeamIds.filter((id) => id !== team.id) : [...current.allowedTeamIds, team.id];
                  if (!nextAllowed.length) return current;
                  const fallback = nextAllowed[0];
                  return { allowedTeamIds: nextAllowed, state: { ...current.state, panes: { left: { ...current.state.panes.left, teamId: nextAllowed.includes(current.state.panes.left.teamId) ? current.state.panes.left.teamId : fallback }, right: { ...current.state.panes.right, teamId: nextAllowed.includes(current.state.panes.right.teamId) ? current.state.panes.right.teamId : fallback } } } };
                })} />{team.name}</label>)}</fieldset>
                <label>Vista<select value={draft.state.layout} onChange={(event) => updateState({ ...draft.state, layout: event.target.value as ScreenState['layout'] })}><option value="single">Simple</option><option value="split-vertical">Dividida vertical</option></select></label>
                {(['left', 'right'] as const).map((pane) => <fieldset key={pane} disabled={pane === 'right' && draft.state.layout === 'single'}><legend>{pane === 'left' ? 'Panel izquierdo' : 'Panel derecho'}</legend>
                  <label>Team<select value={draft.state.panes[pane].teamId} onChange={(event) => updateState({ ...draft.state, panes: { ...draft.state.panes, [pane]: { ...draft.state.panes[pane], teamId: event.target.value } } })}>{allowedTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
                  <label>Contenido<select value={draft.state.panes[pane].view} onChange={(event) => updateState({ ...draft.state, panes: { ...draft.state.panes, [pane]: { ...draft.state.panes[pane], view: event.target.value as 'board' | 'report' } } })}><option value="board">Tablero</option><option value="report">Reporte</option></select></label>
                  <label>Buscar<input value={draft.state.panes[pane].filter.textSearch} onChange={(event) => updateState({ ...draft.state, panes: { ...draft.state.panes, [pane]: { ...draft.state.panes[pane], filter: { ...draft.state.panes[pane].filter, textSearch: event.target.value } } } })} /></label>
                  <label>Prioridades<input placeholder="1,2,3" value={draft.state.panes[pane].filter.priorities.join(',')} onChange={(event) => updateState({ ...draft.state, panes: { ...draft.state.panes, [pane]: { ...draft.state.panes[pane], filter: { ...draft.state.panes[pane].filter, priorities: event.target.value.split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 4) } } } })} /></label>
                </fieldset>)}
                <label className="control-check"><input type="checkbox" checked={draft.state.muted ?? false} onChange={(event) => updateState({ ...draft.state, muted: event.target.checked })} />Silenciar sonidos de la app</label>
                <div className="control-actions"><button onClick={() => void apply(device)}>Aplicar</button><button onClick={() => updateState({ ...draft.state, reloadNonce: createRequestId() })}>Preparar recarga interna</button><button className="danger" onClick={() => void revoke(device)}>Revocar / volver a vincular</button></div>
              </>}
            </article>
          );
        })}
      </section>
    </main>
  );
}
