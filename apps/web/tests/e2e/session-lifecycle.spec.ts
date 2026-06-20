import { test, expect } from '@playwright/test';

// globalSetup seeds one fixture session, so the list and its card link are
// guaranteed — the asserts no longer hide behind `if (count > 0)`.
test.describe('Session Lifecycle', () => {
  test('should navigate to the sessions page', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.locator('h1')).toContainText('Sessions');
  });

  test('should display the session list', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForLoadState('networkidle');
    // Card links are `/sessions/<id>`; the nav link `/sessions` won't match.
    await expect(page.locator('a[href*="/sessions/"]').first()).toBeVisible();
  });

  test('should navigate to session details', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForLoadState('networkidle');
    const firstLink = page.locator('a[href*="/sessions/"]').first();
    await expect(firstLink).toBeVisible();
    await firstLink.click();
    await expect(page).toHaveURL(/\/sessions\/.+/);
  });
});
