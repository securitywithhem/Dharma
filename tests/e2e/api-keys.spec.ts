import { expect, test } from "@playwright/test";

test.describe("API keys settings page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("creating a key shows the plaintext token once, then the key appears active", async ({ page }) => {
    await page.goto("/dashboard/settings/api-keys");
    await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();

    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.getByText("Create API key")).toBeVisible();

    const keyName = `e2e-key-${Date.now()}`;
    await page.locator("#key-name").fill(keyName);

    // Scope checkboxes render as <label><Checkbox/><code>{scope}</code></label> —
    // no per-checkbox id, so target the one whose row contains the scope text.
    await page.getByText("controls:read", { exact: true }).locator("..").locator("button[role='checkbox']").click();

    const submitBtn = page.getByRole("button", { name: "Create key" }).last();
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Plaintext token is shown exactly once.
    await expect(page.getByText("Copy your API key")).toBeVisible();
    const tokenInput = page.locator("input[readonly]");
    await expect(tokenInput).toBeVisible();
    const token = await tokenInput.inputValue();
    expect(token).toMatch(/^dhm_/);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Copy your API key")).not.toBeVisible();

    // The key now shows in the list as Active with its scope badge, never the token again.
    const row = page.locator("div").filter({ hasText: keyName }).last();
    await expect(row.getByText("Active")).toBeVisible();
    await expect(row.getByText("controls:read")).toBeVisible();
    await expect(page.getByText(token)).not.toBeVisible();
  });

  test("revoking a key marks it Revoked and removes the revoke action", async ({ page }) => {
    await page.goto("/dashboard/settings/api-keys");

    await page.getByRole("button", { name: "Create key" }).click();
    const keyName = `e2e-revoke-${Date.now()}`;
    await page.locator("#key-name").fill(keyName);
    await page.getByText("evidence:read", { exact: true }).locator("..").locator("button[role='checkbox']").click();
    await page.getByRole("button", { name: "Create key" }).last().click();
    await expect(page.getByText("Copy your API key")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();

    const row = page.locator("div").filter({ hasText: keyName }).last();
    await expect(row.getByText("Active")).toBeVisible();

    await row.getByRole("button").last().click(); // trash-icon revoke button
    await expect(page.getByText("API key revoked")).toBeVisible();
    await expect(row.getByText("Revoked")).toBeVisible();
    await expect(row.getByRole("button")).toHaveCount(0);
  });
});
