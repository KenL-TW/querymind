import { defineConfig, devices } from "playwright/test";

const browserChannel = process.env.QUERYMIND_BROWSER_CHANNEL;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: "line",
  use: {
    baseURL: process.env.QUERYMIND_TEST_URL || "http://127.0.0.1:8787",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...(browserChannel ? { channel: browserChannel } : {}) } }],
});
