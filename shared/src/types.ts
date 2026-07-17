export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: 0 | 1 | 2 | 3 | 4;
  priorityLabel: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  assignedAt?: string;
  dueDate?: string;
  assignee?: { id: string; name: string; email?: string } | null;
  state: { id: string; name: string; type: string };
  labels?: { nodes: { id: string; name: string; color?: string }[] };
  project?: { id: string; name: string } | null;
  team?: { id: string; name: string } | null;
  cycle?: { id: string; name: string } | null;
  estimate?: number;
}

export interface SLAWarningThresholds {
  warming: number;  // 0.0–1.0: over this pct remaining → FRESH (default 0.6)
  heating: number;  // below this → HEATING (default 0.3)
  critical: number; // below this → CRITICAL (default 0.1)
}

export interface SLAConfig {
  id: string;
  label: string;
  applicablePriorities: number[];
  maxMinutes: number;
  warningThresholds: SLAWarningThresholds;
}

export interface PriorityLabelConfig {
  label: string;
  color: string;
  dotColor: string;
}

export interface StateLabelConfig {
  label: string;
  icon: string; // icon name, resolved client-side
}

export interface KitchenPhrases {
  emptyState: string; // idle headline ("all caught up")
  emptyStateSub?: string; // idle subtitle
  errorState?: string; // connection-lost headline
  errorStateSub?: string; // connection-lost subtitle
  warningTimer: string;
  breachedTimer: string;
}

/** Titles for the three board zones (untaken / in-progress / served). */
export interface ZoneLabels {
  new: string;
  active: string;
  done: string;
}

/**
 * A Linear team the board can show, with its own board-worthiness criterion.
 * - 'ticket-label': only issues carrying the "ticket" label.
 * - 'active-states': every issue of the team (zones split them; canceled hidden).
 */
export interface TeamBoardConfig {
  id: string;
  name: string;
  filter: 'ticket-label' | 'active-states';
  timer: boolean; // whether the SLA countdown applies to this team
  accent?: string; // hex accent colour used to signal the active team in the UI
}

export interface DashboardConfig {
  pollingInterval: number;
  title: string;
  teamMembers: string[];
  displayOrder: number[];
  priorityLabels: Record<number, PriorityLabelConfig>;
  stateLabels: Record<string, StateLabelConfig>;
  report: {
    slaWindowHours: number;
    enabled: boolean;
  };
  kitchenPhrases: KitchenPhrases;
  zoneLabels?: ZoneLabels;
  teams?: TeamBoardConfig[];
  activeTeamId?: string;
  displayOptions?: DisplayOptions;
}

export interface ConfigResponse {
  slas: SLAConfig[];
  dashboard: DashboardConfig;
  version: string;
  configV2?: ConfigV2;
}

export interface SelectOption {
  id: string;
  name: string;
}

export interface MetadataCatalog {
  teams: SelectOption[];
  projects: SelectOption[];
  users: SelectOption[];
  workflowStates: SelectOption[];
  labels: SelectOption[];
  cycles: (SelectOption & { completedAt?: string })[];
}

export interface DisplayOptions {
  columnOrder?: number[];
  columnVisibility?: Record<number, boolean>;
  timerStyle?: 'circle' | 'bar';
  animationIntensity?: 'off' | 'subtle' | 'full';
  autoMute?: boolean;
}

export interface TeamDashboardSettings {
  filter: TeamBoardConfig['filter'];
  timer: boolean;
  accent?: string;
  slas: SLAConfig[];
  teamMembers: string[];
  displayOrder: number[];
  priorityLabels: Record<number, PriorityLabelConfig>;
  stateLabels: Record<string, StateLabelConfig>;
  report: DashboardConfig['report'];
  kitchenPhrases: KitchenPhrases;
  zoneLabels: ZoneLabels;
  displayOptions: DisplayOptions;
}

export interface ConfigV2 {
  schemaVersion: 2;
  global: {
    title: string;
    pollingInterval: number;
  };
  teams: Record<string, TeamDashboardSettings>;
}

export interface FilterState {
  projects: string[];
  assignees: string[];
  states: string[];
  labels: string[];
  priorities: number[];
  textSearch: string;
  excludeStates: string[];
}

export interface ScreenPaneState {
  teamId: string;
  view: 'board' | 'report';
  filter: FilterState;
}

export interface ScreenState {
  schemaVersion: 1;
  layout: 'single' | 'split-vertical';
  muted?: boolean;
  /** Changes trigger an in-app remount; this never reloads the browser or OS. */
  reloadNonce?: string;
  panes: {
    left: ScreenPaneState;
    right: ScreenPaneState;
  };
}

export type ScreenDeviceHealth = 'online' | 'unstable' | 'offline' | 'stale';

export interface ScreenDevice {
  id: string;
  name: string | null;
  desiredState: ScreenState | null;
  stateVersion: number;
  lastAppliedVersion: number;
  lastSeenAt: string | null;
  capabilities: Record<string, unknown>;
  allowedTeamIds: string[];
  pairedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  health: ScreenDeviceHealth;
}

export interface ScreenControlFeatures {
  screenControlEnabled: boolean;
  requirePairing: boolean;
  captchaProvider: 'turnstile' | null;
  captchaSiteKey: string | null;
  configurationError: string | null;
}

export type TimerState = 'FRESH' | 'WARMING' | 'HEATING' | 'CRITICAL' | 'EXPIRED';

export interface TimerInfo {
  deadline: number;
  remaining: number;
  state: TimerState;
  slaId: string;
  maxMinutes: number;
}
