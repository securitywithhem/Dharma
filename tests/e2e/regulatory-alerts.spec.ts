import { expect, test } from "@playwright/test";

test.describe("Regulatory alerts page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("empty state renders when there are no alerts", async ({ page }) => {
    // Fresh org from test-auth has no imported frameworks with new versions,
    // so this exercises the real empty state rather than a seeded one.
    await page.goto("/dashboard/regulatory-alerts");
    await expect(page.getByRole("heading", { name: "Regulatory alerts" })).toBeVisible();
    await expect(
      page.getByText("No regulatory alerts. You'll be notified here when an imported framework updates."),
    ).toBeVisible();
  });

  test("a seeded alert shows the diff, then can be acknowledged and dismissed", async ({ page }) => {
    const seedResponse = await page.request.get(
      "/api/test-seed-regulatory-alert?email=admin@dharma.local",
    );
    expect(seedResponse.ok()).toBe(true);

    await page.goto("/dashboard/regulatory-alerts");
    await expect(page.getByText("E2E Seed Framework")).toBeVisible();
    await expect(page.getByText("v2.0.0")).toBeVisible();
    // exact: true — plain getByText("New") also substring-matches "...two
    // new access-control..." in the changelog paragraph below.
    await expect(page.getByText("New", { exact: true })).toBeVisible();
    await expect(page.getByText("Added two new access-control requirements.")).toBeVisible();

    // Expand the diff viewer.
    await page.getByRole("button", { name: "Show diff" }).click();
    await expect(page.getByText("Added (1)")).toBeVisible();
    await expect(page.getByText("Session lock after inactivity")).toBeVisible();
    await expect(page.getByText("Modified (1)")).toBeVisible();
    await expect(page.getByText("Account management")).toBeVisible();

    // Acknowledge — the acknowledge action disappears, the alert stays visible.
    await page.getByRole("button", { name: "Acknowledge" }).click();
    await expect(page.getByText("Acknowledged")).toBeVisible();
    await expect(page.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);

    // Dismiss — the badge updates.
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("Dismissed").first()).toBeVisible();
  });
});
