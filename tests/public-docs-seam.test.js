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

test("public docs verification seam: 1. Build and Page Count Gate", () => {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
	const errors = verifyBuildAndPageCount(manifest);
	assert.deepEqual(errors, [], `Build and page count check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 2. Reference Drift Gate", () => {
	const errors = verifyReferenceDrift();
	assert.deepEqual(errors, [], `CLI reference drift check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 3. C-Layer Deny Gate", () => {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
	const errors = verifyCLayerDeny(manifest);
	assert.deepEqual(errors, [], `C-layer deny check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 4. Content Safety / Secrets & Absolute Paths Gate", () => {
	const errors = verifyContentSafety();
	assert.deepEqual(errors, [], `Content safety check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 5. Internal Links & Anchors Gate", () => {
	const errors = verifyLinksAndAnchors();
	assert.deepEqual(errors, [], `Link & anchor check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 6. Search Index Gate", () => {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
	const errors = verifySearchIndex(manifest);
	assert.deepEqual(errors, [], `Search index check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 7. Accessibility Floor & Responsive Gate", () => {
	const errors = verifyAccessibilityAndResponsive();
	assert.deepEqual(errors, [], `Accessibility & responsive check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 8. SEO Baseline Gate", () => {
	const errors = verifySeoBaseline();
	assert.deepEqual(errors, [], `SEO baseline check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 9. Edit Links Gate", () => {
	const errors = verifyEditLinks();
	assert.deepEqual(errors, [], `Edit links check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 10. Zero Telemetry Gate", () => {
	const errors = verifyZeroTelemetry();
	assert.deepEqual(errors, [], `Zero telemetry check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 11. Version & Support Matrix Gate", () => {
	const errors = verifyVersionSync();
	assert.deepEqual(errors, [], `Version sync check failed: ${errors.join("; ")}`);
});

test("public docs verification seam: 12. Replayable Reader Result Scenarios", () => {
	const errors = verifyReaderScenarios();
	assert.deepEqual(errors, [], `Reader scenarios check failed: ${errors.join("; ")}`);
});

test("public docs verification seam runs end-to-end and returns exit code 0", () => {
	const code = runVerification();
	assert.equal(code, 0, "runVerification must return exit code 0");
});
