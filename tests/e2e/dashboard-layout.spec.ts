import { expect, test, type Page } from "@playwright/test";

/**
 * Layout-consistency guard for the Compliance Status dashboard.
 *
 * This exists because the same bug shipped twice in different rows, and it is
 * invisible to every other check: the markup was valid, the a11y suite passed,
 * nothing overflowed, and typecheck was clean. A `lg:grid-cols-3` reserves
 * three tracks whether or not three children render, so a row holding one
 * `col-span-2` child — or a child that returns null when it has no data —
 * renders at full width with a permanently empty column and *reads* as narrow.
 *
 * The invariant that catches it: every full-width row's OWN box is the width of
 * the page container, AND its rendered content reaches the right edge of that
 * box. The second half is the part that matters — the first was always true.
 */

/**
 * Located by landmark accessible name, not by a heading child: Row 3's visible
 * title lives on the Card inside it (a CardTitle h3), so its <Section> names
 * itself with aria-label rather than rendering a duplicate h2.
 */
const ROWS = ["Framework status", "Domain gap analysis", "Workspace"] as const;

/** Rounding and sub-pixel layout make exact equality the wrong assertion. */
const TOLERANCE_PX = 2;

/**
 * Every element that could scroll horizontally, measured together.
 *
 * Checking `documentElement` alone is what let the reported bug through a green
 * suite: the shell is now a fixed-viewport layout whose document never scrolls
 * at all, so an inner container can drag sideways while the document reports a
 * perfect 0. This walks every scrollable box instead.
 */
async function measureHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const boxes: Array<{ what: string; over: number }> = [
      {
        what: "document",
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      },
      { what: "body", over: document.body.scrollWidth - document.body.clientWidth },
    ];

    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const style = getComputedStyle(el);
      const scrollable =
        style.overflowX === "auto" || style.overflowX === "scroll" || el === document.body;
      if (!scrollable) return;
      const over = el.scrollWidth - el.clientWidth;
      if (over > 1) {
        boxes.push({ what: `${el.tagName}#${el.id || "-"}`, over });
      }
    });

    const worst = Math.max(...boxes.map((b) => b.over));
    return {
      worst,
      detail: boxes
        .filter((b) => b.over > 1)
        .map((b) => `${b.what} +${b.over}`)
        .join(", "),
    };
  });
}

async function expectNoHorizontalScroll(page: Page) {
  // Polled: a single sample at networkidle can land mid-reflow under parallel
  // workers and report a phantom overflow.
  await expect
    .poll(async () => (await measureHorizontalOverflow(page)).worst, { timeout: 10_000 })
    .toBeLessThanOrEqual(1);
}

