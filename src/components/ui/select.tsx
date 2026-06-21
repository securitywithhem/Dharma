"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------
// Context
// ------------------------------------------------------------------

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SelectContext = React.createContext<SelectContextValue>({
  value: "",
  onValueChange: () => undefined,
  open: false,
  setOpen: () => undefined,
});

// ------------------------------------------------------------------
// Root
// ------------------------------------------------------------------

interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}

function Select({ value, defaultValue = "", onValueChange, children }: SelectProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [open, setOpen] = React.useState(false);

  const resolvedValue = value ?? internalValue;

  const handleValueChange = React.useCallback(
    (next: string) => {
      setInternalValue(next);
      onValueChange?.(next);
      setOpen(false);
    },
    [onValueChange],
  );

  // Close on outside click
  const containerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <SelectContext.Provider
      value={{
        value: resolvedValue,
        onValueChange: handleValueChange,
        open,
        setOpen,
      }}
    >
      <div ref={containerRef} className="relative">
        {children}
      </div>
    </SelectContext.Provider>
  );
}

// ------------------------------------------------------------------
// Trigger
// ------------------------------------------------------------------

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const { open, setOpen } = React.useContext(SelectContext);

    return (
      <button
        ref={ref}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        onClick={() => setOpen(!open)}
        {...props}
      >
        {children}
        <ChevronDown
          className={cn(
            "ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
    );
  },
);
SelectTrigger.displayName = "SelectTrigger";

// ------------------------------------------------------------------
// Value
// ------------------------------------------------------------------

interface SelectValueProps {
  placeholder?: string;
  className?: string;
}

function SelectValue({ placeholder, className }: SelectValueProps) {
  const { value } = React.useContext(SelectContext);
  return (
    <span className={cn("block truncate", !value && "text-muted-foreground", className)}>
      {value || placeholder}
    </span>
  );
}

// ------------------------------------------------------------------
// Content
// ------------------------------------------------------------------

interface SelectContentProps extends React.HTMLAttributes<HTMLUListElement> {}

const SelectContent = React.forwardRef<HTMLUListElement, SelectContentProps>(
  ({ className, children, ...props }, ref) => {
    const { open } = React.useContext(SelectContext);

    if (!open) return null;

    return (
      <ul
        ref={ref}
        role="listbox"
        className={cn(
          "absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card py-1 shadow-lg",
          "animate-in fade-in-0 zoom-in-95 duration-100",
          className,
        )}
        {...props}
      >
        {children}
      </ul>
    );
  },
);
SelectContent.displayName = "SelectContent";

// ------------------------------------------------------------------
// Item
// ------------------------------------------------------------------

interface SelectItemProps extends React.LiHTMLAttributes<HTMLLIElement> {
  value: string;
}

const SelectItem = React.forwardRef<HTMLLIElement, SelectItemProps>(
  ({ className, value, children, ...props }, ref) => {
    const { value: selectedValue, onValueChange } = React.useContext(SelectContext);
    const isSelected = selectedValue === value;

    return (
      <li
        ref={ref}
        role="option"
        aria-selected={isSelected}
        className={cn(
          "relative flex cursor-pointer select-none items-center px-3 py-2 text-sm outline-none transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          isSelected && "bg-accent/70 font-medium text-accent-foreground",
          className,
        )}
        onClick={() => onValueChange(value)}
        {...props}
      >
        {children}
      </li>
    );
  },
);
SelectItem.displayName = "SelectItem";

// ------------------------------------------------------------------
// Separator (optional)
// ------------------------------------------------------------------

const SelectSeparator = React.forwardRef<
  HTMLLIElement,
  React.HTMLAttributes<HTMLLIElement>
>(({ className, ...props }, ref) => (
  <li
    ref={ref}
    role="separator"
    className={cn("my-1 h-px bg-border", className)}
    {...props}
  />
));
SelectSeparator.displayName = "SelectSeparator";

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectSeparator,
};
