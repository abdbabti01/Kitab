import { defineConfig, devices } from "@playwright/test";

const ui = Number(process.env.KITAB_UI_PORT ?? 5174);
const api = Number(process.env.KITAB_API_PORT ?? 5175);
/** Specs that need the real Worker handler with fake bindings (vite.e2e.config.ts). */
const workerSpecs = /(api|stale-replies)\.spec/;
const desktop ={ ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } };

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${ui}`, trace: "retain-on-failure" },
  webServer: [
    { command: `npx vite --port ${ui} --strictPort`, url: `http://localhost:${ui}`, reuseExistingServer: !process.env.CI },
    // The real Worker handler with fake bindings (see vite.e2e.config.ts).
    { command: `npx vite --config vite.e2e.config.ts --port ${api} --strictPort`, url: `http://localhost:${api}`, reuseExistingServer: !process.env.CI },
  ],
  projects: [
    { name: "desktop-1440", testIgnore: workerSpecs, use: desktop },
    { name: "laptop-1024", testIgnore: workerSpecs, use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 800 } } },
    { name: "tablet-768", testIgnore: workerSpecs, use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "phone-390", testIgnore: workerSpecs, use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 } },
    { name: "worker-integration", testMatch: workerSpecs, use: { ...desktop, baseURL: `http://localhost:${api}` } },
  ],
});
