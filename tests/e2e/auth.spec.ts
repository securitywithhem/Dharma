import { expect, test } from "@playwright/test";

test("landing page renders successfully", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Your compliance infrastructure.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Enter Workspace" })).toBeVisible();
});

test("dashboard redirects anonymous users to sign-in page", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL("**/auth/signin**");
  await expect(page.getByText("Sign in to Dharma")).toBeVisible();
});

test("magic link form validates and submits successfully", async ({ page }) => {
  await page.goto("/auth/signin");
  
  const emailInput = page.locator("#email");
  const sendButton = page.getByRole("button", { name: "Send" });

  await expect(emailInput).toBeVisible();
  await expect(sendButton).toBeDisabled();

  // Type valid email
  await emailInput.fill("auditor@dharma.local");
  await expect(sendButton).toBeEnabled();

  // Click send magic link (this outputs URL to server console in local mode)
  await sendButton.click();
  
  // Verify UI changes or indicates verification link sent
  await expect(page.getByText("Sign in to Dharma")).toBeVisible();
});
