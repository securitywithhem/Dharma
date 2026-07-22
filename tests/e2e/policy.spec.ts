import { expect, test } from "@playwright/test";

// Rewritten for the template-first builder (the old "AI Policy Wizard" UI this
// spec originally drove no longer exists). The AI-audit step that follows
// Step 3 needs local Ollama models, so the spec stops at the details step.
test.describe("Template-first policy builder", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate using the test backdoor
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("policy generation wizard workflow", async ({ page }) => {
    await page.goto("/dashboard/policies/new");

    await expect(
      page.getByRole("heading", { name: "Template-First Policy Builder" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Step 1: Choose a template" }),
    ).toBeVisible();

    const continueBtn = page.getByRole("button", { name: "Continue" });
    await expect(continueBtn).toBeDisabled();

    // Template cards are buttons showing "<TYPE> · v<version>" — present only
    // when the database is seeded (SEED_DATABASE=true in CI).
    const firstTemplate = page
      .getByRole("button")
      .filter({ hasText: /· v\d/ })
      .first();
    await expect(firstTemplate).toBeVisible({ timeout: 10000 });
    await firstTemplate.click();

    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    await expect(
      page.getByRole("heading", { name: /Step 2: Fill in your details/ }),
    ).toBeVisible();
  });
});
