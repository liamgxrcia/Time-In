import { defineConfig, devices } from "@playwright/test";
const configuredBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const configuredPort = process.env.PLAYWRIGHT_PORT ?? process.env.PORT;
const baseURL = configuredBaseURL ?? `http://localhost:${configuredPort ?? "3000"}`;
const previewPort = configuredPort ?? (new URL(baseURL).port || "3000");

export default defineConfig({ testDir: "./tests/e2e", fullyParallel: true, use: { baseURL, trace: "retain-on-failure" }, webServer: { command: `NEXT_PUBLIC_DEMO_MODE=true NEXT_PUBLIC_APP_ENV=test PORT=${previewPort} npm run dev`, url: baseURL, reuseExistingServer: true, timeout: 120_000 }, projects: [
  { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
  { name: "webkit-mobile", use: { ...devices["iPhone 15"] } },
  { name: "firefox-tablet", use: { ...devices["Desktop Firefox"], viewport: { width: 820, height: 1180 } } },
] });
