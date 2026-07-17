import {
  ConfigResponse,
  ConfigV2,
  DashboardConfig,
  DisplayOptions,
  FilterState,
  ScreenState,
  TeamBoardConfig,
  TeamDashboardSettings,
  ZoneLabels,
} from './types';

export const EMPTY_FILTER: FilterState = {
  projects: [],
  assignees: [],
  states: [],
  labels: [],
  priorities: [],
  textSearch: '',
  excludeStates: [],
};

const DEFAULT_ZONES: ZoneLabels = { new: 'Sin tomar', active: 'En progreso', done: 'Servidos hoy' };

export function createConfigV2(config: Pick<ConfigResponse, 'dashboard' | 'slas'>): ConfigV2 {
  const teams = Object.fromEntries(
    (config.dashboard.teams ?? []).map((team) => [
      team.id,
      legacySettings(config.dashboard, config.slas, team),
    ]),
  );
  return {
    schemaVersion: 2,
    global: {
      title: config.dashboard.title,
      pollingInterval: config.dashboard.pollingInterval,
    },
    teams,
  };
}

export function resolveTeamSettings(config: ConfigResponse, teamId: string): TeamDashboardSettings {
  const v2 = config.configV2 ?? createConfigV2(config);
  const team = (config.dashboard.teams ?? []).find((candidate) => candidate.id === teamId);
  const settings = v2.teams[teamId] ?? legacySettings(config.dashboard, config.slas, team);
  return cloneSettings(settings);
}

export function materializeTeamConfig(config: ConfigResponse, teamId: string): ConfigResponse {
  const settings = resolveTeamSettings(config, teamId);
  return {
    ...config,
    slas: settings.slas,
    dashboard: {
      ...config.dashboard,
      title: config.configV2?.global.title ?? config.dashboard.title,
      pollingInterval: config.configV2?.global.pollingInterval ?? config.dashboard.pollingInterval,
      teamMembers: settings.teamMembers,
      displayOrder: settings.displayOrder,
      priorityLabels: settings.priorityLabels,
      stateLabels: settings.stateLabels,
      report: settings.report,
      kitchenPhrases: settings.kitchenPhrases,
      zoneLabels: settings.zoneLabels,
      displayOptions: settings.displayOptions,
    },
  };
}

export function validateConfigV2(value: unknown, configuredTeamIds?: readonly string[]): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['configV2 must be an object'];
  if (value.schemaVersion !== 2) errors.push('configV2.schemaVersion must equal 2');
  if (!isRecord(value.global)) errors.push('configV2.global must be an object');
  else {
    if (Object.keys(value.global).some((key) => !['title', 'pollingInterval'].includes(key))) {
      errors.push('configV2.global contains unknown fields');
    }
    if (typeof value.global.title !== 'string' || !value.global.title.trim()) errors.push('configV2.global.title is required');
    if (!isPositiveInt(value.global.pollingInterval)) errors.push('configV2.global.pollingInterval must be a positive integer');
  }
  if (!isRecord(value.teams)) errors.push('configV2.teams must be an object');
  else {
    const ids = Object.keys(value.teams);
    if (configuredTeamIds) {
      const expected = [...configuredTeamIds].sort();
      const actual = [...ids].sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        errors.push('configV2.teams must contain exactly the configured dashboard teams');
      }
    }
    for (const [teamId, settings] of Object.entries(value.teams)) {
      if (!teamId || teamId !== teamId.trim()) errors.push('configV2 team IDs must be non-empty and trimmed');
      errors.push(...validateTeamSettings(settings, `configV2.teams.${teamId}`));
    }
  }
  return errors;
}

export function validateScreenState(value: unknown, configuredTeamIds?: readonly string[]): string[] {
  if (!isRecord(value)) return ['screen state must be an object'];
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push('screen state schemaVersion must equal 1');
  if (value.layout !== 'single' && value.layout !== 'split-vertical') errors.push('screen layout is invalid');
  if (value.muted !== undefined && typeof value.muted !== 'boolean') errors.push('screen muted must be boolean');
  if (value.reloadNonce !== undefined
    && (typeof value.reloadNonce !== 'string' || value.reloadNonce.length > 100)) {
    errors.push('screen reloadNonce is invalid');
  }
  if (!isRecord(value.panes)) return [...errors, 'screen panes must be an object'];
  errors.push(...validatePane(value.panes.left, 'left', configuredTeamIds));
  errors.push(...validatePane(value.panes.right, 'right', configuredTeamIds));
  return errors;
}

function validatePane(value: unknown, name: string, teamIds?: readonly string[]): string[] {
  if (!isRecord(value)) return [`screen ${name} pane must be an object`];
  const errors: string[] = [];
  if (typeof value.teamId !== 'string' || !value.teamId) errors.push(`screen ${name} teamId is required`);
  else if (teamIds && !teamIds.includes(value.teamId)) errors.push(`screen ${name} teamId is not configured`);
  if (value.view !== 'board' && value.view !== 'report') errors.push(`screen ${name} view is invalid`);
  if (!isFilter(value.filter)) errors.push(`screen ${name} filter is invalid`);
  return errors;
}

