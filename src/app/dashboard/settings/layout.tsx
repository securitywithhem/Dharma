"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Users, CreditCard, Shield, Cloud, Webhook, KeyRound, UserCog, ScrollText, Palette, Code2 } from "lucide-react";

const settingsTabs = [
  { href: "/dashboard/settings/general", label: "General", icon: <Settings className="w-4 h-4" /> },
  { href: "/dashboard/settings/team", label: "Team", icon: <Users className="w-4 h-4" /> },
  { href: "/dashboard/settings/connectors", label: "Connectors", icon: <Cloud className="w-4 h-4" /> },
  { href: "/dashboard/settings/webhooks", label: "Webhooks", icon: <Webhook className="w-4 h-4" /> },
  { href: "/dashboard/settings/billing", label: "Billing", icon: <CreditCard className="w-4 h-4" /> },
  { href: "/dashboard/settings/security", label: "Security", icon: <Shield className="w-4 h-4" /> },
  // Phase 8 Part 1 — Enterprise SSO/SCIM + custom roles
  { href: "/dashboard/settings/enterprise/sso", label: "SSO & SCIM", icon: <KeyRound className="w-4 h-4" /> },
  { href: "/dashboard/settings/enterprise/roles", label: "Roles", icon: <UserCog className="w-4 h-4" /> },
  // Phase 8 Part 2 — audit viewer + white-label
  { href: "/dashboard/settings/enterprise/audit-log", label: "Audit Log", icon: <ScrollText className="w-4 h-4" /> },
  { href: "/dashboard/settings/enterprise/white-label", label: "White-label", icon: <Palette className="w-4 h-4" /> },
  // Phase 9 Part 3 — public API keys
  { href: "/dashboard/settings/api-keys", label: "API Keys", icon: <Code2 className="w-4 h-4" /> },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col md:flex-row gap-8">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-56 flex-shrink-0">
        <nav className="space-y-1">
          {settingsTabs.map((tab) => {
            // Check if current path matches or starts with the tab href
            const isActive = pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                href={tab.href as any}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-dharma-accent-tint text-dharma-accent-on-tint"
                    : "text-dharma-ink-secondary hover:bg-dharma-surface-hover hover:text-dharma-ink"
                }`}
              >
                {tab.icon}
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
