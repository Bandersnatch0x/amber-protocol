import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Server availability', () => {
  test('Express health endpoint returns debug info', async ({ request }) => {
    const resp = await request.get('http://localhost:3001/api/health');
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.ok).toBe(true);

    // Log server-side paths for CI debugging
    console.log('[health] cwd:', body.cwd);
    console.log('[health] AMBER_REPO_ROOT:', body.amberRepoRoot);

    // cwd must be apps/web (or the workspace root in some setups)
    expect(body.cwd).toContain('amber-protocol');

    // AMBER_REPO_ROOT must be set in CI (Playwright passes it via webServer.env)
    if (process.env.CI) {
      expect(body.amberRepoRoot).toBeTruthy();
      expect(body.amberRepoRoot).toContain('amber-protocol');
    }
  });

  test('Vite dev server is reachable', async ({ request }) => {
    const resp = await request.get('http://localhost:5173');
    expect(resp.ok()).toBeTruthy();
  });
});
