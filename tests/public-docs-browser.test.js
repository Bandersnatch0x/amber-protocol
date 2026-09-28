"use strict";

// Guard for the browser verification seam (issues/0063 rows 7 & 10).
//
// The gate functions require a built site (apps/docs/build), a Playwright
// chromium, and axe-core. The root test job usually has none of those, so the
// end-to-end checks skip there and run in the docs CI job (which builds the
// site and installs the browser). The module-shape assertion always runs, and
// the axe "bite" test proves the accessibility mechanism actually reports a
// planted violation whenever a browser is present.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const mod = require("../scripts/verify-public-docs-browser");

const hasBuild = fs.existsSync(mod.BUILD_DIR);
const chromium = mod.loadChromium();
const axeReady = Boolean(mod.loadAxeSource());
const browserReady = hasBuild && Boolean(chromium) && axeReady;
const gated = browserReady
	? {}
	: { skip: "no apps/docs/build, chromium, or axe-core — the docs CI job provides them" };

test("browser verifier exports the row 7 & 10 gate functions", () => {
	for (const fn of [
		"runBrowserVerification",
		"verifyBrowserAccessibility",
		"verifyThemeRendering",
		"runAxe",
		"startServer",
	]) {
		assert.equal(typeof mod[fn], "function", `expected ${fn} to be exported`);
	}
	assert.ok(Array.isArray(mod.REPRESENTATIVE_PAGES) && mod.REPRESENTATIVE_PAGES.length >= 4);
	assert.deepEqual(mod.VIEWPORTS, [320, 375, 768]);
});

test("browser verification passes end-to-end on the built site", gated, async () => {
	const code = await mod.runBrowserVerification();
	assert.equal(code, 0, "rows 7 & 10 must be clean on the dark default theme");
});

test("the axe check reports a planted color-contrast violation", gated, async () => {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		// Light-gray text on white: a serious color-contrast violation axe must flag.
		await page.setContent(
			'<!doctype html><html><head><meta charset="utf-8"><title>bite</title></head>' +
				'<body style="background:#ffffff"><p style="color:#dddddd">low contrast text that axe should reject</p></body></html>',
		);
		const violations = await mod.runAxe(page);
		assert.ok(
			violations.some((v) => v.id === "color-contrast"),
			`expected a color-contrast violation, got: ${JSON.stringify(violations)}`,
		);
	} finally {
		await browser.close();
	}
});
