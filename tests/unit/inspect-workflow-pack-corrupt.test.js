"use strict";

// Unit tests for the workflow-pack inspectors' corrupt-file hardening. readJson
// returns a literal `null`/scalar/array unchanged, so validateWorkflowPackData
// flags it but the later data.id / validateWorkflowPackReferences /
// inspectLoopReadiness reads would still throw on a non-object body. Both
// inspectors must surface the validation error instead — inspectWorkflowPack
// feeds doctor's product-repo smoke check, so a bad pack body must not crash it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	inspectWorkflowPack,
	inspectWorkflowPackReadiness,
} = require("../../scripts/lib/core/workflow-packs");

function tempPack(contents) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-corrupt-"));
	const filePath = path.join(dir, "x.pack.json");
	fs.writeFileSync(filePath, contents);
	return filePath;
}

test("inspectWorkflowPack reports an error instead of throwing on a JSON null body", () => {
	const result = inspectWorkflowPack(tempPack("null"));
	assert.ok(
		result.errors.some((e) => /must contain an object/.test(e)),
		`expected an object-shape error, got: ${JSON.stringify(result.errors)}`,
	);
});

test("inspectWorkflowPack reports an error instead of throwing on a JSON array body", () => {
	const result = inspectWorkflowPack(tempPack("[]"));
	assert.ok(result.errors.length > 0);
});

test("inspectWorkflowPackReadiness reports an error instead of throwing on a JSON null body", () => {
	const result = inspectWorkflowPackReadiness(tempPack("null"));
	assert.ok(
		result.errors.some((e) => /must contain an object/.test(e)),
		`expected an object-shape error, got: ${JSON.stringify(result.errors)}`,
	);
});
