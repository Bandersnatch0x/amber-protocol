"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
	resolveStateDirForRead,
	resolveStateDirForCreate,
	CANONICAL_STATE_DIR,
	LEGACY_STATE_DIR,
} = require("../../scripts/lib/state-dir-resolver");

function tmpRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-resolver-"));
}

test("no state exists: both read and create resolve to .amber", () => {
	const root = tmpRoot();
	assert.equal(resolveStateDirForRead(root, { quiet: true }), path.join(root, ".amber"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("only .amber exists: read and create resolve to .amber", () => {
	const root = tmpRoot();
	fs.mkdirSync(path.join(root, ".amber"));
	assert.equal(resolveStateDirForRead(root, { quiet: true }), path.join(root, ".amber"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("only .harness exists: read resolves legacy, create resolves .amber", () => {
	const root = tmpRoot();
	fs.mkdirSync(path.join(root, ".harness"));
	assert.equal(resolveStateDirForRead(root, { quiet: true }), path.join(root, ".harness"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("both exist: .amber wins for read and create", () => {
	const root = tmpRoot();
	fs.mkdirSync(path.join(root, ".amber"));
	fs.mkdirSync(path.join(root, ".harness"));
	assert.equal(resolveStateDirForRead(root, { quiet: true }), path.join(root, ".amber"));
	assert.equal(resolveStateDirForCreate(root), path.join(root, ".amber"));
});

test("exports canonical and legacy dir names", () => {
	assert.equal(CANONICAL_STATE_DIR, ".amber");
	assert.equal(LEGACY_STATE_DIR, ".harness");
});
