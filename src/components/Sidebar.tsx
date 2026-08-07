"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/trpc";
import { DharmaMark } from "@/components/brand/DharmaMark";
import { isActive, navGroups, settingsItem, type NavItem } from "@/lib/navigation";

/** Unread-alert count badge for the notification bell nav item. */
function RegulatoryBadge() {
  const { data } = api.regulatory.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  if (!data || data <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-dharma-danger-bg px-1 text-[10px] font-semibold tabular-nums text-dharma-danger-text">
      {data > 99 ? "99+" : data}
    </span>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { href, icon: Icon, label } = item;

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2 text-data font-medium",
        "transition-[background-color,color] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent focus-visible:ring-offset-1 focus-visible:ring-offset-dharma-bg",
        active
          ? "bg-dharma-accent-tint text-dharma-accent-on-tint"
          : "text-dharma-ink-secondary hover:bg-dharma-surface-hover hover:text-dharma-ink",
      )}
    >
      {/* A left marker rule rather than a filled button. The filled state made
          every visited section shout at the same volume as a primary action. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-dharma-accent transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors duration-150",
          active ? "text-dharma-accent-on-tint" : "text-dharma-ink-secondary group-hover:text-dharma-ink",
        )}
      />
      <span className="truncate">{label}</span>
      {(href as string) === "/dashboard/regulatory-alerts" && <RegulatoryBadge />}
    </Link>
  );
}

export interface SidebarProps {
  id?: string;
  /** Rendered at all when false; the shell owns this state. */
  open?: boolean;
  /** Below md the sidebar floats over the content instead of taking a column. */
  overlay?: boolean;
  /** Called after a nav link is followed, so the shell can close the drawer. */
  onNavigate?: () => void;
}

export function Sidebar({ id, open = true, overlay = false, onNavigate }: SidebarProps) {
  // usePathname() is typed nullable during the initial render pass.
  const pathname = usePathname() ?? "/dashboard";

  // WAVE 5.2 — gated sections (MSSP, Publisher, Catalogue Review).
  //
  // Branching on `isSuccess && data?.x` rather than `data?.x ?? fallback`: the
  // fallback form is the permission-gating anti-pattern WAVE 2.3 removed, and
  // here it would briefly render an MSSP link to every user on each load.
  // Hidden until the server has actually said yes.
  const capabilitiesQuery = api.user.capabilities.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!item.gate) return true;
        return capabilitiesQuery.isSuccess && capabilitiesQuery.data[item.gate];
      }),
    }))
    // A group whose every item is gated away must not leave a stray heading.
    .filter((group) => group.items.length > 0);

  // Unmounted rather than hidden. A `display:none` sidebar still leaves its
  // links in the accessibility tree in some readers, and this used to be the
  // ONLY state below md — navigation was unreachable with no opener anywhere.
  if (!open) return null;

  return (
    /*
      Constant, with no positioning trick required. DashboardLayout is a
      fixed-viewport shell whose only scroll container is <main>, so in the
      in-flow case this aside simply fills the row height and cannot move —
      there is no document scroll for it to ride.

      In `overlay` mode (below md) it becomes a fixed drawer instead, because a
      240px in-flow column on a 390px screen leaves nothing for the content.

      The nav below keeps overflow-y-auto purely as a safety valve for short
      viewports; at any normal height the items all fit and nothing scrolls.
    */
    <aside
      id={id}
      className={cn(
        "surface-paper flex w-60 shrink-0 flex-col border-r border-dharma-border bg-dharma-surface",
        overlay
          ? // Floats above the content and the scrim. A 240px in-flow column on
            // a 390px screen would leave nothing for the page itself.
            "fixed inset-y-0 left-0 z-40 h-dvh"
          : "h-full",
      )}
    >
      <div className="flex shrink-0 items-center gap-2.5 px-4 py-4">
        <DharmaMark className="h-7 w-7 text-dharma-accent-on-tint" />
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold leading-none tracking-[-0.01em]">
            Dharma
          </p>
          <p className="mt-1 text-micro leading-none text-dharma-ink-secondary">
            Compliance workspace
          </p>
        </div>
      </div>

      <hr className="rule" />

      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
        {visibleGroups.map((group, groupIndex) => (
          <div key={group.label ?? `group-${groupIndex}`} className="space-y-0.5">
            {group.label && (
              <p className="label-eyebrow px-3 pb-1.5">{group.label}</p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <hr className="rule" />

      {/* shrink-0: on a short viewport the scrollable nav gives up space, never
          this frame. Settings and Sign out stay reachable at any height. */}
      <div className="shrink-0 space-y-0.5 px-2.5 py-3">
        <NavLink
          item={settingsItem}
          active={isActive(pathname, settingsItem.href)}
          onNavigate={onNavigate}
        />
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="flex w-full items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2 text-data font-medium text-dharma-ink-secondary transition-colors duration-150 hover:bg-dharma-surface-hover hover:text-dharma-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dharma-accent"
        >
          <LogOut className="h-4 w-4 shrink-0 text-dharma-ink-secondary" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
