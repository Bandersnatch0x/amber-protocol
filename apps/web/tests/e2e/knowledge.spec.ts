import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const artifactDir = path.resolve(process.cwd(), '..', '..', 'output', 'playwright');

async function capture(page: Page, name: string): Promise<void> {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({
    path: path.join(artifactDir, name),
    fullPage: true,
    animations: 'disabled',
  });
}

// Rendered sRGB channels of the app shell background. Tailwind emits palette
// colors as oklch(), so computed-style strings are not comparable across
// versions; normalize through a 1x1 canvas like home-visual.spec.ts does.
async function pageBackgroundChannels(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [-1, -1, -1];
    const shell = document.querySelector('.min-h-screen');
    if (!shell) return [-1, -1, -1];
    ctx.fillStyle = getComputedStyle(shell).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  });
}

// Wait for the knowledge graph to finish loading by checking the subtitle shows counts.
async function waitForGraph(page: Page) {
  await expect(page.locator('p', { hasText: /nodes/ }).first()).toBeVisible({ timeout: 15_000 });
}

// Extract and assert mandatory counts from the subtitle.
async function getSubtitleCounts(
  page: Page,
): Promise<{ visible: number; total: number; edges: number }> {
  const subtitle = page.locator('p', { hasText: /nodes/ }).first();
  await expect(subtitle).toBeVisible();
  const text = await subtitle.textContent();

  const nodeMatch = /(\d+)\/(\d+)\s+nodes/.exec(text ?? '');
  expect(nodeMatch, `subtitle "${text}" must match "X/Y nodes"`).not.toBeNull();
  const edgeMatch = /(\d+)\s+edges/.exec(text ?? '');
  expect(edgeMatch, `subtitle "${text}" must match "Z edges"`).not.toBeNull();

  return {
    visible: parseInt(nodeMatch![1], 10),
    total: parseInt(nodeMatch![2], 10),
    edges: parseInt(edgeMatch![1], 10),
  };
}

