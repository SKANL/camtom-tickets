import React, { useEffect, useId, useRef, useState } from 'react';

interface BoardViewportProps {
  layout: 'single' | 'split-vertical';
  left: React.ReactNode;
  right?: React.ReactNode;
  leftLabel: string;
  rightLabel?: string;
  leftSummary?: string;
  rightSummary?: string;
}

type PaneSide = 'left' | 'right';

export function BoardViewport({
  layout,
  left,
  right,
  leftLabel,
  rightLabel,
  leftSummary = 'Tablero',
  rightSummary = 'Tablero',
}: BoardViewportProps) {
  const [activePane, setActivePane] = useState<PaneSide>('left');
  const baseId = useId().replace(/:/g, '');
  const tabRefs = {
    left: useRef<HTMLButtonElement>(null),
    right: useRef<HTMLButtonElement>(null),
  };

  useEffect(() => {
    if (layout === 'single') setActivePane('left');
  }, [layout]);

  const split = layout === 'split-vertical' && !!right;
  const selectPane = (side: PaneSide, focus = false) => {
    setActivePane(side);
    if (focus) tabRefs[side].current?.focus();
  };
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, side: PaneSide) => {
    let target: PaneSide | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = side === 'left' ? 'right' : 'left';
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = side === 'right' ? 'left' : 'right';
    if (event.key === 'Home') target = 'left';
    if (event.key === 'End') target = 'right';
    if (!target) return;
    event.preventDefault();
    selectPane(target, true);
  };

  const panel = (node: React.ReactNode, side: PaneSide) => {
    if (!split) {
      return <div className={`board-viewport__panel board-viewport__panel--${side}`}>{node}</div>;
    }
    return (
      <div
        id={`${baseId}-panel-${side}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${side}`}
        className={`board-viewport__panel board-viewport__panel--${side}`}
        tabIndex={0}
      >
        {node}
      </div>
    );
  };

  const tab = (side: PaneSide, label: string, summary: string) => (
    <button
      ref={tabRefs[side]}
      id={`${baseId}-tab-${side}`}
      type="button"
      role="tab"
      aria-selected={activePane === side}
      aria-controls={`${baseId}-panel-${side}`}
      tabIndex={activePane === side ? 0 : -1}
      onClick={() => selectPane(side)}
      onKeyDown={(event) => onTabKeyDown(event, side)}
    >
      <span className="mobile-pane-switcher__position">{side === 'left' ? 'Izquierda' : 'Derecha'}</span>
      <strong>{label}</strong>
      <small>{activePane === side ? `Activo · ${summary}` : `Otro equipo · ${summary}`}</small>
    </button>
  );

  return (
    <div className="board-viewport-shell">
      {split && (
        <div className="mobile-pane-switcher" role="tablist" aria-label="Panel visible" aria-orientation="horizontal">
          {tab('left', leftLabel, leftSummary)}
          {tab('right', rightLabel ?? 'Segundo panel', rightSummary)}
        </div>
      )}
      <div className={`board-viewport ${layout}`} data-mobile-active={activePane}>
        {panel(left, 'left')}
        {split ? panel(right, 'right') : null}
      </div>
    </div>
  );
}
