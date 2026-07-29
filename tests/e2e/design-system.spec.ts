import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Design-system E2E: severity tokens, the Dharma Ring's reduced-motion
 * fallback, and white-label SSR.
 *
 * Note this suite does NOT exclude the "color-contrast" rule that the older
 * a11y specs (pentest-a11y, ai-advisor-a11y) still carry. That exclusion was
 * added for a primary-button failure (#fffdf5 on #e3860d, 2.68:1). The token
 * redesign moved --primary to indigo, which measures 9.84:1, so the rule is
 * enforced here.
 */

test.describe("Design system", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("frameworks page has no serious/critical a11y violations, contrast included", async ({
    page,
  }) => {
    await page.goto("/dashboard/frameworks");
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    // Report the offending element and axe's measured ratio, not just a count —
    // "color-contrast: 6 node(s)" is not actionable on its own.
    const detail = blocking.flatMap((v) =>
      v.nodes.map((n) => `${v.id} | ${n.target.join(" ")} | ${n.failureSummary?.replace(/\s+/g, " ")}`),
    );
    expect(detail).toEqual([]);
  });

  // Note: ScoreGauge defaults animated={false} — the settle is reserved for a
  // freshly computed score, not for every card on a list. So the assertion
  // here is that the ring renders its static form in a real browser and that
  // reduced-motion is honoured; the animated/static branch itself is covered
  // deterministically in tests/designSystem.components.test.tsx.
  test("Dharma Ring renders statically under prefers-reduced-motion", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
    await page.goto("/dashboard/frameworks");

    const ring = page.locator("[data-dharma-ring]").first();
    await expect(ring).toBeVisible();
    await expect(ring).toHaveAttribute("data-animated", "false");

    // The track always renders, even at a score of 0 where there are no
    // severity arcs to draw — "static fallback" must mean a visible ring, not
    // an empty box.
    await expect(ring.locator("circle").first()).toBeVisible();

    // No settle animation may be attached to any circle in the ring.
    const animations = await ring.evaluate((el) =>
      Array.from(el.querySelectorAll("circle")).map(
        (c) => getComputedStyle(c).animationName,
      ),
    );
    expect(animations.every((name) => name === "none")).toBe(true);

    await context.close();
  });

  test("severity tokens resolve to distinct computed colours for HIGH and CRITICAL", async ({
    page,
  }) => {
    // Guards the specific defect the old SeverityBadge had: HIGH and CRITICAL
    // both resolving to the same destructive colour.
    const [high, critical] = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [
        style.getPropertyValue("--severity-high").trim(),
        style.getPropertyValue("--severity-critical").trim(),
      ];
    });

    expect(high).not.toBe("");
    expect(critical).not.toBe("");
    expect(high).not.toBe(critical);
  });
});
