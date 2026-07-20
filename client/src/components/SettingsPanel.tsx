import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ConfigResponse,
  ConfigV2,
  DisplayOptions,
  KitchenPhrases,
  PriorityLabelConfig,
  SLAConfig,
  ScreenState,
  TeamDashboardSettings,
  ZoneLabels,
  createConfigV2,
  canonicalizeConfigV2,
  validateConfigV2,
} from '@camtom/shared';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { IconCheckmark, IconSettings, IconX } from './Icons';
import { GeneralTab } from './settings/GeneralTab';
import { TeamsTab } from './settings/TeamsTab';
import { DisplayTab } from './settings/DisplayTab';
import { SlaTab } from './settings/SlaTab';
import { LabelsTab } from './settings/LabelsTab';
import { SoundsTab } from './settings/SoundsTab';
import { ConfigAdminError, readAdminToken, updateServerConfig } from '../lib/config-admin';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useDialogFocus } from '../hooks/useDialogFocus';

type TabId = 'general' | 'teams' | 'display' | 'sla' | 'labels' | 'sounds';
type SettingsScope = 'Global' | 'Team' | 'Este navegador' | 'Mixto';
const TABS: { id: TabId; label: string; scope: SettingsScope }[] = [
  { id: 'general', label: 'General', scope: 'Mixto' },
  { id: 'teams', label: 'Pantalla', scope: 'Este navegador' },
  { id: 'display', label: 'Apariencia', scope: 'Team' },
  { id: 'sla', label: 'SLA', scope: 'Team' },
  { id: 'labels', label: 'Etiquetas', scope: 'Team' },
  { id: 'sounds', label: 'Audio', scope: 'Este navegador' },
];

interface SettingsPanelProps {
  config: ConfigResponse;
  screenState: ScreenState;
  onApplyConfig: (config: ConfigResponse) => void;
  onSavedConfig: (config: ConfigResponse) => void;
  onScreenStateChange: (state: ScreenState) => void;
  onClose: () => void;
}

export function buildConfigV2SaveBody(
  configV2: ConfigV2,
  expectedVersion: string,
): { configV2: ConfigV2; expectedVersion: string } {
  return { configV2: canonicalizeConfigV2(configV2), expectedVersion };
}

export function applyConfigV2Preview(config: ConfigResponse, configV2: ConfigV2): ConfigResponse {
  return { ...config, configV2 };
}

export interface ConfigMergeConflict {
  path: string[];
  base: unknown;
  local: unknown;
  remote: unknown;
}

export function threeWayMergeConfigV2(
  base: ConfigV2,
  draft: ConfigV2,
  latest: ConfigV2,
): { merged: ConfigV2; conflicts: ConfigMergeConflict[] } {
  const conflicts: ConfigMergeConflict[] = [];
  const merged = mergeConfigNode(base, draft, latest, [], conflicts) as ConfigV2;
  return { merged, conflicts };
}

export function resolveConfigMergeConflict(
  config: ConfigV2,
  conflict: ConfigMergeConflict,
  choice: 'local' | 'remote',
): ConfigV2 {
  const next = cloneValue(config);
  setValueAtPath(next as unknown as Record<string, unknown>, conflict.path, conflict[choice]);
  return next;
}

