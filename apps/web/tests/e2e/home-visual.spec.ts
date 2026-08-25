import { expect, test, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const artifactDir = path.resolve(process.cwd(), '..', '..', 'output', 'playwright');

async function openStableHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Operator Console' })).toBeVisible();
  await expect(page.getByText('E2E fixture session', { exact: true }).first()).toBeVisible();
}

async function capture(page: Page, name: string): Promise<void> {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({
    path: path.join(artifactDir, name),
    fullPage: true,
    animations: 'disabled',
  });
}

test.describe('Operator Console visual contracts', () => {
  test('desktop keeps the product shell and the data-first first screen', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await openStableHome(page);

    await expect(page.getByRole('navigation').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
    await expect(page.locator('.amber-home')).toHaveCount(0);

    // IA: the decorative WebGL field is opt-in and collapsed by default,
    // so it must not consume first-screen space (data-first principle).
    await expect(page.locator('.amber-field')).toHaveCount(0);

    // First screen keeps exactly five operational blocks: overview,
    // next action, active sessions, pending gates, and entries.
    await expect(page.getByText('Next Amber Action')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Active Sessions' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pending Gates' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Primary Workflows' })).toBeVisible();

    await capture(page, 'operator-console-desktop-light.png');
  });

  test('mobile stacks first-screen blocks without horizontal page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await openStableHome(page);

    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();

    const viewportMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewportMetrics.scrollWidth).toBeLessThanOrEqual(viewportMetrics.clientWidth + 1);

    await capture(page, 'operator-console-mobile-light.png');
  });

  test('dark mode applies the graphite surface palette', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openStableHome(page);

    await expect(page.locator('html')).toHaveClass(/dark/);
    const palette = await page
      .locator('main .card')
      .first()
      .evaluate((element) => {
        // Tailwind v4 emits palette colors as oklch() (v3 used rgb() hex
        // literals), so comparing computed-style strings would pin the test
        // to one major's color-function spelling. Normalize through a 1x1
        // canvas instead: the contract is the rendered sRGB channels.
        function renderedChannels(color: string): number[] {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d');
          if (!ctx) return [-1, -1, -1];
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
        }
        return {
          page: renderedChannels(
            getComputedStyle(document.querySelector('.min-h-screen')!).backgroundColor,
          ),
          card: renderedChannels(getComputedStyle(element).backgroundColor),
        };
      });
    // Tailwind v4 emits palette colors as oklch() and regenerated the slate
    // ramp, so the anchors are the v4-rendered sRGB channels (v3's hexes
    // #0f172a/#1e293b land a couple of channels off). oklch -> sRGB round-
    // trips can also wobble one rounding step, hence the ±1 tolerance.
    const expected: Record<'page' | 'card', number[]> = {
      page: [15, 23, 43],
      card: [29, 41, 61],
    };
    for (const key of ['page', 'card'] as const) {
      palette[key].forEach((channel, index) => {
        expect(Math.abs(channel - expected[key][index])).toBeLessThanOrEqual(1);
      });
    }

    await capture(page, 'operator-console-desktop-dark.png');
  });

  test('falls back to a CSS lifecycle field when WebGL2 is unavailable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: function getContext(contextId: string, options?: object) {
          if (contextId === 'webgl2') return null;
          return Reflect.apply(originalGetContext, this, [contextId, options]);
        },
      });
    });
    await openStableHome(page);

    // The visualization showcase is collapsed by default; expand it first.
    // Chrome exposes the collapsed <summary> as a generic node, so target it by selector.
    await page.locator('details summary', { hasText: 'Lifecycle visualization' }).click();

    const field = page.locator('.amber-field');
    await expect(field).toHaveClass(/amber-field--fallback/);
    await expect(field.locator('.amber-field__canvas')).toBeHidden();
    await expect(field.locator('.amber-field__fallback')).toBeVisible();

    await capture(page, 'operator-console-webgl-fallback.png');
  });

  test('reduced motion removes scanning motion and collapses transition timing', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await openStableHome(page);

    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    );

    // The scan overlay only exists inside the opt-in showcase; expand it.
    await page.locator('details summary', { hasText: 'Lifecycle visualization' }).click();
    await expect(page.locator('.amber-field__scan')).toBeHidden();

    const timing = await page.locator('main').evaluate((element) => ({
      animationDuration: getComputedStyle(element).animationDuration,
      transitionDuration: getComputedStyle(element).transitionDuration,
    }));
    expect(timing.animationDuration).toMatch(/^(0\.01ms|0\.00001s|1e-05s)$/);
    expect(timing.transitionDuration).toMatch(/^(0\.01ms|0\.00001s|1e-05s)$/);

    await capture(page, 'operator-console-reduced-motion.png');
  });
});
