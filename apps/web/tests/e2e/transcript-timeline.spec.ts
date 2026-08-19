import { test, expect } from '@playwright/test';
import { FIXTURE_TRANSCRIPT_ID } from './fixtures/transcript-fixture';

// globalSetup seeds a Claude Code transcript fixture (N1-N5, N8 + 2 ordinary
// turns) under AMBER_CLAUDE_HOME; the web server reads it via the same
// transcript.list/read path as production.
const TRANSCRIPT_URL = `/transcripts/${FIXTURE_TRANSCRIPT_ID}`;

test.describe('Transcript timeline (zh-CN)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('amber-web-language', 'zh-CN');
    });
  });

  test('renders the denoised timeline and hides raw noise literals', async ({ page }) => {
    await page.goto(TRANSCRIPT_URL);

    const timeline = page.locator('[data-testid="transcript-timeline"]');
    await expect(timeline).toBeVisible();

    // R2: slash command folded into a chip card.
    await expect(timeline.getByText('斜杠命令 /model')).toBeVisible();

    // Turn separator inserted for the >15min gap before the slash command.
    await expect(page.locator('[data-testid="transcript-turn-separator"]').first()).toBeVisible();
    await expect(timeline.getByText('Turn 分隔').first()).toBeVisible();

    // Role badges are translated and role-differentiated.
    await expect(timeline.getByText('用户', { exact: true }).first()).toBeVisible();
    await expect(timeline.getByText('助手', { exact: true }).first()).toBeVisible();

    // R1 caveat is fully hidden; R4 ANSI never leaks: no raw literals anywhere.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('<local-command-caveat>');
    expect(bodyText).not.toContain('\u001b[');

    // MetadataPanel counts the hidden local command record.
    await expect(page.getByText('已隐藏的系统记录')).toBeVisible();
    await expect(page.getByText(/已隐藏 1 条/)).toBeVisible();
    await page.getByRole('button', { name: '显示记录类型' }).click();
    await expect(page.getByText('本地命令记录').first()).toBeVisible();
  });

  test('raw viewer expands original tags without leaking ANSI', async ({ page }) => {
    await page.goto(TRANSCRIPT_URL);

    const timeline = page.locator('[data-testid="transcript-timeline"]');
    await expect(timeline).toBeVisible();

    // First raw viewer belongs to the slash-command card (plain cards have none).
    await page.getByRole('button', { name: '查看原文' }).first().click();
    const timelineText = await timeline.innerText();
    expect(timelineText).toContain('<command-name>');
    expect(timelineText).not.toContain('\u001b[');

    await page.getByRole('button', { name: '收起原文' }).first().click();
    const collapsedText = await timeline.innerText();
    expect(collapsedText).not.toContain('<command-name>');
  });
});

test.describe('Transcript timeline (en)', () => {
  test('badge and chip copy switch to English', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('amber-web-language', 'en');
    });
    await page.goto(TRANSCRIPT_URL);

    const timeline = page.locator('[data-testid="transcript-timeline"]');
    await expect(timeline).toBeVisible();
    await expect(timeline.getByText('Slash command /model')).toBeVisible();
    await expect(timeline.getByText('User', { exact: true }).first()).toBeVisible();
    await expect(timeline.getByText('Assistant', { exact: true }).first()).toBeVisible();
    await expect(timeline.getByText('Session recap').first()).toBeVisible();
  });
});
