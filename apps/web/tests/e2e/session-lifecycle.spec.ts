import { test, expect } from '@playwright/test';
import { CONTROL_FIXTURE_SESSION_ID, FIXTURE_SESSION_ID } from './fixtures/seed';

// globalSetup seeds one fixture session, so the list and its card link are
// guaranteed; the asserts no longer hide behind `if (count > 0)`.
test.describe('Session Lifecycle', () => {
  test('should navigate to the sessions page', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.locator('h1')).toContainText('Sessions');
  });

  test('should display the session list', async ({ page }) => {
    await page.goto('/sessions');
    // Card links are `/sessions/<id>`; the nav link `/sessions` won't match.
    await expect(page.locator('a[href*="/sessions/"]').first()).toBeVisible();
  });

  test('should navigate to session details', async ({ page }) => {
    await page.goto(`/sessions/${FIXTURE_SESSION_ID}`);
    await expect(page).toHaveURL(new RegExp(`/sessions/${FIXTURE_SESSION_ID}`));
    await expect(page.locator('h1')).toContainText('E2E fixture session');
  });

  test('shows durable evidence from the seeded ledger and timeline', async ({ page }) => {
    await page.goto(`/sessions/${FIXTURE_SESSION_ID}`);
    await expect(page.getByText('Evidence trail')).toBeVisible();
    await expect(page.getByText('Ledger verified')).toBeVisible();
    await expect(page.getByText(/runner_ack/i)).toBeVisible();
  });

  test('shows three-phase confirmation after a safe fixture control action', async ({ page }) => {
    await page.goto(`/sessions/${CONTROL_FIXTURE_SESSION_ID}`);
    await page.getByRole('button', { name: 'Pause session' }).click();

    await expect(page.getByText('Request persisted')).toBeVisible();
    await expect(page.getByText('Manifest confirmed')).toBeVisible();
    await expect(page.getByText('Runner ACK timed out')).toBeVisible();
  });
});
