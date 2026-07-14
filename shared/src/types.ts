export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: 0 | 1 | 2 | 3 | 4;
  priorityLabel: string;
  createdAt: string;
  updatedAt: string;
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

export interface SLAConfig {
  id: string;
  label: string;
  applicablePriorities: number[];
  maxMinutes: number;
  warningThreshold: number;
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
  emptyState: string;
  warningTimer: string;
  breachedTimer: string;
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
  displayOptions?: DisplayOptions;
}

export interface ConfigResponse {
  slas: SLAConfig[];
  dashboard: DashboardConfig;
  version: string;
}

export interface SSEEvent {
  type: 'delta' | 'heartbeat';
  data: {
    added?: Issue[];
    updated?: Issue[];
    removed?: string[];
    serverTime: number;
    assignmentTimestamps?: Record<string, string>;
  };
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

export interface FilterState {
  projects: string[];
  assignees: string[];
  states: string[];
  labels: string[];
  priorities: number[];
  textSearch: string;
  excludeStates: string[];
}

export type TimerState = 'OK' | 'WARNING' | 'BREACHED';

export interface TimerInfo {
  deadline: number;
  remaining: number;
  state: TimerState;
  slaId: string;
  maxMinutes?: number;
}
