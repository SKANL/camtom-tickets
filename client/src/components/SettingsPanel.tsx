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
import { ConfigAdminError, readAdminToken, storeAdminToken, updateServerConfig } from '../lib/config-admin';

type TabId = 'general' | 'teams' | 'display' | 'sla' | 'labels' | 'sounds';
const TABS: { id: TabId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'teams', label: 'Teams y pantalla' },
  { id: 'display', label: 'Visual' },
  { id: 'sla', label: 'SLA' },
  { id: 'labels', label: 'Etiquetas' },
  { id: 'sounds', label: 'Sonidos' },
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
  return { configV2, expectedVersion };
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
  const baseV2 = useRef(config.configV2 ?? createConfigV2(config)).current;
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

  const settings = draft.teams[selectedTeamId] ?? baseV2.teams[selectedTeamId];
  const selectedName = teams.find((team) => team.id === selectedTeamId)?.name ?? 'Team';
  const handleClose = useCallback(() => {
    onApplyConfig(savedConfigRef.current ?? baseConfig);
    onClose();
  }, [baseConfig, onApplyConfig, onClose]);

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

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
      setSaveStatus('Error: Ingresá la clave de administración');
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
      const savedV2 = saved.configV2 ?? createConfigV2(saved);
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
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="settings-dialog">
        <div className="settings-header">
          <h2 id="settings-title"><IconSettings size={22} /> Configuración</h2>
          <button autoFocus aria-label="Cerrar configuración" onClick={handleClose}><IconX size={18} /></button>
        </div>
        <div className="settings-team-context">
          Editando: <strong>{selectedName}</strong>. General conserva branding; las demás opciones se guardan por team.
        </div>
        <div role="tablist" aria-label="Secciones de configuración" className="settings-tabs">
          {TABS.map((tab) => (
            <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {activeTab === 'general' && (
            <GeneralTab
              title={draft.global.title}
              slaWindowHours={settings.report.slaWindowHours}
              reportEnabled={settings.report.enabled}
              teamMembers={settings.teamMembers}
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
              screenState={screenState}
              onSelectTeam={setSelectedTeamId}
              onTeamChange={updateTeam}
              onScreenChange={onScreenStateChange}
            />
          )}
          {activeTab === 'display' && (
            <DisplayTab
              displayOptions={settings.displayOptions}
              displayOrder={settings.displayOrder}
              onChange={(key, value) => updateTeam({ displayOptions: { ...settings.displayOptions, [key]: value } as DisplayOptions })}
              onDisplayOrderChange={(displayOrder) => updateTeam({ displayOrder })}
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
        <div className="settings-admin">
          <label htmlFor="config-admin-token">Clave de administración</label>
          <input
            id="config-admin-token"
            type="password"
            autoComplete="current-password"
            value={adminToken}
            onChange={(event) => { setAdminToken(event.target.value); storeAdminToken(event.target.value); }}
          />
        </div>
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
                const latest = conflictConfig.configV2 ?? createConfigV2(conflictConfig);
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
                const latest = conflictConfig.configV2 ?? createConfigV2(conflictConfig);
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
          <Button variant="primary" onClick={handleSaveToServer} disabled={saving || mergeConflicts.length > 0}>
            {saving ? 'Guardando…' : 'Guardar en servidor'}
          </Button>
        </div>
      </div>
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
