import {
  Bell,
  Bug,
  Building2,
  FileBarChart,
  FileCheck2,
  FileText,
  Grid3x3,
  LayoutDashboard,
  MonitorSmartphone,
  PackageOpen,
  Radar,
  Settings2,
  Shield,
  ShieldCheck,
  Store,
} from "lucide-react";

import type { Route } from "next";
import type { LucideIcon } from "lucide-react";

/**
 * Capability required to see a nav item, resolved server-side by
 * `user.navCapabilities`. Undefined means every org member sees it.
 *
 * Deliberately a capability name rather than a role: the sidebar must not
 * re-implement an authorization rule that a router already owns, or the two
 * drift and the menu starts advertising sections the API refuses.
 */
export type NavGate = "mssp" | "publisher" | "platformAdmin";

export type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  gate?: NavGate;
};

export type NavGroup = {
  /** null renders the group without a section heading. */
  label: string | null;
  items: NavItem[];
};

/**
 * Single source of truth for dashboard navigation — consumed by both the
 * sidebar (to render the menu) and the top bar (to resolve breadcrumb labels).
 * Keeping one list avoids the two drifting apart when a route is added.
 *
 * Twelve flat destinations is past the point where a sidebar scans as a list
 * rather than a menu. Grouping by the phase of compliance work a user is in
 * (prove it / defend it / report on it) lets them land on a section before
 * reading individual labels.
 */
export const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/dashboard" as Route, label: "Compliance Status", icon: LayoutDashboard },
    ],
  },
  {
    label: "Comply",
    items: [
      { href: "/dashboard/frameworks" as Route, label: "Certification Goals", icon: Shield },
      { href: "/dashboard/policies" as Route, label: "Policies", icon: FileText },
      { href: "/dashboard/evidence" as Route, label: "Evidence", icon: FileCheck2 },
      { href: "/dashboard/cross-walk" as Route, label: "Cross-Walk Mapping", icon: Grid3x3 },
    ],
  },
  {
    label: "Defend",
    items: [
      { href: "/dashboard/pentests" as Route, label: "Pentests", icon: Radar },
      { href: "/dashboard/vulnerabilities" as Route, label: "Vulnerabilities", icon: Bug },
      // Phase 9 Part 1 — endpoint agent (EDR-lite)
      { href: "/dashboard/endpoints" as Route, label: "Endpoints", icon: MonitorSmartphone },
    ],
  },
  {
    label: "Insight",
    items: [
      // Phase 9 Part 2 — advanced reporting
      { href: "/dashboard/reports" as Route, label: "Reports", icon: FileBarChart },
      // Phase 9 Part 3 — regulatory change monitoring (notification bell)
      { href: "/dashboard/regulatory-alerts" as Route, label: "Regulatory", icon: Bell },
      { href: "/dashboard/marketplace" as Route, label: "Marketplace", icon: Store },
    ],
  },
  /**
   * WAVE 5.2 — the seven routes that shipped with zero inbound links.
   *
   * `/dashboard/mssp`, `/dashboard/publisher/*` and `/dashboard/admin/*` all
   * existed and worked, but nothing anywhere in the app linked to them: the
   * MSSP dashboard is a headline Phase 8 deliverable a customer could only
   * reach by typing the URL. Grouped rather than appended to Insight, because
   * these are a different *kind* of destination — they are not part of one
   * tenant's compliance work, and mixing them into Comply/Defend/Insight would
   * blur the grouping that makes the sidebar scan as sections.
   *
   * Every item is gated, so for an ordinary member this group renders as
   * nothing at all and the sidebar is unchanged from before.
   */
  {
    label: "Manage",
    items: [
      { href: "/dashboard/mssp" as Route, label: "Client Portfolio", icon: Building2, gate: "mssp" },
      { href: "/dashboard/publisher/items" as Route, label: "My Listings", icon: PackageOpen, gate: "publisher" },
      { href: "/dashboard/admin/marketplace" as Route, label: "Catalogue Review", icon: ShieldCheck, gate: "platformAdmin" },
    ],
  },
];

export const settingsItem: NavItem = {
  href: "/dashboard/settings" as Route,
  label: "Settings",
  icon: Settings2,
};

const allItems: NavItem[] = [
  ...navGroups.flatMap((group) => group.items),
  settingsItem,
];

/**
 * `/dashboard` must match exactly or it would claim every nested route; every
 * other entry matches its subtree, so a detail view such as
 * `/dashboard/policies/<id>` keeps its section lit. An exact-only comparison
 * leaves the sidebar with no active item on any detail page.
 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Turns an unrecognised slug into a readable crumb: "api-keys" → "Api Keys". */
/**
 * Slug words that are acronyms, not words. Without this, naive title-casing
 * renders `sso` as "Sso" and `scim` as "Scim". Extend this map rather than
 * special-casing at a call site, so a future acronym route cannot regress the
 * same way.
 */
const ACRONYMS: Readonly<Record<string, string>> = Object.freeze({
  sso: "SSO",
  scim: "SCIM",
  api: "API",
  mssp: "MSSP",
  ai: "AI",
});

function humanize(segment: string): string {
  return segment
    .split("-")
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Path segments that exist to group routes but have no page of their own.
 *
 * A crumb for one of these must render as plain text: linking it produced a
 * real 404 on every Enterprise settings page, because Next prefetches
 * breadcrumb links and `/dashboard/settings/enterprise` has no page.tsx.
 */
const NON_ROUTE_SEGMENTS: ReadonlySet<string> = new Set([
  "/dashboard/settings/enterprise",
  // WAVE 5.2 — the same defect, found by checking every segment rather than
  // only the one that was reported. `/dashboard/admin` and
  // `/dashboard/publisher` are grouping directories: their children
  // (admin/marketplace, publisher/items, publisher/publish) have pages, they
  // do not. Linking them 404s exactly as `/dashboard/settings/enterprise` did.
  "/dashboard/admin",
  "/dashboard/publisher",
  // `/dashboard/controls` has no list page either — controls are reached by
  // drilling into a framework, so only `controls/[id]` exists. Every control
  // detail page was rendering a "Controls" crumb linking to a 404.
  "/dashboard/controls",
]);

/** `href: null` marks a grouping segment that must not be rendered as a link. */
export type Crumb = { href: string | null; label: string };

/**
 * Builds the breadcrumb trail for a dashboard pathname, preferring the
 * navigation label for known routes and falling back to a humanised slug.
 * Opaque id segments (cuid/uuid-ish) are collapsed to "Detail" rather than
 * printing a 25-character identifier into the header.
 */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];

  segments.forEach((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    const known = allItems.find((item) => item.href === href);

    if (known) {
      crumbs.push({ href, label: known.label });
      return;
    }

    // Root of the dashboard is always the first crumb, labelled from nav.
    if (href === "/dashboard") {
      crumbs.push({ href, label: "Compliance Status" });
      return;
    }

    const looksLikeId = /^[0-9a-f]{8,}$/i.test(segment) || /^c[a-z0-9]{20,}$/i.test(segment);
    crumbs.push({
      href: NON_ROUTE_SEGMENTS.has(href) ? null : href,
      label: looksLikeId ? "Detail" : humanize(segment),
    });
  });

  return crumbs;
}
