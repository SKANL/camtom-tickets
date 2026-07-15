import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

// Small read-only text label. Base matches the read-only SLA tags;
// callers pass `style` for tone/layout variations (e.g. the footer "Saved" pill).
export function Badge({ children, style }: BadgeProps) {
  return (
    <span style={{ fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.4)', ...style }}>
      {children}
    </span>
  );
}
