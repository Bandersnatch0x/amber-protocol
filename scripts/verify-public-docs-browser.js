#!/usr/bin/env node
"use strict";

/* global window, document, getComputedStyle */
// The identifiers above are browser globals referenced only inside
// page.evaluate()/addInitScript() callbacks that execute in the page context,
// not in Node — declared here so the Node-env linter does not flag them.

/**
 * Public Documentation Site — browser verification seam (issues/0063 rows 7 & 10).
 *
 * The fast, dependency-free `scripts/verify-public-docs.js` covers the static
 * Layer-1 gates. Two Layer-1 rows of the 0020 acceptance contract can only be
 * proven in a real browser, so they live here and run in the docs CI job after
 * the build (a browser + axe-core are required):
 *
 *   Row 7  — accessibility floor & responsive widths: axe-core reports zero
 *            serious/critical violations on both the dark default theme and
 *            the light theme, and there is no page-level horizontal overflow
 *            at 320/375/768.
 *   Row 10 — light/dark token rendering across page types, preserved across
 *            client-side navigation.
 *
 * A fail is a recorded outcome (exit 1), not a crash. Missing build or browser
 * is reported and skips (exit 0) so the root test job — which has neither — is
 * not blocked; the docs CI job is where this actually runs.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT_DIR, "apps", "docs", "build");
const CONFIG = path.join(ROOT_DIR, "apps", "docs", "docusaurus.config.ts");

// Representative pages — one per major reader group, plus two that render
// command-block nature badges and rich Prism tokens so the light/dark a11y
// fixes for those surfaces are actually exercised (issues/0157 coverage).
// Row 7 scans all of these; row 10 exercises four distinct page types.
const REPRESENTATIVE_PAGES = [
	"/",
	"/start-here/installation",
	"/reference/cli/next",
	"/concepts/",
	"/troubleshooting/",
	"/about/",
	"/guides/governance-gates-and-audit/",
	"/guides/adopting-existing-project/",
];
const THEME_PAGE_TYPES = ["/", "/start-here/installation", "/reference/cli/next", "/concepts/"];
const VIEWPORTS = [320, 375, 768];

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ico": "image/x-icon",
	".map": "application/json",
	".txt": "text/plain",
	".xml": "application/xml",
};

function readBaseUrl() {
	try {
		const src = fs.readFileSync(CONFIG, "utf8");
		const m = src.match(/baseUrl:\s*process\.env\.DOCUSAURUS_BASE_URL\s*\|\|\s*['"]([^'"]+)['"]/);
		if (m) return m[1].replace(/\/+$/, "");
		const m2 = src.match(/baseUrl:\s*['"]([^'"]+)['"]/);
		if (m2) return m2[1].replace(/\/+$/, "");
	} catch (_) {
		/* fall through */
	}
	return "/amber-protocol";
}

const BASE = readBaseUrl();

function resolveFile(pathname) {
	let p = pathname;
	if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length);
	if (!p || p === "/") return path.join(BUILD_DIR, "index.html");
	const f = path.join(BUILD_DIR, p);
	if (fs.existsSync(f) && fs.statSync(f).isDirectory()) return path.join(f, "index.html");
	if (fs.existsSync(f)) return f;
	if (fs.existsSync(f + ".html")) return f + ".html";
	if (fs.existsSync(path.join(f, "index.html"))) return path.join(f, "index.html");
	return null;
}

function startServer() {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			let pathname = "/";
			try {
				pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
			} catch (_) {
				/* keep default */
			}
			const file = resolveFile(pathname);
			if (!file) {
				res.statusCode = 404;
				return res.end("not found");
			}
			res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
			res.end(fs.readFileSync(file));
		});
		server.listen(0, () => resolve(server));
	});
}

function loadChromium() {
	// Prefer the docs workspace (which owns the browser-verification deps), then
	// a root dependency, then the sibling app that already ships @playwright/test.
	const candidates = [
		path.join(ROOT_DIR, "apps", "docs", "node_modules", "@playwright", "test"),
		"@playwright/test",
		"playwright",
		path.join(ROOT_DIR, "apps", "web", "node_modules", "@playwright", "test"),
	];
	for (const spec of candidates) {
		try {
			return require(spec).chromium;
		} catch (_) {
			/* try next */
		}
	}
	return null;
}

function loadAxeSource() {
	const candidates = [path.join(ROOT_DIR, "apps", "docs", "node_modules", "axe-core"), "axe-core"];
	for (const spec of candidates) {
		try {
			return require(spec).source;
		} catch (_) {
			/* try next */
		}
	}
	return null;
}

async function runAxe(page) {
	const source = loadAxeSource();
	if (!source) throw new Error("axe-core is not installed");
	await page.addScriptTag({ content: source });
	return page.evaluate(async () => {
		const result = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] });
		return result.violations
			.filter((v) => v.impact === "serious" || v.impact === "critical")
			.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
	});
}

