import { breadcrumbsFor } from "@/lib/navigation";

describe("breadcrumbsFor", () => {
  it("renders acronym segments as acronyms, not title-cased words", () => {
    const crumbs = breadcrumbsFor("/dashboard/settings/enterprise/sso");
    const labels = crumbs.map((c) => c.label);
    expect(labels).toContain("SSO");
    // The specific regression: naive title-casing produced "Sso".
    expect(labels).not.toContain("Sso");
    expect(labels).not.toContain("Scim");
  });

  it("does not link a grouping segment that has no page", () => {
    // /dashboard/settings/enterprise has no page.tsx. Next prefetches
    // breadcrumb links, so linking it produced a real 404 on every Enterprise
    // settings page.
    const crumbs = breadcrumbsFor("/dashboard/settings/enterprise/roles");
    const enterprise = crumbs.find((c) => c.label === "Enterprise");
    expect(enterprise).toBeDefined();
    expect(enterprise!.href).toBeNull();
  });

  it("still links real route segments", () => {
    const crumbs = breadcrumbsFor("/dashboard/settings/enterprise/roles");
    const dashboard = crumbs.find((c) => c.label === "Compliance Status");
    expect(dashboard?.href).toBe("/dashboard");
    expect(crumbs[crumbs.length - 1].href).toBe("/dashboard/settings/enterprise/roles");
  });

  it("collapses opaque id segments rather than printing a cuid", () => {
    const crumbs = breadcrumbsFor("/dashboard/frameworks/cmrx5d8720003hgis8aucqnlh");
    expect(crumbs[crumbs.length - 1].label).toBe("Detail");
  });

  it("humanises an ordinary multi-word slug", () => {
    const crumbs = breadcrumbsFor("/dashboard/regulatory-alerts");
    expect(crumbs[crumbs.length - 1].label).toBeTruthy();
    expect(crumbs[crumbs.length - 1].label).not.toContain("-");
  });

  // WAVE 5.2 — the same defect as the Enterprise crumb above, found by
  // checking every grouping segment rather than only the reported one. Each
  // of these directories holds pages but has no page.tsx of its own, so a
  // linked crumb prefetches a 404.
  it.each([
    ["/dashboard/admin/marketplace", "Admin"],
    ["/dashboard/publisher/items", "Publisher"],
    ["/dashboard/controls/cmrx5d8720003hgis8aucqnlh", "Controls"],
  ])("does not link the grouping segment in %s", (path, label) => {
    const crumb = breadcrumbsFor(path).find((c) => c.label === label);
    expect(crumb).toBeDefined();
    expect(crumb!.href).toBeNull();
  });

  it("still links the leaf of a gated section", () => {
    const crumbs = breadcrumbsFor("/dashboard/admin/marketplace");
    expect(crumbs[crumbs.length - 1].href).toBe("/dashboard/admin/marketplace");
  });
});
