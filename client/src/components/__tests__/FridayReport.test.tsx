import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FridayReport } from '../FridayReport';
import { Issue } from '@camtom/shared';

const makeIssue = (overrides: Partial<Issue> & { id: string; priority: number }): Issue => ({
  identifier: `TEST-${overrides.id}`,
  title: 'Test issue',
  priorityLabel: 'Medium',
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date().toISOString(),
  assignee: { id: 'u1', name: 'Alice' },
  state: { id: 's1', name: 'In Progress', type: 'started' },
  ...overrides,
});

describe('FridayReport', () => {
  it('renders title and metric cards', () => {
    render(<FridayReport issues={[]} playSuccess={vi.fn()} config={null} />);
    expect(screen.getByText('Reporte del viernes')).toBeDefined();
    expect(screen.getByText('Resumen semanal de resolución')).toBeDefined();
  });

  it('shows N/A for metrics when no issues resolved', () => {
    render(<FridayReport issues={[]} playSuccess={vi.fn()} config={null} />);
    // Multiple elements show '0' — use getAllByText and verify at least one
    const zeroElements = screen.getAllByText(/^0$/);
    expect(zeroElements.length).toBeGreaterThanOrEqual(1);
    // Two metric cards show N/D: Cumplimiento SLA and Tiempo prom. de resolución
    const naElements = screen.getAllByText('N/D');
    expect(naElements).toHaveLength(2);
  });

  it('shows correct resolved count for weekly issues', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 1, state: { id: 's2', name: 'Done', type: 'completed' } }),
      makeIssue({ id: '2', priority: 3, state: { id: 's2', name: 'Done', type: 'completed' } }),
      makeIssue({ id: '3', priority: 2, state: { id: 's1', name: 'In Progress', type: 'started' } }),
    ];

    render(<FridayReport issues={issues} playSuccess={vi.fn()} config={null} />);
    // 2 completed, 1 in progress
    const resolvedTexts = screen.getAllByText(/^[0-9]+$/);
    expect(resolvedTexts.some((el) => el.textContent === '2')).toBe(true);
  });

  it('renders team performance section', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 2, state: { id: 's2', name: 'Done', type: 'completed' } }),
    ];

    render(<FridayReport issues={issues} playSuccess={vi.fn()} config={null} />);
    expect(screen.getByText('Rendimiento del equipo')).toBeDefined();
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByRole('table', { name: 'Rendimiento del equipo' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Chef' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Alice' })).toBeInTheDocument();
  });

  it('shows priority breakdown section', () => {
    render(<FridayReport issues={[]} playSuccess={vi.fn()} config={null} />);
    expect(screen.getByText('Por prioridad')).toBeDefined();
  });

  it('calls playSuccess on mount', () => {
    const playSuccess = vi.fn();
    render(<FridayReport issues={[]} playSuccess={playSuccess} config={null} />);
    expect(playSuccess).toHaveBeenCalledTimes(1);
  });

  it('renders all team member rows', () => {
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 2, assignee: { id: 'u1', name: 'Alice' }, state: { id: 's2', name: 'Done', type: 'completed' } }),
    ];

    render(<FridayReport issues={issues} playSuccess={vi.fn()} config={null} />);
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Sin asignar')).toBeDefined();
  });

  it('uses completedAt, not updatedAt, for the weekly window', () => {
    // Completed a month ago but edited just now: updatedAt would wrongly pull it
    // into this week's report — completedAt must keep it out.
    const issues: Issue[] = [
      makeIssue({
        id: '1',
        priority: 1,
        state: { id: 's2', name: 'Done', type: 'completed' },
        completedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ];

    render(<FridayReport issues={issues} playSuccess={vi.fn()} config={null} />);
    // Nothing resolved this week -> both computed metrics show N/D (as in the empty case)
    expect(screen.getAllByText('N/D')).toHaveLength(2);
  });

  it('shows correct SLA rate for completed issues', () => {
    // All completed within SLA time (created 1h ago, SLA 5min — still OK)
    const issues: Issue[] = [
      makeIssue({ id: '1', priority: 1, state: { id: 's2', name: 'Done', type: 'completed' } }),
      makeIssue({ id: '2', priority: 1, state: { id: 's2', name: 'Done', type: 'completed' } }),
    ];

    render(<FridayReport issues={issues} playSuccess={vi.fn()} config={null} />);
    // SLA rate should be 100% for on-time completion
    expect(screen.getByText('100%')).toBeDefined();
  });
});
