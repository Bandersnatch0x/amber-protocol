import { defineConfig, devices } from '@playwright/test';
import { getE2ERepoRoot } from './tests/e2e/fixtures/repo-root';

// Compute and set AMBER_REPO_ROOT early so webServer processes inherit it
if (!process.env.AMBER_REPO_ROOT) {
  process.env.AMBER_REPO_ROOT = getE2ERepoRoot();
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/globalSetup.ts',
  globalTeardown: './tests/e2e/globalTeardown.ts',
  expect: {
    timeout: 15_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:server',
      port: 3001,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev:client',
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
