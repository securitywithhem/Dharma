import { expect, test } from "@playwright/test";

test("landing page renders the Dharma entry point", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Dharma Phase 0.1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Enter workspace" })).toBeVisible();
});

test("dashboard redirects unauthenticated users to sign-in", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/auth\/signin/);
});
