/** @jest-environment jsdom */
/**
 * WAVE 9.3 — the shared Dialog actually traps focus.
 *
 * Closes fullstack-audit-2026-08-06 §6 MEDIUM-1: dialog.tsx carried the comment
 * "Trap focus inside modal and close on Escape" above an effect that handled
 * ONLY Escape. There was no focus containment, no initial focus, no restore on
 * close, and no aria-labelledby despite role="dialog" + aria-modal="true" —
 * so a screen reader announced an unnamed dialog and Tab walked straight out
 * into the page behind it (WCAG 2.4.3 / 2.1.2).
 *
 * All six modals (AddFrameworkModal, ControlDetailModal, LogFindingModal,
 * NewScanModal, EvidenceUploadModal, ImportModal) consume this primitive, so
 * fixing it here fixes all of them — which is why this suite tests the
 * primitive rather than each modal.
 *
 * This is the "comment describes behaviour the code does not implement" case
 * the audit calls the dangerous kind (pattern P4): a reviewer reads the comment
 * and stops.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

/** A page with focusable content behind the modal — what focus must not reach. */
function Harness({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <div>
      <button data-testid="behind-1">Behind one</button>
      <button data-testid="behind-2">Behind two</button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete evidence?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <input data-testid="field" aria-label="Reason" />
          <DialogFooter>
            <button data-testid="cancel">Cancel</button>
            <button data-testid="confirm">Confirm</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function renderOpen() {
  const onOpenChange = jest.fn();
  const utils = render(<Harness open onOpenChange={onOpenChange} />);
  return { ...utils, onOpenChange };
}

describe('accessible name (§6 MEDIUM-1)', () => {
  it('names the dialog from its title via aria-labelledby', () => {
    renderOpen();
    const dialog = screen.getByRole('dialog');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toHaveTextContent('Delete evidence?');
  });

  it('describes it from its description', () => {
    renderOpen();
    const dialog = screen.getByRole('dialog');

    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent('This cannot be undone.');
  });

  it('is exposed to assistive tech as a modal dialog with a name', () => {
    renderOpen();
    // getByRole with a name only matches if the accessible name resolves —
    // this query itself fails on the pre-fix component.
    expect(screen.getByRole('dialog', { name: /delete evidence/i })).toBeInTheDocument();
  });
});

describe('initial focus', () => {
  it('moves focus into the dialog on open', () => {
    renderOpen();
    // Focus must not be left on the page behind an open modal.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('focuses the first focusable element', () => {
    renderOpen();
    expect(document.activeElement).toBe(screen.getByTestId('field'));
  });
});

describe('the trap (WCAG 2.4.3 / 2.1.2)', () => {
  /**
   * Resolve the real focusable order from the DOM rather than assuming it.
   * DialogContent renders its own "Close dialog" button AFTER {children}, so
   * the last tabbable is the close button, not the last child the caller
   * passed — an assumption worth not baking into the test.
   */
  function tabbables(dialog: HTMLElement): HTMLElement[] {
    return Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex='-1'])",
      ),
    );
  }

  it('Tab from the last element cycles to the first, not out of the dialog', async () => {
    const user = userEvent.setup();
    renderOpen();
    const dialog = screen.getByRole('dialog');
    const order = tabbables(dialog);
    const first = order[0];
    const last = order[order.length - 1];

    last.focus();
    await user.tab();

    expect(document.activeElement).toBe(first);
    expect(document.activeElement).not.toBe(screen.getByTestId('behind-1'));
  });

  it('Shift+Tab from the first element cycles to the last', async () => {
    const user = userEvent.setup();
    renderOpen();
    const dialog = screen.getByRole('dialog');
    const order = tabbables(dialog);
    const first = order[0];
    const last = order[order.length - 1];

    first.focus();
    await user.tab({ shift: true });

    expect(document.activeElement).toBe(last);
  });

  it('repeated Tab never lands on anything behind the modal', async () => {
    const user = userEvent.setup();
    renderOpen();
    const dialog = screen.getByRole('dialog');

    // The audit's exact repro: "open New Scan and press Tab repeatedly —
    // focus walks the page behind the modal."
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('pulls focus back if something outside grabs it', () => {
    renderOpen();
    const outside = screen.getByTestId('behind-1');

    // Programmatic focus from outside the Tab cycle — a click on the page
    // behind, or a stray focus() call.
    act(() => {
      outside.focus();
      outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('focus restore on close', () => {
  it('hands focus back to whatever opened the dialog', () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('data-testid', 'trigger');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(<Harness open onOpenChange={jest.fn()} />);
    expect(document.activeElement).not.toBe(trigger);

    // Closing must not drop focus onto <body>, which would make a keyboard
    // user restart from the top of the document.
    rerender(<Harness open={false} onOpenChange={jest.fn()} />);
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });
});

describe('Escape still closes (the behaviour that already worked)', () => {
  it('calls onOpenChange(false)', () => {
    const { onOpenChange } = renderOpen();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
