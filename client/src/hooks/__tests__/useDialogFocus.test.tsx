import React, { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDialogFocus } from '../useDialogFocus';

function FocusRegion({ onEscape }: { onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onEscape);
  return <div ref={ref} tabIndex={-1}><button>First</button><input aria-label="Editor" /><button>Last</button></div>;
}

function Harness({ onEscape }: { onEscape: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open region</button>{open && <FocusRegion onEscape={() => { onEscape(); setOpen(false); }} />}</>;
}

describe('useDialogFocus', () => {
  it('keeps a roving trap, uses the latest Escape callback, and restores focus', () => {
    const firstEscape = vi.fn();
    const secondEscape = vi.fn();
    const { rerender } = render(<Harness onEscape={firstEscape} />);
    const opener = screen.getByRole('button', { name: 'Open region' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();

    const editor = screen.getByLabelText('Editor');
    editor.focus();
    rerender(<Harness onEscape={secondEscape} />);
    expect(editor).toHaveFocus();

    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(firstEscape).not.toHaveBeenCalled();
    expect(secondEscape).toHaveBeenCalledOnce();
    expect(opener).toHaveFocus();
  });
});
