#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT_DIR, "apps", "docs");
const BUILD_DIR = path.join(DOCS_DIR, "build");
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

// 1. Static Build & Page Count Gate
function verifyBuildAndPageCount(manifest) {
	const errors = [];
	if (!fs.existsSync(BUILD_DIR)) {
		return [
			"Build directory apps/docs/build does not exist. Run 'npm --prefix apps/docs run build' first.",
		];
	}

	const htmlFiles = collectFiles(BUILD_DIR, (p) => p.endsWith(".html"));
	// Filter out 404.html
	const contentHtmlFiles = htmlFiles.filter((p) => !path.basename(p).startsWith("404"));

	const expectedCount = manifest.totalDocuments || manifest.documents.length;
	// Docusaurus builds each doc into an index.html in a subdirectory, plus possible root index.html
	if (contentHtmlFiles.length < expectedCount) {
		errors.push(
			`Build output page count (${contentHtmlFiles.length}) is less than curated manifest count (${expectedCount}).`,
		);
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
		"docs/superpowers",
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
		for (const pattern of ["week-c6-settings-draft", "superpowers/plans", "docs/agents/"]) {
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
	];

	// Absolute local paths scanner (C:\, D:\, /home/user, /Users/user, /root/)
	// We exclude standard unix root paths like /amber-protocol/ or /
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

			// Ignore static asset files (.css, .js, .svg, .png, .ico, .json, .xml)
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
function verifySearchIndex(_manifest) {
	const errors = [];
	const searchIndexPath = path.join(BUILD_DIR, "search-index.json");
	if (!fs.existsSync(searchIndexPath)) {
		return ["Search index file 'search-index.json' missing from apps/docs/build."];
	}

	const stat = fs.statSync(searchIndexPath);
	if (stat.size < 100) {
		errors.push(`Search index 'search-index.json' is unexpectedly small (${stat.size} bytes).`);
	}

	try {
		const data = JSON.parse(fs.readFileSync(searchIndexPath, "utf8"));
		const totalDocs = Array.isArray(data)
			? data.reduce((acc, chunk) => acc + (chunk.documents ? chunk.documents.length : 0), 0)
			: 0;
		if (totalDocs === 0) {
			errors.push("Search index contains 0 documents.");
		}
	} catch (e) {
		errors.push(`Failed to parse search index JSON: ${e.message}`);
	}

	return errors;
}

// 7. Accessibility Floor & Responsive Narrow-Screen Gate
function verifyAccessibilityAndResponsive() {
	const errors = [];

	// Check samples covering 4 page types across navigation groups
	const samplePaths = [
		"index.html", // Start here (Home / Overview)
		"start-here/first-governed-workflow/index.html", // Long guide
		"reference/cli/init/index.html", // CLI reference
		"concepts/evidence/index.html", // Concept
		"troubleshooting/index.html", // Troubleshooting
		"about/boundaries/index.html", // About
	];

	for (const sample of samplePaths) {
		const fullPath = path.join(BUILD_DIR, sample);
		if (!fs.existsSync(fullPath)) continue;

		const content = fs.readFileSync(fullPath, "utf8");

		// Landmarks verification
		if (!content.includes("<main") && !content.includes('role="main"')) {
			errors.push(`Accessibility check: <main> landmark missing on sample page ${sample}`);
		}
		if (!content.includes("<nav") && !content.includes('role="navigation"')) {
			errors.push(`Accessibility check: <nav> landmark missing on sample page ${sample}`);
		}

		// Heading progression (h1 present)
		if (!content.includes("<h1")) {
			errors.push(`Accessibility check: <h1> heading missing on sample page ${sample}`);
		}

		// Skip to content link
		if (!content.includes("skip") && !content.includes("Skip to main content")) {
			errors.push(`Accessibility check: Skip-to-content link missing on sample page ${sample}`);
		}
	}

	// CSS Verification for narrow-screen overflow & touch target constraints
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

// 8. SEO Baseline Gate
function verifySeoBaseline() {
	const errors = [];
	const htmlFiles = collectFiles(
		BUILD_DIR,
		(p) => p.endsWith(".html") && !path.basename(p).startsWith("404") && !p.includes("search"),
	);

	const sitemapPath = path.join(BUILD_DIR, "sitemap.xml");
	if (!fs.existsSync(sitemapPath)) {
		errors.push("SEO baseline: sitemap.xml is missing from build output.");
	}

	for (const file of htmlFiles) {
		const content = fs.readFileSync(file, "utf8");
		const rel = path.relative(BUILD_DIR, file).replace(/\\/g, "/");

		if (!/<title[^>]*>.+?<\/title>/i.test(content)) {
			errors.push(`SEO check: Page ${rel} lacks a non-empty <title> tag.`);
		}

		if (!content.includes('name="description"') && !content.includes('property="og:description"')) {
			errors.push(`SEO check: Page ${rel} lacks meta description tag.`);
		}

		if (!content.includes('rel="canonical"')) {
			errors.push(`SEO check: Page ${rel} lacks canonical link tag.`);
		}
	}

	return errors;
}

// 9. Edit Links Gate
function verifyEditLinks() {
	const errors = [];
	const htmlFiles = collectFiles(
		BUILD_DIR,
		(p) =>
			p.endsWith(".html") &&
			!path.basename(p).startsWith("404") &&
			!p.includes("search") &&
			path.relative(BUILD_DIR, p).replace(/\\/g, "/") !== "index.html",
	);

	for (const file of htmlFiles) {
		const content = fs.readFileSync(file, "utf8");
		const rel = path.relative(BUILD_DIR, file).replace(/\\/g, "/");

		// Check for edit link presence
		if (!content.includes("github.com/Bandersnatch0x/amber-protocol/tree/master/apps/docs/")) {
			errors.push(`Edit links check: Page ${rel} lacks a valid GitHub edit link.`);
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
		if (!content.includes(`v${expectedVersion}`) && !content.includes(expectedVersion)) {
			errors.push(
				`Version sync check: about/version-history.md does not contain current package version v${expectedVersion}.`,
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

function runVerification() {
	console.log("🔍 Running Public Documentation Site Verification Seam (Ticket 0020 & 0024)...\n");

	if (!fs.existsSync(MANIFEST_PATH)) {
		console.error("❌ Curated public manifest apps/docs/docs-manifest.json is missing.");
		process.exit(1);
	}

	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

	const gates = [
		{ name: "1. Static Build & Page Count Gate", fn: () => verifyBuildAndPageCount(manifest) },
		{ name: "2. Reference Drift Gate", fn: () => verifyReferenceDrift() },
		{ name: "3. C-Layer Deny Gate", fn: () => verifyCLayerDeny(manifest) },
		{ name: "4. Content Safety / Secrets Gate", fn: () => verifyContentSafety() },
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
	];

	let totalFailures = 0;

	for (const gate of gates) {
		const errs = gate.fn();
		if (errs.length === 0) {
			console.log(`✅ [PASS] ${gate.name}`);
		} else {
			console.error(`❌ [FAIL] ${gate.name}:`);
			for (const err of errs) {
				console.error(`     • ${err}`);
			}
			totalFailures += errs.length;
		}
	}

	console.log("");
	if (totalFailures > 0) {
		console.error(
			`💥 Verification failed with ${totalFailures} error(s). Site is not ready for publication.`,
		);
		return 1;
	}

	console.log(
		"🎉 All 11 verification gates passed with zero tolerance! Public documentation site verified.",
	);
	return 0;
}

if (require.main === module) {
	process.exitCode = runVerification();
}

module.exports = {
	runVerification,
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
};
