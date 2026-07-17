import { expect, test } from "@playwright/test";

/**
 * Phase 7 Part 3 — AI Advisor chat flow (3_APP_FLOW.md §5).
 * open chat → ask about controls → streamed answer with citation chip →
 * click chip → navigate to control detail → gap-analysis follow-up →
 * structured multi-section response.
 *
 * Requires a running app + seeded org with ingested compliance content and a
 * reachable Ollama (or OPENAI_API_KEY). Skipped automatically when the app is
 * not up (see webServer in playwright.config.ts).
 */
test.describe("AI Advisor chat", () => {
  test.skip(!!process.env.E2E_SKIP_AI, "Requires local Ollama models — not available on CI runners");
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("answers a controls question with a clickable citation and navigates", async ({ page }) => {
    await page.getByRole("button", { name: "Open Compliance Advisor" }).click();
    const panel = page.getByRole("dialog", { name: "Compliance Advisor" });
    await expect(panel).toBeVisible();

    await panel.getByLabel("Message the compliance advisor").fill("Do we have any controls related to encryption at rest?");
    await panel.getByRole("button", { name: "Send message" }).click();

    // Assistant response renders with at least one citation chip.
    const chip = panel.getByRole("link", { name: /Open control/i }).first();
    await expect(chip).toBeVisible({ timeout: 30_000 });

    await chip.click();
    await expect(page).toHaveURL(/\/dashboard\/controls\/.+/);

    // Follow-up gap analysis renders a structured, multi-section answer.
    await page.getByRole("button", { name: "Open Compliance Advisor" }).click();
    await panel.getByLabel("Message the compliance advisor").fill("Generate a gap analysis against SOC 2 CC6");
    await panel.getByRole("button", { name: "Send message" }).click();
    await expect(panel.getByText(/PASSING/i)).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(/FAILING|GAPS/i)).toBeVisible();
  });
});