function validateTeamSettings(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const errors: string[] = [];
  if (value.filter !== 'ticket-label' && value.filter !== 'active-states') errors.push(`${path}.filter is invalid`);
  if (typeof value.timer !== 'boolean') errors.push(`${path}.timer must be boolean`);
  if (value.accent !== undefined && (typeof value.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.accent))) {
    errors.push(`${path}.accent must be a six-digit hex color`);
  }
  if (!Array.isArray(value.slas) || !value.slas.every(isSla)) errors.push(`${path}.slas is invalid`);
  if (!isStringArray(value.teamMembers)) errors.push(`${path}.teamMembers must be a string array`);
  if (!isPriorityArray(value.displayOrder)) errors.push(`${path}.displayOrder is invalid`);
  if (!isPriorityLabels(value.priorityLabels)) errors.push(`${path}.priorityLabels is invalid`);
  if (!isStateLabels(value.stateLabels)) errors.push(`${path}.stateLabels is invalid`);
  if (!isReport(value.report)) errors.push(`${path}.report is invalid`);
  if (!isKitchenPhrases(value.kitchenPhrases)) errors.push(`${path}.kitchenPhrases is invalid`);
  if (!isZoneLabels(value.zoneLabels)) errors.push(`${path}.zoneLabels is invalid`);
  if (!isDisplayOptions(value.displayOptions)) errors.push(`${path}.displayOptions is invalid`);
  return errors;
}

function legacySettings(
  dashboard: DashboardConfig,
  slas: ConfigResponse['slas'],
  team?: TeamBoardConfig,
): TeamDashboardSettings {
  return {
    filter: team?.filter ?? 'active-states',
    timer: team?.timer ?? true,
    ...(team?.accent ? { accent: team.accent } : {}),
    slas: structuredCloneSafe(slas),
    teamMembers: [...dashboard.teamMembers],
    displayOrder: [...dashboard.displayOrder],
    priorityLabels: structuredCloneSafe(dashboard.priorityLabels),
    stateLabels: structuredCloneSafe(dashboard.stateLabels),
    report: { ...dashboard.report },
    kitchenPhrases: { ...dashboard.kitchenPhrases },
    zoneLabels: { ...DEFAULT_ZONES, ...dashboard.zoneLabels },
    displayOptions: { ...dashboard.displayOptions },
  };
}

function cloneSettings(settings: TeamDashboardSettings): TeamDashboardSettings {
  return structuredCloneSafe(settings);
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isPositiveInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
function isPriority(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
}
function isPriorityArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isPriority);
}
function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
function isSla(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') return false;
  if (!isPriorityArray(value.applicablePriorities) || typeof value.maxMinutes !== 'number' || value.maxMinutes < 1) return false;
  const thresholds = value.warningThresholds;
  return isRecord(thresholds)
    && ['warming', 'heating', 'critical'].every((key) => typeof thresholds[key] === 'number' && thresholds[key] >= 0 && thresholds[key] <= 1);
}
function isPriorityLabels(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).every(([key, label]) =>
    /^(0|1|2|3|4)$/.test(key) && isRecord(label)
    && ['label', 'color', 'dotColor'].every((field) => typeof label[field] === 'string'));
}
function isStateLabels(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).every(([key, label]) =>
    !!key && isRecord(label) && typeof label.label === 'string' && typeof label.icon === 'string');
}
function isReport(value: unknown): boolean {
  return isRecord(value) && typeof value.enabled === 'boolean'
    && typeof value.slaWindowHours === 'number' && value.slaWindowHours >= 1;
}
function isKitchenPhrases(value: unknown): boolean {
  return isRecord(value)
    && typeof value.emptyState === 'string'
    && typeof value.warningTimer === 'string'
    && typeof value.breachedTimer === 'string'
    && ['emptyStateSub', 'errorState', 'errorStateSub'].every((key) => value[key] === undefined || typeof value[key] === 'string');
}
function isZoneLabels(value: unknown): boolean {
  return isRecord(value) && ['new', 'active', 'done'].every((key) => typeof value[key] === 'string');
}
function isDisplayOptions(value: unknown): value is DisplayOptions {
  if (!isRecord(value)) return false;
  if (value.columnOrder !== undefined && !isPriorityArray(value.columnOrder)) return false;
  if (value.columnVisibility !== undefined
    && (!isRecord(value.columnVisibility) || !Object.entries(value.columnVisibility).every(([key, visible]) => /^(0|1|2|3|4)$/.test(key) && typeof visible === 'boolean'))) return false;
  if (value.timerStyle !== undefined && value.timerStyle !== 'circle' && value.timerStyle !== 'bar') return false;
  if (value.animationIntensity !== undefined && !['off', 'subtle', 'full'].includes(value.animationIntensity)) return false;
  return value.autoMute === undefined || typeof value.autoMute === 'boolean';
}
function isFilter(value: unknown): boolean {
  return isRecord(value)
    && ['projects', 'assignees', 'states', 'labels', 'excludeStates'].every((key) => isStringArray(value[key]))
    && isPriorityArray(value.priorities)
    && typeof value.textSearch === 'string';
}
