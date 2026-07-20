import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTER } from '@camtom/shared';
import { FilterBar } from '../FilterBar';

describe('FilterBar responsive scroller', () => {
  it('exposes overflowing filter controls as a keyboard-focusable region', () => {
    render(<FilterBar metadata={null} filter={EMPTY_FILTER} onChange={vi.fn()} />);

    const scroller = screen.getByRole('region', { name: 'Controles de filtro desplazables' });
    expect(scroller).toHaveClass('filter-bar__scroller');
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(screen.getByPlaceholderText('Buscar tickets...')).toBeInTheDocument();
  });

  it('removes the scroll region when filters are collapsed and restores it when expanded', () => {
    render(<FilterBar metadata={null} filter={EMPTY_FILTER} onChange={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Filtros' });

    fireEvent.click(toggle);
    expect(screen.queryByRole('region', { name: 'Controles de filtro desplazables' })).not.toBeInTheDocument();
    expect(toggle.closest('.filter-bar')).toHaveClass('filter-bar--collapsed');

    fireEvent.click(toggle);
    expect(screen.getByRole('region', { name: 'Controles de filtro desplazables' })).toBeInTheDocument();
  });
});
