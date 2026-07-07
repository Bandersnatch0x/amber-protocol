import { defineConfig, devices } from '@playwright/test';
import os from 'os';
import path from 'path';

// Inline getE2ERepoRoot to avoid import issues
function getE2ERepoRoot(): string {
  const override = process.env.AMBER_E2E_REPO_ROOT;
  if (override) return path.resolve(override);

  const repoKey = path.resolve(process.cwd(), '..', '..').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `amber-web-e2e-${repoKey}`);
}

// Compute and set AMBER_REPO_ROOT early so webServer processes inherit it
process.env.AMBER_REPO_ROOT = getE2ERepoRoot();
const reuseExistingServer = process.env.AMBER_E2E_REUSE_SERVER === '1';
const apiPort = Number(process.env.AMBER_E2E_API_PORT ?? 3101);
const clientPort = Number(process.env.AMBER_E2E_CLIENT_PORT ?? 5273);
process.env.PORT = String(apiPort);
process.env.API_PORT = String(apiPort);
process.env.VITE_DEV_PORT = String(clientPort);
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';
const e2eEnv = {
  ...process.env,
  AMBER_REPO_ROOT: process.env.AMBER_REPO_ROOT,
  PORT: String(apiPort),
  API_PORT: String(apiPort),
  VITE_DEV_PORT: String(clientPort),
};

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/globalSetup.ts',
  globalTeardown: './tests/e2e/globalTeardown.ts',
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${clientPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'local-chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:server',
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: e2eEnv,
    },
    {
      command: 'npm run dev:client',
      url: `http://127.0.0.1:${clientPort}`,
      reuseExistingServer,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: e2eEnv,
    },
  ],
});
