import { expect, test } from "@playwright/test";

/**
 * WAVE 0 gate — scan authorization (GRC-VAPT §2).
 *
 * (a) a scan against an unverified domain is rejected with a clear error,
 * (b) a scan against 127.0.0.1 is rejected,
 * (c) the verify -> scan flow against a verified domain is accepted.
 *
 * On (c): the DNS TXT challenge cannot be completed from CI, which has no
 * controllable DNS zone. The challenge-issuing UI is asserted here, and the
 * verified state is then established through /api/test-seed-verified-asset so
 * the rest of the flow is exercised for real. The DNS resolution logic itself
 * is unit-tested against an injected resolver in tests/assetVerification.test.ts.
 * See that route's docstring for why this split is deliberate rather than a
 * gap being papered over.
 */

const ADMIN = "admin@dharma.local";

test.describe("Scan authorization", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/api/test-auth?email=${ADMIN}`);
    await page.waitForURL("**/dashboard");
  });

  async function openNewScanModal(page: import("@playwright/test").Page) {
    await page.goto("/dashboard/pentests");
    await page.locator("#new-scan-btn").click();
    await expect(page.getByText("New Penetration Test")).toBeVisible();
  }

  test("(a) refuses a scan against a domain the org has not verified", async ({ page }) => {
    await openNewScanModal(page);

    // A real, resolvable, public domain nobody in the org owns — the exact
    // shape of the original finding.
    await page.locator("#scan-target").fill("google.com");
    await page.locator("#scan-ownership-confirmed").click();

    // The verification sub-flow appears instead of the target being accepted.
    await expect(page.getByTestId("verify-ownership-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Ownership not verified")).toBeVisible();

    // And the checkbox alone can no longer arm the submit button.
    await expect(page.locator("#new-scan-submit")).toBeDisabled();
  });

  test("(a2) the server rejects an unverified target even if the UI is bypassed", async ({
    page,
  }) => {
    // The UI check above is an affordance. This asserts the actual control: a
    // direct tRPC call, exactly what a modified client would send.
    const response = await page.request.post("/api/trpc/pentest.create", {
      data: {
        json: { target: "google.com", type: "EXTERNAL_NETWORK", ownershipConfirmed: true },
      },
    });

    expect(response.ok()).toBe(false);
    const body = await response.text();
    expect(body).toMatch(/has not verified ownership/i);
  });

  test("(b) refuses a scan against 127.0.0.1", async ({ page }) => {
    const response = await page.request.post("/api/trpc/pentest.create", {
      data: {
        json: { target: "127.0.0.1", type: "EXTERNAL_NETWORK", ownershipConfirmed: true },
      },
    });

    expect(response.ok()).toBe(false);
    expect(await response.text()).toMatch(/private\/reserved/i);
  });

  test("(b2) refuses a scan against the cloud metadata endpoint", async ({ page }) => {
    const response = await page.request.post("/api/trpc/pentest.create", {
      data: {
        json: { target: "169.254.169.254", type: "EXTERNAL_NETWORK", ownershipConfirmed: true },
      },
    });

    expect(response.ok()).toBe(false);
    expect(await response.text()).toMatch(/private\/reserved/i);
  });

  test("(c) shows a DNS challenge, and accepts the scan once the asset is verified", async ({
    page,
  }) => {
    await openNewScanModal(page);
    await page.locator("#scan-target").fill("example.com");

    // The challenge UI issues a real token via pentest.assets.requestVerification.
    await expect(page.getByTestId("verify-ownership-panel")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("request-verification").click();
    await expect(page.getByTestId("challenge-record-value")).toHaveText(
      /^dharma-verify=[0-9a-f]{32}$/,
      { timeout: 10000 },
    );

    // Confirming without the record actually published must fail — proving the
    // server resolves DNS itself rather than trusting the client's click.
    await page.getByTestId("confirm-verification").click();
    await expect(page.getByRole("alert")).toContainText(/No matching TXT record/i, {
      timeout: 15000,
    });

    // Establish the verified state out of band (see this file's header).
    const seed = await page.request.get(
      `/api/test-seed-verified-asset?email=${ADMIN}&domain=example.com`,
    );
    expect(seed.ok()).toBe(true);

    // Now the same target is accepted.
    await page.reload();
    await page.locator("#new-scan-btn").click();
    await page.locator("#scan-target").fill("example.com");
    await expect(page.getByText(/Verified — covered by example\.com/)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("verify-ownership-panel")).toHaveCount(0);

    await page.locator("#scan-ownership-confirmed").click();
    const submit = page.locator("#new-scan-submit");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText("New Penetration Test")).not.toBeVisible({ timeout: 15000 });
  });

  test("(c2) a subdomain of a verified apex is accepted without separate verification", async ({
    page,
  }) => {
    const seed = await page.request.get(
      `/api/test-seed-verified-asset?email=${ADMIN}&domain=example.com`,
    );
    expect(seed.ok()).toBe(true);

    const response = await page.request.post("/api/trpc/pentest.create", {
      data: {
        json: { target: "www.example.com", type: "EXTERNAL_NETWORK", ownershipConfirmed: true },
      },
    });

    expect(response.ok()).toBe(true);
  });
});