export function SettingsPanel({
  config,
  screenState,
  onApplyConfig,
  onSavedConfig,
  onScreenStateChange,
  onClose,
}: SettingsPanelProps) {
  const baseConfig = useRef(config).current;
  const dialogRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ general: null, teams: null, display: null, sla: null, labels: null, sounds: null });
  const baseV2 = useRef(canonicalizeConfigV2(config.configV2 ?? createConfigV2(config))).current;
  const savedConfigRef = useRef<ConfigResponse | null>(null);
  const [previewBase, setPreviewBase] = useState<ConfigResponse>(() => baseConfig);
  const teams = previewBase.dashboard.teams ?? [];
  const [draft, setDraft] = useState<ConfigV2>(() => baseV2);
  const [mergeBase, setMergeBase] = useState<ConfigV2>(() => baseV2);
  const [mergeConflicts, setMergeConflicts] = useState<ConfigMergeConflict[]>([]);
  const [observedVersion, setObservedVersion] = useState(config.version);
  const [conflictConfig, setConflictConfig] = useState<ConfigResponse | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState(
    screenState.panes.left.teamId || teams[0]?.id || '',
  );
  const [activeTab, setActiveTab] = useState<TabId>('teams');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState(readAdminToken);
  const [newMemberName, setNewMemberName] = useState('');
  const [editingSla, setEditingSla] = useState<SLAConfig | null>(null);
  const [slaValidation, setSlaValidation] = useState<string | null>(null);
  const [previewVolume, setPreviewVolume] = useState(0.5);
  const [localScreenState, setLocalScreenState] = useState(screenState);
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const settings = draft.teams[selectedTeamId] ?? baseV2.teams[selectedTeamId];
  const selectedName = teams.find((team) => team.id === selectedTeamId)?.name ?? 'Team';
  const dirty = useMemo(
    () => !configValuesEqual(draft, mergeBase),
    [draft, mergeBase],
  );
  const validationErrors = useMemo(
    () => validateConfigV2(draft, teams.map((team) => team.id)),
    [draft, teams],
  );
  const closeImmediately = useCallback(() => {
    onApplyConfig(savedConfigRef.current ?? baseConfig);
    onClose();
  }, [baseConfig, onApplyConfig, onClose]);
  const discardAndClose = useCallback(() => {
    closeImmediately();
  }, [closeImmediately]);
  const handleClose = useCallback(() => {
    if (dirty) setDiscardOpen(true);
    else closeImmediately();
  }, [closeImmediately, dirty]);
  useDialogFocus(dialogRef, handleClose, !discardOpen);

  useEffect(() => {
    onApplyConfig(applyConfigV2Preview(previewBase, draft));
  }, [draft, onApplyConfig, previewBase]);

  useEffect(() => {
    setEditingSla(null);
    setSlaValidation(null);
  }, [selectedTeamId]);

  useEffect(() => {
    if (!teams.some((team) => team.id === selectedTeamId) && teams[0]) {
      setSelectedTeamId(teams[0].id);
    }
  }, [selectedTeamId, teams]);

  const updateTeam = useCallback((patch: Partial<TeamDashboardSettings>) => {
    setDraft((current) => ({
      ...current,
      teams: {
        ...current.teams,
        [selectedTeamId]: { ...(current.teams[selectedTeamId] ?? baseV2.teams[selectedTeamId]), ...patch },
      },
    }));
  }, [baseV2.teams, selectedTeamId]);

  const priorityLabels = useMemo<Record<number, Partial<PriorityLabelConfig>>>(
    () => settings.priorityLabels,
    [settings.priorityLabels],
  );

  const addTeamMember = (name: string) => {
    const trimmed = name.trim();
    if (trimmed) updateTeam({ teamMembers: [...settings.teamMembers, trimmed] });
  };
  const removeTeamMember = (index: number) => {
    updateTeam({ teamMembers: settings.teamMembers.filter((_, current) => current !== index) });
  };
  const setPriority = (priority: number, field: keyof PriorityLabelConfig, value: string) => {
    updateTeam({
      priorityLabels: {
        ...settings.priorityLabels,
        [priority]: { ...settings.priorityLabels[priority], [field]: value },
      },
    });
  };
  const setPhrase = (key: keyof KitchenPhrases, value: string) => {
    updateTeam({ kitchenPhrases: { ...settings.kitchenPhrases, [key]: value } });
  };
  const setZone = (key: keyof ZoneLabels, value: string) => {
    updateTeam({ zoneLabels: { ...settings.zoneLabels, [key]: value } });
  };
  const setStateLabel = (state: string, field: 'label' | 'icon', value: string) => {
    updateTeam({ stateLabels: { ...settings.stateLabels, [state]: { ...settings.stateLabels[state], [field]: value } } });
  };
  const handleSaveSla = (sla: SLAConfig) => {
    if (!sla.label.trim() || sla.maxMinutes < 1 || sla.applicablePriorities.length === 0) {
      setSlaValidation('Completá etiqueta, minutos y al menos una prioridad');
      return;
    }
    updateTeam({ slas: settings.slas.map((item) => item.id === sla.id ? sla : item) });
    setEditingSla(null);
    setSlaValidation(null);
  };

  const handleSaveToServer = async () => {
    if (mergeConflicts.length > 0) {
      setSaveStatus('Error: Resolvé todos los conflictos antes de guardar');
      return;
    }
    if (!adminToken.trim()) {
      setShowAdminPrompt(true);
      setSaveStatus('Ingresá la clave administrativa para confirmar el guardado.');
      return;
    }
    const errors = validateConfigV2(draft, teams.map((team) => team.id));
    if (errors.length) {
      setSaveStatus(`Error: ${errors.join('; ')}`);
      return;
    }
    setSaving(true);
    setSaveStatus(null);
    try {
      const saved = await updateServerConfig(buildConfigV2SaveBody(draft, observedVersion), adminToken);
      const savedV2 = canonicalizeConfigV2(saved.configV2 ?? createConfigV2(saved));
      setDraft(savedV2);
      setMergeBase(savedV2);
      setMergeConflicts([]);
      setPreviewBase(saved);
      setObservedVersion(saved.version);
      setConflictConfig(null);
      savedConfigRef.current = saved;
      onSavedConfig(saved);
      onApplyConfig(saved);
      setSaveStatus('saved');
      setShowAdminPrompt(false);
    } catch (error) {
      if (error instanceof ConfigAdminError && error.status === 401) setAdminToken('');
      if (error instanceof ConfigAdminError && error.status === 409 && error.currentConfig) {
        setConflictConfig(error.currentConfig);
      }
      setSaveStatus(`Error: ${error instanceof Error ? error.message : 'No se pudo guardar'}`);
    } finally {
      setSaving(false);
    }
  };

  const selectTab = (id: TabId, focus = false) => {
    setActiveTab(id);
    if (focus) tabRefs.current[id]?.focus();
  };
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, id: TabId) => {
    const index = TABS.findIndex((tab) => tab.id === id);
    let next = index;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    selectTab(TABS[next].id, true);
  };

  const activeScope = TABS.find((tab) => tab.id === activeTab)?.scope ?? 'Team';
  const handleScreenStateChange = (state: ScreenState) => {
    setLocalScreenState(state);
    onScreenStateChange(state);
  };

  const handleResolveConflict = (conflict: ConfigMergeConflict, choice: 'local' | 'remote') => {
    setDraft((current) => resolveConfigMergeConflict(current, conflict, choice));
    setMergeConflicts((current) => {
      const path = conflict.path.join('.');
      const next = current.filter((item) => item.path.join('.') !== path);
      setSaveStatus(next.length > 0
        ? `Quedan ${next.length} conflicto(s) por resolver.`
        : 'Conflictos resueltos; revisá el borrador antes de guardar.');
      return next;
    });
  };

  return (
    <div className="settings-backdrop" onClick={(event) => { if (event.target === event.currentTarget) handleClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="settings-dialog" tabIndex={-1}>
        <div className="settings-header">
          <div><p className="screen-kicker">MISE EN PLACE</p><h2 id="settings-title"><IconSettings size={22} /> Configuración</h2></div>
          <Badge>{dirty ? 'Borrador sin guardar' : 'Todo guardado'}</Badge>
          <button aria-label="Cerrar configuración" onClick={handleClose}><IconX size={18} /></button>
        </div>
        <div className="settings-workspace">
          <nav role="tablist" aria-label="Secciones de configuración" aria-orientation="vertical" className="settings-tabs">
            {TABS.map((tab) => (
              <button
                ref={(element) => { tabRefs.current[tab.id] = element; }}
                id={`settings-tab-${tab.id}`}
                key={tab.id}
                role="tab"
                aria-label={tab.label}
                aria-selected={activeTab === tab.id}
                aria-controls={`settings-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, tab.id)}
              >
                <span>{tab.label}</span><small>{tab.scope}</small>
              </button>
            ))}
          </nav>
          <div id={`settings-panel-${activeTab}`} role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`} className="settings-content" tabIndex={0}>
            <div className="settings-section-heading">
              <div><span className={`settings-scope settings-scope--${activeScope.replace(' ', '-').toLowerCase()}`}>{activeScope}</span><strong>{activeScope === 'Team' ? selectedName : activeScope}</strong></div>
              <p>{activeScope === 'Global'
                ? 'Se aplica a todos los equipos.'
                : activeScope === 'Team'
                  ? 'Sólo cambia la experiencia de este team.'
                  : activeScope === 'Mixto'
                    ? `El título es Global; reporte e integrantes pertenecen a ${selectedName}.`
                    : 'Permanece en este navegador y no modifica otras pantallas.'}</p>
            </div>
            {validationErrors.length > 0 && (
              <div className="settings-validation" role="alert">
                <strong>Hay {validationErrors.length} ajuste(s) por revisar</strong>
                <ul>{validationErrors.slice(0, 4).map((error) => <li key={error}>{error}</li>)}</ul>
              </div>
            )}
          {activeTab === 'general' && (
            <GeneralTab
              title={draft.global.title}
              slaWindowHours={settings.report.slaWindowHours}
              reportEnabled={settings.report.enabled}
              teamMembers={settings.teamMembers}
              selectedTeamName={selectedName}
              newMemberName={newMemberName}
              setNewMemberName={setNewMemberName}
              addTeamMember={addTeamMember}
              removeTeamMember={removeTeamMember}
              onTitleChange={(title) => setDraft((current) => ({ ...current, global: { ...current.global, title } }))}
              onSlaWindowHoursChange={(slaWindowHours) => updateTeam({ report: { ...settings.report, slaWindowHours } })}
              onReportEnabledChange={(enabled) => updateTeam({ report: { ...settings.report, enabled } })}
            />
          )}
          {activeTab === 'teams' && (
            <TeamsTab
              teams={teams}
              selectedTeamId={selectedTeamId}
              settings={settings}
              screenState={localScreenState}
              onSelectTeam={setSelectedTeamId}
              onTeamChange={updateTeam}
              onScreenChange={handleScreenStateChange}
            />
          )}
          {activeTab === 'display' && (
            <DisplayTab
              displayOptions={settings.displayOptions}
              displayOrder={settings.displayOrder}
              onChange={(key, value) => updateTeam({ displayOptions: { ...settings.displayOptions, [key]: value } as DisplayOptions })}
              onDisplayOrderChange={(displayOrder) => updateTeam({
                displayOrder,
                displayOptions: { ...settings.displayOptions, columnOrder: displayOrder },
              })}
            />
          )}
          {activeTab === 'sla' && (
            <SlaTab
              slaRules={settings.slas}
              editingSla={editingSla}
              slaValidation={slaValidation}
              handleAddSla={() => {
                const next: SLAConfig = { id: `sla_${Date.now()}`, label: 'Nueva SLA', applicablePriorities: [1, 2], maxMinutes: 30, warningThresholds: { warming: .6, heating: .3, critical: .1 } };
                updateTeam({ slas: [...settings.slas, next] });
                setEditingSla(next);
              }}
              handleRemoveSla={(id) => updateTeam({ slas: settings.slas.filter((sla) => sla.id !== id) })}
              handleSaveSla={handleSaveSla}
              toggleSlaPriority={(sla, priority) => setEditingSla({
                ...sla,
                applicablePriorities: sla.applicablePriorities.includes(priority)
                  ? sla.applicablePriorities.filter((value) => value !== priority)
                  : [...sla.applicablePriorities, priority],
              })}
              setEditingSla={setEditingSla}
            />
          )}
          {activeTab === 'labels' && (
            <LabelsTab
              priorityLabels={priorityLabels}
              kitchenPhrases={settings.kitchenPhrases}
              zoneLabels={settings.zoneLabels}
              stateLabels={settings.stateLabels}
              setPriorityOverride={setPriority}
              setPhrase={setPhrase}
              setZone={setZone}
              setStateLabel={setStateLabel}
            />
          )}
          {activeTab === 'sounds' && (
            <SoundsTab
              previewVolume={previewVolume}
              setPreviewVolume={setPreviewVolume}
              handlePreviewSound={(name) => { try { (window as any).cuelume?.play(name); } catch {} }}
            />
          )}
          </div>
          <aside className="settings-preview" aria-label="Vista previa">
            <div className="settings-preview__screen">
              <div className="settings-preview__top"><span /><span /><span /></div>
              <strong>{draft.global.title}</strong>
              <div className={`settings-preview__layout ${localScreenState.layout}`}>
                <span>{teams.find((team) => team.id === localScreenState.panes.left.teamId)?.name ?? 'Panel izquierdo'}</span>
                {localScreenState.layout === 'split-vertical' && <span>{teams.find((team) => team.id === localScreenState.panes.right.teamId)?.name ?? 'Panel derecho'}</span>}
              </div>
            </div>
            <p>La pantalla local se guarda automáticamente; la configuración Global/Team permanece en borrador.</p>
          </aside>
        </div>
        {showAdminPrompt && <div className="settings-admin" role="group" aria-label="Autenticación administrativa">
          <label id="settings-admin-label" htmlFor="config-admin-token">Confirmá con la clave administrativa</label>
          <input id="config-admin-token" type="password" autoComplete="current-password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} autoFocus />
          <small>La clave se solicita únicamente al guardar y no forma parte del borrador.</small>
        </div>}
        {mergeConflicts.length > 0 && (
          <div className="settings-conflicts" role="alert" aria-label="Conflictos de configuración">
            <strong>Resolvé {mergeConflicts.length} conflicto(s) antes de guardar:</strong>
            {mergeConflicts.map((conflict) => (
              <div key={conflict.path.join('.')} className="settings-conflict-row">
                <code>{conflict.path.join('.')}</code>
                <Button variant="secondary" onClick={() => handleResolveConflict(conflict, 'remote')}>Usar cambio remoto</Button>
                <Button variant="secondary" onClick={() => handleResolveConflict(conflict, 'local')}>Usar mi cambio</Button>
              </div>
            ))}
          </div>
        )}
        <div className="settings-footer">
          {saveStatus && saveStatus !== 'saved' && <span role="alert">{saveStatus}</span>}
          {saveStatus === 'saved' && <Badge><IconCheckmark size={12} /> Guardado</Badge>}
          {conflictConfig && (
            <>
              <Button variant="secondary" onClick={() => {
                const latest = canonicalizeConfigV2(conflictConfig.configV2 ?? createConfigV2(conflictConfig));
                setDraft(latest);
                setMergeBase(latest);
                setMergeConflicts([]);
                setPreviewBase(conflictConfig);
                setObservedVersion(conflictConfig.version);
                onSavedConfig(conflictConfig);
                onApplyConfig(conflictConfig);
                setConflictConfig(null);
                setSaveStatus('Se cargó la última versión; tu borrador fue descartado.');
              }}>Cargar última versión</Button>
              <Button variant="secondary" onClick={() => {
                const latest = canonicalizeConfigV2(conflictConfig.configV2 ?? createConfigV2(conflictConfig));
                const result = threeWayMergeConfigV2(mergeBase, draft, latest);
                setDraft(result.merged);
                setMergeBase(latest);
                setMergeConflicts(result.conflicts);
                setPreviewBase(conflictConfig);
                setObservedVersion(conflictConfig.version);
                onSavedConfig(conflictConfig);
                onApplyConfig(applyConfigV2Preview(conflictConfig, result.merged));
                setConflictConfig(null);
                setSaveStatus(result.conflicts.length > 0
                  ? `Hay ${result.conflicts.length} conflicto(s) que requieren tu decisión.`
                  : 'Borrador rebasado sin conflictos; revisalo antes de guardar.');
              }}>Rebasar borrador</Button>
            </>
          )}
          <Button variant="secondary" onClick={handleClose}>Cerrar</Button>
          <Button variant="primary" onClick={handleSaveToServer} disabled={saving || mergeConflicts.length > 0 || validationErrors.length > 0}>
            {saving ? 'Guardando…' : 'Guardar en servidor'}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={discardOpen}
        title="¿Dejar la cocina como estaba?"
        description="Hay cambios Global/Team que todavía no fueron guardados. Si salís ahora, se descartarán."
        confirmLabel="Descartar cambios"
        destructive
        onCancel={() => setDiscardOpen(false)}
        onConfirm={discardAndClose}
      />
    </div>
  );
}

function mergeConfigNode(
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string[],
  conflicts: ConfigMergeConflict[],
): unknown {
  if (configValuesEqual(local, base)) return cloneValue(remote);
  if (configValuesEqual(remote, base)) return cloneValue(local);
  if (configValuesEqual(local, remote)) return cloneValue(local);
  if (isPlainRecord(base) || isPlainRecord(local) || isPlainRecord(remote)) {
    const baseRecord = isPlainRecord(base) ? base : {};
    const localRecord = isPlainRecord(local) ? local : {};
    const remoteRecord = isPlainRecord(remote) ? remote : {};
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(baseRecord), ...Object.keys(localRecord), ...Object.keys(remoteRecord)]);
    for (const key of keys) {
      const value = mergeConfigNode(baseRecord[key], localRecord[key], remoteRecord[key], [...path, key], conflicts);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  conflicts.push({
    path,
    base: cloneValue(base),
    local: cloneValue(local),
    remote: cloneValue(remote),
  });
  // Preserve the concurrent remote value until the user resolves this path.
  return cloneValue(remote);
}

function configValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => configValuesEqual(value, right[index]));
  }
  if (isPlainRecord(left) || isPlainRecord(right)) {
    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && configValuesEqual(left[key], right[key]));
  }
  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function setValueAtPath(root: Record<string, unknown>, path: string[], value: unknown): void {
  let current = root;
  for (const key of path.slice(0, -1)) {
    if (!isPlainRecord(current[key])) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  const leaf = path[path.length - 1];
  if (value === undefined) delete current[leaf];
  else current[leaf] = cloneValue(value);
}
