"use client";

import * as React from "react";
import { PanelLeft, X } from "lucide-react";
import { Sidebar } from "@/components/Sidebar";
import { TopNav } from "@/components/TopNav";
import { UpgradeBannerHeader } from "@/components/billing/UpgradeBannerHeader";

import type { ReactNode } from "react";

/**
 * Fixed-viewport app shell. The page itself never scrolls; `main` is the only
 * scroll container, and it scrolls on one axis.
 *
 * Why this rather than a taller-than-viewport document:
 *
 *  - The sidebar is *constant* by construction. Pinning it with `sticky` made
 *    it behave, but it was still a passenger on a scrolling document — one
 *    stray `position` or `overflow` on an ancestor and it detaches again.
 *    Here there is no document scroll to detach from.
 *  - `overflow-x: hidden` on the scroller makes horizontal scrolling
 *    IMPOSSIBLE, not merely absent. This is the guarantee, and it is honest
 *    about what it does: it clips rather than fixes. The actual fix is that the
 *    grids inside size from their container (auto-fit) and so have nothing to
 *    clip — see the layout contract in app/dashboard/page.tsx.
 *
 * `min-h-0` on main is load-bearing: a flex child defaults to `min-height:auto`,
 * which refuses to shrink below its content, so without it the column grows
 * past the viewport and the document scrolls after all — silently undoing the
 * whole arrangement.
 *
 * `h-dvh` rather than `h-screen` so mobile browser chrome collapsing does not
 * leave the shell taller than the visible area.
 *
 * ---------------------------------------------------------------------------
 * SIDEBAR VISIBILITY
 *
 * The sidebar is toggleable, and the toggle is always present in the top bar.
 * This fixes a real defect as much as it adds a feature: the aside was
 * `hidden md:flex` with no opener anywhere, so on any viewport under 768px the
 * ENTIRE navigation was `display: none` and unreachable — there was no way to
 * leave the current page.
 *
 * Two presentations, one piece of state:
 *   - md and up: an in-flow column. Closing it removes the column and the
 *     content genuinely reflows wider, because the content grids are
 *     container-relative and pick up the space rather than merely stretching.
 *   - below md: a fixed overlay drawer with a scrim, since a 240px in-flow
 *     column on a 390px screen leaves nothing for the content.
 * ---------------------------------------------------------------------------
 */
export function DashboardLayout({ children }: { children: ReactNode }) {
  // Open on desktop, closed on mobile. Both start false so the first client
  // paint matches the server render; the effect resolves the real value.
  const [open, setOpen] = React.useState(false);
  const [isDesktop, setIsDesktop] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = (matches: boolean) => {
      setIsDesktop(matches);
      setOpen(matches);
    };
    sync(query.matches);

    const onChange = (event: MediaQueryListEvent) => sync(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Escape closes the mobile drawer. Not wired on desktop, where the sidebar is
  // in flow and closing it is a deliberate choice rather than an escape hatch.
  React.useEffect(() => {
    if (!open || isDesktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isDesktop]);

  const toggle = (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      aria-controls="dashboard-sidebar"
      aria-label={open ? "Hide navigation" : "Show navigation"}
      className="shrink-0 rounded-dharma-md p-1.5 text-dharma-ink-secondary transition-colors duration-dharma-fast ease-dharma hover:bg-dharma-surface-hover hover:text-dharma-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent"
    >
      {open && !isDesktop ? (
        <X className="h-4 w-4" aria-hidden />
      ) : (
        <PanelLeft className="h-4 w-4" aria-hidden />
      )}
    </button>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-dharma-bg">
      <Sidebar
        id="dashboard-sidebar"
        open={open}
        overlay={!isDesktop}
        // On mobile the drawer covers the content, so following a link has to
        // close it or the destination is never seen.
        onNavigate={() => {
          if (!isDesktop) setOpen(false);
        }}
      />

      {/* Scrim, mobile only. Clicking outside is the gesture people reach for
          before they look for a close button. */}
      {open && !isDesktop && (
        <div
          className="fixed inset-0 z-30 bg-black/30"
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Chrome: fixed above the scroller, never shrinks. */}
        <div className="shrink-0">
          <TopNav leading={toggle} />
          <UpgradeBannerHeader />
        </div>
        <main
          id="dashboard-scroll"
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-5 lg:px-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
