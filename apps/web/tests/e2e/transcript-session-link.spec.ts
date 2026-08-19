import { test, expect } from '@playwright/test';
import { FIXTURE_SESSION_ID } from './fixtures/seed';
import { FIXTURE_TRANSCRIPT_ID } from './fixtures/transcript-fixture';

// Task #34: the session detail page upgrades the honest "cannot link" note
// into an inferred association when cwd + time-window evidence exists.
// globalSetup seeds a transcript fixture whose records carry cwd=<e2e repo
// root> and timestamps inside the fixture session's activity window, so the
// candidate block must appear for FIXTURE_SESSION_ID.
const SESSION_URL = `/sessions/${FIXTURE_SESSION_ID}`;

test.describe('Inferred transcript association (zh-CN)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('amber-web-language', 'zh-CN');
    });
  });

  test('shows the inferred candidate block with evidence and disclaimer', async ({ page }) => {
    await page.goto(SESSION_URL);

    const block = page.locator('[data-testid="session-related-transcripts"]');
    await expect(block).toBeVisible();
    await expect(block.getByText('可能相关的转录')).toBeVisible();

    // Honest basis disclaimer accompanies the inference.
    await expect(block.getByText(/按工作目录与会话活动时间窗推断/)).toBeVisible();

    // The candidate links to the seeded transcript and carries overlap evidence.
    const link = block.getByRole('link', { name: /E2E fixture/ });
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`/transcripts/${FIXTURE_TRANSCRIPT_ID}$`),
    );
    await expect(block.getByText(/活动重叠区间/)).toBeVisible();

    // Full-list entry point stays available next to the candidates.
    await expect(block.getByRole('link', { name: '查看记录' })).toBeVisible();
  });
});

test.describe('Inferred transcript association (en)', () => {
  test('candidate block copy switches to English', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('amber-web-language', 'en');
    });
    await page.goto(SESSION_URL);

    const block = page.locator('[data-testid="session-related-transcripts"]');
    await expect(block).toBeVisible();
    await expect(block.getByText('Possibly related transcripts')).toBeVisible();
    await expect(block.getByText(/indicative only, not proven/i)).toBeVisible();
    await expect(block.getByText(/Activity overlap/)).toBeVisible();
  });
});
