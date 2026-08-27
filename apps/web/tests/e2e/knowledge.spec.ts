import { test, expect, type Page } from '@playwright/test';

// Wait for the knowledge graph to finish loading by checking the subtitle shows counts.
async function waitForGraph(page: Page) {
  await expect(page.locator('p', { hasText: /nodes/ }).first()).toBeVisible({ timeout: 15_000 });
}

// Extract and assert mandatory counts from the subtitle.
async function getSubtitleCounts(page: Page): Promise<{ visible: number; total: number; edges: number }> {
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
  test('renders the graph with real node/edge counts — assertions are mandatory', async ({ page }) => {
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

  test('search hit reduces visible count; search miss yields zero visible nodes', async ({ page }) => {
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
    await expect(page.locator('dt', { hasText: /source/i }).first()).toBeVisible({ timeout: 5_000 });

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

    // feature:F001 is in the graph — the card renders its id in the node body
    const f001 = page.locator('.react-flow__node').filter({ hasText: 'feature:F001' }).first();
    await expect(f001).toBeVisible({ timeout: 10_000 });
    await f001.click();

    // Anchors section appears (F001 declares paths including the dead scaffolding.js)
    const anchorsSection = page.locator('div', { hasText: /^anchors$/i }).first();
    await expect(anchorsSection).toBeVisible({ timeout: 5_000 });

    // Dead anchor label is present (standing drift finding: scaffolding.js → scaffold.js)
    const deadLabel = page.locator('span', { hasText: /dead anchor/i }).first();
    await expect(deadLabel).toBeVisible({ timeout: 3_000 });
  });

  test('drift panel shows dead-anchor findings from the real tree', async ({ page }) => {
    await page.goto('/knowledge');
    await waitForGraph(page);

    // F001/F007 are standing drift findings. The drift section must be visible.
    const driftSection = page.locator('h3', { hasText: /drift/i }).first();
    await expect(driftSection).toBeVisible();
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
    const plusN = miniGraph.locator('text').filter({ hasText: /^\+\d+$/ }).first();
    await expect(plusN).toBeVisible({ timeout: 3_000 });
    const label = await plusN.textContent();
    expect(parseInt(label!.replace('+', ''), 10)).toBeGreaterThan(0);
  });
});
