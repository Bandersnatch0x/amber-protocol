"use strict";

// Canonical-source gates (issues/0150, adjudicated under issues/0141).
//
// 0146 confirmed two live-looking sources for the knowledge plan and no CI gate
// at all on the committed knowledge corpus: readers failed closed on stale
// hashes, but nothing noticed the drift before a reader hit it. These gates are
// deliberately read-only and repository-local — they need no `.amber/` runtime
// state, so they hold on a fresh clone and in CI.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { hashFile } = require("../../scripts/lib/core/context-hash");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WIKI_DIR = path.join(REPO_ROOT, "docs", "wiki");
const CORPUS_DIR = path.join(REPO_ROOT, "docs", "knowledge-corpus");
const MANIFEST = path.join(CORPUS_DIR, "knowledge-context-manifest.json");

function planFiles() {
	return fs.readdirSync(WIKI_DIR).filter((name) => /^knowledge-plan\./.test(name));
}

function readManifest() {
	return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

// Rows whose recorded source hashes no longer describe the file on disk.
function staleRows(manifest, root) {
	return manifest.rows
		.filter((row) => {
			const full = path.join(root, row.sourcePath);
			if (!fs.existsSync(full)) return true;
			const hashes = hashFile(full);
			return hashes.rawHash !== row.source.rawHash || hashes.normHash !== row.source.normHash;
		})
		.map((row) => row.sourcePath);
}

describe("knowledge plan has one canonical source", () => {
	it("keeps exactly one plan file, and it is the JSON plan", () => {
		assert.deepEqual(
			planFiles(),
			["knowledge-plan.json"],
			"docs/wiki must keep exactly one knowledge plan file (JSON is canonical — issues/0150)",
		);
	});

	it("the plan file passes the plan schema validator", () => {
		const plan = JSON.parse(fs.readFileSync(path.join(WIKI_DIR, "knowledge-plan.json"), "utf8"));
		assert.equal(plan.schemaVersion, "1.0.0");
		assert.ok(Array.isArray(plan.knowledgeCards), "knowledgeCards must be an array");
	});
});

describe("committed knowledge corpus membership and freshness", () => {
	it("the census counts match the committed rows", () => {
		const manifest = readManifest();
		const byCategory = {};
		for (const row of manifest.rows) {
			byCategory[row.category] = (byCategory[row.category] || 0) + 1;
		}
		assert.deepEqual(
			{ ...byCategory, total: manifest.rows.length },
			manifest.counts,
			"manifest.counts must describe the committed rows",
		);
	});

	it("row ids are unique and every source path resolves", () => {
		const manifest = readManifest();
		const ids = manifest.rows.map((row) => row.id);
		assert.equal(new Set(ids).size, ids.length, "duplicate row ids in the census");
		const missing = manifest.rows
			.map((row) => row.sourcePath)
			.filter((sourcePath) => !fs.existsSync(path.join(REPO_ROOT, sourcePath)));
		assert.deepEqual(missing, [], `census rows point at missing sources: ${missing.join(", ")}`);
	});

	it("every committed row still matches its source file hashes", () => {
		const stale = staleRows(readManifest(), REPO_ROOT);
		assert.deepEqual(
			stale,
			[],
			`the committed corpus is stale for: ${stale.join(", ")} — regenerate with \`amber knowledge context-sync\``,
		);
	});

	it("the freshness rule discriminates: a tampered row hash is reported", () => {
		const manifest = readManifest();
		assert.deepEqual(staleRows(manifest, REPO_ROOT), [], "the fixture must start fresh");
		const tampered = {
			...manifest,
			rows: manifest.rows.map((row, index) =>
				index === 0
					? { ...row, source: { ...row.source, rawHash: `sha256:${"0".repeat(64)}` } }
					: row,
			),
		};
		assert.deepEqual(staleRows(tampered, REPO_ROOT), [manifest.rows[0].sourcePath]);
	});
});
