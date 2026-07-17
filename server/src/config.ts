import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as crypto from 'crypto';
import {
  SLAConfig,
  DashboardConfig,
  ConfigResponse,
  ConfigV2,
  TeamDashboardSettings,
  createConfigV2,
  validateConfigV2,
} from '@camtom/shared';
import { getAppConfigSnapshot, setAppConfig, setAppConfigV2 } from './supabase';

function getConfigDir(): string {
  // Allow override via env var (useful for Vercel / custom deployments)
  if (process.env.CONFIG_DIR) return process.env.CONFIG_DIR;
  // Vercel serverless runtime — project root is available via cwd
  if (process.env.VERCEL) return path.resolve(process.cwd(), 'config');
  // Local / dev — relative to this source file
  return path.resolve(__dirname, '../../config');
}

const CONFIG_DIR = getConfigDir();

interface RawSLAWarningThresholds {
  warming?: number;
  heating?: number;
  critical?: number;
}

interface RawSLAEntry {
  id: string;
  label: string;
  applicablePriorities: number[];
  maxMinutes: number;
  warningThresholds?: RawSLAWarningThresholds;
  /** @deprecated use warningThresholds instead */
  warningThreshold?: number;
}

interface RawSLAFile {
  slas: RawSLAEntry[];
}

interface RawDashboardFile {
  pollingInterval: number;
  title: string;
  teamMembers: string[];
  displayOrder: number[];
  priorityLabels: Record<number, { label: string; color: string; dotColor: string }>;
  stateLabels: Record<string, { label: string; icon: string }>;
  report: { slaWindowHours: number; enabled: boolean };
  kitchenPhrases: {
    emptyState: string;
    emptyStateSub?: string;
    errorState?: string;
    errorStateSub?: string;
    warningTimer: string;
    breachedTimer: string;
  };
  zoneLabels?: { new: string; active: string; done: string };
  teams?: { id: string; name: string; filter: 'ticket-label' | 'active-states'; timer: boolean }[];
  activeTeamId?: string;
  displayOptions?: {
    columnOrder?: number[];
    columnVisibility?: Record<number, boolean>;
    timerStyle?: 'circle' | 'bar';
    animationIntensity?: 'off' | 'subtle' | 'full';
  };
}

let cachedConfig: ConfigResponse | null = null;
let cachedConfigUpdatedAt: string | null = null;
let lastHydratedAt = 0;
let hydrationPromise: Promise<ConfigResponse> | null = null;
const CONFIG_CACHE_TTL_MS = 30_000;

/** Reset module state without forcing Vitest to rebuild the entire import graph. */
export function resetConfigStateForTests(): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('config test reset is test-only');
  cachedConfig = null;
  cachedConfigUpdatedAt = null;
  lastHydratedAt = 0;
  hydrationPromise = null;
}

function computeVersion(...contents: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const content of contents) {
    hash.update(content);
  }
  return hash.digest('hex').slice(0, 12);
}

