import { test, expect } from '@playwright/test';
import {
  APPROVE_CONSUMABLE_GATE_ID,
  APPROVE_CONSUMABLE_SESSION_ID,
  FIXTURE_GATE_ID,
  REJECT_CONSUMABLE_GATE_ID,
  REJECT_CONSUMABLE_SESSION_ID,
} from './fixtures/seed';

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
    if ((await filterSelect.count()) > 0) {
      await filterSelect.selectOption('pending');
      await expect(page.locator('h1')).toContainText('Gates');
      await expect(page.getByText('e2e-approval-gate')).toBeVisible();
      // The filter is URL-backed, so choosing a status rewrites the address.
      await expect(page).toHaveURL(/status=pending/);
    }
  });

  test('restores the status filter from the URL after navigating away and back', async ({
    page,
  }) => {
    await page.goto('/gates?status=pending');
    const filterSelect = page.locator('select');
    await expect(filterSelect).toHaveValue('pending');

    // Deep-link stays compatible with the existing from=gates session links.
    const baselineGateCard = page.locator('article', { hasText: FIXTURE_GATE_ID });
    await baselineGateCard.getByRole('link', { name: 'Open session' }).click();
    await page.goBack();

    await expect(page).toHaveURL(/status=pending/);
    await expect(page.locator('select')).toHaveValue('pending');
  });

  test('shows gate-scoped evidence trail from the fixture ledger', async ({ page }) => {
    await page.goto('/gates');
    // Scope to the baseline gate card: consumable seeds also render Review
    // buttons, and the list order is not part of this spec's contract.
    const baselineGateCard = page.locator('article', { hasText: FIXTURE_GATE_ID });
    await baselineGateCard.getByRole('button', { name: 'Review' }).click();

    await expect(page.getByText('Evidence trail')).toBeVisible();
    await expect(page.getByText('Ledger verified')).toBeVisible();
    await expect(page.getByText(/gate_triggered/i).first()).toBeVisible();
    // Counts are session-file totals and are labeled as such, so the
    // gate-scoped "latest" entries can never read as contradicting them.
    await expect(page.getByText('Session ledger records / Session timeline events')).toBeVisible();
  });

  test('keeps validation errors inline without polluting the action feedback banner', async ({
    page,
  }) => {
    await page.goto('/gates');
    const baselineGateCard = page.locator('article', { hasText: FIXTURE_GATE_ID });
    await baselineGateCard.getByRole('button', { name: 'Reject', exact: true }).click();

    // Submitting without a reason fails pre-dispatch validation only.
    await baselineGateCard.getByRole('button', { name: 'Confirm reject' }).click();
    await expect(baselineGateCard.getByText('Please provide a rejection reason.')).toBeVisible();
    // The top aria-live banner stays on its neutral hint instead of carrying a
    // stale validation error.
    await expect(page.getByText(/Review gate context, decide approve or reject/)).toBeVisible();

    // Editing the field clears the inline error immediately.
    const textarea = baselineGateCard.locator('textarea');
    await textarea.fill('draft reason');
    await expect(
      baselineGateCard.getByText('Please provide a rejection reason.'),
    ).not.toBeVisible();

    // Cancel without deciding: the baseline seed must stay pristine.
    await baselineGateCard.getByRole('button', { name: 'Cancel reject' }).click();
  });

  // Consuming cases keep to the end of this file and only ever consume their
  // dedicated seeds — approving/rejecting appends decision records to the
  // owning session's ledger/timeline, so they must never touch the baseline
  // session (FIXTURE_SESSION_ID) that session-lifecycle.spec.ts asserts on.
  test('shows completion workbench guidance link after approval', async ({ page }) => {
    await page.goto('/gates');
    const consumableGateCard = page.locator('article', { hasText: APPROVE_CONSUMABLE_GATE_ID });
    // The optional reviewer identifier now lives inside the expanded Review
    // panel; it rides into the audit chain with the decision. Leaving it
    // empty would record web:anonymous instead.
    await consumableGateCard.getByRole('button', { name: 'Review' }).click();
    await consumableGateCard.locator('input[type="text"]').fill('e2e-auditor');
    await consumableGateCard.getByRole('button', { name: 'Approve and confirm resume' }).click();

    const guidanceLink = page.getByRole('link', { name: 'Open completion workbench' });
    await expect(guidanceLink).toBeVisible();
    await expect(guidanceLink).toHaveAttribute(
      'href',
      new RegExp(`/sessions/${APPROVE_CONSUMABLE_SESSION_ID}`),
    );

    // The Review panel was expanded before approval and stays open; the
    // recorded reviewer identity surfaces there as the resolvedBy value read
    // back from the decision file.
    await expect(consumableGateCard.getByText('e2e-auditor')).toBeVisible();
  });

  test('shows rework guidance link after rejection', async ({ page }) => {
    await page.goto('/gates');
    const consumableGateCard = page.locator('article', { hasText: REJECT_CONSUMABLE_GATE_ID });
    await consumableGateCard.getByRole('button', { name: 'Reject', exact: true }).click();

    // The reject panel requires an auditable reason before the decision is
    // written.
    await consumableGateCard.locator('textarea').fill('E2E rejection: route back to rework');
    await consumableGateCard.getByRole('button', { name: 'Confirm reject' }).click();

    const reworkLink = page.getByRole('link', { name: 'Open session for rework' });
    await expect(reworkLink).toBeVisible();
    await expect(reworkLink).toHaveAttribute(
      'href',
      new RegExp(`/sessions/${REJECT_CONSUMABLE_SESSION_ID}`),
    );
  });
});
