import { Router, Request, Response } from 'express';
import { ensureConfig, saveConfig } from '../config';
import { metadataCache } from '../cache';
import { ConfigV2, DashboardConfig, SLAConfig, validateConfigV2 } from '@camtom/shared';
import { authorizeAdmin } from '../admin-auth';

const router: Router = Router();

type UnknownRecord = Record<string, unknown>;

const DASHBOARD_KEYS = [
  'pollingInterval', 'title', 'teamMembers', 'displayOrder', 'priorityLabels', 'stateLabels',
  'report', 'kitchenPhrases', 'zoneLabels', 'teams', 'activeTeamId', 'displayOptions',
] as const;
const KITCHEN_KEYS = ['emptyState', 'emptyStateSub', 'errorState', 'errorStateSub', 'warningTimer', 'breachedTimer'] as const;
const DISPLAY_KEYS = ['columnOrder', 'columnVisibility', 'timerStyle', 'animationIntensity', 'autoMute'] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPriority(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 4;
}

function isPriorityKey(value: string): boolean {
  return /^(0|1|2|3|4)$/.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isPriorityArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isPriority);
}

function isStringFields(value: unknown, allowed: readonly string[], required: readonly string[] = []): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, allowed)) return false;
  if (!required.every((key) => Object.prototype.hasOwnProperty.call(value, key))) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

function isPriorityLabels(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([priority, label]) => isPriorityKey(priority)
    && isStringFields(label, ['label', 'color', 'dotColor'], ['label', 'color', 'dotColor']));
}

function isStateLabels(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([state, label]) => state.length > 0
    && isStringFields(label, ['label', 'icon'], ['label', 'icon']));
}

function isTeams(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((team) => {
    if (!isRecord(team) || !hasOnlyKeys(team, ['id', 'name', 'filter', 'timer', 'accent'])) return false;
    if (typeof team.id !== 'string' || !team.id || team.id !== team.id.trim() || ids.has(team.id)
      || typeof team.name !== 'string' || typeof team.timer !== 'boolean') return false;
    ids.add(team.id);
    if (team.filter !== 'ticket-label' && team.filter !== 'active-states') return false;
    return team.accent === undefined || (typeof team.accent === 'string' && /^#[0-9a-f]{6}$/i.test(team.accent));
  });
}

function isDisplayOptions(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, DISPLAY_KEYS)) return false;
  if (value.columnOrder !== undefined && !isPriorityArray(value.columnOrder)) return false;
  if (value.columnVisibility !== undefined) {
    if (!isRecord(value.columnVisibility)) return false;
    if (!Object.entries(value.columnVisibility).every(([priority, visible]) => isPriorityKey(priority) && typeof visible === 'boolean')) return false;
  }
  if (value.timerStyle !== undefined && value.timerStyle !== 'circle' && value.timerStyle !== 'bar') return false;
  if (value.animationIntensity !== undefined
    && value.animationIntensity !== 'off'
    && value.animationIntensity !== 'subtle'
    && value.animationIntensity !== 'full') return false;
  return value.autoMute === undefined || typeof value.autoMute === 'boolean';
}

function isDashboardUpdate(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, DASHBOARD_KEYS)) return false;
  if (value.pollingInterval !== undefined
    && (!isFiniteNumber(value.pollingInterval) || !Number.isInteger(value.pollingInterval) || value.pollingInterval < 1)) return false;
  if (value.title !== undefined && typeof value.title !== 'string') return false;
  if (value.teamMembers !== undefined && !isStringArray(value.teamMembers)) return false;
  if (value.displayOrder !== undefined && !isPriorityArray(value.displayOrder)) return false;
  if (value.priorityLabels !== undefined && !isPriorityLabels(value.priorityLabels)) return false;
  if (value.stateLabels !== undefined && !isStateLabels(value.stateLabels)) return false;
  if (value.report !== undefined) {
    if (!isRecord(value.report) || !hasOnlyKeys(value.report, ['slaWindowHours', 'enabled'])) return false;
    if (value.report.slaWindowHours !== undefined
      && (!isFiniteNumber(value.report.slaWindowHours) || value.report.slaWindowHours < 1)) return false;
    if (value.report.enabled !== undefined && typeof value.report.enabled !== 'boolean') return false;
  }
  if (value.kitchenPhrases !== undefined && !isStringFields(value.kitchenPhrases, KITCHEN_KEYS)) return false;
  if (value.zoneLabels !== undefined
    && !isStringFields(value.zoneLabels, ['new', 'active', 'done'], ['new', 'active', 'done'])) return false;
  if (value.teams !== undefined && !isTeams(value.teams)) return false;
  if (value.activeTeamId !== undefined && typeof value.activeTeamId !== 'string') return false;
  return value.displayOptions === undefined || isDisplayOptions(value.displayOptions);
}

