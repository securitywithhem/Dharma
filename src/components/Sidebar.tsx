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
    <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-critical px-1 text-[10px] font-semibold tabular-nums text-critical-foreground">
      {data > 99 ? "99+" : data}
    </span>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { href, icon: Icon, label } = item;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2 text-data font-medium",
        "transition-[background-color,color] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        active
          ? "bg-primary/8 text-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {/* A left marker rule rather than a filled button. The filled state made
          every visited section shout at the same volume as a primary action. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors duration-150",
          active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground",
        )}
      />
      <span className="truncate">{label}</span>
      {(href as string) === "/dashboard/regulatory-alerts" && <RegulatoryBadge />}
    </Link>
  );
}

export function Sidebar() {
  // usePathname() is typed nullable during the initial render pass.
  const pathname = usePathname() ?? "/dashboard";

  return (
    <aside className="surface-paper hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <DharmaMark className="h-7 w-7 text-primary" />
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold leading-none tracking-[-0.01em]">
            Dharma
          </p>
          <p className="mt-1 text-micro leading-none text-muted-foreground">
            Compliance workspace
          </p>
        </div>
      </div>

      <hr className="rule" />

      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
        {navGroups.map((group, groupIndex) => (
          <div key={group.label ?? `group-${groupIndex}`} className="space-y-0.5">
            {group.label && (
              <p className="label-eyebrow px-3 pb-1.5">{group.label}</p>
            )}
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
            ))}
          </div>
        ))}
      </nav>

      <hr className="rule" />

      <div className="space-y-0.5 px-2.5 py-3">
        <NavLink item={settingsItem} active={isActive(pathname, settingsItem.href)} />
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="flex w-full items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2 text-data font-medium text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="h-4 w-4 shrink-0 text-muted-foreground/70" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
