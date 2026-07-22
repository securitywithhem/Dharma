import { expect, test } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * Phase 7 Part 3 — evidence auto-tag flow. Upload evidence → a suggested-tag
 * badge appears → Accept persists a control association → a second upload +
 * Reject persists NO association.
 *
 * Requires a running app + evidence-auto-tag worker + Ollama, and controls
 * with embeddings seeded for the org.
 */
test.describe("Evidence auto-tagging", () => {
  test.skip(!!process.env.E2E_SKIP_AI, "Requires local Ollama models — not available on CI runners");
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  async function uploadEvidence(page: import("@playwright/test").Page, content: string) {
    await page.goto("/dashboard/evidence");
    await page.locator("#evidence-upload-trigger").click();
    const fixture = path.join(__dirname, `autotag-${Date.now()}.txt`);
    fs.writeFileSync(fixture, content);
    await page.locator("input[type='file']").setInputFiles(fixture);
    await page.locator("#evidence-type-select").click();
    await page.locator("role=option[name*='Screenshot']").click();
    await page.locator("#evidence-upload-submit").click();
    return fixture;
  }

  test("accept persists the suggested control association", async ({ page }) => {
    const f = await uploadEvidence(page, "Quarterly access review completed for all admins; MFA enforced.");
    const suggestion = page.getByLabel(/AI-suggested control tags/i);
    await expect(suggestion).toBeVisible({ timeout: 60_000 });
    await suggestion.getByRole("button", { name: /Accept suggested control/i }).first().click();
    await expect(page.getByText(/Suggested control association added/i)).toBeVisible();
    fs.unlinkSync(f);
  });

  test("reject persists no association", async ({ page }) => {
    const f = await uploadEvidence(page, "Firewall configuration export showing deny-by-default rules.");
    const suggestion = page.getByLabel(/AI-suggested control tags/i);
    await expect(suggestion).toBeVisible({ timeout: 60_000 });
    await suggestion.getByRole("button", { name: /Reject suggested control/i }).first().click();
    await expect(page.getByText(/Suggestions dismissed/i)).toBeVisible();
    await expect(page.getByLabel(/AI-suggested control tags/i)).toHaveCount(0);
    fs.unlinkSync(f);
  });
});
