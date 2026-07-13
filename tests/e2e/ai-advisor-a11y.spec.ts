import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Phase 7 Part 3 — accessibility spot-check on the chat + upload panel.
 * Fails on any serious/critical violation except the app-wide pre-existing
 * primary-button color-contrast token issue (documented in
 * tests/e2e/pentest-a11y.spec.ts), which Part 3 did not introduce.
 */
const KNOWN_PRE_EXISTING_RULE_IDS = new Set(["color-contrast"]);

test.describe("AI Advisor accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("chat panel has no serious/critical a11y violations", async ({ page }) => {
    await page.getByRole("button", { name: "Open Compliance Advisor" }).click();
    await expect(page.getByRole("dialog", { name: "Compliance Advisor" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const serious = results.violations.filter(
      (v) => (v.impact === "serious" || v.impact === "critical") && !KNOWN_PRE_EXISTING_RULE_IDS.has(v.id),
    );
    expect(serious, JSON.stringify(serious, null, 2)).toHaveLength(0);
  });
});
