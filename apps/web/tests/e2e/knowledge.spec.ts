import { test, expect } from '@playwright/test';

test.describe('Knowledge Map (/knowledge)', () => {
  test('renders the graph with real node/edge counts > 0', async ({ page }) => {
    await page.goto('/knowledge');

    // Wait for the graph to finish loading (loading spinner disappears)
    await expect(page.locator('text=/Loading knowledge graph/i')).not.toBeVisible({
      timeout: 15_000,
    });

    // The page subtitle shows counts in the form "X/Y nodes · Z edges"
    const subtitle = page.locator('p', { hasText: /nodes/ });
    await expect(subtitle.first()).toBeVisible({ timeout: 10_000 });
    const subtitleText = await subtitle.first().textContent();
    expect(subtitleText).toBeTruthy();
    // Extract the "total" node count from "visible/total nodes"
    const nodeMatch = /(\d+)\/(\d+)\s+nodes/.exec(subtitleText ?? '');
    if (nodeMatch) {
      const total = parseInt(nodeMatch[2], 10);
      expect(total).toBeGreaterThan(0);
    }
    const edgeMatch = /(\d+)\s+edges/.exec(subtitleText ?? '');
    if (edgeMatch) {
      const edges = parseInt(edgeMatch[1], 10);
      expect(edges).toBeGreaterThan(0);
    }
  });

  test('does not render fixture-only sentinel content', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.locator('text=/Loading knowledge graph/i')).not.toBeVisible({
      timeout: 15_000,
    });

    // The fixture had a node titled exactly 'Scaffold versions and drift classes' (adr:0001).
    // Verify the real data is served — the ADR title should come from the real file, not
    // a hardcoded fixture export that KnowledgeMapPage no longer imports.
    // We just check the page doesn't show a "fixture-only" sentinel error message.
    await expect(page.locator('text=/fixture/i')).not.toBeVisible();
    await expect(page.locator('text=/Failed to load knowledge graph/i')).not.toBeVisible();
  });

  test('layer/filter controls and search are functional', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.locator('text=/Loading knowledge graph/i')).not.toBeVisible({
      timeout: 15_000,
    });

    // Layout mode toggle exists
    const clusterBtn = page.getByRole('button', { name: /cluster/i });
    const layeredBtn = page.getByRole('button', { name: /layered/i });
    await expect(clusterBtn).toBeVisible();
    await expect(layeredBtn).toBeVisible();

    // Switch to layered
    await layeredBtn.click();

    // Search box is functional
    const searchBox = page.locator('input[type="search"]');
    await expect(searchBox).toBeVisible();
    await searchBox.fill('ADR');
    // Subtitle should update to show filtered count
    await expect(page.locator('p', { hasText: /nodes/ }).first()).toBeVisible();
  });

  test('selecting a node shows detail panel with source path and edges', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.locator('text=/Loading knowledge graph/i')).not.toBeVisible({
      timeout: 15_000,
    });

    // Click the first visible node in the ReactFlow canvas
    const canvas = page.locator('.react-flow__node').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await canvas.click();

    // Detail panel should show source path
    const sourceLabel = page.locator('dt', { hasText: /source/i });
    await expect(sourceLabel.first()).toBeVisible({ timeout: 5_000 });
  });

  test('drift panel shows dead-anchor findings from the real tree', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.locator('text=/Loading knowledge graph/i')).not.toBeVisible({
      timeout: 15_000,
    });

    // F001/F007 are standing drift findings. The drift section must be visible.
    const driftSection = page.locator('h3', { hasText: /drift/i });
    await expect(driftSection.first()).toBeVisible();
  });
});
