"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { addFeature } = require("../../scripts/lib/feature-commands");

function tmpDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-feat-"));
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({ features: [] }, null, 2) + "\n",
	);
	return dir;
}

test("addFeature stores paths array from comma-separated string", () => {
	const dir = tmpDir();
	const r = addFeature(dir, { id: "F10", title: "T", paths: "src/a,src/b" });
	assert.deepStrictEqual(r.feature.paths, ["src/a", "src/b"]);
});

test("addFeature omits paths when not provided", () => {
	const dir = tmpDir();
	const r = addFeature(dir, { id: "F11", title: "T" });
	assert.strictEqual("paths" in r.feature, false);
});
