import { expect, test } from "@playwright/test";

test.describe("Auditor Access Portal Flow", () => {
  test("auditor token generation and access portals", async ({ page }) => {
    // 1. Authenticate as admin
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");

    // 2. Go to settings
    await page.goto("/dashboard/settings");
    await expect(page.getByText("Auditor Access Portal")).toBeVisible();

    // 3. Generate auditor link
    const generateBtn = page.getByRole("button", { name: "Generate Auditor Link" });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // 4. Extract generated link
    const linkInput = page.locator("input[readonly]");
    await expect(linkInput).toBeVisible({ timeout: 5000 });
    const url = await linkInput.inputValue();
    expect(url).toContain("/audit/auth?token=");

    // 5. Navigate using the auditor login link (this sets the session and redirects)
    await page.goto(url);
    await page.waitForURL("**/audit/portal");

    // 6. Verify auditor read-only mode and organization details
    await expect(page.getByText("Dharma Auditor Portal — Read-Only Access")).toBeVisible();
    await expect(page.getByText("Read-Only Mode Active")).toBeVisible();
    await expect(page.getByText("Dharma E2E Test Organization Workspace", { exact: false })).toBeVisible();
  });
});
