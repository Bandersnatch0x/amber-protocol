import { test, expect } from '@playwright/test';

test.describe('Routes', () => {
  test('should view routes list', async ({ page }) => {
    await page.goto('/routes');
    await expect(page.locator('h1')).toContainText('Routes');
  });

  test('should display route categories', async ({ page }) => {
    await page.goto('/routes');
    await page.waitForLoadState('networkidle');
    // The repo ships route definitions (routes/*.route.json), so the grouped
    // list must render at least one category heading. This replaces a previous
    // `toBeGreaterThanOrEqual(0)` no-op that passed even with zero categories.
    await expect(page.locator('h2').first()).toBeVisible();
    expect(await page.locator('h2').count()).toBeGreaterThan(0);
  });

  test('should navigate to route details', async ({ page }) => {
    await page.goto('/routes');
    await page.waitForLoadState('networkidle');
    // Card links are `/routes/<id>`; the nav link is `/routes` (no trailing
    // slash) so it won't match. The repo ships routes, so a card must exist.
    const firstRouteLink = page.locator('a[href*="/routes/"]').first();
    await expect(firstRouteLink).toBeVisible();
    await firstRouteLink.click();
    await expect(page).toHaveURL(/\/routes\/.+/);
  });
});
