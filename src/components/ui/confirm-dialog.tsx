"use client";

/**
 * Shared confirmation dialog for destructive actions.
 *
 * Dharma is a compliance product with no soft-delete on reports or schedules,
 * so a misplaced click is unrecoverable. Every irreversible action should route
 * through this rather than firing straight from an icon button.
 *
 * Deliberately uncontrolled-open: the caller owns `open`, so one dialog
 * instance can serve a whole table without rendering a dialog per row.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  /** Label for the destructive action. Say what happens, not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Disables the confirm button while the mutation is in flight. */
  pending?: boolean;
  onConfirm: () => void;
  /**
   * GH #24 — type-to-confirm, for actions that destroy audit-adjacent history
   * or sign an entire organization out.
   *
   * Pass the exact string the user must type (the record's own name, or a word
   * like `REVOKE`). Omit it for ordinary destructive actions: gating everything
   * behind typing trains people to copy-paste past the dialog, which costs the
   * friction its meaning exactly where it is needed most.
   */
  requireTypedConfirmation?: string;
  /** Label above the type-to-confirm field. */
  typedConfirmationLabel?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  pending = false,
  onConfirm,
  requireTypedConfirmation,
  typedConfirmationLabel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");

  // Reset whenever the dialog opens. Without this, a user who cancels one
  // deletion and opens another finds the box pre-filled with the previous
  // record's name — which would satisfy the gate for the wrong record if the
  // two happen to share a name.
  React.useEffect(() => {
    if (open) {
      setTyped("");
    }
  }, [open]);

  const typedOk =
    !requireTypedConfirmation || typed.trim() === requireTypedConfirmation;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {requireTypedConfirmation && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-typed" className="text-xs">
              {typedConfirmationLabel ?? (
                <>
                  Type <span className="font-mono font-semibold">{requireTypedConfirmation}</span> to
                  confirm
                </>
              )}
            </Label>
            <Input
              id="confirm-typed"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              // Not autoFocus: the point of this field is that the user reads
              // the consequence in the description above it first.
              placeholder={requireTypedConfirmation}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={pending || !typedOk}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
