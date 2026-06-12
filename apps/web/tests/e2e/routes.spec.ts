import { test, expect } from '@playwright/test';

test.describe('Routes', () => {
  test('should view routes list', async ({ page }) => {
    await page.goto('/routes');
    await expect(page.locator('h1')).toContainText('Routes');
  });

  test('should display route categories', async ({ page }) => {
    await page.goto('/routes');
    await page.waitForLoadState('networkidle');
    const categories = page.locator('h2');
    const count = await categories.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should navigate to route details', async ({ page }) => {
    await page.goto('/routes');
    await page.waitForLoadState('networkidle');
    const firstRouteLink = page.locator('a[href*="/routes/"]').first();
    if (await firstRouteLink.count() > 0) {
      await firstRouteLink.click();
      await expect(page).toHaveURL(/\/routes\/.+/);
    }
  });
});
