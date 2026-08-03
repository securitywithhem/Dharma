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

import { Button } from "@/components/ui/button";
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
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