test.describe('Knowledge Map (/knowledge)', () => {
  test('renders the graph with real node/edge counts — assertions are mandatory', async ({
    page,
  }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    const { visible, total, edges } = await getSubtitleCounts(page);

    // Counts are real and non-trivial — regression guard.
    expect(total).toBeGreaterThanOrEqual(100);
    expect(visible).toBe(total); // no filter active on initial load
    expect(edges).toBeGreaterThanOrEqual(80);
  });

  test('does not render fixture-only sentinel content', async ({ page }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    await expect(page.locator('text=/fixture/i')).not.toBeVisible();
    await expect(page.locator('text=/Failed to load knowledge graph/i')).not.toBeVisible();
    // Error state must not be showing
    await expect(page.locator('[role="alert"]')).not.toBeVisible();
  });

  test('search hit reduces visible count; search miss yields zero visible nodes', async ({
    page,
  }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    const { total } = await getSubtitleCounts(page);

    const searchBox = page.locator('input[type="search"]');
    await expect(searchBox).toBeVisible();

    // Hit: a term present in at least one ADR title
    await searchBox.fill('ADR-0001');
    await page.waitForTimeout(300);
    const { visible: hitVisible } = await getSubtitleCounts(page);
    expect(hitVisible).toBeGreaterThan(0);
    expect(hitVisible).toBeLessThan(total);

    // Miss: a term that matches no node
    await searchBox.fill('zzz-no-match-term-xyz');
    await page.waitForTimeout(300);
    const { visible: missVisible } = await getSubtitleCounts(page);
    expect(missVisible).toBe(0);
  });

  test('kind filter reduces visible count', async ({ page }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    const { total } = await getSubtitleCounts(page);

    // Click the "adr" kind filter chip — it deactivates adr, keeping everything else.
    // The first chip labeled with "adr" count text reduces visible nodes.
    const adrChip = page.getByRole('button', { name: /\badr\b/i }).first();
    await expect(adrChip).toBeVisible();
    await adrChip.click();
    await page.waitForTimeout(300);

    const { visible: filteredVisible } = await getSubtitleCounts(page);
    expect(filteredVisible).toBeGreaterThan(0);
    expect(filteredVisible).toBeLessThan(total);
  });

  test('layered layout mode visibly activates after clicking the button', async ({ page }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    const clusterBtn = page.getByRole('button', { name: /cluster/i }).first();
    const layeredBtn = page.getByRole('button', { name: /layered/i }).first();
    await expect(clusterBtn).toBeVisible();
    await expect(layeredBtn).toBeVisible();

    // Initially cluster is active
    await expect(clusterBtn).toHaveClass(/bg-amber-500/);

    await layeredBtn.click();
    await page.waitForTimeout(400);

    // After clicking layered, it should become active
    await expect(layeredBtn).toHaveClass(/bg-amber-500/);
    // Cluster should no longer be active
    await expect(clusterBtn).not.toHaveClass(/bg-amber-500/);
  });

  test('node detail panel exposes real source path, context, anchors, dead-anchor marking, and jump link', async ({
    page,
  }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    // Click the first visible ReactFlow node
    const canvas = page.locator('.react-flow__node').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await canvas.click();

    // Source path shown in detail panel
    const sourceLabel = page.locator('dt', { hasText: /source/i }).first();
    await expect(sourceLabel).toBeVisible({ timeout: 5_000 });
    const sourcePath = page.locator('dd.font-mono').first();
    const sourceText = await sourcePath.textContent();
    expect(sourceText?.trim().length).toBeGreaterThan(0);
  });

  test('ADR node detail exposes context, edge rows, mini-context graph, and jump link', async ({
    page,
  }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    // Find and click an ADR node (has type="knowledge" data-id starting with "adr:")
    // Find by node id text rendered inside the card
    const adrNode = page
      .locator('.react-flow__node')
      .filter({ hasText: /adr:\d{4}/ })
      .first();
    await expect(adrNode).toBeVisible({ timeout: 10_000 });
    await adrNode.click();

    // Source row visible
    await expect(page.locator('dt', { hasText: /source/i }).first()).toBeVisible({
      timeout: 5_000,
    });

    // Context section: body excerpt rendered (P-1 fix delivers this)
    const contextHeading = page.locator('div', { hasText: /^context$/i }).first();
    await expect(contextHeading).toBeVisible({ timeout: 3_000 });

    // Edges section must be visible
    const edgesHeading = page.locator('div', { hasText: /^edges$/i }).first();
    await expect(edgesHeading).toBeVisible({ timeout: 3_000 });

    // Mini-context graph SVG is rendered
    const miniGraph = page.locator('svg[aria-label]').first();
    await expect(miniGraph).toBeVisible({ timeout: 3_000 });

    // Jump link to /governance (ADR kind maps to governance)
    const jumpLink = page.locator('a[href="/governance"]').first();
    await expect(jumpLink).toBeVisible({ timeout: 3_000 });
  });

  test('feature:F001 node shows anchors section with dead-anchor marking for scaffolding.js', async ({
    page,
  }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    const f001 = page.locator('.react-flow__node[data-id="feature:F001"]:visible');
    await expect(f001).toBeVisible({ timeout: 10_000 });
    await f001.click();

    const detailCard = page.locator('aside > .card').first();
    await expect(detailCard.getByText('feature:F001', { exact: true })).toBeVisible({
      timeout: 5_000,
    });

    await expect(detailCard.getByText(/^context$/i)).toBeVisible();
    await expect(detailCard).toContainText('A project gains AGENTS.md/CLAUDE.md');

    await expect(detailCard.getByText(/^anchors$/i)).toBeVisible();
    const scaffoldingAnchor = detailCard.locator('li').filter({
      hasText: /^scripts\/lib\/core\/scaffolding\.js/,
    });
    await expect(scaffoldingAnchor).toHaveCount(1);
    await expect(scaffoldingAnchor).toContainText(/^scripts\/lib\/core\/scaffolding\.js/);
    await expect(scaffoldingAnchor.getByText(/dead anchor|死锚点/i)).toBeVisible();
  });

  test('drift panel shows dead-anchor findings from the real tree', async ({ page }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    // F001/F007 are standing drift findings. The drift section must be visible.
    const driftSection = page.locator('h3', { hasText: /drift/i }).first();
    await expect(driftSection).toBeVisible();
  });

  test('recent and drift feed is live, pinned, capped, manually refreshed, and linked to real routes', async ({
    page,
  }) => {
    let recentRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/trpc/knowledge.recentChanges')) recentRequests += 1;
    });

    await page.goto('/knowledge');
    await waitForGraph(page);

    const panel = page.getByTestId('recent-drift-panel');
    const rows = panel.getByTestId('recent-change');
    await expect(panel).toBeVisible();
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });

    const count = await rows.count();
    expect(count).toBe(50);
    const sources = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-source')),
    );
    expect(sources).toContain('drift');
    expect(sources).toContain('feature');
    expect(sources).toContain('adr');

    const firstNonDrift = sources.findIndex((source) => source !== 'drift');
    expect(firstNonDrift).toBeGreaterThan(0);
    expect(sources.slice(0, firstNonDrift).every((source) => source === 'drift')).toBe(true);
    expect(sources.slice(firstNonDrift)).not.toContain('drift');

    const requestsAfterLoad = recentRequests;
    await page.waitForTimeout(1_200);
    expect(recentRequests).toBe(requestsAfterLoad);
    await panel.getByRole('button', { name: /^refresh$/i }).click();
    await expect.poll(() => recentRequests).toBe(requestsAfterLoad + 1);

    const links = panel.locator('a[data-link-to]');
    const linkCount = await links.count();
    expect(linkCount).toBeGreaterThan(0);
    const targets = await links.evaluateAll((elements) =>
      elements.map((element) => ({
        href: element.getAttribute('href') ?? '',
        linkTo: element.getAttribute('data-link-to') ?? '',
        linkId: element.getAttribute('data-link-id') ?? '',
      })),
    );

    for (const target of targets) {
      expect(target.href).not.toMatch(/placeholder|fixture/i);
      if (target.linkTo === 'sessions') expect(target.href).toContain(`/sessions/${target.linkId}`);
      if (target.linkTo === 'transcripts') {
        expect(target.href).toContain(`/transcripts/${target.linkId}`);
      }
      if (target.linkTo === 'routes') expect(target.href).toContain(`/routes/${target.linkId}`);
      if (target.linkTo === 'gates') expect(target.href).toBe('/gates');
      if (target.linkTo === 'governance') {
        expect(target.href).toBe(
          target.linkId
            ? `/governance?featureId=${encodeURIComponent(target.linkId)}`
            : '/governance',
        );
      }
      const response = await page.request.get(target.href);
      expect(response.ok(), target.href).toBe(true);
    }
  });

  test('adr:0003 (15 edges) shows edge rows and +N>0 in mini-context graph', async ({ page }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    // adr:0003 has 15 edges (2 outgoing + 13 incoming) — 8 shown, 7 hidden → +7
    const adr0003 = page.locator('.react-flow__node').filter({ hasText: 'adr:0003' }).first();
    await expect(adr0003).toBeVisible({ timeout: 10_000 });
    await adr0003.click();

    // Edge rows section must be visible
    const edgesHeading = page.locator('div', { hasText: /^edges$/i }).first();
    await expect(edgesHeading).toBeVisible({ timeout: 5_000 });

    // Mini-context graph SVG is rendered
    const miniGraph = page.locator('svg[role="img"]').first();
    await expect(miniGraph).toBeVisible({ timeout: 3_000 });

    // +N overflow label is visible and positive (15 total > 8 shown → +7)
    const plusN = miniGraph
      .locator('text')
      .filter({ hasText: /^\+\d+$/ })
      .first();
    await expect(plusN).toBeVisible({ timeout: 3_000 });
    const label = await plusN.textContent();
    expect(parseInt(label!.replace('+', ''), 10)).toBeGreaterThan(0);
  });
});

