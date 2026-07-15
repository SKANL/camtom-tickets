import React from 'react';

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-base)',
          color: 'var(--color-mustard)',
          margin: '0 0 var(--space-md)',
          letterSpacing: '0.05em',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 'var(--space-xs)',
        }}
      >
        {label}
      </h3>
      {children}
    </div>
  );
}

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
      <span style={{ minWidth: 140, fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.6)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  color: 'var(--color-mayo)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  flex: 1,
};

export const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};
