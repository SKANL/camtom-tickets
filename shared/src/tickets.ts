import { Issue } from './types';

/**
 * Row shape of the Supabase `tickets` table (snake_case).
 * The webhook and reconcile jobs write these; the browser reads them.
 */
export interface TicketRow {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  priority_label: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  assigned_at: string | null;
  due_date: string | null;
  assignee: { id: string; name: string; email?: string } | null;
  state: { id: string; name: string; type: string };
  labels: { nodes: { id: string; name: string; color?: string }[] } | null;
  project: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  cycle: { id: string; name: string } | null;
  estimate: number | null;
}

/** Map a DB row to the client-facing Issue type. Pure. */
export function rowToIssue(row: TicketRow): Issue {
  return {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    description: row.description ?? undefined,
    priority: (row.priority as Issue['priority']) ?? 0,
    priorityLabel: row.priority_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    assignedAt: row.assigned_at ?? undefined,
    dueDate: row.due_date ?? undefined,
    assignee: row.assignee ?? null,
    state: row.state ?? { id: '', name: 'Unknown', type: 'unknown' },
    labels: row.labels ?? undefined,
    project: row.project ?? null,
    team: row.team ?? null,
    cycle: row.cycle ?? null,
    estimate: row.estimate ?? undefined,
  };
}
