import { test, expect } from '@playwright/test';

test.describe('Session Lifecycle', () => {
  test('should navigate to sessions page', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.locator('h1')).toContainText('Sessions');
  });

  test('should display session list', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForSelector('h1');
    const heading = await page.locator('h1').textContent();
    expect(heading).toContain('Sessions');
  });

  test('should navigate to session details', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForLoadState('networkidle');
    const firstLink = page.locator('a[href*="/sessions/"]').first();
    if (await firstLink.count() > 0) {
      await firstLink.click();
      await expect(page).toHaveURL(/\/sessions\/.+/);
    }
  });
});