async function hasHorizontalOverflow(page) {
	return page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
	);
}

// Row 7: axe serious/critical = 0 on both the dark default and the light theme
// + no horizontal overflow at the narrow-screen widths. `pages` is injectable
// for tests. (Light-theme parity added by issues/0157.)
async function verifyBrowserAccessibility(browser, origin, pages = REPRESENTATIVE_PAGES) {
	const errors = [];
	for (const scheme of ["dark", "light"]) {
		const context = await browser.newContext({ colorScheme: scheme });
		try {
			for (const rel of pages) {
				const page = await context.newPage();
				page.setDefaultTimeout(20000);
				const target = `${origin}${BASE}${rel === "/" ? "/" : rel}`;
				try {
					await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
					await page.waitForSelector("#__docusaurus", { timeout: 15000 });
					// Let hydration settle the theme attribute and deferred styling before
					// measuring: running axe mid-hydration produced flaky contrast hits.
					await page
						.waitForFunction(() => document.documentElement.getAttribute("data-theme") !== null, {
							timeout: 5000,
						})
						.catch(() => {});
					await page.waitForTimeout(300);
					const violations = await runAxe(page);
					for (const v of violations) {
						errors.push(
							`a11y (${scheme} ${rel}): axe ${v.impact} violation "${v.id}" on ${v.nodes} node(s).`,
						);
					}
					for (const width of VIEWPORTS) {
						await page.setViewportSize({ width, height: 900 });
						await page.waitForTimeout(120);
						if (await hasHorizontalOverflow(page)) {
							errors.push(
								`responsive (${scheme} ${rel}): page-level horizontal overflow at ${width}px.`,
							);
						}
					}
				} catch (e) {
					errors.push(`a11y (${scheme} ${rel}): could not evaluate — ${e.message}`);
				} finally {
					await page.close();
				}
			}
		} finally {
			await context.close();
		}
	}
	return errors;
}

// Row 10: each page type renders in both themes with distinct background tokens,
// and the chosen theme is preserved across a client-side navigation.
async function verifyThemeRendering(browser, origin, pageTypes = THEME_PAGE_TYPES) {
	const errors = [];
	const bgByTheme = { dark: {}, light: {} };
	for (const theme of ["dark", "light"]) {
		const context = await browser.newContext();
		await context.addInitScript((t) => {
			try {
				window.localStorage.setItem("theme", t);
			} catch (_) {
				/* ignore */
			}
		}, theme);
		try {
			for (const rel of pageTypes) {
				const page = await context.newPage();
				page.setDefaultTimeout(20000);
				const target = `${origin}${BASE}${rel === "/" ? "/" : rel}`;
				try {
					await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
					await page.waitForSelector("#__docusaurus", { timeout: 15000 });
					const applied = await page.getAttribute("html", "data-theme");
					if (applied !== theme) {
						errors.push(`theme (${rel}): expected data-theme="${theme}" but got "${applied}".`);
					}
					bgByTheme[theme][rel] = await page.evaluate(() => {
						const root = document.documentElement;
						const token = getComputedStyle(root).getPropertyValue("--ifm-background-color").trim();
						return token || getComputedStyle(root).backgroundColor;
					});
				} catch (e) {
					errors.push(`theme (${rel}, ${theme}): could not evaluate — ${e.message}`);
				} finally {
					await page.close();
				}
			}
		} finally {
			await context.close();
		}
	}
	// Tokens must actually differ between themes on every page type.
	for (const rel of pageTypes) {
		const d = bgByTheme.dark[rel];
		const l = bgByTheme.light[rel];
		if (d && l && d === l) {
			errors.push(`theme (${rel}): dark and light render the same background token (${d}).`);
		}
	}
	// Preserved across a client-side navigation: pick dark, land on a doc page,
	// follow an in-app sidebar link, and confirm the theme did not reset.
	const context = await browser.newContext();
	await context.addInitScript(() => {
		try {
			window.localStorage.setItem("theme", "dark");
		} catch (_) {
			/* ignore */
		}
	});
	try {
		const page = await context.newPage();
		page.setDefaultTimeout(20000);
		await page.goto(`${origin}${BASE}/start-here/installation`, {
			waitUntil: "domcontentloaded",
			timeout: 25000,
		});
		await page.waitForSelector("#__docusaurus", { timeout: 15000 });
		const before = await page.getAttribute("html", "data-theme");
		const link = page.locator("a.menu__link[href], nav a[href^='" + BASE + "']").first();
		if (await link.count()) {
			await link.click({ timeout: 8000 });
			await page.waitForTimeout(400);
			const after = await page.getAttribute("html", "data-theme");
			if (before !== after) {
				errors.push(
					`theme persistence: data-theme changed from "${before}" to "${after}" across navigation.`,
				);
			}
		}
		await page.close();
	} catch (e) {
		errors.push(`theme persistence: could not evaluate — ${e.message}`);
	} finally {
		await context.close();
	}
	return errors;
}

