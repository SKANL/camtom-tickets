import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketCard } from '../TicketCard';
import { Issue } from '@camtom/shared';

const mockIssue: Issue = {
  id: 'issue-1',
  identifier: 'TEST-123',
  title: 'Fix login page timeout',
  priority: 1,
  priorityLabel: 'Urgent',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  assignee: { id: 'user-1', name: 'Alice' },
  state: { id: 'state-1', name: 'In Progress', type: 'started' },
};

import { TimerState } from '@camtom/shared';

const mockTimer = {
  deadline: Date.now() + 4 * 60 * 1000,
  remaining: 4 * 60 * 1000,
  state: 'FRESH' as TimerState,
  slaId: 'urgent_sla',
  maxMinutes: 30,
};

describe('TicketCard', () => {
  it('renders issue identifier', () => {
    render(<TicketCard issue={mockIssue} config={null} />);
    expect(screen.getByText(/TEST-123/)).toBeInTheDocument();
  });

  it('renders issue title', () => {
    render(<TicketCard issue={mockIssue} config={null} />);
    expect(screen.getByText('Fix login page timeout')).toBeInTheDocument();
  });

  it('renders priority badge with Urgent label', () => {
    render(<TicketCard issue={mockIssue} config={null} />);
    expect(screen.getByText(/Urgent/)).toBeInTheDocument();
  });

  it('renders assignee name', () => {
    render(<TicketCard issue={mockIssue} config={null} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('hides assignee area when no assignee', () => {
    const unassignedIssue: Issue = { ...mockIssue, assignee: null };
    render(<TicketCard issue={unassignedIssue} config={null} />);
    // Per TC3: no assignee name renders when unassigned — block conditionally renders
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('renders status label', () => {
    render(<TicketCard issue={mockIssue} config={null} />);
    expect(screen.getByText('Prep')).toBeInTheDocument();
  });

  it('renders SLATimer when timers prop is provided', () => {
    const { container } = render(<TicketCard issue={mockIssue} timer={mockTimer} config={null} />);
    // SLATimer renders an SVG
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders Done status for completed issues', () => {
    const completedIssue: Issue = {
      ...mockIssue,
      state: { id: 'state-2', name: 'Done', type: 'completed' },
    };
    render(<TicketCard issue={completedIssue} config={null} />);
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('does not render SLATimer when timer prop is not provided', () => {
    const { container } = render(<TicketCard issue={mockIssue} config={null} />);
    const svg = container.querySelector('.sla-timer');
    expect(svg).not.toBeInTheDocument();
  });
});
