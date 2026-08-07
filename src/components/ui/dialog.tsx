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
  /**
   * Ids wired to aria-labelledby / aria-describedby on the dialog. Generated
   * here rather than passed in so every consumer gets an accessible name
   * without having to remember to plumb one — the previous version set
   * role="dialog" and aria-modal="true" with NO accessible name at all, which
   * a screen reader announces as an unnamed dialog.
   */
  titleId: string;
  descriptionId: string;
  /** Set when a DialogTitle/DialogDescription actually renders. */
  registerTitle: () => void;
  registerDescription: () => void;
  hasTitle: boolean;
  hasDescription: boolean;
}

const DialogContext = React.createContext<DialogContextValue>({
  open: false,
  onOpenChange: () => undefined,
  titleId: "",
  descriptionId: "",
  registerTitle: () => undefined,
  registerDescription: () => undefined,
  hasTitle: false,
  hasDescription: false,
});

function useDialog() {
  return React.useContext(DialogContext);
}

/**
 * Elements that can hold focus. `[tabindex="-1"]` is excluded deliberately:
 * such elements are programmatically focusable but must not appear in the Tab
 * cycle, which is exactly the distinction a trap has to respect.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hidden) return false;

    // Elements inside a collapsed section must not be reachable by Tab.
    //
    // Deliberately NOT `offsetParent !== null`, the usual shorthand: it is null
    // for position:fixed elements — which this dialog is — and is always null
    // under jsdom, which does no layout. Either would empty this list and
    // silently degrade the trap to "focus the container", i.e. no trap at all.
    // checkVisibility() answers the real question, and returns undefined where
    // unsupported, where we fall back to treating the element as visible.
    const visible = (el as { checkVisibility?: () => boolean }).checkVisibility?.();
    return visible ?? true;
  });
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

  const reactId = React.useId();
  const [hasTitle, setHasTitle] = React.useState(false);
  const [hasDescription, setHasDescription] = React.useState(false);

  const registerTitle = React.useCallback(() => setHasTitle(true), []);
  const registerDescription = React.useCallback(() => setHasDescription(true), []);

  const value = React.useMemo(
    () => ({
      open,
      onOpenChange: handleChange,
      titleId: `${reactId}-title`,
      descriptionId: `${reactId}-description`,
      registerTitle,
      registerDescription,
      hasTitle,
      hasDescription,
    }),
    [open, handleChange, reactId, registerTitle, registerDescription, hasTitle, hasDescription],
  );

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
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
        "fixed inset-0 z-50 bg-black/50 transition-opacity duration-dharma-base ease-dharma",
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
    const { open, onOpenChange, titleId, descriptionId, hasTitle, hasDescription } =
      useDialog();

    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const restoreFocusRef = React.useRef<HTMLElement | null>(null);

    // Merge the forwarded ref with our own — the trap needs the node.
    const setRefs = React.useCallback(
      (node: HTMLDivElement | null) => {
        contentRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      },
      [ref],
    );

    // WAVE 9.3 — a REAL focus trap.
    //
    // The comment here used to read "Trap focus inside modal and close on
    // Escape" above an effect that handled only Escape: there was no focus
    // containment, no initial focus and no restore, so Tab walked straight out
    // into the page behind the modal (WCAG 2.4.3 / 2.1.2). All six modals
    // consume this primitive, so the fix belongs here and nowhere else.
    React.useEffect(() => {
      if (!open) return;

      // Remember where focus came from so it can be handed back on close.
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      const node = contentRef.current;
      if (node) {
        // Initial focus: the first focusable element, falling back to the
        // dialog itself (tabIndex -1) so focus is never left on the page
        // behind an open modal.
        const focusables = focusableWithin(node);
        (focusables[0] ?? node).focus();
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onOpenChange(false);
          onClose?.();
          return;
        }

        if (e.key !== "Tab") return;

        const container = contentRef.current;
        if (!container) return;

        const focusables = focusableWithin(container);
        if (focusables.length === 0) {
          // Nothing to cycle between — keep focus on the dialog rather than
          // letting Tab escape to the page.
          e.preventDefault();
          container.focus();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey && (active === first || active === container)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      };

      // Backstop for focus that arrives from outside the Tab cycle — a click
      // on the page behind, or a programmatic focus() elsewhere. Without this
      // the trap holds only for keyboard Tab.
      const handleFocusIn = (e: FocusEvent) => {
        const container = contentRef.current;
        if (!container) return;
        if (e.target instanceof Node && container.contains(e.target)) return;
        const focusables = focusableWithin(container);
        (focusables[0] ?? container).focus();
      };

      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("focusin", handleFocusIn);

      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.removeEventListener("focusin", handleFocusIn);

        // Restore focus to whatever opened the dialog. Without this, closing a
        // modal drops focus onto <body> and a keyboard user restarts from the
        // top of the document.
        const toRestore = restoreFocusRef.current;
        if (toRestore && document.contains(toRestore)) {
          toRestore.focus();
        }
      };
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
          ref={setRefs}
          role="dialog"
          aria-modal="true"
          // Named by its own title. role="dialog" + aria-modal with no
          // accessible name announces as an unnamed dialog.
          aria-labelledby={hasTitle ? titleId : undefined}
          aria-describedby={hasDescription ? descriptionId : undefined}
          // Focusable as a last resort so the trap always has somewhere to put
          // focus, without entering the Tab cycle itself.
          tabIndex={-1}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dharma-border bg-dharma-surface p-6 border border-dharma-border",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-left-1/2 slide-in-from-top-[48%] duration-dharma-base",
            className,
          )}
          {...props}
        >
          {children}
          <button
            type="button"
            aria-label="Close dialog"
            className="absolute right-4 top-4 rounded-sm text-dharma-ink-secondary opacity-70 ring-offset-dharma-bg transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-dharma-accent focus:ring-offset-2"
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
>(({ className, id, ...props }, ref) => {
  const { titleId, registerTitle } = useDialog();

  // Tells DialogContent an accessible name exists, so aria-labelledby is set
  // only when it actually points at something.
  React.useEffect(() => registerTitle(), [registerTitle]);

  return (
    <h2
      ref={ref}
      id={id ?? titleId}
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
});
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, id, ...props }, ref) => {
  const { descriptionId, registerDescription } = useDialog();

  React.useEffect(() => registerDescription(), [registerDescription]);

  return (
    <p
      ref={ref}
      id={id ?? descriptionId}
      className={cn("text-sm text-dharma-ink-secondary", className)}
      {...props}
    />
  );
});
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
