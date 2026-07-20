import React, { useEffect, useMemo, useState } from 'react';
import { materializeTeamConfig, resolveTeamSettings } from '@camtom/shared';
import { Header } from '../components/Header';
import { TeamBoardPane } from '../components/TeamBoardPane';
import { BoardViewport } from '../components/BoardViewport';
import { useTeamSLA } from '../hooks/useTeamSLA';
import { DisplayRuntime, type DisplaySnapshot } from './display-runtime';
import { createXhrDisplayTransport } from './display-transport';
import { Button } from '../components/ui/Button';
import { Surface } from '../components/ui/Surface';
import { IconChefHat } from '../components/Icons';

export function pendingPresentationCommand(
  state: import('@camtom/shared').ScreenState,
  device: import('@camtom/shared').ScreenDevice,
) {
  return device.lastAppliedVersion < device.stateVersion ? state.presentationCommand : undefined;
}

function PairingScreen({ runtime, snapshot }: { runtime: DisplayRuntime; snapshot: DisplaySnapshot }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!snapshot.pairing) return undefined;
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [snapshot.pairing]);

  const seconds = snapshot.pairing
    ? Math.max(0, Math.ceil((Date.parse(snapshot.pairing.expiresAt) - Date.now()) / 1_000))
    : 0;
  const canRetry = snapshot.phase === 'error' || snapshot.phase === 'expired' || snapshot.phase === 'revoked';

  return (
    <main className="screen-pairing-shell" aria-live="polite">
      <Surface as="section" tone="raised" className="screen-pairing-card">
        <div className="pairing-hero-mark" aria-hidden="true">
          <IconChefHat size={38} />
        </div>
        <p className="screen-kicker">ESTACIÓN DE PANTALLA · CONEXIÓN SEGURA</p>
        {snapshot.phase === 'pairing' && snapshot.pairing ? (
          <>
            <h1>Prepará esta estación una sola vez</h1>
            <ol className="pairing-steps" aria-label="Pasos para vincular la pantalla">
              <li className="is-active"><span>1</span><strong>Abrí /control</strong><small>Desde tu laptop</small></li>
              <li><span>2</span><strong>Ingresá el código</strong><small>Se usa una sola vez</small></li>
              <li><span>3</span><strong>Guardá el favorito</strong><small>La TV se reconecta sola</small></li>
            </ol>
            <p className="pairing-instruction">Ingresá este código en el control de pantallas:</p>
            <div className="screen-pairing-code" aria-label={`Código ${snapshot.pairing.code.split('').join(' ')}`}>
              {snapshot.pairing.code}
            </div>
            <p className="pairing-expiry"><span aria-hidden="true">◷</span> Disponible por {seconds} segundos</p>
            <p className="pairing-note">Después guardá esta página como favorita. La dirección privada recupera el control al reiniciar la TV.</p>
            {snapshot.message && <p role="alert">{snapshot.message}</p>}
          </>
        ) : snapshot.phase === 'incompatible' ? (
          <>
            <h1>Navegador incompatible</h1>
            <p role="alert">{snapshot.message}</p>
            <p>La TV necesita JavaScript, DOM, XHR, variables CSS y HTTPS/TLS vigente.</p>
          </>
        ) : (
          <>
            <h1>{snapshot.phase === 'connecting' || snapshot.phase === 'initializing' ? 'Conectando…' : 'La pantalla necesita atención'}</h1>
            <p role={snapshot.message ? 'alert' : undefined}>{snapshot.message ?? 'Preparando la conexión segura.'}</p>
            {canRetry && <Button variant="primary" size="lg" type="button" onClick={() => runtime.restartPairing()}>Generar nueva vinculación</Button>}
          </>
        )}
        <details>
          <summary>Diagnóstico de compatibilidad</summary>
          <dl>
            <dt>Estado</dt><dd>{snapshot.phase}</dd>
            <dt>Protocolo</dt><dd>HTTPS + XHR v2</dd>
            <dt>XHR</dt><dd>{snapshot.capabilities.xhr ? 'disponible' : 'no disponible'}</dd>
            <dt>Variables CSS</dt><dd>{snapshot.capabilities.cssCustomProperties ? 'disponibles' : 'no disponibles'}</dd>
            <dt>Cookies</dt><dd>{snapshot.capabilities.cookies ? 'disponibles' : 'fallback en memoria'}</dd>
            <dt>Fetch</dt><dd>{snapshot.capabilities.fetch ? 'disponible (no requerido)' : 'no disponible (correcto)'}</dd>
            <dt>WebSocket</dt><dd>{snapshot.capabilities.webSocket ? 'disponible (no requerido)' : 'no disponible (correcto)'}</dd>
            <dt>Almacenamiento</dt><dd>{snapshot.capabilities.localStorage ? 'disponible (opcional)' : 'no disponible (no requerido)'}</dd>
          </dl>
        </details>
      </Surface>
    </main>
  );
}

