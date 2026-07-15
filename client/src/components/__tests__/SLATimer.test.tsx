import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SLATimer } from '../SLATimer';
import { TimerInfo } from '@camtom/shared';

describe('SLATimer', () => {
  const baseTimer: TimerInfo = {
    deadline: Date.now() + 5 * 60 * 1000,
    remaining: 5 * 60 * 1000,
    state: 'FRESH',
    slaId: 'test_sla',
    maxMinutes: 30,
  };

  it('renders SVG element', () => {
    const { container } = render(<SLATimer timer={baseTimer} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders time display when FRESH', () => {
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

  it('renders a fire icon (SVG, not an emoji) when EXPIRED', () => {
    const expiredTimer: TimerInfo = {
      ...baseTimer,
      remaining: 0,
      state: 'EXPIRED',
    };
    const { container } = render(<SLATimer timer={expiredTimer} />);
    // No emoji glyph — the countdown is replaced by the IconFire SVG.
    expect(screen.queryByText('🔥')).toBeNull();
    // Ring SVG + fire icon SVG.
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
  });

  it('has expired-burn class when in EXPIRED state', () => {
    const expiredTimer: TimerInfo = {
      ...baseTimer,
      remaining: 0,
      state: 'EXPIRED',
    };
    const { container } = render(<SLATimer timer={expiredTimer} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.classList.contains('expired-burn')).toBe(true);
  });

  it('has pulse-critical class when in CRITICAL state', () => {
    const criticalTimer: TimerInfo = {
      ...baseTimer,
      remaining: 10_000,
      state: 'CRITICAL',
    };
    const { container } = render(<SLATimer timer={criticalTimer} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.classList.contains('pulse-critical')).toBe(true);
  });

  it('has no animation class when in FRESH state', () => {
    const { container } = render(<SLATimer timer={baseTimer} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.classList.contains('pulse-critical')).toBe(false);
    expect(wrapper.classList.contains('expired-burn')).toBe(false);
  });

  it('renders with custom size', () => {
    const { container } = render(<SLATimer timer={baseTimer} size={128} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '128');
    expect(svg).toHaveAttribute('height', '128');
  });
});
