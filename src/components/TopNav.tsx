"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useSession } from "next-auth/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { breadcrumbsFor } from "@/lib/navigation";

import type { Route } from "next";

/** Initials for the avatar chip, from name if present, else the email local part. */
function initialsFor(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function TopNav({ leading }: { leading?: React.ReactNode } = {}) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname ?? "/dashboard");

  const email = session?.user?.email ?? null;
  const name = session?.user?.name ?? null;

  return (
    // Not sticky. It sits above the shell's scroll container rather than inside
    // it, so it is already fixed in place; a `sticky top-0` here did nothing but
    // invite the reader to think this bar scrolls.
    <header className="z-20 border-b border-dharma-border bg-dharma-bg">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-5">
        {/* `leading` carries the sidebar toggle. It lives here rather than in
            the sidebar itself because it must stay reachable when the sidebar is
            closed — which, below md, it always was. */}
        {leading}
        {/* The bar previously restated the page title the page itself already
            renders. A breadcrumb earns the space instead: it tells you where
            you are in a tree that is now four sections deep. */}
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex items-center gap-1 text-data">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <li key={crumb.href} className="flex min-w-0 items-center gap-1">
                  {index > 0 && (
                    <ChevronRight
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-dharma-ink-secondary"
                    />
                  )}
                  {last ? (
                    <span
                      aria-current="page"
                      className="truncate font-medium text-dharma-ink"
                    >
                      {crumb.label}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href as Route}
                      className="truncate rounded-sm text-dharma-ink-secondary transition-colors duration-150 hover:text-dharma-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent"
                    >
                      {crumb.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex shrink-0 items-center gap-2.5">
          <Badge variant="outline" className="hidden sm:inline-flex">
            {session?.user?.role ?? "VIEWER"}
          </Badge>
          <ThemeToggle />
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full bg-dharma-accent-tint text-[11px] font-semibold text-dharma-accent-on-tint"
            title={email ?? undefined}
          >
            {initialsFor(name, email)}
          </div>
        </div>
      </div>
    </header>
  );
}
