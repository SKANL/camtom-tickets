import type { ComponentType } from 'react';
import {
  IconFire,
  IconFlash,
  IconClipboard,
  IconCheck,
  IconMinusSquare,
} from '../components/Icons';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export interface PriorityMeta {
  level: number;
  name: string; // default label (runtime config can override)
  colorVar: string; // CSS custom property reference for the main color
  gaugeColor: string; // resolved color for the temperature gauge strip
  dotColor: string; // default swatch hex
  icon: IconComponent;
}

/**
 * Single source of truth for priority metadata (name, colors, icon, order).
 * Canonical display order: Urgent → No Priority.
 *
 * Runtime `config.dashboard.priorityLabels` still overrides name/color at render
 * time; this module is the default + the icon/order that were previously
 * duplicated across TicketCard, PriorityGroup, FilterBar, SettingsPanel and Icons.
 */
export const PRIORITIES: PriorityMeta[] = [
  { level: 1, name: 'Urgente', colorVar: 'var(--priority-urgent)', gaugeColor: 'var(--color-ketchup)', dotColor: '#D32F2F', icon: IconFire },
  { level: 2, name: 'Alta', colorVar: 'var(--priority-high)', gaugeColor: 'var(--color-oil)', dotColor: '#FF8C00', icon: IconFlash },
  { level: 3, name: 'Media', colorVar: 'var(--priority-medium)', gaugeColor: '#E0A82E', dotColor: '#E0A82E', icon: IconClipboard },
  { level: 4, name: 'Baja', colorVar: 'var(--priority-low)', gaugeColor: 'var(--color-lettuce)', dotColor: '#4CAF50', icon: IconCheck },
  { level: 0, name: 'Sin prioridad', colorVar: 'var(--priority-none)', gaugeColor: '#9E9E9E', dotColor: '#9E9E9E', icon: IconMinusSquare },
];

export const PRIORITY_LEVELS: number[] = PRIORITIES.map((p) => p.level);

export const PRIORITY_BY_LEVEL: Record<number, PriorityMeta> = Object.fromEntries(
  PRIORITIES.map((p) => [p.level, p]),
);

/** level → icon component (replaces Icons.priorityIcons) */
export const priorityIcons: Record<number, IconComponent> = Object.fromEntries(
  PRIORITIES.map((p) => [p.level, p.icon]),
);

/** { id, name } options for the priority filter dropdown */
export const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ id: String(p.level), name: p.name }));

/** Default label/color config used as a fallback when server config is absent */
export const defaultPriorityConfig: Record<number, { label: string; color: string; dotColor: string }> =
  Object.fromEntries(PRIORITIES.map((p) => [p.level, { label: p.name, color: p.colorVar, dotColor: p.dotColor }]));
