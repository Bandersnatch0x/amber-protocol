import { test, expect } from '@playwright/test';

test.describe('Theme Toggle', () => {
  test('should toggle to dark mode', async ({ page }) => {
    await page.goto('/');
    const themeButton = page.locator('[aria-label*="theme" i], button:has-text("Theme")').first();
    if (await themeButton.count() > 0) {
      await themeButton.click();
      await page.waitForTimeout(500);
      const html = page.locator('html');
      const className = await html.getAttribute('class');
      expect(className).toContain('dark');
    }
  });

  test('should persist dark mode on reload', async ({ page }) => {
    await page.goto('/');
    const themeButton = page.locator('[aria-label*="theme" i], button:has-text("Theme")').first();
    if (await themeButton.count() > 0) {
      await themeButton.click();
      await page.waitForTimeout(500);
      await page.reload();
      await page.waitForLoadState('networkidle');
      const html = page.locator('html');
      const className = await html.getAttribute('class');
      expect(className).toContain('dark');
    }
  });
});
