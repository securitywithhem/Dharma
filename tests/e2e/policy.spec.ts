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

    // Fill any required text/date/email inputs so Generate Draft is
    // meaningful regardless of which template got seeded first (template
    // variable sets differ per policy type). Date inputs need YYYY-MM-DD —
    // any other string is a "Malformed value" fill error on <input type=date>.
    const textInputs = page.locator("input[type='text'], input[type='email']");
    const textCount = await textInputs.count();
    for (let i = 0; i < textCount; i++) {
      await textInputs.nth(i).fill("E2E Test Value");
    }
    const dateInputs = page.locator("input[type='date']");
    const dateCount = await dateInputs.count();
    for (let i = 0; i < dateCount; i++) {
      await dateInputs.nth(i).fill("2026-01-01");
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

  /**
   * WAVE 7.4 — the full User_Journeys.md flow 3 round-trip.
   *
   * fullstack-audit-2026-08-06 §4 CRITICAL: everything above stops at "the
   * draft is on screen". Before this wave that WAS the end of the road —
   * there was no detail route and no update/publish/delete mutation, so a
   * generated policy could never be opened again. This walks the rest of the
   * journey: save → find it in the list → open it → edit → publish.
   *
   * Deliberately drives the UI rather than the router (policy.lifecycle.test.ts
   * already covers the procedures): the finding was that the journey had no
   * *path* through the interface, which only a UI-level test can pin.
   */
  test("a saved policy can be found, opened, edited and published", async ({ page }) => {
    await page.goto("/dashboard/policies/new");

    const firstTemplate = page
      .getByRole("button")
      .filter({ hasText: /· v\d/ })
      .first();
    await expect(firstTemplate).toBeVisible({ timeout: 10000 });
    await firstTemplate.click();
    await page.getByRole("button", { name: "Continue" }).click();

    const textInputs = page.locator("input[type='text'], input[type='email']");
    for (let i = 0; i < (await textInputs.count()); i++) {
      await textInputs.nth(i).fill("E2E Lifecycle Value");
    }
    const dateInputs = page.locator("input[type='date']");
    for (let i = 0; i < (await dateInputs.count()); i++) {
      await dateInputs.nth(i).fill("2026-01-01");
    }

    await page.getByRole("button", { name: "Generate Draft" }).click();
    await expect(page.getByText("Draft generated — review and edit below")).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole("button", { name: "Save Draft" }).click();

    // ── The list must offer a route in. The cards were not links at all. ──
    await page.goto("/dashboard/policies");

    const policyLink = page.locator('a[href^="/dashboard/policies/"]').filter({
      hasNot: page.locator('[href="/dashboard/policies/new"]'),
    });
    await expect(policyLink.first()).toBeVisible({ timeout: 10000 });
    await policyLink.first().click();

    // ── The detail page: the route that did not exist. ──
    await expect(page).toHaveURL(/\/dashboard\/policies\/[^/]+$/);
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Draft")).toBeVisible();

    // ── Edit, then save. ──
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type(" Reviewed during the end-to-end run.");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Saved/i)).toBeVisible({ timeout: 10000 });

    // ── Publish — the step User_Journeys flow 3 named and the router lacked. ──
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Policy published.")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Published")).toBeVisible();

    // The published state survives a reload, i.e. it was persisted rather than
    // being optimistic UI.
    await page.reload();
    await expect(page.getByText("Published")).toBeVisible({ timeout: 10000 });

    // ── And it is reachable from the list, now badged Published. ──
    await page.goto("/dashboard/policies");
    await expect(page.getByText("Published").first()).toBeVisible({ timeout: 10000 });
  });

  test("the empty-state and header both offer a way to start a policy", async ({ page }) => {
    // §4 HIGH-2: the empty state was a Card with no link, no button and no CTA,
    // and the header had no action either — the only route into the builder in
    // the entire app was the dashboard's QuickActionsCard.
    await page.goto("/dashboard/policies");

    const newPolicyLinks = page.locator('a[href="/dashboard/policies/new"]');
    await expect(newPolicyLinks.first()).toBeVisible({ timeout: 10000 });
  });
});

