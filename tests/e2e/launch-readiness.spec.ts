import { expect, test } from "@playwright/test";

// Regression coverage for the 2026-08-02 launch-readiness audit findings.
test.describe("Launch-readiness audit regressions", () => {
  // Serial: every test signs in through /api/test-auth, and concurrent hits
  // on that endpoint race under the config's fullyParallel default — the
  // redirect to /dashboard intermittently never lands. Not a product bug,
  // but it makes these tests flaky if left parallel.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  // A1 — framework detail crashed with "An unsupported type was passed to
  // use(): [object Object]" because the page typed `params` as a Promise and
  // unwrapped it with React's use(), which is a Next 15 convention. This app
  // runs Next 14, where params is a plain object.
  test("A1: framework detail pages render controls instead of crashing", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto("/dashboard/frameworks");

    const firstCard = page.locator('a[href^="/dashboard/frameworks/"]').first();
    await expect(firstCard).toBeVisible({ timeout: 15_000 });
    await firstCard.click();

    await expect(page).toHaveURL(/\/dashboard\/frameworks\/[^/]+$/);

    // The crash rendered the error boundary instead of the page body.
    await expect(page.getByText("Framework not found")).not.toBeVisible();

    const useErrors = pageErrors.filter((e) =>
      /unsupported type was passed to use\(\)/i.test(e.message),
    );
    expect(useErrors).toHaveLength(0);
  });

  // A3 — the Team tab existed in the settings nav but had no route, so it 404'd.
  test("A3: settings Team page loads and lists members", async ({ page }) => {
    await page.goto("/dashboard/settings/team");

    await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await expect(page.getByText("Members")).toBeVisible();
    // The signed-in admin must appear in their own org's roster.
    await expect(page.getByText("admin@dharma.local")).toBeVisible({ timeout: 15_000 });
  });

  // A4 — same as A3: nav tab present, route missing.
  test("A4: settings Security page loads and states its capability gaps", async ({ page }) => {
    await page.goto("/dashboard/settings/security");

    await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
    await expect(page.getByText("Sign-in methods")).toBeVisible({ timeout: 15_000 });
    // Sessions/MFA have no backing store here; the page must say so rather
    // than render placeholder data.
    await expect(page.getByText("Not available on this deployment")).toBeVisible();
  });

  // A5 — the audit reported this CTA as dead. It was already wired; this test
  // pins that behaviour so it cannot regress into the reported state.
  test("A5: pentests empty-state CTA opens the same modal as the toolbar button", async ({
    page,
  }) => {
    await page.goto("/dashboard/pentests");

    const emptyStateBtn = page.locator("#new-scan-empty-btn");
    const toolbarBtn = page.locator("#new-scan-btn");

    if (await emptyStateBtn.isVisible().catch(() => false)) {
      await emptyStateBtn.click();
      await expect(page.getByText("New Penetration Test")).toBeVisible();
    } else {
      // Org already has scans, so the empty state isn't rendered — assert the
      // toolbar path still opens the modal.
      await toolbarBtn.click();
      await expect(page.getByText("New Penetration Test")).toBeVisible();
    }
  });

  // B3 — every route previously shared the literal title
  // "Dharma | Compliance Status".
  test("B3: routes have distinct, descriptive titles", async ({ page }) => {
    const seen = new Map<string, string>();

    for (const route of [
      "/dashboard",
      "/dashboard/frameworks",
      "/dashboard/evidence",
      "/dashboard/policies",
      "/dashboard/settings/team",
      "/dashboard/settings/security",
    ]) {
      await page.goto(route);
      seen.set(route, await page.title());
    }

    for (const [route, title] of seen) {
      expect(title, `${route} should be suffixed with "| Dharma"`).toMatch(/\| Dharma$/);
    }

    // All distinct — the bug was every route sharing one title.
    expect(new Set(seen.values()).size).toBe(seen.size);
  });

  // B2 — Stripe's SDK was loaded app-wide from the root providers.
  test("B2: Stripe SDK does not load outside billing", async ({ page }) => {
    const stripeRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("js.stripe.com")) stripeRequests.push(request.url());
    });

    await page.goto("/dashboard");
    await page.goto("/dashboard/settings/security");
    await page.goto("/dashboard/frameworks");
    await page.waitForLoadState("networkidle");

    expect(stripeRequests).toHaveLength(0);
  });
});
