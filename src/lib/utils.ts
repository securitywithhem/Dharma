import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must be taught this project's custom fontSize keys
// (tailwind.config.ts: micro/meta/data/display-*). Without this it cannot tell
// `text-data` (a size) from `text-primary-foreground` (a colour), classes them
// into the same group, and drops whichever came first — so
// `cn("bg-primary text-primary-foreground", "text-data")` silently loses the
// text colour.
//
// That is not hypothetical: it stripped the foreground from every
// size="sm"/"xs" Button, which then inherited body ink onto indigo at 1.63:1
// and failed WCAG AA. Caught by tests/e2e/design-system.spec.ts.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "micro",
            "meta",
            "data",
            "display-sm",
            "display-md",
            "display-lg",
            "display-xl",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
