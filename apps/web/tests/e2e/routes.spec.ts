import { test, expect } from '@playwright/test';

test.describe('Routes', () => {
  test('should view routes list', async ({ page }) => {
    await page.goto('/routes');
    await expect(page.locator('h1')).toContainText('Routes');
  });

  test('should display route categories', async ({ page }) => {
    await page.goto('/routes');
    // The repo ships route definitions (routes/*.route.json), so the grouped
    // list must render at least one category heading. This replaces a previous
    // `toBeGreaterThanOrEqual(0)` no-op that passed even with zero categories.
    await expect(page.locator('h2').first()).toBeVisible();
    expect(await page.locator('h2').count()).toBeGreaterThan(0);
  });

  test('should navigate to route details', async ({ page }) => {
    await page.goto('/routes/feature-standard');
    await expect(page).toHaveURL(/\/routes\/feature-standard/);
    await expect(page.getByText('feature-standard')).toBeVisible();
    await expect(page.getByText('Complete feature delivery with planning and review')).toBeVisible();
  });
});
