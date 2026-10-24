"use strict";

// issues/0196 - the default wiki scaffold used to copy the whole template
// directory, which included knowledge-plan.yaml. That seeded a second plan
// file the JSON (first in load order) silently shadowed, contradicting the
// "JSON is canonical" decision recorded for docs/wiki/knowledge-plan.json.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { trackTempDir } = require("../helpers/harness");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { scaffoldWiki } = require("../../scripts/lib/core/scaffold");
const knowledgePlan = require("../../scripts/lib/knowledge-plan");

function mkTarget(label) {
	return trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), `amber-wiki-yaml-${label}-`)));
}

test("the default wiki scaffold seeds the JSON plan but not the yaml alternate", () => {
	const dir = mkTarget("default");
	const result = scaffoldWiki(dir, {});
	assert.equal(result.errors.length, 0, result.errors.join("; "));

	const wiki = path.join(dir, "docs", "wiki");
	assert.equal(fs.existsSync(path.join(wiki, "knowledge-plan.json")), true);
	assert.equal(
		fs.existsSync(path.join(wiki, "knowledge-plan.yaml")),
		false,
		"the yaml alternate must not ride along with the default skeleton",
	);
});

test("`knowledge scaffold --yaml` remains the only entry point that emits the yaml", () => {
	const dir = mkTarget("yaml");
	const result = knowledgePlan.scaffold(dir, { yaml: true });
	assert.equal(result.errors.length, 0, result.errors.join("; "));

	const wiki = path.join(dir, "docs", "wiki");
	assert.equal(fs.existsSync(path.join(wiki, "knowledge-plan.yaml")), true);
	assert.equal(
		fs.existsSync(path.join(wiki, "knowledge-plan.json")),
		false,
		"--yaml selects the alternate format, it does not add to the default",
	);
});
