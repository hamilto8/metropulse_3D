import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'phase0-reference.spec.js',
  outputDir: '../../test-results/phase0-reference',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 300_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    viewport: { width: 1280, height: 720 },
    headless: true,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000
  }
});
