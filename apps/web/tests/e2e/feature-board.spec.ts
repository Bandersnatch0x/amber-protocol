import { test, expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const repoKey = path.resolve(process.cwd(), '..', '..').replace(/[^a-zA-Z0-9_-]/g, '_');
const root = path.resolve(
  process.env.AMBER_E2E_REPO_ROOT ?? path.join(os.tmpdir(), `amber-web-e2e-${repoKey}`),
);
const featureFile = path.join(root, 'feature_list.json');
const ids = Array.from({ length: 4 }, () => randomUUID());
const statuses = ['not_started', 'in_progress', 'blocked', 'passing', 'accepted'];
const longText = '长标题与完整记录/'.repeat(60) + 'abcdefghijklmnop'.repeat(20);
const features = statuses.map((status, index) => ({
  id: `F90${index + 1}`,
  title: index === 2 ? longText : `Delivery sample ${index + 1}`,
  status,
  priority: index + 1,
  area: 'observability',
  user_visible_behavior: 'Read-only Feature projection',
  verification: ['Inspect the actual governance page'],
  notes: index === 2 ? [longText] : [],
  evidence: status === 'passing' ? ['Agent 自述：完成', longText] : [],
}));
let original: Buffer;
const originalSessionManifests = new Map<string, Buffer>();

function seed(): void {
  fs.writeFileSync(featureFile, JSON.stringify({ features }));
  ids.forEach((sessionId, index) => {
    const directory = path.join(root, '.amber/sessions', sessionId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'manifest.json'),
      JSON.stringify({
        sessionId,
        schemaVersion: '1.0.0-rc.1',
        createdAt: '2026-11-27T00:00:00Z',
        goal: `Delivery Session ${index + 1}`,
        route: { id: 'feature-standard', version: '1.0.0' },
        status: 'created',
        currentStage: index === 1 ? '' : 'implement',
        ...(index < 2 ? { feature: 'F902' } : index === 3 ? { feature: 'F999' } : {}),
      }),
    );
  });
}

