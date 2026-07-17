import {
  EMPTY_FILTER,
  FilterState,
  Issue,
  TeamDashboardSettings,
} from '@camtom/shared';
import { isToday, matchesTeam } from './board';

export interface PaneIssueView {
  teamIssues: Issue[];
  filteredIssues: Issue[];
  doneToday: Issue[];
}

export function buildPaneIssueView(
  issues: Issue[],
  teamId: string,
  settings: TeamDashboardSettings,
  filter: FilterState = EMPTY_FILTER,
): PaneIssueView {
  const team = { id: teamId, name: teamId, filter: settings.filter, timer: settings.timer, accent: settings.accent };
  const teamIssues = issues.filter((issue) => matchesTeam(issue, team));
  const doneToday = teamIssues
    .filter((issue) => issue.state.type === 'completed' && isToday(issue.completedAt))
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());
  return {
    teamIssues,
    filteredIssues: applyManualFilter(teamIssues, filter),
    doneToday,
  };
}

export function applyManualFilter(issues: Issue[], filter: FilterState): Issue[] {
  let result = issues;
  if (filter.priorities.length) result = result.filter((issue) => filter.priorities.includes(issue.priority));
  if (filter.projects.length) result = result.filter((issue) => !!issue.project && filter.projects.includes(issue.project.id));
  if (filter.states.length) result = result.filter((issue) => filter.states.includes(issue.state.id));
  if (filter.excludeStates.length) result = result.filter((issue) => !filter.excludeStates.includes(issue.state.id));
  if (filter.assignees.length) result = result.filter((issue) => !!issue.assignee && filter.assignees.includes(issue.assignee.id));
  if (filter.labels.length) {
    result = result.filter((issue) => issue.labels?.nodes.some((label) => filter.labels.includes(label.id)) ?? false);
  }
  const search = filter.textSearch.trim().toLowerCase();
  if (search) {
    result = result.filter((issue) =>
      issue.title.toLowerCase().includes(search) || issue.identifier.toLowerCase().includes(search));
  }
  return result;
}