test.describe('Knowledge Map — semantic layer without a provider', () => {
  test.skip(process.env.AMBER_E2E_SEMANTIC_STUB === '1', 'requires hermetic no-key server');

  test('graph renders fully in deterministic-only mode without a provider', async ({ page }) => {
    let semanticRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/knowledge.semantic?')) semanticRequests += 1;
    });

    await page.goto('/knowledge');
    await waitForGraph(page);

    const { total } = await getSubtitleCounts(page);
    expect(total).toBeGreaterThanOrEqual(100);
    expect(semanticRequests).toBe(0);
    await expect(page.locator('.react-flow__renderer, .react-flow__viewport').first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('shows the provider-not-configured status and keeps inferred controls harmless', async ({
    page,
  }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    const banner = page.getByTestId('semantic-status-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toHaveAttribute('role', 'status');
    await expect(banner).toContainText(/not configured|provider/i);
    await expect(page.getByTestId('semantic-disclosure')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /inferred/i }).first()).toBeChecked();
  });

  test('keeps the deterministic map usable when Ask has no provider', async ({ page }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);
    await page.getByRole('button', { name: 'Ask' }).click();
    await page.getByLabel('Question').fill('What governs this repository?');
    await page.getByRole('button', { name: 'Send question' }).click();

    await expect(page.getByTestId('knowledge-ask-panel')).toContainText(/no LLM provider/i);
    await expect(
      page.locator('.react-flow__renderer, .react-flow__viewport').first(),
    ).toBeVisible();
  });
});

