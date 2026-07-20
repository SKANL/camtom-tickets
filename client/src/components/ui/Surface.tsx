import React from 'react';

type SurfaceTone = 'default' | 'soft' | 'raised';

interface SurfaceProps extends React.HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article';
  tone?: SurfaceTone;
}

export function Surface({ as: Element = 'div', tone = 'default', className = '', ...props }: SurfaceProps) {
  return <Element className={`ui-surface ui-surface--${tone} ${className}`.trim()} {...props} />;
}
