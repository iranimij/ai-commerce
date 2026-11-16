import { defineConfig, devices } from '@playwright/test'

// Run with ./dev e2e: the shops are the production image, started by compose.yaml (profile e2e).
export default defineConfig({
  testMatch: '*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  workers: 4,
  // A retry would need a fresh shop of its own.
  retries: 0,
  timeout: 120_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  globalSetup: './support/global-setup.ts',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Chromium, like desktop: the shop's Secure cookies on http://localhost are a Chromium rule.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
