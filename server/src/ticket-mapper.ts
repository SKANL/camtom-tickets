import { Issue, TicketRow } from '@camtom/shared';

const TIMER_LABEL = 'ticket';

/**
 * Map a Linear Issue to a Supabase ticket row.
 *
 * `assigned_at` here is only an initial guess (updated_at ≈ when the label was
 * applied). The DB trigger `stamp_assigned_at` owns the real anchor: it preserves
 * the earliest known value across updates and clears it when the label is removed.
 */
export function issueToRow(issue: Issue): TicketRow {
  const hasLabel = issue.labels?.nodes?.some((l) => l.name === TIMER_LABEL) ?? false;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: null,
    priority: issue.priority,
    priority_label: issue.priorityLabel,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    completed_at: issue.completedAt ?? null,
    assigned_at: hasLabel ? issue.updatedAt : null,
    due_date: issue.dueDate ?? null,
    assignee: issue.assignee ? { id: issue.assignee.id, name: issue.assignee.name } : null,
    state: issue.state,
    labels: issue.labels ?? null,
    project: issue.project ?? null,
    team: issue.team ?? null,
    cycle: issue.cycle ?? null,
    estimate: issue.estimate ?? null,
  };
}
