import { expect, test } from "@playwright/test";

/**
 * Phase 7 Part 3 — budget-exceeded flow. With the org seeded at its monthly
 * token cap (AIUsageLog vs Plan.limits.aiTokensPerMonth), sending a message
 * surfaces a clear budget state, not a silent failure or generic error.
 *
 * Seeding the org to its cap is an environment precondition (a test-seed
 * endpoint or fixture), mirrored from the pentest seed pattern.
 */
test.describe("AI Advisor budget enforcement", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("shows a budget-exceeded state instead of a silent failure", async ({ page }) => {
    // Precondition: the seeded org is at/over its monthly token budget.
    await page.getByRole("button", { name: "Open Compliance Advisor" }).click();
    const panel = page.getByRole("dialog", { name: "Compliance Advisor" });

    // The budget banner renders and the input is disabled at/over cap.
    await expect(panel.getByText(/Monthly AI token budget reached|budget/i)).toBeVisible({ timeout: 15_000 });

    const input = panel.getByLabel("Message the compliance advisor");
    // If not already disabled, attempting to send must surface a clear budget error toast.
    if (await input.isEnabled()) {
      await input.fill("Any question");
      await panel.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText(/Monthly AI token budget reached/i)).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(input).toBeDisabled();
    }
  });
});
