import { expect, test } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * Phase 7 Part 3 — document upload flow: upload a fixture → progress states
 * render → COMPLETED toast → ask a question answered from that doc → cited.
 * Requires a running app + ingestion worker + Ollama.
 */
test.describe("AI Advisor document upload", () => {
  test.skip(!!process.env.E2E_SKIP_AI, "Requires local Ollama models — not available on CI runners");
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("ingests a document and can answer from it", async ({ page }) => {
    await page.getByRole("button", { name: "Open Compliance Advisor" }).click();
    const panel = page.getByRole("dialog", { name: "Compliance Advisor" });

    const fixture = path.join(__dirname, "ai-advisor-fixture.txt");
    fs.writeFileSync(
      fixture,
      "Encryption at Rest Policy: All production databases use AES-256 encryption at rest, satisfying control CC6.1.",
    );
    await panel.getByLabel("Upload a document for the advisor").setInputFiles(fixture);

    // Progress states surface, then a completion toast.
    await expect(panel.getByText(/Splitting into chunks|Generating embeddings|Extracting knowledge graph|Queued/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/ready for the advisor/i)).toBeVisible({ timeout: 60_000 });

    await panel.getByLabel("Message the compliance advisor").fill("What encryption do our production databases use at rest?");
    await panel.getByRole("button", { name: "Send message" }).click();
    await expect(panel.getByText(/AES-256/i)).toBeVisible({ timeout: 30_000 });

    fs.unlinkSync(fixture);
  });
});
