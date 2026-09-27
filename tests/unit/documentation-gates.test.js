"use strict";

// Documentation-governance gates (issues/0149, adjudicated under issues/0141):
// the wiki validator is a real CI step, the inert drift step is gone, and
// product-repo doctor validates a wiki that exists.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { doctor } = require("../../scripts/lib/core/doctor");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CI_WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");

function tmpProductRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-doc-gate-"));
	// Product-repo signature: SPEC.md + ROADMAP.md + scripts/amber.js + templates/
	fs.writeFileSync(path.join(dir, "SPEC.md"), "# spec");
	fs.writeFileSync(path.join(dir, "ROADMAP.md"), "# roadmap");
	fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
	fs.writeFileSync(path.join(dir, "scripts", "amber.js"), "// cli");
	fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
	return dir;
}

describe("CI documentation gates", () => {
	it("runs the wiki validator as a real step", () => {
		const workflow = fs.readFileSync(CI_WORKFLOW, "utf8");
		assert.match(
			workflow,
			/node scripts\/validate-wiki\.js --target \./,
			"ci.yml must run `node scripts/validate-wiki.js --target .`",
		);
	});

	it("does not keep the inert amber drift step", () => {
		const workflow = fs.readFileSync(CI_WORKFLOW, "utf8");
		assert.doesNotMatch(
			workflow,
			/amber\.js drift --target/,
			"the drift step reports n/a for every dimension on a product-repo and was removed (issues/0149)",
		);
	});
});

describe("product-repo doctor wiki coverage", () => {
	it("validates docs/wiki when the wiki exists", () => {
		const dir = tmpProductRepo();
		const wikiRoot = path.join(dir, "docs", "wiki");
		fs.mkdirSync(wikiRoot, { recursive: true });
		fs.writeFileSync(path.join(wikiRoot, "index.md"), "# Index\n\nSee [missing](./nope.md).\n");

		const result = doctor(dir);
		assert.equal(result.classification.type, "product-repo");
		const check = result.productChecks.find((c) => c.name === "wiki-structure");
		assert.ok(check, "productChecks should include wiki-structure");
		assert.ok(check.errors > 0, "a broken internal wiki link must produce an error");
		assert.ok(
			result.errors.some((e) => /links to missing/.test(e)),
			`expected a broken-link error, got: ${result.errors.join("; ")}`,
		);
	});

	it("does not fail a product-repo that ships no wiki", () => {
		const dir = tmpProductRepo();
		const result = doctor(dir);
		assert.equal(result.classification.type, "product-repo");
		assert.equal(
			result.productChecks.find((c) => c.name === "wiki-structure"),
			undefined,
			"no docs/wiki means the check is skipped, not failed",
		);
		assert.equal(
			result.errors.filter((e) => /docs\/wiki/.test(e)).length,
			0,
			`unexpected wiki errors: ${result.errors.join("; ")}`,
		);
	});
});
