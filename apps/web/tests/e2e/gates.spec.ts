import { test, expect } from '@playwright/test';

test.describe('Gates', () => {
  test('should view gates list', async ({ page }) => {
    await page.goto('/gates');
    await expect(page.locator('h1')).toContainText('Gates');
  });

  test('should display gate count', async ({ page }) => {
    await page.goto('/gates');
    const countText = page.locator('text=/\\d+ gate/');
    await expect(countText.first()).toBeVisible();
  });

  test('should filter gates by status', async ({ page }) => {
    await page.goto('/gates');
    const filterSelect = page.locator('select');
    if (await filterSelect.count() > 0) {
      await filterSelect.selectOption('pending');
      await expect(page.locator('h1')).toContainText('Gates');
      await expect(page.getByText('e2e-approval-gate')).toBeVisible();
    }
  });

  test('shows gate-scoped evidence trail from the fixture ledger', async ({ page }) => {
    await page.goto('/gates');
    await page.getByRole('button', { name: 'Review' }).first().click();

    await expect(page.getByText('Evidence trail')).toBeVisible();
    await expect(page.getByText('Ledger verified')).toBeVisible();
    await expect(page.getByText(/gate_triggered/i).first()).toBeVisible();
  });
});
