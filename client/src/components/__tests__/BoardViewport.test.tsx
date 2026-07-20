import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BoardViewport } from '../BoardViewport';

describe('BoardViewport', () => {
  it('does not expose tab semantics when only one pane is rendered', () => {
    render(
      <BoardViewport
        layout="single"
        leftLabel="Support"
        left={<section>Only board</section>}
      />,
    );

    expect(screen.getByText('Only board')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  });

  it('exposes a mobile pane selector without removing either desktop pane', () => {
    const { container } = render(
      <BoardViewport
        layout="split-vertical"
        leftLabel="Support"
        rightLabel="Platform"
        leftSummary="Tablero · 3 tickets"
        rightSummary="Reporte · 8 tickets"
        left={<section>Left board</section>}
        right={<section>Right board</section>}
      />,
    );
    const rightTab = screen.getByRole('tab', { name: /Derecha Platform/ });
    const leftTab = screen.getByRole('tab', { name: /Izquierda Support/ });
    expect(leftTab).toHaveAttribute('tabindex', '0');
    expect(rightTab).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Otro equipo · Reporte · 8 tickets')).toBeInTheDocument();
    fireEvent.click(rightTab);
    expect(rightTab).toHaveAttribute('aria-selected', 'true');
    expect(rightTab).toHaveAttribute('tabindex', '0');
    expect(container.querySelector('.board-viewport')).toHaveAttribute('data-mobile-active', 'right');
    expect(screen.getByText('Left board')).toBeInTheDocument();
    expect(screen.getByText('Right board')).toBeInTheDocument();
    const rightPanel = screen.getByRole('tabpanel', { name: /Platform/ });
    expect(rightTab).toHaveAttribute('aria-controls', rightPanel.id);
  });

  it('supports arrow, Home, and End navigation with roving focus', () => {
    render(
      <BoardViewport
        layout="split-vertical"
        leftLabel="Support"
        rightLabel="Platform"
        left={<section>Left board</section>}
        right={<section>Right board</section>}
      />,
    );
    const leftTab = screen.getByRole('tab', { name: /Izquierda Support/ });
    const rightTab = screen.getByRole('tab', { name: /Derecha Platform/ });
    leftTab.focus();
    fireEvent.keyDown(leftTab, { key: 'ArrowRight' });
    expect(rightTab).toHaveFocus();
    expect(rightTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rightTab, { key: 'Home' });
    expect(leftTab).toHaveFocus();
    fireEvent.keyDown(leftTab, { key: 'End' });
    expect(rightTab).toHaveFocus();
  });

  it('renders concrete tabpanels even when a child component ignores injected props', () => {
    const OpaquePane = ({ text }: { text: string }) => <section>{text}</section>;
    render(
      <BoardViewport
        layout="split-vertical"
        leftLabel="Support"
        rightLabel="Platform"
        left={<OpaquePane text="Left" />}
        right={<OpaquePane text="Right" />}
      />,
    );
    for (const tab of screen.getAllByRole('tab')) {
      const panelId = tab.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      expect(document.getElementById(panelId!)).toHaveAttribute('role', 'tabpanel');
      expect(document.getElementById(panelId!)).toHaveAttribute('aria-labelledby', tab.id);
    }
  });
});
