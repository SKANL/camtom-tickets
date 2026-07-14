import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SLATimer } from '../SLATimer';
import { TimerInfo } from '@camtom/shared';

describe('SLATimer', () => {
  const baseTimer: TimerInfo = {
    deadline: Date.now() + 5 * 60 * 1000,
    remaining: 5 * 60 * 1000,
    state: 'OK',
    slaId: 'test_sla',
  };

  it('renders SVG element', () => {
    const { container } = render(<SLATimer timer={baseTimer} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders time display when OK', () => {
    render(<SLATimer timer={baseTimer} />);
    // Should show mm:ss format
    expect(screen.getByText(/05:00/)).toBeInTheDocument();
  });

  it('renders different time for partial remaining', () => {
    const partialTimer: TimerInfo = {
      ...baseTimer,
      remaining: 2 * 60 * 1000 + 30 * 1000, // 2:30
    };
    render(<SLATimer timer={partialTimer} />);
    expect(screen.getByText(/02:30/)).toBeInTheDocument();
  });

  it('renders 00:00 when breached', () => {
    const breachedTimer: TimerInfo = {
      ...baseTimer,
      remaining: 0,
      state: 'BREACHED',
    };
    render(<SLATimer timer={breachedTimer} />);
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it('has pulse-warning class when in WARNING state', () => {
    const warningTimer: TimerInfo = {
      ...baseTimer,
      remaining: 30_000, // 30 seconds
      state: 'WARNING',
    };
    const { container } = render(<SLATimer timer={warningTimer} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.classList.contains('pulse-warning')).toBe(true);
  });

  it('has shake-breach class when in BREACHED state', () => {
    const breachedTimer: TimerInfo = {
      ...baseTimer,
      remaining: 0,
      state: 'BREACHED',
    };
    const { container } = render(<SLATimer timer={breachedTimer} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.classList.contains('shake-breach')).toBe(true);
  });

  it('has no animation class when in OK state', () => {
    const { container } = render(<SLATimer timer={baseTimer} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.classList.contains('pulse-warning')).toBe(false);
    expect(wrapper.classList.contains('shake-breach')).toBe(false);
  });

  it('renders with custom size', () => {
    const { container } = render(<SLATimer timer={baseTimer} size={128} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '128');
    expect(svg).toHaveAttribute('height', '128');
  });
});
