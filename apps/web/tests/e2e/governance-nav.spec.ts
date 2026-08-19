import { test, expect } from '@playwright/test';

// Governance navigation & page-state coverage. Kept separate from
// completion-handoff.spec.ts, which owns the home -> governance link and the
// base governance render cases (do not duplicate them here).
test.describe('Governance navigation & page states', () => {
  test('desktop nav includes a governance entry that routes to the page', async ({ page }) => {
    await page.goto('/sessions');

    const link = page.getByRole('link', { name: 'Governance', exact: true }).first();
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(/\/governance/);
    await expect(page.locator('h1')).toContainText('Governance');
  });

  test('mobile nav exposes the same governance entry', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/sessions');

    const link = page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .getByRole('link', { name: 'Governance', exact: true });
    await expect(link).toBeVisible();
  });

  test('governance page offers a feature-focus control and readable count labels', async ({
    page,
  }) => {
    await page.goto('/governance');

    // The on-demand fold always renders the refresh control once mounted.
    await expect(page.getByRole('button', { name: 'Refresh governance summary' })).toBeVisible();

    // Feature focus entry: either a populated selector or the empty-state hint.
    const selector = page.getByLabel('Select feature focus');
    const emptyHint = page.getByText(/No feature candidates found/);
    expect((await selector.count()) + (await emptyHint.count())).toBeGreaterThan(0);

    // Count-card labels must never be raw camelCase keys uppercased.
    const body = await page.locator('body').innerText();
    for (const raw of ['FEATUREEVIDENCE', 'READINESSFINDINGS', 'STALEDOCS', 'MAINTENANCEERRORS']) {
      expect(body).not.toContain(raw);
    }
  });
});
