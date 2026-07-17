import { ConfigResponse } from '@camtom/shared';

export function configFixture(): ConfigResponse {
  return {
    version: 'v1',
    slas: [{ id: 'timer', label: 'Timer', applicablePriorities: [1], maxMinutes: 30, warningThresholds: { warming: .6, heating: .3, critical: .1 } }],
    dashboard: {
      pollingInterval: 30000,
      title: 'Dashboard',
      teamMembers: ['Ana'],
      displayOrder: [1, 2, 3, 4, 0],
      priorityLabels: {
        0: { label: 'None', color: '#999', dotColor: '#999999' },
        1: { label: 'Urgent', color: '#f00', dotColor: '#ff0000' },
        2: { label: 'High', color: '#f80', dotColor: '#ff8800' },
        3: { label: 'Medium', color: '#fd0', dotColor: '#ffdd00' },
        4: { label: 'Low', color: '#0f0', dotColor: '#00ff00' },
      },
      stateLabels: { started: { label: 'Started', icon: 'start' } },
      report: { slaWindowHours: 24, enabled: true },
      kitchenPhrases: { emptyState: 'Empty', warningTimer: 'Warn', breachedTimer: 'Late' },
      zoneLabels: { new: 'New', active: 'Active', done: 'Done' },
      teams: [
        { id: 'a', name: 'A', filter: 'active-states', timer: true, accent: '#112233' },
        { id: 'b', name: 'B', filter: 'ticket-label', timer: false, accent: '#445566' },
      ],
      activeTeamId: 'a',
      displayOptions: { timerStyle: 'circle', animationIntensity: 'full' },
    },
  };
}
