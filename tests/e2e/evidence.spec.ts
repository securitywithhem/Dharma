import { expect, test } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Evidence Upload Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate using the test backdoor
    await page.goto("/api/test-auth?email=admin@dharma.local");
    await page.waitForURL("**/dashboard");
  });

  test("upload flow completes successfully", async ({ page }) => {
    await page.goto("/dashboard/evidence");

    // Check header
    await expect(page.getByText("Compliance Evidence")).toBeVisible();

    // Trigger upload dialog
    const uploadTrigger = page.locator("#evidence-upload-trigger");
    await expect(uploadTrigger).toBeVisible();
    await uploadTrigger.click();

    // Verify dialog shows up
    await expect(page.getByText("Upload Compliance Evidence")).toBeVisible();

    page.on("console", (msg) => console.log("EVIDENCE BROWSER LOG:", msg.type(), msg.text()));
    page.on("pageerror", (err) => console.log("EVIDENCE BROWSER ERROR:", err.message));
    page.on("requestfailed", request => console.log("EVIDENCE BROWSER REQ FAILED:", request.url(), request.failure()?.errorText));

    // Create a temporary file to upload
    const tempFilePath = path.join(__dirname, "temp-test-evidence.txt");
    fs.writeFileSync(tempFilePath, "This is E2E test evidence content.");

    // Select file using Playwright's setInputFiles
    const fileInput = page.locator("input[type='file']");
    await fileInput.setInputFiles(tempFilePath);

    // Select evidence type
    await page.locator("#evidence-type-select").click();
    await page.locator("role=option[name*='Screenshot']").click();

    // Submit upload
    const submitBtn = page.locator("#evidence-upload-submit");
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Verify success banner appears
    await expect(page.getByText("Evidence uploaded and linked successfully.")).toBeVisible({ timeout: 10000 });

    // Clean up temporary file
    fs.unlinkSync(tempFilePath);
  });
});
