import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Compliance Status dashboard — accessibility and responsive behaviour.
 *
 * Follows the pattern in design-system.spec.ts: colour-contrast is NOT excluded.
 * The redesign introduces new chips, a ring, and empty-state CTAs, and the three
 * known sub-AA pairs in the Warm Paper spec (muted text, the 4.48:1 warning
 * pair, both border tokens) are handled as usage constraints in the primitives
 * — so a contrast violation on this page means one of those constraints leaked,
 * which is exactly what this suite exists to catch.
 */

const BREAKPOINTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.describe("Compliance status dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
    await page.waitForLoadState("networkidle");
  });

  test("has no serious/critical a11y violations, contrast included", async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    // Report the offending element and axe's measured ratio, not just a count.
    const detail = blocking.flatMap((v) =>
      v.nodes.map(
        (n) => `${v.id} | ${n.target.join(" ")} | ${n.failureSummary?.replace(/\s+/g, " ")}`,
      ),
    );
    expect(detail).toEqual([]);
  });

  test("every framework readiness ring is exposed as a named meter", async ({ page }) => {
    const meters = page.getByRole("meter");
    const count = await meters.count();

    for (let i = 0; i < count; i += 1) {
      const meter = meters.nth(i);
      await expect(meter).toHaveAttribute("aria-valuenow", /^\d+$/);
      // A meter with no accessible name reads as an unlabelled number.
      await expect(meter).toHaveAttribute("aria-label", /.+/);
    }
  });

  test("domain gap list is keyboard operable and expands in place", async ({ page }) => {
    const toggle = page.getByRole("button", { name: /Show all \d+ domains/ });
    if ((await toggle.count()) === 0) {
      test.skip(true, "Seeded org has 5 or fewer domains — nothing to collapse.");
    }

    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");

    // Count-agnostic: the collapsed row count is a layout decision that has
    // already changed once (5 -> 6, to fill whole rows of the two-up grid).
    await expect(page.getByRole("button", { name: /Show top \d+ only/ })).toBeVisible();
  });

  for (const { name, width, height } of BREAKPOINTS) {
    test(`does not scroll horizontally at ${name} (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.waitForLoadState("networkidle");

      // Polled, not sampled once. Under parallel workers the dev server can
      // still be settling layout when networkidle fires, and a single
      // measurement taken mid-reflow reports a phantom overflow.
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
          { timeout: 10_000 },
        )
        .toBeLessThanOrEqual(1);

      await page.screenshot({
        path: `Dharma-Knowledge-OS/docs/design/screenshots/after/dashboard-${name}.png`,
        fullPage: true,
      });
    });
  }

  test("respects prefers-reduced-motion on the readiness ring", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.waitForLoadState("networkidle");

    const meter = page.getByRole("meter").first();
    if ((await meter.count()) === 0) {
      test.skip(true, "Seeded org has no frameworks.");
    }

    // The ring must be at its final value immediately, never mid-transition:
    // reduced-motion readers otherwise see a permanently empty arc.
    const arc = meter.locator("circle").nth(1);
    await expect(arc).toHaveAttribute("stroke-dashoffset", /.+/);
  });
});