export function loadConfig(): ConfigResponse {
  const slaPath = path.join(CONFIG_DIR, 'sla.yaml');
  const dashPath = path.join(CONFIG_DIR, 'dashboard.yaml');

  let slaContent: string;
  let dashContent: string;
  let slas: SLAConfig[];
  let dashboard: DashboardConfig;

  try {
    slaContent = fs.readFileSync(slaPath, 'utf-8');
    const parsed = yaml.load(slaContent) as RawSLAFile;
    if (!parsed || !Array.isArray(parsed.slas)) {
      throw new Error('Invalid SLA YAML: missing "slas" array');
    }
    slas = parsed.slas.map((entry): SLAConfig => ({
      id: entry.id,
      label: entry.label,
      applicablePriorities: entry.applicablePriorities,
      maxMinutes: entry.maxMinutes,
      warningThresholds: {
        warming: entry.warningThresholds?.warming ?? entry.warningThreshold ?? 0.6,
        heating: entry.warningThresholds?.heating ?? entry.warningThreshold ?? 0.3,
        critical: entry.warningThresholds?.critical ?? entry.warningThreshold ?? 0.1,
      },
    }));
  } catch (err: any) {
    console.error(`[config] Failed to load SLA config: ${err.message}`);
    console.error('[config] Falling back to default SLA config');
    slas = getDefaultSLAConfig();
    slaContent = JSON.stringify(slas);
  }

  try {
    dashContent = fs.readFileSync(dashPath, 'utf-8');
    const parsed = yaml.load(dashContent) as Partial<RawDashboardFile>;
    if (!parsed || typeof parsed.pollingInterval !== 'number') {
      throw new Error('Invalid dashboard YAML: missing pollingInterval');
    }
    const defaults = getDefaultDashboardConfig();
    dashboard = {
      pollingInterval: parsed.pollingInterval,
      title: parsed.title ?? defaults.title,
      teamMembers: parsed.teamMembers ?? defaults.teamMembers,
      displayOrder: parsed.displayOrder ?? defaults.displayOrder,
      priorityLabels: { ...defaults.priorityLabels, ...(parsed.priorityLabels ?? {}) },
      stateLabels: { ...defaults.stateLabels, ...(parsed.stateLabels ?? {}) },
      report: { ...defaults.report, ...(parsed.report ?? {}) },
      kitchenPhrases: { ...defaults.kitchenPhrases, ...(parsed.kitchenPhrases ?? {}) },
      zoneLabels: { ...defaults.zoneLabels, ...(parsed.zoneLabels ?? {}) } as DashboardConfig['zoneLabels'],
      teams: parsed.teams ?? defaults.teams,
      activeTeamId: parsed.activeTeamId ?? defaults.activeTeamId,
      displayOptions: parsed.displayOptions ?? undefined,
    };
  } catch (err: any) {
    console.error(`[config] Failed to load dashboard config: ${err.message}`);
    console.error('[config] Falling back to default dashboard config');
    dashboard = getDefaultDashboardConfig();
    dashContent = JSON.stringify(dashboard);
  }

  const version = computeVersion(slaContent, dashContent);

  cachedConfig = { slas, dashboard, version };
  cachedConfigUpdatedAt = null;
  return cachedConfig;
}

function getDefaultSLAConfig(): SLAConfig[] {
  return [
    {
      id: 'ticket_timer',
      label: 'Ticket Timer',
      applicablePriorities: [0, 1, 2, 3, 4],
      maxMinutes: 30,
      warningThresholds: { warming: 0.6, heating: 0.3, critical: 0.1 },
    },
  ];
}

function getDefaultDashboardConfig(): DashboardConfig {
  return {
    pollingInterval: 30000,
    title: 'Panel de Soporte Camtom',
    teamMembers: [],
    displayOrder: [1, 2, 3, 4, 0],
    priorityLabels: {
      1: { label: 'Urgente', color: 'var(--priority-urgent)', dotColor: '#D32F2F' },
      2: { label: 'Alta', color: 'var(--priority-high)', dotColor: '#FF8C00' },
      3: { label: 'Media', color: 'var(--priority-medium)', dotColor: '#E0A82E' },
      4: { label: 'Baja', color: 'var(--priority-low)', dotColor: '#4CAF50' },
      0: { label: 'Sin prioridad', color: 'var(--priority-none)', dotColor: '#9E9E9E' },
    },
    stateLabels: {
      completed: { label: 'Listo', icon: 'check' },
      started: { label: 'En prep', icon: 'fork-knife' },
      unstarted: { label: 'Entró', icon: 'edit' },
      canceled: { label: 'Cancelado', icon: 'x' },
      triaged: { label: 'Triage', icon: 'search' },
    },
    report: { slaWindowHours: 24, enabled: true },
    kitchenPhrases: {
      emptyState: '¡Cocina limpia!',
      emptyStateSub: 'No hay tickets pendientes.',
      errorState: 'Perdimos la cocina',
      errorStateSub: 'Sin conexión en tiempo real — mostrando lo último que vimos. Reintentando…',
      warningTimer: '¡La orden se enfría!',
      breachedTimer: '¡Orden QUEMADA!',
    },
    zoneLabels: {
      new: 'Sin tomar',
      active: 'En progreso',
      done: 'Servidos hoy',
    },
    teams: [
      { id: 'f25f5221-40c8-47ab-8071-8024b4564df0', name: 'Customs Advocacy', filter: 'active-states', timer: true, accent: '#4CAF50' },
      { id: '7a3df8eb-2e31-4b69-9f92-b0c5d110e05e', name: 'Engineering', filter: 'ticket-label', timer: true, accent: '#FFD700' },
    ],
    activeTeamId: 'f25f5221-40c8-47ab-8071-8024b4564df0',
  };
}

