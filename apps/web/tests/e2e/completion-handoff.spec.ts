import { test, expect } from '@playwright/test';
import { FIXTURE_SESSION_ID } from './fixtures/seed';

// The seeded fixture session has no handoff bundle and an incomplete
// completion checklist, so the read-only handoff card and the completion
// workbench both surface CLI remediation guidance (copy-only, never executed).
test.describe('Completion workbench guidance & handoff card', () => {
  test('shows the read-only handoff continuity card with CLI remediation', async ({ page }) => {
    await page.goto(`/sessions/${FIXTURE_SESSION_ID}`);

    await expect(page.getByText('Handoff continuity')).toBeVisible();
    await expect(page.getByText('Missing', { exact: true }).first()).toBeVisible();
    // Copy-only remediation command — the console never runs it.
    await expect(page.getByText('amber handoff --target .').first()).toBeVisible();
    await expect(page.getByText('CLI remediation')).toBeVisible();
  });

  test('lazily loads the handoff preview only when expanded', async ({ page }) => {
    await page.goto(`/sessions/${FIXTURE_SESSION_ID}`);

    const toggle = page.getByRole('button', { name: 'Preview handoff' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    // Expanding swaps the label to the collapse control.
    const collapse = page.getByRole('button', { name: 'Hide preview' });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    // The preview query settles to either rendered content or the empty note.
    await expect(page.getByText('Rendering preview...')).toBeHidden();
  });

  test('renders next-action guidance rows in the completion workbench', async ({ page }) => {
    await page.goto(`/sessions/${FIXTURE_SESSION_ID}`);

    await expect(page.getByText('Completion').first()).toBeVisible();
    await expect(page.getByText('Next Actions')).toBeVisible();
    // The incomplete fixture surfaces actionable guidance, including at least
    // one copy-only CLI command row.
    await expect(page.getByText('CLI command').first()).toBeVisible();
  });

  test('links from the home page to the governance overview', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: 'Open governance overview' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/governance');
  });

  test('renders the on-demand governance overview without polling controls', async ({ page }) => {
    await page.goto('/governance');

    await expect(page.locator('h1')).toContainText('Governance');
    await expect(page.getByText('Decision')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh governance summary' })).toBeVisible();
  });
});
