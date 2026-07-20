import React, { useEffect, useState } from 'react';
import App from '../App';
import { useRemoteScreen } from '../hooks/useRemoteScreen';

export function DisplayRoute({ legacyRoot = false }: { legacyRoot?: boolean }) {
  const remote = useRemoteScreen(legacyRoot);
  const [, setClock] = useState(0);

  useEffect(() => {
    if (!remote.pairing) return;
    const timer = setInterval(() => setClock((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [remote.pairing]);

  if (remote.phase === 'local') return <App />;
  if (remote.phase === 'paired' && remote.config && remote.screenState && remote.device) {
    const scope = `${remote.device.id}:${[...remote.device.allowedTeamIds].sort().join(',')}`;
    return (
      <App
        key={`${remote.screenState.reloadNonce ?? 'remote-screen'}:${scope}`}
        externalConfig={remote.config}
        controlledScreenState={remote.screenState}
        readOnlyDisplay
        issueCacheScope={`screen:${scope}`}
        remoteDiagnostic={`Control remoto ${remote.transport}`}
        onPresentationCommandHandled={remote.acknowledgePresentationCommand}
      />
    );
  }

  const seconds = remote.pairing
    ? Math.max(0, Math.ceil((Date.parse(remote.pairing.expiresAt) - Date.now()) / 1_000))
    : 0;

  return (
    <main className="screen-pairing-shell" aria-live="polite">
      <section className="screen-pairing-card">
        <p className="screen-kicker">PANTALLA CAMTOM</p>
        {remote.phase === 'pairing' && remote.pairing ? (
          <>
            <h1>Vinculá esta pantalla</h1>
            <p>En tu laptop abrí <strong>/control</strong> e ingresá este código:</p>
            <div className="screen-pairing-code" aria-label={`Código ${remote.pairing.code.split('').join(' ')}`}>
              {remote.pairing.code}
            </div>
            <p>Vence en {seconds} segundos. El código se usa una sola vez.</p>
            {seconds === 0 && <button onClick={remote.restartPairing}>Generar otro código</button>}
          </>
        ) : remote.phase === 'revoked' ? (
          <>
            <h1>Acceso revocado</h1>
            <p>Esta pantalla dejó de recibir tickets y comandos. Generá una nueva vinculación.</p>
            <button onClick={remote.restartPairing}>Volver a vincular</button>
          </>
        ) : remote.phase === 'error' ? (
          <>
            <h1>No se pudo conectar</h1>
            <p role="alert">{remote.message ?? 'Error desconocido'}</p>
            <button onClick={remote.restartPairing}>Reintentar vinculación</button>
          </>
        ) : (
          <>
            <h1>Preparando pantalla…</h1>
            <p>Autenticando el navegador y buscando su estado autorizado.</p>
          </>
        )}
        <details>
          <summary>Diagnóstico</summary>
          <dl>
            <dt>Modo</dt><dd>{remote.phase}</dd>
            <dt>Transporte</dt><dd>{remote.transport}</dd>
            <dt>WebSocket</dt><dd>{typeof WebSocket === 'undefined' ? 'no disponible; usando polling' : 'disponible'}</dd>
            <dt>Control de pantalla</dt><dd>{remote.features?.screenControlEnabled ? 'habilitado' : 'consultando'}</dd>
          </dl>
        </details>
      </section>
    </main>
  );
}
