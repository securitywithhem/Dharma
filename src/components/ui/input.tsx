import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        // Focus moves the border to the ring colour as well as drawing the
        // ring — on a warm paper background a ring alone reads as a glow
        // rather than as "this field is active".
        "flex h-9 w-full rounded-md border border-dharma-border-strong bg-dharma-surface px-3 py-2 text-sm border border-dharma-border",
        "transition-[border-color,box-shadow] duration-150 ease-out",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-dharma-ink-secondary",
        "focus-visible:outline-none focus-visible:border-dharma-accent focus-visible:ring-2 focus-visible:ring-dharma-accent",
        "aria-[invalid=true]:border-dharma-danger aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-dharma-danger",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-dharma-surface-hover",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";

export { Input };
