"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
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
	runVerification,
} = require("../scripts/verify-public-docs");

const ROOT_DIR = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT_DIR, "apps", "docs", "docs-manifest.json");
const BUILD_DIR = path.join(ROOT_DIR, "apps", "docs", "build");

// The seam mirrors `npm run docs:verify`, which is authoritative and runs in the
// CI docs job right after a build. The root test job has neither the build nor
// the apps/docs dependencies, and calling the gate functions directly bypasses
// Gate 1's build-presence check — so without a build the other gates iterate zero
// files and pass vacuously. Skip them there instead of reporting a green that
// verified nothing.
const needsBuild = fs.existsSync(BUILD_DIR)
	? {}
	: { skip: "no apps/docs/build — run `npm run docs:build` first (the docs CI job does)" };

function buildTest(name, fn) {
	test(name, needsBuild, fn);
}

test("public docs manifest has valid structure and unique paths", () => {
	assert.ok(fs.existsSync(MANIFEST_PATH), "docs-manifest.json must exist");
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

	assert.ok(typeof manifest.version === "string", "manifest version must be string");
	assert.ok(Array.isArray(manifest.documents), "manifest documents must be array");
	assert.ok(manifest.documents.length >= 70, "manifest must contain at least 70 curated documents");
	assert.ok(Array.isArray(manifest.denyPatterns), "manifest denyPatterns must be array");

	const idSet = new Set();
	const pathSet = new Set();

	for (const doc of manifest.documents) {
		assert.ok(doc.id, `Document missing id: ${JSON.stringify(doc)}`);
		assert.ok(doc.path, `Document missing path: ${JSON.stringify(doc)}`);
		assert.ok(doc.group, `Document missing group: ${JSON.stringify(doc)}`);
		assert.ok(doc.title, `Document missing title: ${JSON.stringify(doc)}`);
		assert.ok(doc.description, `Document missing description: ${JSON.stringify(doc)}`);

		assert.ok(!idSet.has(doc.id), `Duplicate document id: ${doc.id}`);
		assert.ok(!pathSet.has(doc.path), `Duplicate document path: ${doc.path}`);

		idSet.add(doc.id);
		pathSet.add(doc.path);
	}
});

// Every `nature` a page hands to CommandBlock must be a member of the
// component's accepted union. Anything outside it silently renders with the
// scaffold badge style, and hand-written pages have drifted from this contract
// before (a non-existent `expectedOutput` prop survived review the same way),
// so the agreement is checked mechanically rather than by reading pages.
test("public docs CommandBlock nature values match the component contract", () => {
	const componentPath = path.join(
		ROOT_DIR,
		"apps",
		"docs",
		"src",
		"components",
		"command-block.tsx",
	);
	const unionMatch = fs.readFileSync(componentPath, "utf8").match(/nature:\s*([\s\S]+?);/);
	assert.ok(unionMatch, "command-block.tsx must declare a `nature` prop type");

	const accepted = new Set([...unionMatch[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
	assert.ok(accepted.size >= 4, `Could not parse the nature union: ${unionMatch[1]}`);

	const offenders = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.name.endsWith(".md")) {
				for (const match of fs.readFileSync(full, "utf8").matchAll(/nature="([^"]+)"/g)) {
					if (!accepted.has(match[1])) {
						offenders.push(`${path.relative(ROOT_DIR, full)}: nature="${match[1]}"`);
					}
				}
			}
		}
	};
	walk(path.join(ROOT_DIR, "apps", "docs", "docs"));

	assert.deepEqual(
		offenders,
		[],
		`CommandBlock nature values outside the contract [${[...accepted].join(", ")}]:\n${offenders.join("\n")}`,
	);
});

buildTest("public docs verification seam: 1. Build and Page Count Gate", () => {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
	const errors = verifyBuildAndPageCount(manifest);
	assert.deepEqual(errors, [], `Build and page count check failed: ${errors.join("; ")}`);
});

buildTest("public docs verification seam: 2. Reference Drift Gate", () => {
	const errors = verifyReferenceDrift();
	assert.deepEqual(errors, [], `CLI reference drift check failed: ${errors.join("; ")}`);
});

