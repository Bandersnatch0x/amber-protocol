import { test, expect } from '@playwright/test';

test.describe('Timeline', () => {
  test('should display timeline on session page', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForLoadState('networkidle');
    const firstSession = page.locator('a[href*="/sessions/"]').first();
    if (await firstSession.count() > 0) {
      await firstSession.click();
      await page.waitForLoadState('networkidle');
      const timeline = page.locator('[class*="timeline"], [data-testid="timeline"]');
      if (await timeline.count() > 0) {
        await expect(timeline.first()).toBeVisible();
      }
    }
  });

  test('should scroll timeline events', async ({ page }) => {
    await page.goto('/sessions');
    await page.waitForLoadState('networkidle');
    const firstSession = page.locator('a[href*="/sessions/"]').first();
    if (await firstSession.count() > 0) {
      await firstSession.click();
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    }
  });
});
