import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end tests against a local Supabase (`npx supabase start`, which needs
 * Docker) and the Next dev server. e2e/env.ts reads the keys from .env.local
 * or the environment; see e2e/README.md.
 */
const PORT = Number(process.env.E2E_PORT ?? 3000)
export const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  // One journey, step by step: each test builds on the one before.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --hostname 127.0.0.1 --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: { SITE_URL: BASE_URL },
      },
})
