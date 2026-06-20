import { test, expect } from '@playwright/test';
import { FIXTURE_SESSION_ID } from './fixtures/seed';

// The timeline lives at /sessions/<id>/timeline (a separate route), NOT on the
// session detail page — the old spec looked for it on the detail page and so
// never asserted. globalSetup seeds FIXTURE_SESSION_ID with 3 events.
test.describe('Timeline', () => {
  test('renders the timeline page for the seeded session', async ({ page }) => {
    await page.goto(`/sessions/${FIXTURE_SESSION_ID}/timeline`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toContainText('Timeline');
    await expect(page.locator('[data-testid="timeline"]')).toBeVisible();
  });

  test('shows the event count for the seeded session', async ({ page }) => {
    await page.goto(`/sessions/${FIXTURE_SESSION_ID}/timeline`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/of \d+ events?/i)).toBeVisible();
  });
});
