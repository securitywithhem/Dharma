import { test, expect } from '@playwright/test';

test('evidence upload flow', async ({ page }) => {
  // Navigate to control detail page
  await page.goto('/dashboard/controls/ctrl_123');

  // Click upload button
  await page.click('button:has-text("Upload Evidence")');

  // Select evidence type
  await page.selectOption('select', 'SCREENSHOT');

  // Upload file
  await page.setInputFiles('input[type="file"]', './test-screenshot.png');

  // Click submit
  await page.click('button:has-text("Upload Evidence")');

  // Verify success toast
  await expect(page.locator('text=Evidence uploaded successfully')).toBeVisible();

  // Verify file appears in list
  await expect(page.locator('text=test-screenshot.png')).toBeVisible();
});
