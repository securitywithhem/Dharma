"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Bug, FileBarChart, FileCheck2, FileText, Grid3x3, LayoutDashboard, LogOut, MonitorSmartphone, Radar, Settings2, Shield, Store } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/trpc";

import type { Route } from "next";

const navigation = [
  {
    href: "/dashboard" as Route,
    label: "Compliance Status",
    icon: LayoutDashboard
  },
  {
    href: "/dashboard/frameworks" as Route,
    label: "Certification Goals",
    icon: Shield
  },
  {
    href: "/dashboard/policies" as Route,
    label: "Policies",
    icon: FileText
  },
  {
    href: "/dashboard/evidence" as Route,
    label: "Evidence",
    icon: FileCheck2
  },
  {
    href: "/dashboard/marketplace" as Route,
    label: "Marketplace",
    icon: Store
  },
  {
    href: "/dashboard/cross-walk" as Route,
    label: "Cross-Walk Mapping",
    icon: Grid3x3
  },
  {
    href: "/dashboard/pentests" as Route,
    label: "Pentests",
    icon: Radar
  },
  {
    href: "/dashboard/vulnerabilities" as Route,
    label: "Vulnerabilities",
    icon: Bug
  },
  {
    // Phase 9 Part 1 — endpoint agent (EDR-lite)
    href: "/dashboard/endpoints" as Route,
    label: "Endpoints",
    icon: MonitorSmartphone
  },
  {
    // Phase 9 Part 2 — advanced reporting
    href: "/dashboard/reports" as Route,
    label: "Reports",
    icon: FileBarChart
  },
  {
    // Phase 9 Part 3 — regulatory change monitoring (notification bell)
    href: "/dashboard/regulatory-alerts" as Route,
    label: "Regulatory",
    icon: Bell
  },
  {
    href: "/dashboard/settings" as Route,
    label: "Settings",
    icon: Settings2
  }
];

/** Unread-alert count badge for the notification bell nav item. */
function RegulatoryBadge() {
  const { data } = api.regulatory.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  if (!data || data <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
      {data > 99 ? "99+" : data}
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-border/80 bg-[linear-gradient(180deg,rgba(255,251,235,0.8),rgba(255,255,255,1))] p-6 dark:bg-[linear-gradient(180deg,rgba(41,37,36,0.7),rgba(9,9,11,1))] md:flex">
      <div className="mb-8 space-y-3">
        <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
          Dharma
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compliance Workspace</h1>
          <p className="text-sm text-muted-foreground">
            Self-hosted compliance workspace for proof, policies, and certification goals.
          </p>
        </div>
      </div>

      <nav className="space-y-2">
        {navigation.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                buttonVariants({ variant: active ? "default" : "ghost", size: "default" }),
                "w-full justify-start gap-3",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {(href as string) === "/dashboard/regulatory-alerts" && <RegulatoryBadge />}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-8">
        <Button
          variant="outline"
          className="w-full justify-start gap-3"
          onClick={() => signOut({ callbackUrl: "/" })}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
