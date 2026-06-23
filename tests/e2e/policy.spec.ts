import { expect, test } from "@playwright/test";

test.describe("AI Policy Wizard Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate using the test backdoor
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("policy generation wizard workflow", async ({ page }) => {
    await page.goto("/dashboard/policies/new");

    // Verify page header
    await expect(page.getByText("AI Policy Wizard")).toBeVisible();
    await expect(page.getByText("Step 1: Select Policy Type")).toBeVisible();

    // Select policy type
    await page.locator("select").selectOption("PRIVACY_POLICY");
    await page.getByRole("button", { name: "Next Step" }).click();

    // Verify step 2
    await expect(page.getByText("Step 2: Organizational Context")).toBeVisible();
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible();

    // Fill organizational context
    await textarea.fill("Dharma E2E test company context for data compliance policy drafting.");

    // Submit for generation
    const generateBtn = page.getByRole("button", { name: "Generate Policy" });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // Step 3 shows loading status initially
    await expect(page.getByText("Drafting Policy...")).toBeVisible();
  });
});
