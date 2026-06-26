"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileCheck2, FileText, LayoutDashboard, LogOut, Settings2, Shield } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

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
    href: "/dashboard/settings" as Route,
    label: "Settings",
    icon: Settings2
  }
];

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
