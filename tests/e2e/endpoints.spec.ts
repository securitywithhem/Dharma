import { expect, test } from "@playwright/test";

test.describe("Endpoints page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("enrolling an endpoint shows the one-time install command, then a status card", async ({ page }) => {
    await page.goto("/dashboard/endpoints");
    await expect(page.getByRole("heading", { name: "Endpoints" })).toBeVisible();

    await page.getByRole("button", { name: "Enroll endpoint" }).click();
    await expect(page.getByText("Enroll a new endpoint")).toBeVisible();

    const hostname = `e2e-laptop-${Date.now()}`;
    await page.locator("#hostname").fill(hostname);
    await page.locator("#osVersion").fill("14.5");

    const submitBtn = page.getByRole("button", { name: "Generate install command" });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // One-time install command containing the enrollment token is shown exactly once.
    const commandInput = page.locator("input[readonly]");
    await expect(commandInput).toBeVisible();
    const command = await commandInput.inputValue();
    expect(command).toContain("curl");
    expect(command).toContain("--token=");

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Enroll a new endpoint")).not.toBeVisible();

    // Endpoint now shows as a card, PENDING (no heartbeat yet), with a Revoke action.
    const card = page.locator("div").filter({ hasText: hostname }).last();
    await expect(card.getByText(/never seen/)).toBeVisible();
    await expect(card.getByRole("button", { name: /Revoke/ })).toBeVisible();
  });

  test("revoking an endpoint removes the revoke action", async ({ page }) => {
    await page.goto("/dashboard/endpoints");

    await page.getByRole("button", { name: "Enroll endpoint" }).click();
    const hostname = `e2e-revoke-${Date.now()}`;
    await page.locator("#hostname").fill(hostname);
    await page.locator("#osVersion").fill("22.04");
    await page.getByRole("button", { name: "Generate install command" }).click();
    await expect(page.locator("input[readonly]")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    const card = page.locator("div").filter({ hasText: hostname }).last();
    await card.getByRole("button", { name: /Revoke/ }).click();

    await expect(page.getByText("Endpoint revoked — future heartbeats will be rejected")).toBeVisible();
    await expect(card.getByRole("button", { name: /Revoke/ })).toHaveCount(0);
  });
});