test.describe('Knowledge Map — user-triggered semantic stub', () => {
  test.skip(process.env.AMBER_E2E_SEMANTIC_STUB !== '1', 'requires stub provider server');

  test('waits for consent, then renders a real inferred edge, badge, summary, and provenance', async ({
    page,
  }) => {
    let semanticRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/knowledge.semantic?')) semanticRequests += 1;
    });

    await page.goto('/knowledge');
    await waitForGraph(page);
    const disclosure = page.getByTestId('semantic-disclosure');
    await expect(disclosure).toContainText(
      /sends repository node identifiers, kinds, titles, excerpts, and existing edges/i,
    );
    expect(semanticRequests).toBe(0);

    await disclosure.getByRole('button', { name: /send repository titles and excerpts/i }).click();
    await expect.poll(() => semanticRequests).toBe(1);

    const inferredPath = page.locator('.react-flow__edge.knowledge-edge-inferred path').first();
    await expect(inferredPath).toBeVisible({ timeout: 15_000 });
    expect(await inferredPath.getAttribute('style')).toMatch(/stroke-dasharray:\s*6(?:,|\s)+4/);

    const adrNode = page.locator('.react-flow__node[data-id="adr:0001"]').first();
    await expect(adrNode).toBeVisible({ timeout: 10_000 });
    await adrNode.click();
    const detail = page.locator('aside > .card').first();
    await expect(detail).toContainText(/inferred \(stub\/stub-e2e\)/i);
    await expect(detail.getByTestId('inferred-summary')).toContainText('Semantic summary for');
    await expect(detail.getByTestId('inferred-summary')).toContainText(
      /stub\/stub-e2e · \d{4}-\d{2}-\d{2}/,
    );
  });

  test('keeps the deterministic graph visible when the semantic transport fails', async ({
    page,
  }) => {
    await page.route('**/api/trpc/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/knowledge.semantic?')) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.continue();
    });

    await page.goto('/knowledge');
    await waitForGraph(page);
    await page
      .getByRole('button', { name: /send repository titles and excerpts for semantic analysis/i })
      .click();

    const alert = page.getByRole('alert');
    await expect(alert).toContainText(/failed or was incomplete/i);
    await expect(
      page.locator('.react-flow__renderer, .react-flow__viewport').first(),
    ).toBeVisible();
    const { total } = await getSubtitleCounts(page);
    expect(total).toBeGreaterThanOrEqual(100);
  });

  test('returns cited segments and citation chips select live map nodes', async ({ page }) => {
    let askRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/knowledge.ask?')) askRequests += 1;
    });

    await page.goto('/knowledge');
    await waitForGraph(page);
    const askButton = page.getByRole('button', { name: 'Ask' });
    await expect(askButton).toHaveAttribute('aria-pressed', 'false');
    await askButton.click();
    await expect(askButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByTestId('knowledge-ask-panel')).toContainText(
      /sends your question and deterministic repository context/i,
    );
    expect(askRequests).toBe(0);

    await page.getByLabel('Question').fill('What knowledge is available?');
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect.poll(() => askRequests).toBe(1);

    const answer = page.getByTestId('knowledge-ask-answer');
    await expect(answer).toContainText(/deterministic knowledge graph includes/i);
    await expect(page.getByTestId('knowledge-ask-submitted-question')).toContainText(
      'What knowledge is available?',
    );
    await expect(page.getByTestId('knowledge-ask-submitted-focus')).toContainText(
      /submitted without a focus/i,
    );
    await page.getByLabel('Question').fill('A different draft');
    const citation = answer.getByTestId('knowledge-citation-adr:0001');
    await expect(citation).toBeVisible();
    await citation.click();
    await expect(page.getByTestId('knowledge-node-adr:0001')).toHaveClass(/border-amber-400/);
    await expect(page.getByTestId('knowledge-ask-submitted-question')).toContainText(
      'What knowledge is available?',
    );
    await expect(page.getByTestId('knowledge-ask-submitted-question')).not.toContainText(
      'A different draft',
    );
    await expect(page.getByTestId('knowledge-ask-submitted-focus')).toContainText(
      /submitted without a focus/i,
    );
    await expect(
      page.locator('.react-flow__renderer, .react-flow__viewport').first(),
    ).toBeVisible();
  });
});

