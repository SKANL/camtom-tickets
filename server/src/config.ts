import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as crypto from 'crypto';
import { SLAConfig, DashboardConfig, ConfigResponse } from '@camtom/shared';

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

export function saveConfig(updates: {
  dashboard?: Partial<DashboardConfig>;
  slas?: SLAConfig[];
}): ConfigResponse {
  const current = getConfig();

  // Merge dashboard updates
  if (updates.dashboard) {
    const mergedDashboard: DashboardConfig = {
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

    // Write dashboard.yaml
    const dashPath = path.join(CONFIG_DIR, 'dashboard.yaml');
    const dashYaml = yaml.dump(mergedDashboard, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: true,
    });
    fs.writeFileSync(dashPath, dashYaml, 'utf-8');
    current.dashboard = mergedDashboard;
  }

  // Merge SLA updates
  if (updates.slas) {
    const slaPath = path.join(CONFIG_DIR, 'sla.yaml');
    const slaYaml = yaml.dump({ slas: updates.slas }, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: true,
    });
    fs.writeFileSync(slaPath, slaYaml, 'utf-8');
    current.slas = updates.slas;
  }

  // Recompute version
  const slaContent = fs.readFileSync(path.join(CONFIG_DIR, 'sla.yaml'), 'utf-8');
  const dashContent = fs.readFileSync(path.join(CONFIG_DIR, 'dashboard.yaml'), 'utf-8');
  current.version = computeVersion(slaContent, dashContent);

  cachedConfig = current;
  console.log(`[config] Config saved: version ${current.version}`);
  return current;
}

export function getConfig(): ConfigResponse {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}