buildTest("public docs verification seam: 3. C-Layer Deny Gate", () => {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
	const errors = verifyCLayerDeny(manifest);
	assert.deepEqual(errors, [], `C-layer deny check failed: ${errors.join("; ")}`);
});

buildTest(
	"public docs verification seam: 4. Content Safety / Secrets & Absolute Paths Gate",
	() => {
		const errors = verifyContentSafety();
		assert.deepEqual(errors, [], `Content safety check failed: ${errors.join("; ")}`);
	},
);

buildTest("public docs verification seam: 5. Internal Links & Anchors Gate", () => {
	const errors = verifyLinksAndAnchors();
	assert.deepEqual(errors, [], `Link & anchor check failed: ${errors.join("; ")}`);
});

buildTest("public docs verification seam: 6. Search Index Gate", () => {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
	const errors = verifySearchIndex(manifest);
	assert.deepEqual(errors, [], `Search index check failed: ${errors.join("; ")}`);
});

buildTest("search index coverage gate reports a published page that has no index entry", () => {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
	// A non-empty index is not a covered one: a page can stay reachable by URL
	// while being unlocatable through the site's own search box. Hand the gate a
	// corpus the index cannot satisfy to see the parity check actually bite.
	const doctored = {
		...manifest,
		documents: [
			...manifest.documents,
			{ id: "phantom/page", path: "phantom/page.md", group: "Reference", title: "phantom" },
		],
	};
	const errors = verifySearchIndex(doctored);
	assert.ok(
		errors.some((e) => e.includes("coverage incomplete") && e.includes("phantom/page")),
		`Expected an incomplete-coverage error naming phantom/page, got: ${errors.join("; ")}`,
	);
});

buildTest("search index coverage gate reports index entries outside the curated corpus", () => {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
	const victim = manifest.documents.find((d) => d.id === "reference/cli/next");
	assert.ok(victim, "expected the 'amber next' reference page in the manifest");
	// Removing a document from the corpus makes its genuine index entries
	// "extra" — the other direction of the same parity requirement.
	const doctored = {
		...manifest,
		documents: manifest.documents.filter((d) => d !== victim),
	};
	const errors = verifySearchIndex(doctored);
	assert.ok(
		errors.some((e) => e.includes("outside the curated corpus")),
		`Expected an out-of-corpus error, got: ${errors.join("; ")}`,
	);
	assert.ok(
		!errors.some((e) => e.includes("coverage incomplete")),
		`Removing a document must not report missing coverage: ${errors.join("; ")}`,
	);
});

buildTest("public docs verification seam: 7. Accessibility Floor & Responsive Gate", () => {
	const errors = verifyAccessibilityAndResponsive();
	assert.deepEqual(errors, [], `Accessibility & responsive check failed: ${errors.join("; ")}`);
});

buildTest("public docs verification seam: 8. SEO Baseline Gate", () => {
	const errors = verifySeoBaseline();
	assert.deepEqual(errors, [], `SEO baseline check failed: ${errors.join("; ")}`);
});

buildTest("public docs verification seam: 9. Edit Links Gate", () => {
	const errors = verifyEditLinks();
	assert.deepEqual(errors, [], `Edit links check failed: ${errors.join("; ")}`);
});

buildTest("public docs verification seam: 10. Zero Telemetry Gate", () => {
	const errors = verifyZeroTelemetry();
	assert.deepEqual(errors, [], `Zero telemetry check failed: ${errors.join("; ")}`);
});

buildTest("public docs verification seam: 11. Version & Support Matrix Gate", () => {
	const errors = verifyVersionSync();
	assert.deepEqual(errors, [], `Version sync check failed: ${errors.join("; ")}`);
});

buildTest("public docs verification seam: 12. Replayable Reader Result Scenarios", () => {
	const errors = verifyReaderScenarios();
	assert.deepEqual(errors, [], `Reader scenarios check failed: ${errors.join("; ")}`);
});

buildTest("public docs verification seam runs end-to-end and returns exit code 0", () => {
	const code = runVerification();
	assert.equal(code, 0, "runVerification must return exit code 0");
});
