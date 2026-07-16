import { describe, expect, it, vi } from 'vitest';
import { paginateIssuePages, ReconcileIssue } from '../linear-client';

function issue(id: string): ReconcileIssue {
  return {
    id,
    identifier: id,
    title: id,
    priority: 1,
    priorityLabel: 'Urgent',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: { id: 'state', name: 'Open', type: 'started' },
    team: { id: 'team', name: 'Team' },
  };
}

describe('Linear issue pagination', () => {
  it('continues after a short page when hasNextPage is true', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ nodes: [issue('one')], pageInfo: { hasNextPage: true, endCursor: 'next' } })
      .mockResolvedValueOnce({ nodes: [issue('two')], pageInfo: { hasNextPage: false, endCursor: null } });

    const result = await paginateIssuePages(load);

    expect(result.issues.map((value) => value.id)).toEqual(['one', 'two']);
    expect(load).toHaveBeenNthCalledWith(2, 'next');
  });

  it('aborts on a missing or repeated cursor', async () => {
    await expect(paginateIssuePages(async () => ({
      nodes: [issue('one')],
      pageInfo: { hasNextPage: true, endCursor: null },
    }))).rejects.toThrow('invalid or repeated endCursor');

    const load = vi.fn()
      .mockResolvedValueOnce({ nodes: [issue('one')], pageInfo: { hasNextPage: true, endCursor: 'same' } })
      .mockResolvedValueOnce({ nodes: [issue('two')], pageInfo: { hasNextPage: true, endCursor: 'same' } });
    await expect(paginateIssuePages(load)).rejects.toThrow('invalid or repeated endCursor');
  });
});
