import { defineConfig, devices } from "@playwright/test";

// When PLAYWRIGHT_TEST_BASE_URL is set (CI runs the app in Docker on :3000),
// target it directly and spawn no server. Otherwise keep the local flow:
// Playwright boots a dev server on :3001.
const externalBaseURL = process.env.PLAYWRIGHT_TEST_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: externalBaseURL ?? "http://localhost:3001",
    // retries is 0, so on-first-retry would never record; keep full traces of
    // CI failures (uploaded as artifacts) and stay light locally.
    trace: externalBaseURL ? "retain-on-failure" : "on-first-retry"
  },
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: "PORT=3001 npm run dev",
          url: "http://localhost:3001",
          reuseExistingServer: !process.env.CI
        }
      }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
