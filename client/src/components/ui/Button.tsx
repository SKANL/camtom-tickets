import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'neutral' | 'pill';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Only meaningful for the `pill` variant (toggle on/off state). */
  active?: boolean;
}

// Per-variant base look. Padding / fontSize / letterSpacing are intentionally
// left to the caller's `style` because they differ per button instance.
const VARIANT_BASE: Record<Exclude<ButtonVariant, 'pill'>, React.CSSProperties> = {
  primary: {
    background: 'var(--color-tomato)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    color: '#fff',
    cursor: 'pointer',
    fontFamily: 'var(--font-display)',
  },
  secondary: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 'var(--radius-sm)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    fontFamily: 'var(--font-display)',
  },
  danger: {
    background: 'rgba(255,99,71,0.15)',
    border: '1px solid rgba(255,99,71,0.3)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-ketchup)',
    cursor: 'pointer',
  },
  neutral: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 'var(--radius-sm)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
  },
};

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '2px 10px',
    borderRadius: 'var(--radius-pill)',
    border: `1px solid ${active ? 'var(--color-tomato)' : 'rgba(255,255,255,0.15)'}`,
    background: active ? 'rgba(255,99,71,0.2)' : 'transparent',
    color: active ? 'var(--color-tomato)' : 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-xs)',
  };
}

export function Button({
  variant = 'neutral',
  size = 'md',
  active = false,
  loading = false,
  className = '',
  disabled,
  style,
  children,
  ...rest
}: ButtonProps) {
  const base = variant === 'pill' ? pillStyle(active) : VARIANT_BASE[variant];
  return (
    <button
      className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()}
      style={{ ...base, ...style }}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="ui-button__spinner" aria-hidden="true" />}
      <span className="ui-button__content">{children}</span>
    </button>
  );
}
