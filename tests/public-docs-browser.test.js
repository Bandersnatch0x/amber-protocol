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
const path = require("node:path");

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

// Resolve a baseUrl-relative page path to its built HTML file, mirroring the
// gate's static-server resolution (dir -> index.html; else <rel>.html).
function readBuildHtml(rel) {
	const clean = rel === "/" ? "" : rel.replace(/^\//, "").replace(/\/$/, "");
	const candidates = clean
		? [path.join(mod.BUILD_DIR, clean, "index.html"), path.join(mod.BUILD_DIR, `${clean}.html`)]
		: [path.join(mod.BUILD_DIR, "index.html")];
	const hit = candidates.find((p) => fs.existsSync(p));
	return hit ? fs.readFileSync(hit, "utf8") : null;
}

// Hardening (audit follow-up): the gate serves the build under the baseUrl it
// parses from docusaurus.config; if that drifts from the baseUrl the build
// actually used, every page would 404. Pin them together.
test("the gate's served baseUrl matches the built asset prefix", gated, () => {
	const index = fs.readFileSync(path.join(mod.BUILD_DIR, "index.html"), "utf8");
	assert.ok(
		index.includes(`href="${mod.BASE}/`),
		`built assets must live under the gate's served baseUrl "${mod.BASE}" — config/build drift would 404 every page`,
	);
});

// Hardening (audit follow-up): the row-7 axe pass only protects the light/dark
// command-block nature badges if at least one scanned page actually renders
// one. Guard the coverage so a future page-set trim cannot silently drop it.
test("the scanned representative pages include a command-block nature badge", gated, () => {
	const withBadge = mod.REPRESENTATIVE_PAGES.filter((rel) => {
		const html = readBuildHtml(rel);
		return html && /natureBadge/.test(html);
	});
	assert.ok(
		withBadge.length >= 1,
		`no scanned page renders a nature badge — badge a11y fixes go unverified; scanned: ${mod.REPRESENTATIVE_PAGES.join(", ")}`,
	);
});

// 0063 O7 guard: Docusaurus hides the desktop TOC below 997px, so the tablet
// width depends on the collapsible "On this page" TOC. Prove the check passes
// on doc pages and fails on a page that has no section navigation at all.
test("section navigation is reachable at 768px on doc pages", gated, async () => {
	const browser = await chromium.launch();
	try {
		const server = await mod.startServer();
		const origin = `http://localhost:${server.address().port}`;
		try {
			const errors = await mod.verifyNarrowSectionNavigation(browser, origin);
			assert.deepEqual(errors, [], `expected reachable section nav, got: ${errors.join("; ")}`);
		} finally {
			server.close();
		}
	} finally {
		await browser.close();
	}
});

test("the section-navigation check bites on a page with no section nav", gated, async () => {
	const browser = await chromium.launch();
	try {
		const server = await mod.startServer();
		const origin = `http://localhost:${server.address().port}`;
		try {
			// The landing page is not a doc page, so it has no "On this page" TOC.
			const errors = await mod.verifyNarrowSectionNavigation(browser, origin, ["/"]);
			assert.ok(
				errors.some((e) => e.includes("section nav")),
				`expected a missing-section-nav error, got: ${errors.join("; ")}`,
			);
		} finally {
			server.close();
		}
	} finally {
		await browser.close();
	}
});