// Narrow-screen section navigation (issues/0063 O7). Docusaurus hides the
// desktop TOC below 997px, so the tablet width relies on the collapsible
// "On this page" TOC. Assert it is present at 768px and expands to real section
// links, so losing in-page navigation is a gate failure, not a silent UX
// regression. `pages` is injectable for tests.
async function verifyNarrowSectionNavigation(
	browser,
	origin,
	pages = ["/reference/cli/next", "/reference/cli/audit"],
) {
	const errors = [];
	const context = await browser.newContext();
	try {
		for (const rel of pages) {
			const page = await context.newPage();
			page.setDefaultTimeout(20000);
			await page.setViewportSize({ width: 768, height: 900 });
			const target = `${origin}${BASE}${rel === "/" ? "/" : rel}`;
			try {
				await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
				await page.waitForSelector("#__docusaurus", { timeout: 15000 });
				await page.waitForTimeout(300);
				const probe = await page.evaluate(() => {
					const visible = (el) => {
						if (!el) return false;
						const r = el.getBoundingClientRect();
						return r.width > 0 && r.height > 0;
					};
					if (visible(document.querySelector(".theme-doc-toc-desktop"))) {
						return { mode: "desktop" };
					}
					const mobile = document.querySelector(".theme-doc-toc-mobile");
					if (!mobile) return { error: "no section-navigation control" };
					const toggle = mobile.querySelector("button, summary, [role=button]");
					if (!toggle) return { error: 'the "On this page" control has no toggle' };
					toggle.click();
					return { mode: "mobile" };
				});
				if (probe.error) {
					errors.push(`section nav (${rel} @768px): ${probe.error}.`);
					continue;
				}
				if (probe.mode === "mobile") {
					await page.waitForTimeout(400);
					const links = await page.evaluate(
						() =>
							[...document.querySelectorAll(".theme-doc-toc-mobile a")].filter(
								(a) => a.getBoundingClientRect().height > 0,
							).length,
					);
					if (links < 1) {
						errors.push(
							`section nav (${rel} @768px): the "On this page" control expanded to no section links.`,
						);
					}
				}
			} catch (e) {
				errors.push(`section nav (${rel} @768px): could not evaluate — ${e.message}`);
			} finally {
				await page.close();
			}
		}
	} finally {
		await context.close();
	}
	return errors;
}

async function runBrowserVerification() {
	if (!fs.existsSync(BUILD_DIR)) {
		console.log("[skip] apps/docs/build not found — run `npm run docs:build` first.");
		return 0;
	}
	const chromium = loadChromium();
	if (!chromium) {
		console.log(
			"[skip] Playwright chromium not available — run `npx playwright install chromium`.",
		);
		return 0;
	}
	if (!loadAxeSource()) {
		console.log("[skip] axe-core not installed.");
		return 0;
	}
	const server = await startServer();
	const origin = `http://localhost:${server.address().port}`;
	let browser;
	try {
		browser = await chromium.launch();
	} catch (e) {
		server.close();
		console.log(`[skip] could not launch chromium — ${e.message}`);
		return 0;
	}
	const allErrors = [];
	try {
		console.log("Gate 7 (browser): accessibility floor & responsive widths (dark + light themes)…");
		allErrors.push(...(await verifyBrowserAccessibility(browser, origin)));
		console.log("Gate 10 (browser): light/dark token rendering, preserved across navigation…");
		allErrors.push(...(await verifyThemeRendering(browser, origin)));
		console.log("Gate 7b (browser): section navigation reachable at the 768px tablet width…");
		allErrors.push(...(await verifyNarrowSectionNavigation(browser, origin)));
	} finally {
		await browser.close();
		server.close();
	}
	if (allErrors.length === 0) {
		console.log("✅ Browser verification passed: rows 7 & 10 clean on the dark and light themes.");
		return 0;
	}
	console.log(`\n❌ Browser verification found ${allErrors.length} issue(s):`);
	for (const e of allErrors) console.log(`  - ${e}`);
	return 1;
}

module.exports = {
	BASE,
	BUILD_DIR,
	REPRESENTATIVE_PAGES,
	THEME_PAGE_TYPES,
	VIEWPORTS,
	startServer,
	loadChromium,
	loadAxeSource,
	runAxe,
	verifyBrowserAccessibility,
	verifyThemeRendering,
	verifyNarrowSectionNavigation,
	runBrowserVerification,
};

if (require.main === module) {
	runBrowserVerification()
		.then((code) => process.exit(code))
		.catch((e) => {
			console.error("Browser verification crashed:", e);
			process.exit(1);
		});
}