function isSlas(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((sla) => {
    if (!isRecord(sla) || !hasOnlyKeys(sla, ['id', 'label', 'applicablePriorities', 'maxMinutes', 'warningThresholds'])) return false;
    if (typeof sla.id !== 'string' || typeof sla.label !== 'string' || !isPriorityArray(sla.applicablePriorities)) return false;
    if (!isFiniteNumber(sla.maxMinutes) || sla.maxMinutes < 1) return false;
    const thresholds = sla.warningThresholds;
    if (!isRecord(thresholds)
      || !hasOnlyKeys(thresholds, ['warming', 'heating', 'critical'])
      || !['warming', 'heating', 'critical'].every((key) => Object.prototype.hasOwnProperty.call(thresholds, key))) return false;
    return Object.values(thresholds).every((threshold) => isFiniteNumber(threshold) && threshold >= 0 && threshold <= 1);
  });
}

export function validateConfigUpdate(value: unknown): string | null {
  if (!isRecord(value)) return 'El cuerpo debe ser un objeto';
  const body = value;
  if (!hasOnlyKeys(body, ['dashboard', 'slas', 'configV2', 'expectedVersion'])) return 'El cuerpo contiene campos desconocidos';
  if (typeof body.expectedVersion !== 'string' || !body.expectedVersion.trim()) return 'expectedVersion es obligatorio';
  if (body.dashboard === undefined && body.slas === undefined && body.configV2 === undefined) return 'Incluí dashboard, slas o configV2';
  if (body.dashboard !== undefined && !isDashboardUpdate(body.dashboard)) return 'dashboard tiene un formato inválido';
  if (body.slas !== undefined && !isSlas(body.slas)) return 'slas tiene un formato inválido';
  if (body.configV2 !== undefined) {
    const teamIds = isRecord(body.dashboard) && Array.isArray(body.dashboard.teams)
      ? body.dashboard.teams.filter(isRecord).map((team) => team.id).filter((id): id is string => typeof id === 'string')
      : undefined;
    const errors = validateConfigV2(body.configV2, teamIds);
    if (errors.length > 0) return errors.join('; ');
  }
  return null;
}

router.get('/api/config', async (_req: Request, res: Response) => {
  res.json(await ensureConfig());
});

router.put('/api/config', authorizeAdmin, async (req: Request, res: Response) => {
  try {
    const validationError = validateConfigUpdate(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const body = req.body as {
      dashboard?: Partial<DashboardConfig>;
      slas?: SLAConfig[];
      configV2?: ConfigV2;
      expectedVersion: string;
    };
    // Invalidate metadata cache so next request picks up fresh data
    metadataCache.delete('catalog');
    const { expectedVersion, ...updates } = body;
    const updated = await saveConfig(updates, expectedVersion);
    res.json(updated);
  } catch (err: unknown) {
    console.error('[config] PUT /api/config persistence failed:', err);
    if (err instanceof Error && err.message.includes('app config version conflict')) {
      const current = await ensureConfig(undefined, true);
      return res.status(409).json({
        error: 'La configuración cambió en otro navegador. Elegí cargar la última versión o rebasar tu borrador.',
        current,
      });
    }
    if (err instanceof Error && err.message.startsWith('Invalid config v2:')) {
      return res.status(400).json({ error: err.message.replace('Invalid config v2: ', '') });
    }
    res.status(500).json({ error: 'No se pudo guardar la configuración' });
  }
});

export default router;
