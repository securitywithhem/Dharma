"use client";

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

export function TopNav() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const crumbs = breadcrumbsFor(pathname ?? "/dashboard");

  const email = session?.user?.email ?? null;
  const name = session?.user?.name ?? null;

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-4 px-5">
        {/* The bar previously restated the page title the page itself already
            renders. A breadcrumb earns the space instead: it tells you where
            you are in a tree that is now four sections deep. */}
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex items-center gap-1 text-data">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <li key={crumb.href} className="flex min-w-0 items-center gap-1">
                  {index > 0 && (
                    <ChevronRight
                      aria-hidden
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                    />
                  )}
                  {last ? (
                    <span
                      aria-current="page"
                      className="truncate font-medium text-foreground"
                    >
                      {crumb.label}
                    </span>
                  ) : (
                    <Link
                      href={crumb.href as Route}
                      className="truncate rounded-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary"
            title={email ?? undefined}
          >
            {initialsFor(name, email)}
          </div>
        </div>
      </div>
    </header>
  );
}
