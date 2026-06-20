import { test, expect } from '@playwright/test';

// Force a known starting scheme so "click → dark" is deterministic across the
// chromium/firefox/webkit projects (otherwise the OS/browser default decides
// the initial resolved theme and the toggle direction flips).
test.use({ colorScheme: 'light' });

test.describe('Theme Toggle', () => {
  test('should toggle to dark mode', async ({ page }) => {
    await page.goto('/');
    const themeButton = page.getByRole('button', { name: /toggle theme/i });
    await expect(themeButton).toBeVisible();
    await themeButton.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('should persist dark mode on reload', async ({ page }) => {
    await page.goto('/');
    const themeButton = page.getByRole('button', { name: /toggle theme/i });
    await themeButton.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
