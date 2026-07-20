import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';

function Harness({ onConfirm = vi.fn() }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open confirmation</button>
      <ConfirmDialog
        open={open}
        title="Confirm action"
        description="This cannot be undone."
        confirmLabel="Continue"
        onConfirm={onConfirm}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe('ConfirmDialog focus management', () => {
  it('focuses cancel first and traps Tab and Shift+Tab', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    const confirm = screen.getByRole('button', { name: 'Continue' });
    expect(cancel).toHaveFocus();

    confirm.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it('cancels on Escape and restores focus to the opener', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open confirmation' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
