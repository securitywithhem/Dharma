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
        "flex h-9 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs",
        "transition-[border-color,box-shadow] duration-150 ease-out",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "placeholder:text-muted-foreground/70",
        "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
        "aria-[invalid=true]:border-critical aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-critical/20",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";

export { Input };
