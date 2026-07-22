import { expect, test } from "@playwright/test";

test.describe("Reports", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("creating a one-off Custom PDF report queues it and it appears in the list", async ({ page }) => {
    await page.goto("/dashboard/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByText("No reports yet.")).toBeVisible();

    await page.getByRole("link", { name: "New report" }).click();
    await page.waitForURL("**/dashboard/reports/new");
    await expect(page.getByRole("heading", { name: "New report" })).toBeVisible();

    // Custom PDF is the default type — avoid Board Summary here since it's
    // AI-narrated and needs Ollama; Custom PDF's sections are pre-aggregated
    // data, no AI involved in generation itself.
    const title = `E2E Report ${Date.now()}`;
    await page.locator("#title").fill(title);
    await page.getByRole("button", { name: "Generate" }).click();

    await page.waitForURL("**/dashboard/reports");
    await expect(page.getByText("Report queued — it will appear in the list shortly")).toBeVisible();
    await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Custom PDF")).toBeVisible();
  });

  test("creating a scheduled report shows it under the Schedules tab", async ({ page }) => {
    await page.goto("/dashboard/reports/new");

    const title = `E2E Scheduled Report ${Date.now()}`;
    await page.locator("#title").fill(title);

    // Switch cadence away from "One-off" to reveal the recipients field and
    // change the submit button to "Create schedule".
    await page.getByRole("combobox").filter({ hasText: "One-off (generate now)" }).click();
    await page.getByRole("option", { name: "Weekly (Mondays)" }).click();
    await page.locator("#recipients").fill("ciso@example.com, board@example.com");

    await page.getByRole("button", { name: "Create schedule" }).click();

    await page.waitForURL("**/dashboard/reports");
    await expect(page.getByText("Schedule created")).toBeVisible();

    await page.getByRole("button", { name: "Schedules" }).click();
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText("2")).toBeVisible(); // recipient count column
  });

  test("deleting a report removes it from the list", async ({ page }) => {
    await page.goto("/dashboard/reports/new");
    const title = `E2E Delete Me ${Date.now()}`;
    await page.locator("#title").fill(title);
    await page.getByRole("button", { name: "Generate" }).click();
    await page.waitForURL("**/dashboard/reports");
    await expect(page.getByText(title)).toBeVisible({ timeout: 10000 });

    const row = page.getByRole("row").filter({ hasText: title });
    await row.getByRole("button").last().click(); // trash-icon delete button

    await expect(page.getByText("Report deleted")).toBeVisible();
    await expect(page.getByText(title)).toHaveCount(0);
  });
});