/**
 * Async accessor: ensures the YAML base is loaded, then overlays any
 * Supabase-stored config on top. Warm instances refresh on a short TTL and retain
 * the last known value on transient DB errors.
 */
export async function ensureConfig(signal?: AbortSignal, forceRefresh = false): Promise<ConfigResponse> {
  if (!cachedConfig) {
    loadConfig();
  }
  if (!forceRefresh && Date.now() - lastHydratedAt < CONFIG_CACHE_TTL_MS) return cachedConfig!;
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      const row = await getAppConfigSnapshot(signal);
      if (row) {
        const base: ConfigResponse = {
          version: '',
          slas: row.sla,
          dashboard: row.dashboard,
        };
        const teamConfigs = row.teamConfigs;
        if (teamConfigs) {
          const configV2 = createConfigV2(base);
          configV2.teams = teamConfigs;
          const errors = validateConfigV2(configV2, (row.dashboard.teams ?? []).map((team: any) => team.id));
          if (errors.length > 0) throw new Error(`Invalid config v2: ${errors.join('; ')}`);
          base.configV2 = configV2;
        }
        // DB updated_at is the opaque observed version used for optimistic writes.
        base.version = row.updatedAt;
        cachedConfig = base;
        cachedConfigUpdatedAt = row.updatedAt;
      }
    } catch (err: any) {
      console.warn(`[config] DB refresh failed, keeping last known config: ${err.message}`);
    } finally {
      lastHydratedAt = Date.now();
      hydrationPromise = null;
    }
    return cachedConfig!;
  })();
  return hydrationPromise;
}

export async function saveConfig(updates: {
  dashboard?: Partial<DashboardConfig>;
  slas?: SLAConfig[];
  configV2?: ConfigV2;
}, expectedVersion: string): Promise<ConfigResponse> {
  const current = await ensureConfig(undefined, true);
  if (!expectedVersion || current.version !== expectedVersion) {
    throw new Error('app config version conflict');
  }

  let mergedDashboard: DashboardConfig = current.dashboard;
  if (updates.dashboard) {
    mergedDashboard = {
      ...current.dashboard,
      ...updates.dashboard,
      displayOptions: updates.dashboard.displayOptions ?? current.dashboard.displayOptions,
      priorityLabels: {
        ...current.dashboard.priorityLabels,
        ...(updates.dashboard.priorityLabels ?? {}),
      },
      stateLabels: {
        ...current.dashboard.stateLabels,
        ...(updates.dashboard.stateLabels ?? {}),
      },
      report: {
        ...current.dashboard.report,
        ...(updates.dashboard.report ?? {}),
      },
      kitchenPhrases: {
        ...current.dashboard.kitchenPhrases,
        ...(updates.dashboard.kitchenPhrases ?? {}),
      },
    };
  }

  const mergedSlas = updates.slas ?? current.slas;
  let configV2 = updates.configV2 ?? current.configV2;

  if (updates.configV2) {
    const errors = validateConfigV2(updates.configV2, (mergedDashboard.teams ?? []).map((team) => team.id));
    if (errors.length > 0) throw new Error(`Invalid config v2: ${errors.join('; ')}`);
    configV2 = updates.configV2;
    mergedDashboard = syncLegacyDashboard(mergedDashboard, configV2);
  } else if (configV2 && (updates.dashboard || updates.slas)) {
    configV2 = applyLegacyUpdatesToV2(configV2, updates.dashboard, updates.slas);
  }

  // Persist to Supabase (read-only FS on Vercel; let errors propagate to the PUT handler).
  const updatedAt = configV2
    ? await setAppConfigV2(mergedDashboard, mergedSlas, configV2.teams, cachedConfigUpdatedAt)
    : await setAppConfig(mergedDashboard, mergedSlas, cachedConfigUpdatedAt);

  const saved: ConfigResponse = {
    dashboard: mergedDashboard,
    slas: mergedSlas,
    ...(configV2 ? { configV2 } : {}),
    version: updatedAt,
  };
  cachedConfig = saved;
  cachedConfigUpdatedAt = updatedAt;
  lastHydratedAt = Date.now();
  console.log(`[config] Config saved: version ${saved.version}`);
  return saved;
}

