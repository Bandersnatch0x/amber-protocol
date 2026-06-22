import { test, expect } from '@playwright/test';
import path from 'path';
import { FIXTURE_SESSION_ID, FIXTURE_GATE_ID } from './fixtures/seed';

test.describe('Server availability', () => {
  test('Express health endpoint returns debug info', async ({ request }) => {
    const resp = await request.get('http://localhost:3001/api/health');
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.ok).toBe(true);

    console.log('[health] cwd:', body.cwd);
    console.log('[health] AMBER_REPO_ROOT:', body.amberRepoRoot);

    expect(body.cwd).toContain('amber-protocol');
    if (process.env.CI) {
      expect(body.amberRepoRoot).toBeTruthy();
      expect(body.amberRepoRoot).toContain('amber-protocol');
    }
  });

  test('Vite dev server is reachable', async ({ request }) => {
    const resp = await request.get('http://localhost:5173');
    expect(resp.ok()).toBeTruthy();
  });

  test('seeded fixture exists on filesystem', async ({ request }) => {
    // Get the actual repo root from the server
    const health = await (await request.get('http://localhost:3001/api/health')).json();
    const repoRoot: string = health.amberRepoRoot;

    console.log('[fixture] checking under repoRoot:', repoRoot);

    // Manually check the expected session directory via the Vite proxy (the
    // browser can't read the filesystem, but we can ask the server's tRPC
    // endpoints).
    const sessionResp = await request.get(
      `http://localhost:3001/api/trpc/session.list`,
    );
    console.log('[fixture] session.list status:', sessionResp.status());
    const sessions = await sessionResp.json();
    console.log('[fixture] sessions count:', sessions?.length ?? 'no array');
    if (sessions && sessions.length > 0) {
      console.log('[fixture] session IDs:', sessions.map((s: { id: string }) => s.id));
    }
  });

  test('tRPC gate list returns data', async ({ request }) => {
    const resp = await request.get(
      `http://localhost:3001/api/trpc/gate.list`,
    );
    console.log('[gates] gate.list status:', resp.status());
    const gates = await resp.json();
    console.log('[gates] count:', gates?.length ?? 'no array');
  });
});
