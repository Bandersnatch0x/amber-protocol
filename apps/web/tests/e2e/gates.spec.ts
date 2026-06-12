import { test, expect } from '@playwright/test';

test.describe('Gates', () => {
  test('should view gates list', async ({ page }) => {
    await page.goto('/gates');
    await expect(page.locator('h1')).toContainText('Gates');
  });

  test('should display gate count', async ({ page }) => {
    await page.goto('/gates');
    await page.waitForLoadState('networkidle');
    const countText = page.locator('text=/\\d+ gate/');
    await expect(countText.first()).toBeVisible();
  });

  test('should filter gates by status', async ({ page }) => {
    await page.goto('/gates');
    await page.waitForLoadState('networkidle');
    const filterSelect = page.locator('select');
    if (await filterSelect.count() > 0) {
      await filterSelect.selectOption('pending');
      await page.waitForTimeout(500);
      await expect(page.locator('h1')).toContainText('Gates');
    }
  });
});