function syncLegacyDashboard(dashboard: DashboardConfig, configV2: ConfigV2): DashboardConfig {
  const firstTeamId = dashboard.teams?.[0]?.id;
  const legacyProjection = firstTeamId ? configV2.teams[firstTeamId] : undefined;
  if (!legacyProjection) throw new Error('Invalid config v2: missing legacy projection team');
  return {
    ...dashboard,
    title: configV2.global.title,
    pollingInterval: configV2.global.pollingInterval,
    teamMembers: legacyProjection.teamMembers,
    displayOrder: legacyProjection.displayOrder,
    priorityLabels: legacyProjection.priorityLabels,
    stateLabels: legacyProjection.stateLabels,
    report: legacyProjection.report,
    kitchenPhrases: legacyProjection.kitchenPhrases,
    zoneLabels: legacyProjection.zoneLabels,
    displayOptions: legacyProjection.displayOptions,
    teams: (dashboard.teams ?? []).map((team) => {
      const settings = configV2.teams[team.id];
      if (!settings) return team;
      return {
        ...team,
        filter: settings.filter,
        timer: settings.timer,
        ...(settings.accent ? { accent: settings.accent } : {}),
      };
    }),
  };
}

function applyLegacyUpdatesToV2(
  current: ConfigV2,
  dashboard?: Partial<DashboardConfig>,
  slas?: SLAConfig[],
): ConfigV2 {
  const teamPatch: Partial<TeamDashboardSettings> = {};
  if (slas) teamPatch.slas = slas;
  const keys: (keyof TeamDashboardSettings)[] = [
    'teamMembers', 'displayOrder', 'priorityLabels', 'stateLabels', 'report',
    'kitchenPhrases', 'zoneLabels', 'displayOptions',
  ];
  for (const key of keys) {
    const value = dashboard?.[key as keyof DashboardConfig];
    if (value !== undefined) (teamPatch as any)[key] = value;
  }
  const nextTeams = Object.fromEntries(
    Object.entries(current.teams).map(([id, settings]) => {
      const legacyTeam = dashboard?.teams?.find((team) => team.id === id);
      return [id, {
        ...settings,
        ...teamPatch,
        ...(legacyTeam ? {
          filter: legacyTeam.filter,
          timer: legacyTeam.timer,
          ...(legacyTeam.accent ? { accent: legacyTeam.accent } : {}),
        } : {}),
      }];
    }),
  );
  return {
    ...current,
    global: {
      title: dashboard?.title ?? current.global.title,
      pollingInterval: dashboard?.pollingInterval ?? current.global.pollingInterval,
    },
    teams: nextTeams,
  };
}

export function getConfig(): ConfigResponse {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}
