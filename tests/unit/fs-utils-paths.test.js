"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { toPortablePath, ensureDir } = require("../../scripts/lib/core/fs-utils.js");

test("toPortablePath normalizes backslashes and stringifies", () => {
	assert.equal(toPortablePath("a\\b\\c"), "a/b/c");
	assert.equal(toPortablePath("a/b"), "a/b");
	assert.equal(toPortablePath(123), "123");
});

test("ensureDir creates nested directories and is idempotent", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ensure-dir-"));
	try {
		const nested = path.join(root, "a", "b", "c");
		ensureDir(nested);
		assert.ok(fs.statSync(nested).isDirectory());
		ensureDir(nested);
		assert.ok(fs.statSync(nested).isDirectory());
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