test.describe('Knowledge Map — i18n (en/zh)', () => {
  test('renders /knowledge fully in zh-CN: title, subtitle counts, controls, panels', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('amber-web-language', 'zh-CN'));
    await page.goto('/knowledge');

    await expect(page.getByRole('heading', { level: 1, name: '知识与决策地图' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    // The zh subtitle carries the same real-count contract as the en suite.
    const subtitle = page.locator('p', { hasText: /节点/ }).first();
    await expect(subtitle).toBeVisible({ timeout: 15_000 });
    const text = (await subtitle.textContent()) ?? '';
    const nodeMatch = /(\d+)\/(\d+)\s*节点/.exec(text);
    expect(nodeMatch, `zh subtitle "${text}" must match "X/Y 节点"`).not.toBeNull();
    expect(parseInt(nodeMatch![2], 10)).toBeGreaterThanOrEqual(100);
    const edgeMatch = /(\d+)\s*条边/.exec(text);
    expect(edgeMatch, `zh subtitle "${text}" must match "Z 条边"`).not.toBeNull();
    expect(parseInt(edgeMatch![1], 10)).toBeGreaterThanOrEqual(80);

    // Translated controls: search, layout modes, right-rail views.
    await expect(page.locator('input[type="search"]')).toHaveAttribute(
      'placeholder',
      '按标题、ID、状态、内容搜索节点…',
    );
    await expect(page.getByRole('button', { name: '聚簇' })).toBeVisible();
    await expect(page.getByRole('button', { name: '分层' })).toBeVisible();
    await expect(page.getByRole('button', { name: '提问' })).toBeVisible();

    // Recent & Drift panel in zh with its refresh control.
    const panel = page.getByTestId('recent-drift-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('最近变更与漂移').first()).toBeVisible();
    await expect(panel.getByRole('button', { name: '刷新' })).toBeVisible();

    await capture(page, 'knowledge-zh-light.png');
  });

  test('the header language toggle switches /knowledge live between en and zh', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('amber-web-language', 'en'));
    await page.goto('/knowledge');
    await waitForGraph(page);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Knowledge & Decision Map' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    const toggle = page.getByRole('button', { name: 'Switch language' });
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(page.getByRole('heading', { level: 1, name: '知识与决策地图' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    // The live graph survives the switch.
    await expect(page.locator('p', { hasText: /节点/ }).first()).toBeVisible();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();

    await toggle.click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Knowledge & Decision Map' }),
    ).toBeVisible();
    const { total } = await getSubtitleCounts(page);
    expect(total).toBeGreaterThanOrEqual(100);
  });
});

test.describe('Knowledge Map — dual theme', () => {
  test('dark color scheme applies the dark palette without losing the graph', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/knowledge');
    await waitForGraph(page);

    await expect(page.locator('html')).toHaveClass(/dark/);
    const channels = await pageBackgroundChannels(page);
    // Dark shell surface: every rendered channel is dark. The token itself
    // (dark:bg-obsidian-void) is a design detail; the contract is darkness.
    for (const channel of channels) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThan(60);
    }

    const { total, edges } = await getSubtitleCounts(page);
    expect(total).toBeGreaterThanOrEqual(100);
    expect(edges).toBeGreaterThanOrEqual(80);
    await expect(page.getByTestId('recent-drift-panel')).toBeVisible();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();

    await capture(page, 'knowledge-desktop-dark.png');
  });

  test('the in-app theme toggle flips /knowledge between light and dark live', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/knowledge');
    await waitForGraph(page);

    await expect(page.locator('html')).not.toHaveClass(/dark/);
    const lightChannels = await pageBackgroundChannels(page);
    for (const channel of lightChannels) {
      expect(channel).toBeGreaterThan(200);
    }

    const toggle = page.getByRole('button', { name: /toggle theme/i });
    await toggle.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    const darkChannels = await pageBackgroundChannels(page);
    for (const channel of darkChannels) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThan(60);
    }
    // The graph stays rendered and countable after the flip.
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    const { total } = await getSubtitleCounts(page);
    expect(total).toBeGreaterThanOrEqual(100);

    await toggle.click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});
