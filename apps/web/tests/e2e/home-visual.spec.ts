import { expect, test, type Page } from '@playwright/test';
import { capture } from './lib/artifacts';

async function openStableHome(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Trusted Continuation' })).toBeVisible();
  await expect(page.getByText('E2E fixture session', { exact: true }).first()).toBeVisible();
}

test.describe('Trusted Continuation Console visual contracts', () => {
  test('desktop keeps the product shell and the journey-first decision surface', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await openStableHome(page);

    await expect(page.getByRole('navigation').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
    await expect(page.locator('.amber-home')).toHaveCount(0);

    // IA: the decorative WebGL field is opt-in and collapsed by default,
    // so it must not consume first-screen space (data-first principle).
    await expect(page.locator('.amber-field')).toHaveCount(0);

    // The first decision surface names the common journey before exposing
    // implementation-specific sessions, gates, and supporting views.
    await expect(page.getByRole('heading', { name: 'Core Journey' })).toBeVisible();
    const currentJourney = page.locator('[aria-current="step"]');
    await expect(currentJourney).toContainText('J1');
    await expect(currentJourney).toContainText('Adopt safely');
    await expect(page.getByText('Continue Safely from Here')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Active Sessions' }).first()).toBeVisible();
    await expect(page.getByTestId('repository-name')).toHaveText(/amber-web-e2e-/);
    await expect(page.getByRole('heading', { name: 'Recent session outcomes' })).toBeVisible();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pending Gates' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Continue the Journey' })).toBeVisible();

    await expect(page.locator('a').filter({ hasText: 'AGENTS.md' })).toHaveAttribute(
      'href',
      '/governance',
    );

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

  test('query failures keep the journey neutral and expose retry actions', async ({ page }) => {
    await page.route('**/api/trpc/**', async (route) => {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Trusted Continuation' }),
    ).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
    await expect(page.getByText('Current: Unavailable')).toBeVisible();

    await expect(page.getByText('Next action unavailable')).toBeVisible();
    await expect(page.getByText('Failed to load sessions')).toBeVisible();
    await expect(page.getByText('Failed to load gates')).toBeVisible();
    const retryButtons = page.getByRole('button', { name: 'Retry' });
    await expect(retryButtons).toHaveCount(3);
    await retryButtons.first().click();
    await expect(page.getByText('Next action unavailable')).toBeVisible();

    await capture(page, 'operator-console-query-failure.png');
  });

  test('loading state keeps the decision surface explicit while reads are pending', async ({
    page,
  }) => {
    await page.route('**/api/trpc/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });

    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Trusted Continuation' }),
    ).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(3);
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
  });

  test('empty reads show explicit empty states without inventing delivery progress', async ({
    page,
  }) => {
    await page.route('**/api/trpc/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/session.list,gate.list,lifecycle.next?')) {
        const response = await route.fetch();
        const payload = JSON.parse(await response.text());
        if (Array.isArray(payload)) {
          // Preserve the live lifecycle answer (so Journey remains J1 in the
          // fixture) while replacing only the two collection reads with empty
          // successful results.
          payload[0] = { result: { data: { json: [] } } };
          payload[1] = { result: { data: { json: [] } } };
        }
        await route.fulfill({
          response,
          body: JSON.stringify(payload),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Trusted Continuation' }),
    ).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(2);
    await expect(page.getByRole('status').first()).toHaveText('No action required');
    await expect(page.getByRole('status').last()).toHaveText('No action required');
    await expect(page.locator('[aria-current="step"]')).toContainText('J1');
    await expect(page.locator('[aria-current="step"]')).not.toContainText('Deliver');
  });

  test('all empty reads leave the current journey unavailable', async ({ page }) => {
    await page.route('**/api/trpc/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/session.list,gate.list,lifecycle.next?')) {
        const response = await route.fetch();
        const payload = JSON.parse(await response.text());
        if (Array.isArray(payload)) {
          payload[0] = { result: { data: { json: [] } } };
          payload[1] = { result: { data: { json: [] } } };
          payload[2] = {
            result: {
              data: {
                json: {
                  focus: { type: 'repository', id: null, autoSelected: false, othersPending: 0 },
                  nextStep: null,
                  lifecycle: [],
                },
              },
            },
          };
        }
        await route.fulfill({ response, body: JSON.stringify(payload) });
        return;
      }
      await route.continue();
    });

    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Trusted Continuation' }),
    ).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveCount(0);
    await expect(page.getByText('Current: Unavailable')).toBeVisible();
    await expect(page.getByText('No action required').first()).toBeVisible();
  });

  test('Chinese locale keeps the same journey and authority boundary', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStableHome(page);

    await page.getByRole('button', { name: 'Switch language' }).click();

    await expect(page.getByRole('heading', { level: 1, name: '可信续接控制台' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '核心用户旅程' })).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toContainText('安全接入');
    await expect(page.getByText('Agent 与 CLI 仍是受治理工作的权威入口。')).toBeVisible();

    await capture(page, 'operator-console-desktop-zh.png');
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
    // Anchors are the rendered sRGB channels of the Obsidian & Amber Pulse
    // v10 tokens (.design-tool/DESIGN.md): page = obsidian-void #080B10, card =
    // obsidian-surface #0F141C. Color-function round-trips can wobble one
    // rounding step, hence the ±1 tolerance.
    const expected: Record<'page' | 'card', number[]> = {
      page: [8, 11, 16],
      card: [15, 20, 28],
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

  test('reduced motion removes the scanning overlay', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await openStableHome(page);

    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    );

    // Motion reduction is component-scoped since the obsidian shell redesign:
    // experience.css hides the scan overlay and AmberField stops its render
    // loop; there is no global duration-collapse rule to assert anymore.
    // The scan overlay only exists inside the opt-in showcase; expand it.
    await page.locator('details summary', { hasText: 'Lifecycle visualization' }).click();
    await expect(page.locator('.amber-field__scan')).toBeHidden();

    await capture(page, 'operator-console-reduced-motion.png');
  });
});
