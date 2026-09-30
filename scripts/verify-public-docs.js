#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT_DIR, "apps", "docs");
const BUILD_DIR = path.join(DOCS_DIR, "build");
const SRC_DIR = path.join(DOCS_DIR, "src");
const MANIFEST_PATH = path.join(DOCS_DIR, "docs-manifest.json");
const PKG_PATH = path.join(ROOT_DIR, "package.json");

// Helper to collect all files in a directory recursively
function collectFiles(dir, predicate = () => true) {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectFiles(fullPath, predicate));
		} else if (predicate(fullPath, entry.name)) {
			results.push(fullPath);
		}
	}
	return results;
}

// 1. Static Build & Exact Corpus Page Count Gate
function verifyBuildAndPageCount(manifest) {
	const errors = [];
	if (!fs.existsSync(BUILD_DIR)) {
		return [
			"Build directory apps/docs/build does not exist. Run 'npm --prefix apps/docs run build' first.",
		];
	}

	const htmlFiles = collectFiles(BUILD_DIR, (p) => p.endsWith(".html"));
	const contentHtmlFiles = htmlFiles.filter(
		(p) => !path.basename(p).startsWith("404") && !p.includes("search"),
	);

	const allowlistPaths = new Set();
	allowlistPaths.add("index.html"); // Landing page

	for (const doc of manifest.documents) {
		let cleanDocPath = doc.path.replace(/^\/amber-protocol\//, "").replace(/^\/+/, "");
		if (cleanDocPath.endsWith(".md") || cleanDocPath.endsWith(".mdx")) {
			cleanDocPath = cleanDocPath.replace(/\.mdx?$/, "");
		}
		if (cleanDocPath === "" || cleanDocPath === "index") {
			allowlistPaths.add("index.html");
		} else {
			allowlistPaths.add(`${cleanDocPath}/index.html`);
			allowlistPaths.add(`${cleanDocPath}.html`);
		}
	}

	// Verify all manifest documents were built
	for (const doc of manifest.documents) {
		let cleanDocPath = doc.path.replace(/^\/amber-protocol\//, "").replace(/^\/+/, "");
		if (cleanDocPath.endsWith(".md") || cleanDocPath.endsWith(".mdx")) {
			cleanDocPath = cleanDocPath.replace(/\.mdx?$/, "");
		}
		const opt1 = path.join(BUILD_DIR, `${cleanDocPath}`, "index.html");
		const opt2 = path.join(BUILD_DIR, `${cleanDocPath}.html`);
		const opt3 = cleanDocPath === "" ? path.join(BUILD_DIR, "index.html") : null;

		if (!fs.existsSync(opt1) && !fs.existsSync(opt2) && !(opt3 && fs.existsSync(opt3))) {
			errors.push(`Curated manifest document missing from build output: ${doc.path} (${doc.id})`);
		}
	}

	// Exactness check: Fail on extra / unallowlisted navigable HTML pages
	for (const htmlFile of contentHtmlFiles) {
		const rel = path.relative(BUILD_DIR, htmlFile).replace(/\\/g, "/");
		if (!allowlistPaths.has(rel) && !rel.startsWith("assets/")) {
			// Check if it's a valid subsection index
			const isAllowedSub = Array.from(allowlistPaths).some(
				(allowed) =>
					allowed === rel ||
					allowed.replace(/\/index\.html$/, "") === rel.replace(/\/index\.html$/, ""),
			);
			if (!isAllowedSub) {
				errors.push(
					`Exact corpus check failed: Unallowlisted navigable HTML page found in build output: ${rel}`,
				);
			}
		}
	}

	return errors;
}

// 2. Reference Drift Gate
function verifyReferenceDrift() {
	const genScript = path.join(ROOT_DIR, "scripts", "gen-docs-cli.js");
	const res = spawnSync(process.execPath, [genScript, "--check"], {
		cwd: ROOT_DIR,
		encoding: "utf8",
	});
	if (res.status !== 0) {
		return [
			`Generated CLI reference drift check failed:\n${res.stderr || res.stdout || "Drift detected."}`,
		];
	}
	return [];
}

// 3. C-Layer Deny Gate
function verifyCLayerDeny(manifest) {
	const errors = [];
	const denyPatterns = manifest.denyPatterns || [
		"AGENTS.md",
		"CLAUDE.md",
		"MEMORY.md",
		"LOOP.md",
		".amber",
		"docs/agents",
		"docs/reference/week-c6-settings-draft",
		"docs/plans",
		"docs/reviews",
	];

	const allBuildFiles = collectFiles(BUILD_DIR);
	for (const file of allBuildFiles) {
		const rel = path.relative(BUILD_DIR, file).replace(/\\/g, "/");
		for (const pattern of denyPatterns) {
			const cleanPat = pattern.replace(/\/\*\*?$/, "");
			if (rel.toLowerCase().includes(cleanPat.toLowerCase())) {
				errors.push(
					`C-layer denied file found in build output: ${rel} (matched pattern: ${pattern})`,
				);
			}
		}
	}

	// Also inspect HTML content for forbidden C-layer links or references
	const htmlFiles = collectFiles(BUILD_DIR, (p) => p.endsWith(".html"));
	for (const file of htmlFiles) {
		const content = fs.readFileSync(file, "utf8");
		const rel = path.relative(BUILD_DIR, file).replace(/\\/g, "/");
		for (const pattern of ["week-c6-settings-draft", "docs/agents/"]) {
			if (content.includes(pattern)) {
				errors.push(`C-layer forbidden string "${pattern}" found in HTML: ${rel}`);
			}
		}
	}

	return errors;
}

// 4. Content Safety / Secrets & Absolute Paths Gate
function verifyContentSafety() {
	const errors = [];
	const secretPatterns = [
		/ghp_[0-9a-zA-Z]{36}/,
		/github_pat_[0-9a-zA-Z_]{22,}/,
		/-----BEGIN (?:RSA )?PRIVATE KEY-----/,
		/https:\/\/hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9a-zA-Z]+/,
		/AKIA[0-9A-Z]{16}/,
		/AIza[0-9A-Za-z-_]{35}/,
	];

	// Absolute local paths scanner (C:\, D:\, /home/user, /Users/user, /root/)
	const absolutePathPatterns = [
		/[A-Za-z]:\\(?:Users|code_space|workspace|tmp|home)/i,
		/(?:^|\s|\/)"?\/(?:Users|home|root)\/[a-zA-Z0-9_-]+/i,
	];

	const sourceFiles = collectFiles(
		path.join(DOCS_DIR, "docs"),
		(p) => p.endsWith(".md") || p.endsWith(".mdx"),
	);
	const buildHtmlFiles = collectFiles(BUILD_DIR, (p) => p.endsWith(".html"));

	const allFilesToScan = [...sourceFiles, ...buildHtmlFiles];

	for (const file of allFilesToScan) {
		const content = fs.readFileSync(file, "utf8");
		const rel = path.relative(ROOT_DIR, file).replace(/\\/g, "/");

		for (const pat of secretPatterns) {
			if (pat.test(content)) {
				errors.push(`Secret-like pattern ${pat} detected in ${rel}`);
			}
		}

		for (const pat of absolutePathPatterns) {
			if (pat.test(content)) {
				errors.push(`Absolute local path pattern ${pat} detected in ${rel}`);
			}
		}
	}

	return errors;
}

// 5. Internal Links & Anchors Gate
function verifyLinksAndAnchors() {
	const errors = [];
	const htmlFiles = collectFiles(BUILD_DIR, (p) => p.endsWith(".html"));
	const htmlMap = new Map();

	for (const file of htmlFiles) {
		const rel = path.relative(BUILD_DIR, file).replace(/\\/g, "/");
		const content = fs.readFileSync(file, "utf8");
		htmlMap.set(rel, content);
	}

	// Match href="..."
	const hrefRegex = /href=["']([^"'#?]+)(?:#([^"']*))?(?:\?[^"']*)?["']/g;

	for (const [pagePath, content] of htmlMap.entries()) {
		let match;
		while ((match = hrefRegex.exec(content)) !== null) {
			const linkTarget = match[1];
			const anchor = match[2];

			// Ignore external protocols, mailto, tel, javascript
			if (/^(?:https?:|mailto:|tel:|javascript:|#)/.test(linkTarget)) {
				continue;
			}

			// Ignore static asset files
			if (/\.(?:css|js|svg|png|jpg|jpeg|gif|ico|json|xml|txt|woff2?|ttf|eot)$/i.test(linkTarget)) {
				continue;
			}

			// Resolve link target to an HTML path in build
			let resolvedHtmlPath = null;
			let cleanTarget = linkTarget;

			// Handle baseUrl /amber-protocol/
			if (cleanTarget.startsWith("/amber-protocol/")) {
				cleanTarget = cleanTarget.slice("/amber-protocol/".length);
			}
			cleanTarget = cleanTarget.replace(/^\/+|\/+$/g, "");

			if (cleanTarget === "") {
				resolvedHtmlPath = "index.html";
			} else if (htmlMap.has(`${cleanTarget}/index.html`)) {
				resolvedHtmlPath = `${cleanTarget}/index.html`;
			} else if (htmlMap.has(`${cleanTarget}.html`)) {
				resolvedHtmlPath = `${cleanTarget}.html`;
			} else if (htmlMap.has(cleanTarget)) {
				resolvedHtmlPath = cleanTarget;
			}

			if (!resolvedHtmlPath || !htmlMap.has(resolvedHtmlPath)) {
				errors.push(
					`Broken internal link in ${pagePath}: href="${linkTarget}" could not be resolved in build output.`,
				);
				continue;
			}

			// If an anchor was specified, verify it exists in the resolved HTML
			if (anchor) {
				const targetContent = htmlMap.get(resolvedHtmlPath);
				const hasAnchor =
					targetContent.includes(`id="${anchor}"`) ||
					targetContent.includes(`name="${anchor}"`) ||
					targetContent.includes(`id='${anchor}'`);
				if (!hasAnchor) {
					errors.push(
						`Broken anchor link in ${pagePath}: href="${linkTarget}#${anchor}" (anchor #${anchor} not found in ${resolvedHtmlPath}).`,
					);
				}
			}
		}
	}

	return errors;
}

// 6. Search Index Gate
function verifySearchIndex(manifest) {
	const errors = [];
	const searchIndexPath = path.join(BUILD_DIR, "search-index.json");
	if (!fs.existsSync(searchIndexPath)) {
		return ["Search index file 'search-index.json' missing from apps/docs/build."];
	}

	const stat = fs.statSync(searchIndexPath);
	if (stat.size < 100) {
		errors.push(`Search index 'search-index.json' is unexpectedly small (${stat.size} bytes).`);
	}

	let groups = [];
	try {
		const data = JSON.parse(fs.readFileSync(searchIndexPath, "utf8"));
		const totalDocs = Array.isArray(data)
			? data.reduce((acc, chunk) => acc + (chunk.documents ? chunk.documents.length : 0), 0)
			: 0;
		if (totalDocs === 0) {
			errors.push("Search index contains 0 documents.");
		}
		groups = Array.isArray(data) ? data.filter((chunk) => Array.isArray(chunk.documents)) : [];
	} catch (e) {
		errors.push(`Failed to parse search index JSON: ${e.message}`);
	}

	// Coverage parity (0020 Layer 1 row 6). A non-empty index is not the same as
	// a covered one: a page whose entries silently drop out stays reachable by
	// URL yet becomes unlocatable through the site's own search box. Compare the
	// indexed URL set against the curated corpus in both directions.
	if (groups.length > 0 && manifest && Array.isArray(manifest.documents)) {
		const normalize = (u) =>
			String(u)
				.replace(/\/$/, "")
				.replace(/\/index$/, "");
		const indexedUrls = new Set();
		for (const group of groups) {
			for (const doc of group.documents) {
				if (doc && typeof doc.u === "string") indexedUrls.add(normalize(doc.u));
			}
		}

		const expected = manifest.documents.map((doc) => {
			const cleaned = String(doc.path)
				.replace(/^\/amber-protocol\//, "")
				.replace(/^\/+/, "")
				.replace(/\.mdx?$/, "");
			const url =
				cleaned === "" || cleaned === "index"
					? "/amber-protocol"
					: normalize(`/amber-protocol/${cleaned}`);
			return { id: doc.id, url };
		});

		const missing = expected.filter((e) => !indexedUrls.has(e.url));
		if (missing.length > 0) {
			errors.push(
				`Search index coverage incomplete: ${missing.length} published page(s) have no search entry — ${missing
					.map((m) => m.id)
					.join(", ")}.`,
			);
		}

		const expectedUrls = new Set(expected.map((e) => e.url));
		const extra = [...indexedUrls].filter((u) => !expectedUrls.has(u));
		if (extra.length > 0) {
			errors.push(
				`Search index contains entries for ${extra.length} URL(s) outside the curated corpus — ${extra.join(", ")}.`,
			);
		}
	}

	return errors;
}

// 7. Accessibility Floor & Responsive Narrow-Screen Gate
function verifyAccessibilityAndResponsive() {
	const errors = [];

	const samplePaths = [
		"index.html",
		"start-here/first-governed-workflow/index.html",
		"reference/cli/init/index.html",
		"concepts/evidence/index.html",
		"troubleshooting/index.html",
		"about/boundaries/index.html",
	];

	for (const sample of samplePaths) {
		const fullPath = path.join(BUILD_DIR, sample);
		if (!fs.existsSync(fullPath)) continue;

		const content = fs.readFileSync(fullPath, "utf8");

		// 1. Semantic Landmarks
		if (!content.includes("<main") && !content.includes('role="main"')) {
			errors.push(`Accessibility check: <main> landmark missing on sample page ${sample}`);
		}
		if (!content.includes("<nav") && !content.includes('role="navigation"')) {
			errors.push(`Accessibility check: <nav> landmark missing on sample page ${sample}`);
		}

		// 2. Heading Progression (h1 present, no skips)
		if (!content.includes("<h1")) {
			errors.push(`Accessibility check: <h1> heading missing on sample page ${sample}`);
		}

		// 3. Viewport & Skip Link
		if (!content.includes('name="viewport"') || !content.includes("width=device-width")) {
			errors.push(`Responsive check: Viewport meta tag missing on sample page ${sample}`);
		}
		if (!content.includes("skip") && !content.includes("Skip to main content")) {
			errors.push(`Accessibility check: Skip-to-content link missing on sample page ${sample}`);
		}
	}

	// 4. CSS Verification for narrow-screen overflow & touch target constraints
	const customCssPath = path.join(DOCS_DIR, "src", "css", "custom.css");
	if (fs.existsSync(customCssPath)) {
		const css = fs.readFileSync(customCssPath, "utf8");
		if (!css.includes("max-width: 100%") || !css.includes("overflow-x")) {
			errors.push("Responsive check: custom.css must enforce zero page-level horizontal overflow.");
		}
		if (!css.includes("min-height: 44px") && !css.includes("min-height: 40px")) {
			errors.push(
				"Accessibility check: custom.css must enforce touch target sizing floor (>=40-44px).",
			);
		}
		if (!css.includes(":focus-visible")) {
			errors.push("Accessibility check: custom.css must define visible :focus-visible styling.");
		}
	} else {
		errors.push(`custom.css missing at ${customCssPath}`);
	}

	return errors;
}

// Collect the reader-facing HTML pages the SEO/edit-link gates operate on as
// { rel, content } records. Excludes 404 and the search shell, matching the
// prior per-gate collectFiles predicates. Factored out so tests can inject
// doctored pages and prove the gates bite (0063 rows 8/9).
function collectSeoPages() {
	return collectFiles(
		BUILD_DIR,
		(p) => p.endsWith(".html") && !path.basename(p).startsWith("404") && !p.includes("search"),
	).map((file) => ({
		rel: path.relative(BUILD_DIR, file).replace(/\\/g, "/"),
		content: fs.readFileSync(file, "utf8"),
	}));
}

// Append a page to the list of pages sharing a given title/description value.
function recordOwner(map, key, rel) {
	const owners = map.get(key);
	if (owners) owners.push(rel);
	else map.set(key, [rel]);
}

// 8. SEO Baseline Gate
// Contract 0020 row 8: every page carries a non-empty <title>, a meta
// description, and a canonical link, AND titles + descriptions are 100% unique
// across the corpus (a shared title/description reads as duplicate content and
// splits ranking). `pages` is injectable for tests; the sitemap presence check
// only runs against the real build.
function verifySeoBaseline(pages) {
	const errors = [];
	const injected = Array.isArray(pages);
	const htmlPages = injected ? pages : collectSeoPages();

	if (!injected) {
		const sitemapPath = path.join(BUILD_DIR, "sitemap.xml");
		if (!fs.existsSync(sitemapPath)) {
			errors.push("SEO baseline: sitemap.xml is missing from build output.");
		}
	}

	const titleOwners = new Map();
	const descriptionOwners = new Map();

	for (const { rel, content } of htmlPages) {
		if (!/<title[^>]*>.+?<\/title>/i.test(content)) {
			errors.push(`SEO check: Page ${rel} lacks a non-empty <title> tag.`);
		}

		if (!content.includes('name="description"') && !content.includes('property="og:description"')) {
			errors.push(`SEO check: Page ${rel} lacks meta description tag.`);
		}

		if (!content.includes('rel="canonical"')) {
			errors.push(`SEO check: Page ${rel} lacks canonical link tag.`);
		}

		const titleMatch = content.match(/<title[^>]*>(.*?)<\/title>/i);
		if (titleMatch && titleMatch[1].trim()) {
			recordOwner(titleOwners, titleMatch[1].trim(), rel);
		}

		const descriptionMatch =
			content.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) ||
			content.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/i);
		if (descriptionMatch && descriptionMatch[1].trim()) {
			recordOwner(descriptionOwners, descriptionMatch[1].trim(), rel);
		}
	}

	for (const [title, owners] of titleOwners) {
		if (owners.length > 1) {
			errors.push(
				`SEO uniqueness: <title> "${title}" is shared by ${owners.length} pages: ${owners.join(", ")}`,
			);
		}
	}
	for (const owners of descriptionOwners.values()) {
		if (owners.length > 1) {
			errors.push(
				`SEO uniqueness: meta description is shared by ${owners.length} pages: ${owners.join(", ")}`,
			);
		}
	}

	return errors;
}

// 9. Edit Links Gate
// Contract 0020 row 9: every content page carries a GitHub edit link AND that
// link resolves to a source file that actually exists in the repository —
// presence of the prefix alone would let an edit link point at a moved or
// renamed source and still "pass". `pages` is injectable for tests.
const EDIT_LINK_SOURCE_RE =
	/github\.com\/Bandersnatch0x\/amber-protocol\/tree\/master\/(apps\/docs\/[^"'\s<>]+)/;

function verifyEditLinks(pages) {
	const errors = [];
	const injected = Array.isArray(pages);
	const htmlPages = injected
		? pages
		: collectSeoPages().filter((page) => page.rel !== "index.html");

	for (const { rel, content } of htmlPages) {
		const match = content.match(EDIT_LINK_SOURCE_RE);
		if (!match) {
			errors.push(`Edit links check: Page ${rel} lacks a valid GitHub edit link.`);
			continue;
		}
		const sourceRel = match[1].replace(/[#?].*$/, "").replace(/\/+$/, "");
		if (!fs.existsSync(path.join(ROOT_DIR, sourceRel))) {
			errors.push(
				`Edit links check: Page ${rel} edit link points at a source path that does not exist: ${sourceRel}`,
			);
		}
	}

	return errors;
}

// 10. Zero Telemetry Gate
function verifyZeroTelemetry() {
	const errors = [];
	const allFiles = collectFiles(BUILD_DIR, (p) => p.endsWith(".html") || p.endsWith(".js"));

	const telemetryKeywords = [
		"google-analytics.com",
		"googletagmanager.com",
		"analytics.google.com",
		"plausible.io",
		"mixpanel.com",
		"segment.com",
		"telemetry.algolia.com",
	];

	for (const file of allFiles) {
		const content = fs.readFileSync(file, "utf8");
		const rel = path.relative(BUILD_DIR, file).replace(/\\/g, "/");

		for (const kw of telemetryKeywords) {
			if (content.includes(kw)) {
				errors.push(`Zero-telemetry violation: ${kw} found in ${rel}`);
			}
		}
	}

	return errors;
}

// 11. Version & Support Matrix Synchronization Gate
function verifyVersionSync() {
	const errors = [];
	const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
	const expectedVersion = pkg.version;
	const expectedNode = pkg.engines?.node;
	const expectedNpm = pkg.engines?.npm;

	const versionHistoryPath = path.join(DOCS_DIR, "docs", "about", "version-history.md");
	const installPath = path.join(DOCS_DIR, "docs", "start-here", "installation.md");

	if (fs.existsSync(versionHistoryPath)) {
		const rawContent = fs.readFileSync(versionHistoryPath, "utf8");
		const content = rawContent.replace(/\\\|/g, "|");
		// The page must NAME the current release, not merely contain the version string somewhere:
		// `scheduled for removal in v2.0.0` satisfied the old substring test while the page still
		// announced `Current Release: v1.6.0`, so the 2.0.0 release passed this gate by accident.
		const declared = content.match(/^## Current Release:\s*`?v?(\d+\.\d+\.\d+)`?\s*$/m);
		if (!declared) {
			errors.push(
				"Version sync check: about/version-history.md has no `## Current Release: `vX.Y.Z`` heading.",
			);
		} else if (declared[1] !== expectedVersion) {
			errors.push(
				`Version sync check: about/version-history.md announces v${declared[1]} while package.json is v${expectedVersion}.`,
			);
		}
		if (expectedNode && !content.includes(expectedNode)) {
			errors.push(
				`Version sync check: about/version-history.md does not match package.json engines.node (${expectedNode}).`,
			);
		}
		if (expectedNpm && !content.includes(expectedNpm)) {
			errors.push(
				`Version sync check: about/version-history.md does not match package.json engines.npm (${expectedNpm}).`,
			);
		}
	} else {
		errors.push("about/version-history.md is missing.");
	}

	if (fs.existsSync(installPath)) {
		const rawContent = fs.readFileSync(installPath, "utf8");
		const content = rawContent.replace(/\\\|/g, "|");
		if (expectedNode && !content.includes(expectedNode)) {
			errors.push(
				`Version sync check: start-here/installation.md does not match package.json engines.node (${expectedNode}).`,
			);
		}
		if (expectedNpm && !content.includes(expectedNpm)) {
			errors.push(
				`Version sync check: start-here/installation.md does not match package.json engines.npm (${expectedNpm}).`,
			);
		}
	} else {
		errors.push("start-here/installation.md is missing.");
	}

	return errors;
}

// 12. Replayable Reader Result Scenarios (New Reader & Experienced Reader)
function verifyReaderScenarios(options = {}) {
	const errors = [];

	// Scenario 1: First-Time Reader Journey. Paths are injectable for tests so the
	// continuity assertions below can be proven to bite on a doctored fixture.
	const firstWorkflowPath =
		options.firstWorkflowPath ||
		path.join(DOCS_DIR, "docs", "start-here", "first-governed-workflow.md");
	const boundariesPath =
		options.boundariesPath || path.join(DOCS_DIR, "docs", "about", "boundaries.md");

	if (!fs.existsSync(firstWorkflowPath)) {
		errors.push("Scenario 1 failed: first-governed-workflow.md does not exist.");
	} else {
		const content = fs.readFileSync(firstWorkflowPath, "utf8");
		const requiredSequence = ["audit", "init", "doctor", "session start", "next"];
		for (const step of requiredSequence) {
			if (!content.includes(step)) {
				errors.push(`Scenario 1 failed: Step "${step}" missing from first governed workflow.`);
			}
		}
		if (!content.includes("expectedSignal")) {
			errors.push(
				"Scenario 1 failed: Expected signals / artifacts missing from first governed workflow steps.",
			);
		}
		// The canonical first-workflow path must hand the reader to the
		// assurance/handoff half of the full lifecycle, or a reader finishes the
		// walkthrough never learning the loop continues (issues/0063 R3).
		for (const [label, needle] of [
			["assurance/evidence", "/concepts/evidence"],
			["handoff/continuity", "/guides/session-handoff-and-continuity"],
		]) {
			if (!content.includes(needle)) {
				errors.push(
					`Scenario 1 failed: the walkthrough does not link to the ${label} half of the lifecycle (${needle}).`,
				);
			}
		}
	}

	// The landing page states the FULL governed lifecycle; it must be labelled as
	// such and link to the walkthrough's subset, so the two "5-step" surfaces read
	// as one model rather than two competing ones (issues/0063 R3).
	const landingPath = options.landingPath || path.join(SRC_DIR, "pages", "index.tsx");
	if (!fs.existsSync(landingPath)) {
		errors.push("Scenario 1 failed: landing page index.tsx does not exist.");
	} else {
		const landing = fs.readFileSync(landingPath, "utf8");
		if (!landing.includes("/start-here/first-governed-workflow")) {
			errors.push(
				"Scenario 1 failed: the landing lifecycle does not link to the first-governed-workflow walkthrough.",
			);
		}
		if (!/full governed lifecycle/i.test(landing)) {
			errors.push(
				"Scenario 1 failed: the landing lifecycle must be labelled as the full governed lifecycle so it reads as the superset of the walkthrough's subset.",
			);
		}
	}

	if (!fs.existsSync(boundariesPath)) {
		errors.push("Scenario 1 failed: about/boundaries.md does not exist.");
	} else {
		const boundContent = fs.readFileSync(boundariesPath, "utf8");
		// What matters is the claim, not the sentence. The new-reader trial asks a
		// reader to say back what Amber does NOT do, so the gate asserts those
		// claims are on the page; matching is case- and whitespace-insensitive so
		// an editorial rewrite of a still-true statement cannot fail the build.
		// The patterns stay literal (no wildcards) — a loose pattern would pass
		// vacuously and stop being evidence of anything.
		const normalizedContent = boundContent.toLowerCase().replace(/\s+/g, " ");
		const nonExecutionClaims = [
			["dynamic workflow execution", /no dynamic workflow execution|zero dynamic execution/],
			["automatic build or test execution", /does not automatically run tests/],
			["live agent dispatch", /no live agent is ever started/],
			["scheduled loop runs", /schedules a loop run/],
			["rewriting existing project documents", /skip existing user-authored files/],
		];
		const missingClaims = nonExecutionClaims
			.filter(([, pattern]) => !pattern.test(normalizedContent))
			.map(([claim]) => claim);

		if (missingClaims.length > 0) {
			errors.push(
				`Scenario 1 failed: boundaries.md does not state the non-execution boundary for: ${missingClaims.join(", ")}.`,
			);
		}
	}

	// Scenario 2: Experienced Operator Exact Command Search & Reference Journey
	const searchIndexPath = path.join(BUILD_DIR, "search-index.json");
	if (fs.existsSync(searchIndexPath)) {
		try {
			const indexContent = fs.readFileSync(searchIndexPath, "utf8");
			const testCommands = ["audit", "gate", "handoff"];
			for (const cmd of testCommands) {
				if (!indexContent.includes(cmd)) {
					errors.push(
						`Scenario 2 failed: Command "${cmd}" not discoverable in local search index.`,
					);
				}
				const cmdDocPath = path.join(BUILD_DIR, "reference", "cli", cmd, "index.html");
				if (!fs.existsSync(cmdDocPath)) {
					errors.push(
						`Scenario 2 failed: Exact reference landing page for "${cmd}" missing at ${cmdDocPath}.`,
					);
				} else {
					const cmdHtml = fs.readFileSync(cmdDocPath, "utf8");
					if (!cmdHtml.includes("Usage") || !cmdHtml.includes("Boundaries")) {
						errors.push(
							`Scenario 2 failed: Reference page for "${cmd}" lacks complete usage or boundary contracts.`,
						);
					}
				}
			}
		} catch (e) {
			errors.push(`Scenario 2 search index inspection failed: ${e.message}`);
		}
	} else {
		errors.push("Scenario 2 failed: search-index.json missing for search scenario verification.");
	}

	return errors;
}

// 13. Published Endpoint Availability Probing
async function probePublishedEndpoint(baseUrl) {
	const errors = [];
	const endpoints = [
		"",
		"start-here",
		"concepts",
		"reference/cli",
		"sitemap.xml",
		"search-index.json",
	];

	for (const ep of endpoints) {
		const targetUrl = new URL(ep, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
		try {
			const status = await new Promise((resolve, reject) => {
				const client = targetUrl.startsWith("https:") ? https : http;
				const req = client.get(targetUrl, { timeout: 5000 }, (res) => {
					resolve(res.statusCode);
				});
				req.on("error", reject);
				req.on("timeout", () => {
					req.destroy();
					reject(new Error("Request timed out"));
				});
			});

			if (status !== 200) {
				errors.push(`Endpoint probe failed: ${targetUrl} returned HTTP ${status}`);
			}
		} catch (err) {
			errors.push(`Endpoint probe error for ${targetUrl}: ${err.message}`);
		}
	}

	return errors;
}

// 13. CSS-module class integrity (static, no build): every `styles.<name>` a
// page references must resolve to a selector in its imported *.module.css.
// Catches the class of defect where markup and its stylesheet drift apart and
// the page renders `class="undefined"` (issues/0063 C1). `srcDir` is injectable
// for tests.
function verifyCssModuleClasses(srcDir = SRC_DIR) {
	const errors = [];
	if (!fs.existsSync(srcDir)) return errors;
	const tsxFiles = collectFiles(srcDir, (p) => p.endsWith(".tsx"));
	for (const file of tsxFiles) {
		const content = fs.readFileSync(file, "utf8");
		const imp = content.match(/import\s+styles\s+from\s+['"]([^'"]+\.module\.css)['"]/);
		if (!imp) continue;
		const rel = path.relative(ROOT_DIR, file).replace(/\\/g, "/");
		const modulePath = path.resolve(path.dirname(file), imp[1]);
		if (!fs.existsSync(modulePath)) {
			errors.push(`CSS-module integrity: ${rel} imports ${imp[1]}, which does not exist.`);
			continue;
		}
		const css = fs.readFileSync(modulePath, "utf8");
		const defined = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1]));
		const referenced = [
			...new Set([...content.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((m) => m[1])),
		];
		const missing = referenced.filter((name) => !defined.has(name));
		if (missing.length > 0) {
			errors.push(
				`CSS-module integrity: ${rel} references ${missing.length} class(es) not defined in ${path.basename(modulePath)}: ${missing.join(", ")}`,
			);
		}
	}
	return errors;
}

// 14. Custom-property integrity (static, no build): every project-owned
// `var(--amber-*)` used in apps/docs/src CSS must be declared somewhere in that
// same CSS set. Framework `--ifm-*` properties are Docusaurus-provided and out
// of scope. Catches the class of defect where a component references design
// tokens that dissolve to nothing (issues/0063 R2). `srcDir` is injectable.
function verifyCustomProperties(srcDir = SRC_DIR) {
	const errors = [];
	if (!fs.existsSync(srcDir)) return errors;
	const cssFiles = collectFiles(srcDir, (p) => p.endsWith(".css"));
	const defined = new Set();
	const used = [];
	for (const file of cssFiles) {
		const content = fs.readFileSync(file, "utf8");
		for (const m of content.matchAll(/(--amber-[A-Za-z0-9-]+)\s*:/g)) defined.add(m[1]);
		for (const m of content.matchAll(/var\(\s*(--amber-[A-Za-z0-9-]+)/g)) {
			used.push({ prop: m[1], rel: path.relative(ROOT_DIR, file).replace(/\\/g, "/") });
		}
	}
	const reported = new Set();
	for (const { prop, rel } of used) {
		const key = `${rel}:${prop}`;
		if (!defined.has(prop) && !reported.has(key)) {
			reported.add(key);
			errors.push(
				`Custom-property integrity: ${rel} uses ${prop}, which is declared nowhere in apps/docs/src CSS.`,
			);
		}
	}
	return errors;
}

function runVerification() {
	console.log("🔍 Running Public Documentation Site Verification Seam (Ticket 0020 & 0024)...\n");

	if (!fs.existsSync(MANIFEST_PATH)) {
		console.error("❌ docs-manifest.json missing at:", MANIFEST_PATH);
		return 1;
	}

	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
	let hasErrors = false;

	const gates = [
		{ name: "1. Static Build & Page Count Gate", fn: () => verifyBuildAndPageCount(manifest) },
		{ name: "2. Reference Drift Gate", fn: () => verifyReferenceDrift() },
		{ name: "3. C-Layer Deny Gate", fn: () => verifyCLayerDeny(manifest) },
		{ name: "4. Content Safety / Secrets & Absolute Paths Gate", fn: () => verifyContentSafety() },
		{ name: "5. Internal Links & Anchors Gate", fn: () => verifyLinksAndAnchors() },
		{ name: "6. Search Index Gate", fn: () => verifySearchIndex(manifest) },
		{
			name: "7. Accessibility Floor & Responsive Gate",
			fn: () => verifyAccessibilityAndResponsive(),
		},
		{ name: "8. SEO Baseline Gate", fn: () => verifySeoBaseline() },
		{ name: "9. Edit Links Gate", fn: () => verifyEditLinks() },
		{ name: "10. Zero Telemetry Gate", fn: () => verifyZeroTelemetry() },
		{ name: "11. Version & Support Matrix Gate", fn: () => verifyVersionSync() },
		{
			name: "12. Replayable Reader Result Scenarios",
			fn: () => verifyReaderScenarios(),
		},
		{ name: "13. CSS-Module Class Integrity Gate", fn: () => verifyCssModuleClasses() },
		{ name: "14. Custom-Property Integrity Gate", fn: () => verifyCustomProperties() },
	];

	for (const gate of gates) {
		const errors = gate.fn();
		if (errors && errors.length > 0) {
			hasErrors = true;
			console.error(`❌ [FAIL] ${gate.name}`);
			for (const err of errors) {
				console.error(`   - ${err}`);
			}
		} else {
			console.log(`✅ [PASS] ${gate.name}`);
		}
	}

	if (hasErrors) {
		console.error("\n🚫 Publication verification failed. Fix above errors before publishing.");
		return 1;
	}

	console.log(
		"\n🎉 All verification gates and reader scenarios passed with zero tolerance! Public documentation site verified.",
	);
	return 0;
}

if (require.main === module) {
	const args = process.argv.slice(2);
	const probeIdx = args.indexOf("--probe-url");
	if (probeIdx !== -1 && args[probeIdx + 1]) {
		const url = args[probeIdx + 1];
		probePublishedEndpoint(url).then((errors) => {
			if (errors.length > 0) {
				console.error("❌ Endpoint probing failed:");
				errors.forEach((e) => console.error("  -", e));
				process.exit(1);
			} else {
				console.log(`✅ Endpoint probing passed for ${url}`);
				process.exit(0);
			}
		});
	} else {
		const code = runVerification();
		process.exit(code);
	}
}

module.exports = {
	verifyBuildAndPageCount,
	verifyReferenceDrift,
	verifyCLayerDeny,
	verifyContentSafety,
	verifyLinksAndAnchors,
	verifySearchIndex,
	verifyAccessibilityAndResponsive,
	verifySeoBaseline,
	verifyEditLinks,
	verifyZeroTelemetry,
	verifyVersionSync,
	verifyReaderScenarios,
	verifyCssModuleClasses,
	verifyCustomProperties,
	probePublishedEndpoint,
	runVerification,
};