test.describe("Dashboard layout contract", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
    await page.waitForLoadState("networkidle");
  });

  test("every full-width row spans the same container width", async ({ page }) => {
    const widths: Array<{ name: string; width: number }> = [];

    for (const name of ROWS) {
      const section = page.getByRole("region", { name });
      await expect(section).toBeVisible();

      const box = await section.boundingBox();
      expect(box, `${name} has no bounding box`).not.toBeNull();
      widths.push({ name, width: box!.width });
    }

    const reference = widths[0].width;
    for (const { name, width } of widths) {
      expect(
        Math.abs(width - reference),
        `${name} is ${width}px but ${widths[0].name} is ${reference}px`,
      ).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });

  test("no full-width row leaves an empty trailing grid track", async ({ page }) => {
    // The actual regression. A row can be full width and still look narrow if
    // its content stops short of its own right edge.
    for (const name of ROWS) {
      const section = page.getByRole("region", { name });

      const sectionBox = await section.boundingBox();
      expect(sectionBox).not.toBeNull();

      // Rightmost edge reached by any descendant that actually paints.
      const contentRight = await section.evaluate((el) => {
        let max = 0;
        el.querySelectorAll("*").forEach((child) => {
          const rect = child.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) max = Math.max(max, rect.right);
        });
        return max;
      });

      const sectionRight = sectionBox!.x + sectionBox!.width;
      expect(
        sectionRight - contentRight,
        `${name} content stops ${Math.round(sectionRight - contentRight)}px short of its right edge — likely an unfilled grid track`,
      ).toBeLessThanOrEqual(TOLERANCE_PX);
    }
  });

  test("workspace cards are equal height and evenly split", async ({ page }) => {
    const workspace = page.getByRole("region", { name: "Workspace" });

    // The card track specifically. `> div > *` would also sweep up the
    // section's heading block, which is a div too.
    const cards = workspace.locator("[data-card-row] > *");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    const boxes = [];
    for (let i = 0; i < count; i += 1) {
      const box = await cards.nth(i).boundingBox();
      if (box && box.width > 0) boxes.push(box);
    }

    // Equal height: the row stretches, so a short card must not sit short.
    const heights = boxes.map((b) => b.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(TOLERANCE_PX);

    // Even split: auto-fit tracks give every surviving card the same width,
    // whether two or three of them rendered.
    const cardWidths = boxes.map((b) => b.width);
    expect(Math.max(...cardWidths) - Math.min(...cardWidths)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  test("domain gap analysis is a standalone row, not a nested column", async ({ page }) => {
    const domainSection = page.getByRole("region", { name: "Domain gap analysis" });
    const actionSection = page.getByRole("heading", { name: "Top action items", exact: true });

    const domainBox = await domainSection.boundingBox();
    const actionBox = await actionSection.boundingBox();
    expect(domainBox).not.toBeNull();
    expect(actionBox).not.toBeNull();

    // If it were still sharing Row 2's grid it would be no wider than the
    // 2/3-width action items column.
    expect(domainBox!.width).toBeGreaterThan(actionBox!.width);
  });

  for (const width of [1440, 1280, 834, 390]) {
    test(`layout holds at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForLoadState("networkidle");

      await expectNoHorizontalScroll(page);

      await page.screenshot({
        path: `Dharma-Knowledge-OS/docs/design/screenshots/after/layout-fix/dashboard-${width}.png`,
        fullPage: true,
      });
    });
  }

  /**
   * A dense sweep, not four round numbers.
   *
   * The reported horizontal scroll did not reproduce at 1440/1280/834/390, and
   * that is the lesson: breakpoint bugs hide *between* the widths you thought
   * to test. The framework grid used to commit to three columns on a `xl:`
   * media query — a WINDOW measurement — while the grid itself lived in
   * (window - 240px sidebar - 48px padding), so the failure window was a narrow
   * band just above 1280px. These steps walk across every such boundary.
   */
  test("no horizontal scroll at any width across the breakpoint bands", async ({ page }) => {
    const failures: string[] = [];

    for (let width = 320; width <= 1920; width += 40) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(60);

      const result = await measureHorizontalOverflow(page);

      if (result.worst > 1) {
        failures.push(`${width}px (${result.detail})`);
      }
    }

    expect(failures, `horizontal overflow at: ${failures.join(", ")}`).toEqual([]);
  });

  test("compact density: 3 framework columns and the page stays under two screens", async ({
    page,
  }) => {
    /*
      Two assertions, because column count alone is the wrong measure of density.
      At 1440 the grid's content box is 1152px (main 1200 minus its 24px
      padding), so a 4th 18rem track would need 4x288 + 3x16 = 1200 > 1152. It
      does not fit — and chasing it would be pointless anyway: five cards occupy
      two rows at either 3 or 4 columns, so a 4th column saves no vertical space
      and only truncates framework names. 3 is the target; dropping to 2 is the
      regression worth catching.
    */
    const grid = page.locator("[data-card-row]").first();
    const tracks = await grid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
    );
    expect(tracks, "framework grid lost a column").toBeGreaterThanOrEqual(3);

    // The real density measure: total scrollable height. Measured at 1410px
    // after the compact pass; the ceiling leaves headroom for real data without
    // tolerating a drift back to the old spacing.
    const scrollH = await page.locator("#dashboard-scroll").evaluate((el) => el.scrollHeight);
    expect(scrollH, "dashboard got taller — density regression").toBeLessThanOrEqual(1600);
  });

  test("upgrade banner aligns with the page heading", async ({ page }) => {
    // The banner lives in the chrome above <main>, so its rail has to match the
    // page container by hand; nothing enforces it structurally.
    const banner = page.getByText("You're reaching your plan limits");
    if ((await banner.count()) === 0) {
      test.skip(true, "Org is not near plan limits — banner not rendered.");
    }

    const heading = page.getByRole("heading", { name: "Compliance status", level: 1 });
    const bannerBox = await banner.boundingBox();
    const headingBox = await heading.boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(headingBox).not.toBeNull();

    // The banner's text starts after an icon + gap, so compare the rails via
    // the banner's own max-width container rather than the text node.
    const railLeft = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".max-w-\\[88rem\\]");
      return el ? el.getBoundingClientRect().left : null;
    });
    expect(railLeft).not.toBeNull();
    expect(Math.abs(railLeft! - headingBox!.x)).toBeLessThanOrEqual(TOLERANCE_PX);
  });

  test("sidebar footer stays reachable at the top and bottom of the scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState("networkidle");

    const settings = page.getByRole("link", { name: "Settings" });
    const signOut = page.getByRole("button", { name: "Sign out" });

    await expect(settings).toBeInViewport();
    await expect(signOut).toBeInViewport();

    await page.locator("#dashboard-scroll").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(250);

    await expect(settings).toBeInViewport();
    await expect(signOut).toBeInViewport();
  });

  test("navigation is reachable on mobile, where it used to be unreachable", async ({ page }) => {
    /*
      Regression guard for a real defect: the sidebar was `hidden md:flex` with
      no opener anywhere, so below 768px the entire nav was display:none and
      there was no way to leave the current page.
    */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForLoadState("networkidle");

    // Closed by default on mobile — the content needs the whole 390px.
    await expect(page.locator("aside")).toHaveCount(0);

    const toggle = page.getByRole("button", { name: "Show navigation" });
    await expect(toggle).toBeVisible();
    await toggle.click();

    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    // Scoped to the drawer and exact: the page body also renders an
    // "Upload evidence" CTA, which a loose name match would collide with.
    await expect(sidebar.getByRole("link", { name: "Evidence", exact: true })).toBeInViewport();

    // Escape closes it.
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveCount(0);

    // Opening the drawer must not create horizontal scroll either.
    await toggle.click();
    await expectNoHorizontalScroll(page);
  });

  test("desktop toggle collapses the sidebar and the content reclaims the width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForLoadState("networkidle");

    const before = await page.locator("#dashboard-scroll").evaluate((el) => el.clientWidth);
    await expect(page.locator("aside")).toBeVisible();

    await page.getByRole("button", { name: "Hide navigation" }).click();
    await expect(page.locator("aside")).toHaveCount(0);

    const after = await page.locator("#dashboard-scroll").evaluate((el) => el.clientWidth);
    // Content genuinely reflows into the freed 240px rather than just centring.
    expect(after - before).toBeGreaterThanOrEqual(200);

    await expectNoHorizontalScroll(page);

    // And it comes back.
    await page.getByRole("button", { name: "Show navigation" }).click();
    await expect(page.locator("aside")).toBeVisible();
  });

  test("only main scrolls: the document does not, and the sidebar never moves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator("aside").first();
    await expect(sidebar).toBeVisible();
    const before = await sidebar.boundingBox();
    expect(before).not.toBeNull();

    // The document itself must have nothing to scroll — that is the whole
    // point of the shell, and it is what makes the sidebar constant without
    // any positioning trick.
    const docOverflowY = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(docOverflowY).toBeLessThanOrEqual(1);

    // main is the scroller, and it has content to scroll.
    const main = page.locator("#dashboard-scroll");
    const scrollable = await main.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(scrollable).toBeGreaterThan(0);

    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(300);

    const scrolled = await main.evaluate((el) => el.scrollTop);
    expect(scrolled).toBeGreaterThan(0);

    // Sidebar has not moved a pixel, and its items are still reachable.
    const after = await sidebar.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(TOLERANCE_PX);
    await expect(page.getByRole("link", { name: "Settings" })).toBeInViewport();

    // And main cannot scroll sideways, by construction.
    const mainX = await main.evaluate((el) => {
      el.scrollLeft = 9999;
      return el.scrollLeft;
    });
    expect(mainX).toBe(0);
  });

});
