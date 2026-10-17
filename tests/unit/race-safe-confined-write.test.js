"use strict";

// Race-safe seam tests (0159). The seam opens the destination without truncating,
// checks nlink on the pinned fd, then writes through that same fd. To prove the
// check and the write share one inode, the TOCTOU test swaps the leaf for a hard
// link to an outside victim *inside* fs.openSync — after path resolution, before
// the nlink check. A path-based writer (stat then writeFileSync) would follow the
// swapped link and corrupt the victim; the pinned fd writes the inode it checked.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { writeFileWithinTarget, writeJson } = require("../../scripts/lib/core/fs-utils");

function tempDir(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-race-${label}-`));
}

test("seam writes normally through the pinned fd", () => {
	const target = tempDir("normal");
	try {
		const out = writeFileWithinTarget(target, "nested/out.txt", "payload\n", {
			label: "Race output",
		});
		assert.equal(fs.readFileSync(out, "utf8"), "payload\n");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("seam refuses a leaf already hard-linked outside the target", () => {
	const target = tempDir("planted");
	const outside = tempDir("planted-out");
	const victim = path.join(outside, "victim.txt");
	try {
		fs.writeFileSync(victim, "victim original\n", "utf8");
		fs.mkdirSync(path.join(target, "nested"), { recursive: true });
		fs.linkSync(victim, path.join(target, "nested", "out.txt"));

		assert.throws(
			() => writeFileWithinTarget(target, "nested/out.txt", "payload\n", { label: "Race output" }),
			/hard-linked to \d+ paths/,
		);
		assert.equal(fs.readFileSync(victim, "utf8"), "victim original\n");
		assert.equal(
			fs.readFileSync(path.join(target, "nested", "out.txt"), "utf8"),
			"victim original\n",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("a link swapped in between path check and write cannot redirect the bytes", () => {
	const target = tempDir("swap");
	const outside = tempDir("swap-out");
	const victim = path.join(outside, "victim.txt");
	const dest = path.join(target, "nested", "out.txt");
	fs.writeFileSync(victim, "victim original\n", "utf8");
	fs.mkdirSync(path.join(target, "nested"), { recursive: true });
	fs.writeFileSync(dest, "old target bytes\n", "utf8");

	const realOpenSync = fs.openSync;
	fs.openSync = function patchedOpenSync(file, flags, mode) {
		const fd = realOpenSync.call(fs, file, flags, mode);
		if (path.resolve(file) === dest) {
			// The hostile swap the seam promises to survive: the path now names the
			// outside victim's inode, but the returned fd pins the original inode.
			fs.unlinkSync(dest);
			fs.linkSync(victim, dest);
		}
		return fd;
	};
	try {
		writeFileWithinTarget(target, "nested/out.txt", "payload\n", { label: "Race output" });
		assert.equal(fs.readFileSync(victim, "utf8"), "victim original\n");
	} finally {
		fs.openSync = realOpenSync;
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("writeJson shares the pinned-fd write path", () => {
	const target = tempDir("json");
	const outside = tempDir("json-out");
	const victim = path.join(outside, "victim.json");
	try {
		fs.writeFileSync(victim, '{"outside":true}\n', "utf8");
		fs.mkdirSync(path.join(target, "nested"), { recursive: true });
		fs.linkSync(victim, path.join(target, "nested", "out.json"));

		assert.throws(
			() => writeJson(path.join(target, "nested", "out.json"), { written: true }),
			/hard-linked to \d+ paths/,
		);
		assert.equal(fs.readFileSync(victim, "utf8"), '{"outside":true}\n');
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});
