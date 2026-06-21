"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------
// Context
// ------------------------------------------------------------------

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextValue>({
  open: false,
  onOpenChange: () => undefined,
});

function useDialog() {
  return React.useContext(DialogContext);
}

// ------------------------------------------------------------------
// Root
// ------------------------------------------------------------------

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Dialog({ open = false, onOpenChange, children }: DialogProps) {
  const handleChange = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  return (
    <DialogContext.Provider value={{ open, onOpenChange: handleChange }}>
      {children}
    </DialogContext.Provider>
  );
}

// ------------------------------------------------------------------
// Trigger
// ------------------------------------------------------------------

interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const DialogTrigger = React.forwardRef<HTMLButtonElement, DialogTriggerProps>(
  ({ onClick, children, ...props }, ref) => {
    const { onOpenChange } = useDialog();

    return (
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          onClick?.(e);
          onOpenChange(true);
        }}
        {...props}
      >
        {children}
      </button>
    );
  },
);
DialogTrigger.displayName = "DialogTrigger";

// ------------------------------------------------------------------
// Portal / Overlay / Content
// ------------------------------------------------------------------

interface DialogOverlayProps extends React.HTMLAttributes<HTMLDivElement> {}

const DialogOverlay = React.forwardRef<HTMLDivElement, DialogOverlayProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-200",
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  ),
);
DialogOverlay.displayName = "DialogOverlay";

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  onClose?: () => void;
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, onClose, ...props }, ref) => {
    const { open, onOpenChange } = useDialog();

    // Trap focus inside modal and close on Escape
    React.useEffect(() => {
      if (!open) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onOpenChange(false);
          onClose?.();
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, onOpenChange, onClose]);

    if (!open) return null;

    return (
      <>
        <DialogOverlay
          onClick={() => {
            onOpenChange(false);
            onClose?.();
          }}
        />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-xl",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-left-1/2 slide-in-from-top-[48%] duration-200",
            className,
          )}
          {...props}
        >
          {children}
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            onClick={() => {
              onOpenChange(false);
              onClose?.();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </>
    );
  },
);
DialogContent.displayName = "DialogContent";

// ------------------------------------------------------------------
// Header / Footer / Title / Description
// ------------------------------------------------------------------

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("mb-4 flex flex-col space-y-1.5 pr-8", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "mt-6 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogTrigger,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