export function TvDisplayApp({ runtime: suppliedRuntime }: { runtime?: DisplayRuntime }) {
  const runtime = useMemo(
    () => suppliedRuntime ?? new DisplayRuntime(createXhrDisplayTransport()),
    [suppliedRuntime],
  );
  const [snapshot, setSnapshot] = useState(() => runtime.current());

  useEffect(() => {
    const unsubscribe = runtime.subscribe(setSnapshot);
    runtime.start();
    return () => { unsubscribe(); runtime.stop(); };
  }, [runtime]);

  const teams = snapshot.config?.dashboard.teams ?? [];
  const settingsByTeam = useMemo(
    () => snapshot.config
      ? Object.fromEntries(teams.map((team) => [team.id, resolveTeamSettings(snapshot.config!, team.id)]))
      : {},
    [snapshot.config, teams],
  );
  const timers = useTeamSLA(snapshot.issues, settingsByTeam);

  if (snapshot.phase === 'revoked' || snapshot.phase === 'expired' || snapshot.phase === 'incompatible') {
    return <PairingScreen runtime={runtime} snapshot={snapshot} />;
  }

  if (!snapshot.config || !snapshot.screenState || !snapshot.device) {
    return <PairingScreen runtime={runtime} snapshot={snapshot} />;
  }

  const state = snapshot.screenState;
  const leftTeam = teams.find((team) => team.id === state.panes.left.teamId);
  const headerConfig = leftTeam ? materializeTeamConfig(snapshot.config, leftTeam.id) : snapshot.config;
  const title = snapshot.config.configV2?.global.title ?? snapshot.config.dashboard.title ?? 'Panel de Soporte Camtom';
  const updated = snapshot.lastUpdated
    ? new Date(snapshot.lastUpdated).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'sin datos';
  const offline = snapshot.phase === 'offline';
  const presentationCommand = pendingPresentationCommand(state, snapshot.device);
  const paneSummary = (teamId: string, view: 'board' | 'report') => {
    const count = snapshot.issues.filter((issue) => issue.team?.id === teamId).length;
    return `${view === 'report' ? 'Reporte' : 'Tablero'} · ${count} ticket${count === 1 ? '' : 's'}`;
  };

  return (
    <div className="app-shell tv-display-shell" key={state.reloadNonce ?? 'display-v2'}>
      <Header
        title={title}
        isMuted={state.muted !== false}
        isFriday={new Date().getDay() === 5}
        config={headerConfig}
        activeTeam={state.layout === 'single' ? leftTeam : undefined}
      />
      <main className="tv-display-main">
        {offline && (
          <div role="alert" className="tv-display-offline">
            Sin conexión — se conservan los últimos datos. Reintento en {Math.ceil(snapshot.nextPollMs / 1000)} s.
          </div>
        )}
        <div role="status" aria-live="polite" className="sync-status tv-sync-status">
          <span>{offline ? 'Reconectando' : 'Control remoto activo'} · Última actualización: {updated}</span>
          <span>v{snapshot.device.lastAppliedVersion}/{snapshot.device.stateVersion} · Protocolo {snapshot.device.protocolVersion ?? 2} · {snapshot.issues.length} tickets</span>
        </div>
        <BoardViewport
          layout={state.layout}
          leftLabel={leftTeam?.name ?? 'Panel izquierdo'}
          rightLabel={teams.find((team) => team.id === state.panes.right?.teamId)?.name}
          leftSummary={paneSummary(state.panes.left.teamId, state.panes.left.view)}
          rightSummary={paneSummary(state.panes.right.teamId, state.panes.right.view)}
          left={<TeamBoardPane
            paneId="left"
            pane={state.panes.left}
            teams={teams}
            settingsByTeam={settingsByTeam}
            config={snapshot.config}
            issues={snapshot.issues}
            timers={timers}
            metadata={null}
            loading={false}
            error={snapshot.message ?? null}
            readOnly
            compactPresentation={state.layout === 'split-vertical'}
            rotation={state.rotation ?? { enabled: true, intervalSeconds: 12, paused: false }}
            presentationCommand={presentationCommand}
            onChange={() => {}}
          />}
          right={state.layout === 'split-vertical' && state.panes.right ? (
            <TeamBoardPane
              paneId="right"
              pane={state.panes.right}
              teams={teams}
              settingsByTeam={settingsByTeam}
              config={snapshot.config}
              issues={snapshot.issues}
              timers={timers}
              metadata={null}
              loading={false}
              error={snapshot.message ?? null}
              readOnly
              compactPresentation
              rotation={state.rotation ?? { enabled: true, intervalSeconds: 12, paused: false }}
              presentationCommand={presentationCommand}
              onChange={() => {}}
            />
          ) : undefined}
        />
      </main>
    </div>
  );
}
