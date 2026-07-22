import { expect, test } from "@playwright/test";

// Rewritten for the template-first builder (the old "AI Policy Wizard" UI this
// spec originally drove no longer exists). The AI-audit step (Step 3 -> 4,
// "AI Audit" button) needs local Ollama models, so this spec stops there —
// but Step 2 -> 3 (rendering the draft from the template) is plain Handlebars
// substitution via policy.generateFromTemplate, no AI involved, so it's
// covered here too.
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

  test("rendering the draft moves to the editor step", async ({ page }) => {
    await page.goto("/dashboard/policies/new");

    const firstTemplate = page
      .getByRole("button")
      .filter({ hasText: /· v\d/ })
      .first();
    await expect(firstTemplate).toBeVisible({ timeout: 10000 });
    await firstTemplate.click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: /Step 2: Fill in your details/ }),
    ).toBeVisible();

    // Fill any required text/date/email inputs with a placeholder value so
    // Generate Draft is meaningful regardless of which template got seeded
    // first (template variable sets differ per policy type).
    const textInputs = page.locator(
      "input[type='text'], input[type='date'], input[type='email']",
    );
    const count = await textInputs.count();
    for (let i = 0; i < count; i++) {
      await textInputs.nth(i).fill("E2E Test Value");
    }

    await page.getByRole("button", { name: "Generate Draft" }).click();

    // Step 3: rendered draft in the TipTap editor, with the AI Audit /
    // Save Draft / Publish actions visible (AI Audit itself is out of scope
    // here — it needs Ollama).
    await expect(page.getByText("Draft generated — review and edit below")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: "AI Audit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  });
});
