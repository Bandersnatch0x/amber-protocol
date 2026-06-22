import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const repoRoot = path.resolve(process.cwd(), '..', '..');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/globalSetup.ts',
  globalTeardown: './tests/e2e/globalTeardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
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
      env: {
        ...process.env,
        AMBER_REPO_ROOT: repoRoot,
      },
    },
    {
      command: 'npm run dev:client',
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
