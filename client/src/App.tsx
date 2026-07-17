import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ConfigResponse,
  ScreenState,
  TeamDashboardSettings,
  materializeTeamConfig,
  resolveTeamSettings,
} from '@camtom/shared';
import { Header } from './components/Header';
import { SettingsPanel } from './components/SettingsPanel';
import { TeamBoardPane } from './components/TeamBoardPane';
import { useConfig } from './hooks/useConfig';
import { useIssues } from './hooks/useIssues';
import { useMetadata } from './hooks/useMetadata';
import { useScreenState } from './hooks/useScreenState';
import { useSound } from './hooks/useSound';
import { useTeamSLA } from './hooks/useTeamSLA';
import { buildAlertSnapshot, diffAlerts, loadAlertMemory, saveAlertMemory } from './lib/alerts';

interface AppProps {
  externalConfig?: ConfigResponse;
  controlledScreenState?: ScreenState;
  readOnlyDisplay?: boolean;
  issueCacheScope?: string;
  remoteDiagnostic?: string;
}

function App({
  externalConfig,
  controlledScreenState,
  readOnlyDisplay = false,
  issueCacheScope = 'legacy',
  remoteDiagnostic,
}: AppProps = {}) {
  const [showSettings, setShowSettings] = useState(false);
  const [previewConfig, setPreviewConfig] = useState<ConfigResponse | null>(null);
  const { config: serverConfig, loading: serverConfigLoading, adoptConfig } = useConfig(!externalConfig);
  const configLoading = externalConfig ? false : serverConfigLoading;
  const activeConfig = externalConfig ?? serverConfig;
  const config = previewConfig ?? activeConfig;
  const { issues, loading: issuesLoading, error, lastUpdated, connection } = useIssues(issueCacheScope);
  const { catalog: metadata } = useMetadata(!readOnlyDisplay);
  const sound = useSound();

  const teams = config?.dashboard.teams ?? [];
  const teamIds = useMemo(() => teams.map((team) => team.id), [teams]);
  const { state: localScreenState, setState: setLocalScreenState, updatePane: updateLocalPane } = useScreenState(
    teamIds,
    config?.dashboard.activeTeamId,
  );
  const screenState = controlledScreenState ?? localScreenState;
  const setScreenState = controlledScreenState ? (() => {}) : setLocalScreenState;
  const updatePane = controlledScreenState ? (() => {}) : updateLocalPane;
  const settingsByTeam = useMemo<Record<string, TeamDashboardSettings>>(
    () => config
      ? Object.fromEntries(teamIds.map((teamId) => [teamId, resolveTeamSettings(config, teamId)]))
      : {},
    [config, teamIds],
  );
  const timers = useTeamSLA(issues, settingsByTeam);
  const alertMemory = useRef(loadAlertMemory(issueCacheScope));

  useEffect(() => {
    alertMemory.current = loadAlertMemory(issueCacheScope);
  }, [issueCacheScope]);

  useEffect(() => {
    if (typeof screenState.muted === 'boolean') sound.setMuted(screenState.muted);
  }, [screenState.muted, sound.setMuted]);

  const visibleTeamIds = useMemo(() => {
    const ids = [screenState.panes.left.teamId];
    if (screenState.layout === 'split-vertical' && screenState.panes.right?.teamId) {
      ids.push(screenState.panes.right.teamId);
    }
    return [...new Set(ids)];
  }, [screenState]);

  useEffect(() => {
    if (issuesLoading || !config) return;
    const snapshot = buildAlertSnapshot(issues, settingsByTeam, timers);
    const actions = diffAlerts(alertMemory.current, snapshot, visibleTeamIds);
    alertMemory.current = actions.next;
    saveAlertMemory(actions.next, issueCacheScope);
    if (actions.arrival) sound.playNewUrgent();
    if (actions.breach) sound.playBreach();
    else if (actions.warning) sound.playWarning();
    if (actions.success) sound.playSuccess();
  }, [issues, issuesLoading, config, visibleTeamIds, settingsByTeam, timers, sound, issueCacheScope]);

  useEffect(() => {
    import('cuelume').then((mod) => mod.bind()).catch(() => {});
  }, []);

  const leftTeam = teams.find((team) => team.id === screenState.panes.left.teamId);
  const headerConfig = config && leftTeam ? materializeTeamConfig(config, leftTeam.id) : config;
  const isFriday = new Date().getDay() === 5;
  const title = config?.configV2?.global.title ?? config?.dashboard.title ?? 'Panel de Soporte Camtom';
  const syncLabel = connection === 'live' ? 'En vivo' : connection === 'reconnecting' ? 'Reconectando' : 'Conectando';
  const updatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'sin datos aún';
  const ready = !!config && teams.length > 0 && !!settingsByTeam[screenState.panes.left.teamId];

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', width: '100vw', overflow: 'hidden' }}>
      <Header
        title={title}
        isMuted={sound.isMuted}
        onToggleMute={sound.toggleMute}
        isFriday={isFriday}
        config={headerConfig}
        activeTeam={screenState.layout === 'single' ? leftTeam : undefined}
        onOpenSettings={readOnlyDisplay ? undefined : () => setShowSettings(true)}
      />
      <main style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {error && (
          <div role="alert" style={{ background: 'var(--color-ketchup)', color: '#fff', padding: '6px var(--space-lg)', textAlign: 'center', flexShrink: 0 }}>
            Problema de conexión — mostrando los últimos datos. {error}
          </div>
        )}
        <div role="status" aria-live="polite" className="sync-status" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px var(--space-lg)', background: 'rgba(0,0,0,0.22)', color: 'rgba(255,255,255,0.65)', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
          <span>{syncLabel} · Última actualización: {updatedLabel}</span>
          <span>{remoteDiagnostic ? `${remoteDiagnostic} · ` : ''}{screenState.layout === 'split-vertical' ? 'Vista dividida' : 'Vista simple'} · {issues.length} tickets sincronizados</span>
        </div>
        {ready && config ? (
          <div className={`board-viewport ${screenState.layout}`}>
            <TeamBoardPane
              paneId="left"
              pane={screenState.panes.left}
              teams={teams}
              settingsByTeam={settingsByTeam}
              config={config}
              issues={issues}
              timers={timers}
              metadata={metadata}
              loading={issuesLoading || configLoading}
              error={error}
              readOnly={readOnlyDisplay}
              onChange={(update) => updatePane('left', update)}
            />
            {screenState.layout === 'split-vertical' && screenState.panes.right && (
              <TeamBoardPane
                paneId="right"
                pane={screenState.panes.right}
                teams={teams}
                settingsByTeam={settingsByTeam}
                config={config}
                issues={issues}
                timers={timers}
                metadata={metadata}
                loading={issuesLoading || configLoading}
                error={error}
                readOnly={readOnlyDisplay}
                onChange={(update) => updatePane('right', update)}
              />
            )}
          </div>
        ) : (
          <div role="status" style={{ padding: 'var(--space-xl)', color: 'rgba(255,255,255,.65)' }}>
            {configLoading ? 'Cargando configuración…' : 'No hay teams válidos configurados.'}
          </div>
        )}
      </main>

      {!readOnlyDisplay && showSettings && activeConfig && (
        <SettingsPanel
          config={activeConfig}
          screenState={screenState}
          onApplyConfig={setPreviewConfig}
          onSavedConfig={adoptConfig}
          onScreenStateChange={setScreenState}
          onClose={() => {
            setPreviewConfig(null);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

export default App;