function fileTree(directory: string): Record<string, string> {
  return Object.fromEntries(
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected fixture link: ${file}`);
      return entry.isDirectory()
        ? [
            [`${entry.name}/`, 'directory'],
            ...Object.entries(fileTree(file)).map(([name, hash]) => [
              `${entry.name}/${name}`,
              hash,
            ]),
          ]
        : [[entry.name, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]];
    }),
  );
}

async function evidence(page: Page, info: TestInfo, name: string): Promise<void> {
  const screenshot = info.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await info.attach(name, { path: screenshot, contentType: 'image/png' });
  await info.attach(`${name}-a11y`, {
    body: await page.locator('main').ariaSnapshot(),
    contentType: 'text/plain',
  });
}

test.use({ trace: 'on' });

test.describe('Feature delivery read-only projection', () => {
  test.beforeAll(() => {
    if (!root.startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Expected disposable E2E root');
    original = fs.readFileSync(featureFile);
    for (const id of ids)
      if (fs.existsSync(path.join(root, '.amber/sessions', id)))
        throw new Error('Fixture ID collision');
    // The shared viewer fixtures use legacy manifests; this suite needs a healthy board baseline.
    for (const entry of fs.readdirSync(path.join(root, '.amber/sessions'))) {
      const file = path.join(root, '.amber/sessions', entry, 'manifest.json');
      originalSessionManifests.set(file, fs.readFileSync(file));
      fs.writeFileSync(
        file,
        JSON.stringify({
          sessionId: entry,
          schemaVersion: '1.0.0-rc.1',
          createdAt: '2026-11-27T00:00:00Z',
          goal: 'Existing E2E fixture session',
          status: 'created',
          route: { id: 'feature-standard', version: '1.0.0' },
        }),
      );
    }
  });
  test.beforeEach(seed);
  test.afterAll(() => {
    if (original) fs.writeFileSync(featureFile, original);
    for (const [file, bytes] of originalSessionManifests) fs.writeFileSync(file, bytes);
    for (const id of ids)
      fs.rmSync(path.join(root, '.amber/sessions', id), { recursive: true, force: true });
  });

  test('打开、刷新、筛选、聚焦和复制建议不写仓库，不发送 mutation', async ({
    page,
    context,
  }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const before = fileTree(root);
    const requests: Array<{ method: string; url: string }> = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/'))
        requests.push({ method: request.method(), url: request.url() });
    });
    await page.goto('/governance');
    const board = page.getByRole('region', { name: 'Feature delivery', exact: true });
    await expect(board.locator('details[data-feature]')).toHaveCount(5);
    for (const status of statuses)
      await expect(board.locator(`[data-status=${status}]`)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Refresh governance summary' })).toBeVisible();
    await expect(board.getByText(/does not imply independent verification/)).toBeVisible();
    await evidence(page, info, 'desktop');
    const row = board.locator('details[data-feature=F902]');
    await row.locator('summary').first().click();
    await expect(row.getByRole('link', { name: 'Session and handoff' })).toHaveCount(2);
    await expect(row.getByText('Unknown stage')).toBeVisible();
    expect(
      await row
        .getByRole('link')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')).sort()),
    ).toEqual(
      ids
        .slice(0, 2)
        .map((id) => `/sessions/${id}`)
        .sort(),
    );
    await row.getByRole('button', { name: 'Focus recommendations' }).click();
    await expect(page).toHaveURL(/featureId=F902/);
    await expect(board.locator('details[data-feature]')).toHaveCount(1);
    await expect(board.getByText('Delivery Session 3')).toBeVisible();
    await expect(board.getByText('Delivery Session 4')).toBeVisible();
    await expect(board.getByText('F999', { exact: true })).toBeVisible();
    await board.getByRole('button', { name: 'Clear Feature focus' }).click();
    await board.getByRole('button', { name: /^Blocked/ }).click();
    await expect(board.locator('details[data-feature]')).toHaveCount(1);
    await page.getByLabel('Select feature focus').selectOption('F902');
    await expect(page).toHaveURL(/featureId=F902/);
    await expect(board.locator('details[data-feature]')).toHaveCount(1);
    await expect(board.locator('details[data-feature=F902]')).toBeVisible();
    await expect(board.getByRole('button', { name: /^All/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await board.getByRole('button', { name: 'Clear Feature focus' }).click();
    await board.getByRole('button', { name: /^Blocked/ }).click();
    await expect(board.locator('details[data-feature]')).toHaveCount(1);
    await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
    await expect(board.getByRole('button', { name: 'Refresh delivery snapshot' })).toBeEnabled();
    await expect(board.getByRole('button', { name: /^Blocked/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const copy = page.getByRole('button', { name: 'Copy', exact: true }).first();
    await expect(copy).toBeVisible();
    await copy.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toBe('');
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
    expect(requests.some((request) => /continuity.governance.board/.test(request.url))).toBe(true);
    expect(requests.some((request) => /lease|settle|session[.]run/.test(request.url))).toBe(false);
    expect(fileTree(root)).toEqual(before);
  });

  test('损坏来源、部分失败和恢复保留全部有效 Session 与原引用', async ({ page }, info) => {
    await page.goto('/governance');
    const board = page.getByRole('region', { name: 'Feature delivery', exact: true });
    await expect(board.locator('details[data-feature]')).toHaveCount(5);
    const healthyTime = await board.locator('time').innerText();
    fs.writeFileSync(featureFile, '{broken');
    await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
    await expect(board.getByText('Feature source unavailable')).toBeVisible();
    await expect(
      board.getByRole('region', { name: 'References not yet verifiable' }),
    ).toBeVisible();
    for (let index = 1; index <= 4; index++)
      await expect(board.getByText(`Delivery Session ${index}`, { exact: true })).toBeVisible();
    await expect(board.getByText('F999', { exact: true })).toBeVisible();
    await expect(board.getByText('No registered Features.')).toHaveCount(0);
    await expect(board.getByText(/Previous snapshot is stale/)).toBeVisible();
    await expect(board.locator('time')).toHaveText(healthyTime);
    await evidence(page, info, 'feature-error');
    seed();
    fs.writeFileSync(path.join(root, '.amber/sessions', ids[0], 'manifest.json'), '{broken');
    await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
    await expect(board.getByText('Session source partially read')).toBeVisible();
    await expect(board.locator('details[data-feature]')).toHaveCount(5);
    await expect(board.getByText(/Previous snapshot is stale/)).toBeVisible();
    await expect(board.locator('time')).toHaveText(healthyTime);
    await page.getByLabel('Select feature focus').selectOption('F902');
    await expect(page).toHaveURL(/featureId=F902/);
    await expect(board.locator('time')).toHaveText(healthyTime);
    await board.getByRole('button', { name: 'Clear Feature focus' }).click();
    await expect(board.locator('time')).toHaveText(healthyTime);
    await evidence(page, info, 'partial');
    await page.route('**/api/trpc/**', async (route) => {
      if (route.request().url().includes('continuity.governance.board'))
        await route.abort('failed');
      else await route.continue();
    });
    await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
    await expect(board.getByText(/Previous snapshot is stale/)).toBeVisible();
    await expect(board.locator('time')).toHaveText(healthyTime);
    await expect(board.getByRole('button', { name: 'Refresh delivery snapshot' })).toBeEnabled();
    await page.unrouteAll({ behavior: 'wait' });
    seed();
    await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
    await expect(
      board.getByRole('alert').filter({ hasText: 'Session source partially read' }),
    ).toHaveCount(0);
    await expect(board.locator('details[data-feature=F902] > summary')).toContainText('2 Sessions');
    await expect(board.getByText(/Previous snapshot is stale/)).toHaveCount(0);
    await expect(board.locator('time')).not.toHaveText(healthyTime);
    await evidence(page, info, 'recovered-healthy-time');

    fs.writeFileSync(featureFile, '{broken');
    await page.reload();
    await expect(board.getByText(/No fully successful snapshot in this view\./)).toBeVisible();
    await expect(board.locator('time')).toHaveCount(0);
    await expect(board.getByText('Feature source unavailable')).toBeVisible();
    await evidence(page, info, 'initial-source-error-no-healthy-time');
  });

  test('网络刷新失败保留失效旧快照和时间，首次加载不冒充空数据', async ({ page }, info) => {
    await page.goto('/governance');
    const board = page.getByRole('region', { name: 'Feature delivery', exact: true });
    await expect(board.locator('details[data-feature]')).toHaveCount(5);
    const timestamp = await board.locator('time').innerText();
    await page.route('**/api/trpc/**', async (route) => {
      if (route.request().url().includes('continuity.governance.board'))
        await route.abort('failed');
      else await route.continue();
    });
    await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
    await expect(board.getByText(/Previous snapshot is stale/)).toBeVisible();
    await expect(board.locator('time')).toHaveText(timestamp);
    await expect(board.locator('details[data-feature]')).toHaveCount(5);
    await evidence(page, info, 'stale');
    await page.reload();
    await expect(board.getByText('Delivery snapshot unavailable')).toBeVisible();
    await expect(board.getByText('No registered Features.')).toHaveCount(0);
    await evidence(page, info, 'transport-error');
    await page.unrouteAll({ behavior: 'wait' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/trpc/**', async (route) => {
      if (route.request().url().includes('continuity.governance.board')) await gate;
      await route.continue();
    });
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(board.getByRole('status')).toHaveText('Reading delivery snapshot…');
      await expect(board.getByRole('button', { name: 'Refresh delivery snapshot' })).toBeDisabled();
      await evidence(page, info, 'loading');
    } finally {
      release();
    }
    await expect(board.locator('details[data-feature]')).toHaveCount(5);
    await page.unrouteAll({ behavior: 'wait' });
    let releaseTimeout!: () => void;
    const neverCompletes = new Promise<void>((resolve) => {
      releaseTimeout = resolve;
    });
    await page.route('**/api/trpc/**', async (route) => {
      if (route.request().url().includes('continuity.governance.board')) await neverCompletes;
      await route.continue();
    });
    try {
      await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
      await expect(board.getByRole('status')).toHaveText('Reading delivery snapshot…');
      await expect(board.getByText(/Previous snapshot is stale/)).toBeVisible({ timeout: 12_000 });
      await expect(board.locator('details[data-feature]')).toHaveCount(5);
      await expect(board.getByRole('button', { name: 'Refresh delivery snapshot' })).toBeEnabled();
      await evidence(page, info, 'timeout-retry');
    } finally {
      releaseTimeout();
      await page.unrouteAll({ behavior: 'wait' });
    }
    fs.writeFileSync(featureFile, JSON.stringify({ features: [] }));
    await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
    await expect(board.getByText('No registered Features.')).toBeVisible();
    await expect(board.getByText('Delivery Session 4')).toBeVisible();
    await evidence(page, info, 'empty-features');
  });

  test('离线首次读取和刷新明确失败，恢复联网后只由手动重试更新', async ({
    page,
    context,
  }, info) => {
    await page.goto('/');
    await context.setOffline(true);
    try {
      await page.getByRole('link', { name: 'Governance', exact: true }).click();
      const board = page.getByRole('region', { name: 'Feature delivery', exact: true });
      await expect(board.getByText('Delivery snapshot unavailable')).toBeVisible();
      await expect(board.getByText('No registered Features.')).toHaveCount(0);
      await expect(board.getByRole('button', { name: 'Refresh delivery snapshot' })).toBeEnabled();
      await evidence(page, info, 'offline-initial');
      await context.setOffline(false);
      await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
      await expect(board.locator('details[data-feature]')).toHaveCount(5);
      const timestamp = await board.locator('time').innerText();
      await context.setOffline(true);
      await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
      await expect(board.getByText(/Previous snapshot is stale/)).toBeVisible();
      await expect(board.locator('time')).toHaveText(timestamp);
      await expect(board.locator('details[data-feature]')).toHaveCount(5);
      await expect(board.getByRole('button', { name: 'Refresh delivery snapshot' })).toBeEnabled();
      await evidence(page, info, 'offline-stale');
      const reads: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('continuity.governance.board')) reads.push(request.url());
      });
      await context.setOffline(false);
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
      await expect(board.getByText(/Previous snapshot is stale/)).toBeVisible();
      expect(reads).toEqual([]);
      await board.getByRole('button', { name: 'Refresh delivery snapshot' }).click();
      await expect(board.getByText(/Previous snapshot is stale/)).toHaveCount(0);
      await expect(board.locator('details[data-feature]')).toHaveCount(5);
      expect(reads).toHaveLength(1);
    } finally {
      await context.setOffline(false);
    }
  });

  test('窄屏长内容、键盘展开和焦点可用，无横向溢出', async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/governance');
    const board = page.getByRole('region', { name: 'Feature delivery', exact: true });
    const row = board.locator('details[data-feature=F903]');
    const summary = row.locator('summary').first();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('open', '');
    await expect(row.getByText(longText, { exact: true })).toHaveCount(2);
    await expect(summary).toBeFocused();
    const before = await summary.evaluate((element) => ({
      outline: getComputedStyle(element).outlineStyle,
      width: getComputedStyle(element).outlineWidth,
      offset: getComputedStyle(element).outlineOffset,
    }));
    expect(before.outline).not.toBe('none');
    expect(before.width).toBe('2px');
    expect(before.offset).toBe('-2px');
    const evidenceSummary = row.locator('details > summary');
    await evidenceSummary.focus();
    await expect(evidenceSummary).toHaveCSS('outline-width', '2px');
    await expect(evidenceSummary).toHaveCSS('outline-style', 'solid');
    await summary.focus();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await evidence(page, info, 'long-320');
    await page.keyboard.press('Enter');
    await expect(row).not.toHaveAttribute('open');
    const filter = board.getByRole('button', { name: /^In progress/ });
    await filter.focus();
    await page.keyboard.press('Enter');
    await expect(filter).toBeFocused();
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await expect(board.getByText('Delivery Session 3')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const refresh = await board
      .getByRole('button', { name: 'Refresh delivery snapshot' })
      .boundingBox();
    expect(refresh?.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await evidence(page, info, 'mobile-390');
  });
});
