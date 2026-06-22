import { test, expect } from '@playwright/test';

test.describe('Server availability', () => {
  test('Express health endpoint is reachable', async ({ request }) => {
    const resp = await request.get('http://localhost:3001/api/health');
    expect(resp.ok()).toBeTruthy();
  });

  test('Vite dev server is reachable', async ({ request }) => {
    const resp = await request.get('http://localhost:5173');
    expect(resp.ok()).toBeTruthy();
  });
});
