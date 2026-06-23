import { test, expect } from '@playwright/test';
import { FIXTURE_SESSION_ID } from './fixtures/seed';

// globalSetup seeds one fixture session, so the list and its card link are
// guaranteed; the asserts no longer hide behind `if (count > 0)`.
test.describe('Session Lifecycle', () => {
  test('should navigate to the sessions page', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.locator('h1')).toContainText('Sessions');
  });

  test('should display the session list', async ({ page }) => {
    await page.goto('/sessions');
    // Card links are `/sessions/<id>`; the nav link `/sessions` won't match.
    await expect(page.locator('a[href*="/sessions/"]').first()).toBeVisible();
  });

  test('should navigate to session details', async ({ page }) => {
    await page.goto(`/sessions/${FIXTURE_SESSION_ID}`);
    await expect(page).toHaveURL(new RegExp(`/sessions/${FIXTURE_SESSION_ID}`));
    await expect(page.locator('h1')).toContainText('E2E fixture session');
  });
});
