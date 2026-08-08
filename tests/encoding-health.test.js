"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { trackedFiles } = require("../scripts/validate-encoding.js");

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "validate-encoding.js");

test("encoding validator exists and accepts tracked UTF-8 text", () => {
	assert.equal(fs.existsSync(SCRIPT), true);

	const result = spawnSync(process.execPath, [SCRIPT], {
		cwd: ROOT,
		encoding: "utf8",
	});

	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.match(result.stdout, /Encoding check passed/);
});

test("encoding validator ignores tracked files deleted from the working tree", (t) => {
	const repo = fs.mkdtempSync(path.join(os.tmpdir(), "amber-encoding-"));
	t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
	fs.writeFileSync(path.join(repo, "existing.md"), "valid UTF-8\n");
	fs.writeFileSync(path.join(repo, "deleted.md"), "removed\n");

	const init = spawnSync("git", ["init", "--quiet"], { cwd: repo, encoding: "utf8" });
	assert.equal(init.status, 0, init.stderr);
	const add = spawnSync("git", ["add", "existing.md", "deleted.md"], {
		cwd: repo,
		encoding: "utf8",
	});
	assert.equal(add.status, 0, add.stderr);
	fs.unlinkSync(path.join(repo, "deleted.md"));

	assert.deepEqual(trackedFiles(repo), ["existing.md"]);
});
