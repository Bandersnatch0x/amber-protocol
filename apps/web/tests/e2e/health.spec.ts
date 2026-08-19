import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const apiPort = Number(process.env.AMBER_E2E_API_PORT ?? process.env.API_PORT ?? 3101);
const clientPort = Number(process.env.AMBER_E2E_CLIENT_PORT ?? process.env.VITE_DEV_PORT ?? 5273);

test.describe('Server availability', () => {
  test('Express health endpoint returns debug info', async ({ request }) => {
    const resp = await request.get(`http://127.0.0.1:${apiPort}/api/health`);
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(path.resolve(body.amberRepoRoot)).toBe(path.resolve(process.env.AMBER_REPO_ROOT ?? ''));

    console.log('[health] cwd:', body.cwd);
    console.log('[health] AMBER_REPO_ROOT:', body.amberRepoRoot);

    // Verify the seeded fixture data exists at the reported repo root
    const fixtureSessionDir = path.join(
      body.amberRepoRoot,
      '.amber',
      'sessions',
      '00000000-0000-4000-8000-00000000e2e5',
    );
    const manifestPath = path.join(fixtureSessionDir, 'manifest.json');
    const gatesDir = path.join(fixtureSessionDir, 'gates');

    console.log('[health] fixtureSessionDir:', fixtureSessionDir);
    console.log('[health] manifest exists:', fs.existsSync(manifestPath));
    console.log('[health] gates dir exists:', fs.existsSync(gatesDir));

    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      console.log('[health] manifest.goal:', manifest.goal);
    }

    // The test runner's own cwd should also find it
    const cwdFixture = path.resolve(
      process.cwd(),
      '..',
      '..',
      '.amber',
      'sessions',
      '00000000-0000-4000-8000-00000000e2e5',
    );
    console.log('[health] cwd-based fixture:', cwdFixture);
    console.log(
      '[health] cwd-based manifest exists:',
      fs.existsSync(path.join(cwdFixture, 'manifest.json')),
    );
  });

  test('Vite dev server is reachable', async ({ request }) => {
    const resp = await request.get(`http://127.0.0.1:${clientPort}`);
    expect(resp.ok()).toBeTruthy();
  });
});
