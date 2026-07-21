import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const artifactDir = path.resolve(process.cwd(), "..", "..", "output", "playwright");

async function openStableHome(page: Page): Promise<void> {
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1, name: "Operator Console" })).toBeVisible();
	await expect(page.getByText("E2E fixture session", { exact: true }).first()).toBeVisible();
	await expect(page.locator(".amber-field")).toBeVisible();
}

async function capture(page: Page, name: string): Promise<void> {
	fs.mkdirSync(artifactDir, { recursive: true });
	await page.screenshot({
		path: path.join(artifactDir, name),
		fullPage: true,
		animations: "disabled",
	});
}

test.describe("Operator Console visual contracts", () => {
	test("desktop keeps the product shell and two-column operational summary", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.emulateMedia({ colorScheme: "light" });
		await openStableHome(page);

		await expect(page.getByRole("navigation").first()).toBeVisible();
		await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
		await expect(page.locator(".amber-home")).toHaveCount(0);

		const summaryCards = page
			.locator("main .page-container > section")
			.first()
			.locator(":scope > .card");
		await expect(summaryCards).toHaveCount(2);
		const repositoryBox = await summaryCards.nth(0).boundingBox();
		const lifecycleBox = await summaryCards.nth(1).boundingBox();

		expect(repositoryBox).not.toBeNull();
		expect(lifecycleBox).not.toBeNull();
		expect(Math.abs(repositoryBox!.y - lifecycleBox!.y)).toBeLessThanOrEqual(2);
		expect(lifecycleBox!.x).toBeGreaterThan(repositoryBox!.x + repositoryBox!.width);
		await expect(page.locator(".amber-field__canvas")).toBeVisible();

		await capture(page, "operator-console-desktop-light.png");
	});

	test("mobile stacks summary cards without horizontal page overflow", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: "light" });
		await openStableHome(page);

		await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
		const summaryCards = page
			.locator("main .page-container > section")
			.first()
			.locator(":scope > .card");
		const repositoryBox = await summaryCards.nth(0).boundingBox();
		const lifecycleBox = await summaryCards.nth(1).boundingBox();

		expect(repositoryBox).not.toBeNull();
		expect(lifecycleBox).not.toBeNull();
		expect(lifecycleBox!.y).toBeGreaterThan(repositoryBox!.y + repositoryBox!.height);

		const viewportMetrics = await page.evaluate(() => ({
			clientWidth: document.documentElement.clientWidth,
			scrollWidth: document.documentElement.scrollWidth,
		}));
		expect(viewportMetrics.scrollWidth).toBeLessThanOrEqual(viewportMetrics.clientWidth + 1);

		await capture(page, "operator-console-mobile-light.png");
	});

	test("dark mode applies the graphite surface palette", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.emulateMedia({ colorScheme: "dark" });
		await openStableHome(page);

		await expect(page.locator("html")).toHaveClass(/dark/);
		const palette = await page
			.locator("main .card")
			.first()
			.evaluate((element) => ({
				page: getComputedStyle(document.querySelector(".min-h-screen")!).backgroundColor,
				card: getComputedStyle(element).backgroundColor,
			}));
		expect(palette.page).toBe("rgb(15, 23, 42)");
		expect(palette.card).toBe("rgb(30, 41, 59)");

		await capture(page, "operator-console-desktop-dark.png");
	});

	test("falls back to a CSS lifecycle field when WebGL2 is unavailable", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.addInitScript(() => {
			const originalGetContext = HTMLCanvasElement.prototype.getContext;
			Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
				configurable: true,
				value: function getContext(contextId: string, options?: object) {
					if (contextId === "webgl2") return null;
					return Reflect.apply(originalGetContext, this, [contextId, options]);
				},
			});
		});
		await openStableHome(page);

		const field = page.locator(".amber-field");
		await expect(field).toHaveClass(/amber-field--fallback/);
		await expect(field.locator(".amber-field__canvas")).toBeHidden();
		await expect(field.locator(".amber-field__fallback")).toBeVisible();

		await capture(page, "operator-console-webgl-fallback.png");
	});

	test("reduced motion removes scanning motion and collapses transition timing", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
		await openStableHome(page);

		expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
			true,
		);
		await expect(page.locator(".amber-field__scan")).toBeHidden();

		const timing = await page.locator("main").evaluate((element) => ({
			animationDuration: getComputedStyle(element).animationDuration,
			transitionDuration: getComputedStyle(element).transitionDuration,
		}));
		expect(timing.animationDuration).toMatch(/^(0\.01ms|0\.00001s|1e-05s)$/);
		expect(timing.transitionDuration).toMatch(/^(0\.01ms|0\.00001s|1e-05s)$/);

		await capture(page, "operator-console-reduced-motion.png");
	});
});
