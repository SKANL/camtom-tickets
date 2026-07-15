import { describe, it, expect } from 'vitest';
import { issueToRow } from '../ticket-mapper';
import { Issue } from '@camtom/shared';

const base: Issue = {
  id: 'i1',
  identifier: 'SUP-1',
  title: 'Broken thing',
  priority: 2,
  priorityLabel: 'High',
  createdAt: '2026-07-14T10:00:00.000Z',
  updatedAt: '2026-07-14T10:05:00.000Z',
  state: { id: 's1', name: 'Todo', type: 'unstarted' },
};

describe('issueToRow', () => {
  it('anchors assigned_at to updatedAt when the ticket label is present', () => {
    const issue: Issue = { ...base, labels: { nodes: [{ id: 'l1', name: 'ticket' }] } };
    expect(issueToRow(issue).assigned_at).toBe('2026-07-14T10:05:00.000Z');
  });

  it('leaves assigned_at null when the ticket label is absent', () => {
    const issue: Issue = { ...base, labels: { nodes: [{ id: 'l2', name: 'bug' }] } };
    expect(issueToRow(issue).assigned_at).toBeNull();
  });

  it('maps camelCase fields to snake_case columns', () => {
    const row = issueToRow(base);
    expect(row.priority_label).toBe('High');
    expect(row.created_at).toBe(base.createdAt);
    expect(row.description).toBeNull();
    expect(row.estimate).toBeNull();
  });

  it('redacts description and assignee email before persistence', () => {
    const row = issueToRow({
      ...base,
      description: 'Customer passport number',
      assignee: { id: 'u1', name: 'Ada', email: 'ada@example.com' },
    });

    expect(row.description).toBeNull();
    expect(row.assignee).toEqual({ id: 'u1', name: 'Ada' });
    expect(row.assignee).not.toHaveProperty('email');
  });
});
