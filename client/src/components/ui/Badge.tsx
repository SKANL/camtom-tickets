import React from 'react';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
  style?: React.CSSProperties;
}

// Small read-only text label. Base matches the read-only SLA tags;
// callers pass `style` for tone/layout variations (e.g. the footer "Saved" pill).
export function Badge({ children, tone = 'neutral', className = '', style }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge--${tone} ${className}`.trim()} style={style}>
      {children}
    </span>
  );
}
