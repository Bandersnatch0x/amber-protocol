import { test, expect } from '@playwright/test';

test.describe('Improvement Suggestions', () => {
  test('desktop nav opens the suggestions page with a clustered card', async ({ page }) => {
    await page.goto('/sessions');
    const link = page.getByRole('link', { name: 'Suggestions', exact: true }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/suggestions/);
    await expect(page.locator('h1')).toContainText('Improvement Suggestions');
    await expect(page.getByTestId('suggestion-card').first()).toBeVisible();
    await expect(page.getByText(/came up \d+ times across/)).toBeVisible();
  });

  test('preview and apply write an allowlisted wiki note', async ({ page }) => {
    await page.goto('/suggestions');
    const card = page.getByTestId('suggestion-card').first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByTestId('suggestion-preview')).toBeVisible();
    await expect(page.getByTestId('suggestion-preview')).toContainText('docs/wiki/agent/friction/');
    await page.getByTestId('suggestion-apply').first().click();
    await expect(page.getByTestId('suggestions-message')).toContainText(
      'Applied to the allowlisted knowledge file.',
    );
  });
});
