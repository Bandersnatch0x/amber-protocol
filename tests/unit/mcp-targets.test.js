"use strict";

// Unit coverage for the configured-repository module (scripts/lib/mcp-targets.js).
// Exercises the configured-repository invariant from F018 Slice 2:
//   * --target / --targets are canonicalized once at startup; missing, dup,
//     and non-directory entries are rejected.
//   * _target resolves only to an exact configured member (by real path).
//   * descendant reads reject .., absolute, symlink, and junction escape.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const test = require("node:test");

const {
	canonicalizeDirectory,
	buildConfiguredTargets,
	isDescendant,
	resolveConfiguredRepoPath,
	resolveRepoPath,
	resolveTargetOverride,
} = require("../../scripts/lib/mcp-targets");

function makeTempRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-targets-"));
	return dir;
}

test("canonicalizeDirectory resolves a real directory and rejects files", () => {
	const dir = makeTempRepo();
	const real = canonicalizeDirectory(dir);
	assert.equal(real, fs.realpathSync(dir));

	const file = path.join(dir, "f.txt");
	fs.writeFileSync(file, "x");
	assert.throws(() => canonicalizeDirectory(file), /not a directory/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("canonicalizeDirectory rejects missing entries fail-closed", () => {
	assert.throws(
		() => canonicalizeDirectory(path.join(os.tmpdir(), "amber-no-such-xyz-9999")),
		/not an existing directory/,
	);
});

test("buildConfiguredTargets canonicalizes primary + extras and dedups by real path", () => {
	const a = makeTempRepo();
	const b = makeTempRepo();
	const { primary, targets, index } = buildConfiguredTargets({ primary: a, extras: [b] });
	assert.equal(primary, fs.realpathSync(a));
	assert.equal(targets.length, 2);
	assert.ok(index.has(fs.realpathSync(a)));
	assert.ok(index.has(fs.realpathSync(b)));

	// A symlink/alias to an already-configured repo is a duplicate real path.
	const alias = path.join(a, "self-link");
	try {
		fs.symlinkSync(a, alias, "junction");
		assert.throws(
			() => buildConfiguredTargets({ primary: a, extras: [alias] }),
			/duplicate configured target/,
		);
	} catch (err) {
		if (!/EPERM|ENOSYS|existing/i.test(err.message)) throw err;
	}
	fs.rmSync(a, { recursive: true, force: true });
	fs.rmSync(b, { recursive: true, force: true });
});

test("buildConfiguredTargets rejects missing primary and bad extras", () => {
	assert.throws(() => buildConfiguredTargets({ primary: null }), /primary --target/);
	const a = makeTempRepo();
	assert.throws(
		() =>
			buildConfiguredTargets({ primary: a, extras: [path.join(os.tmpdir(), "amber-nope-9999")] }),
		/not an existing directory/,
	);
	fs.rmSync(a, { recursive: true, force: true });
});

test("isDescendant handles nested, sibling, and trailing-sep cases", () => {
	const root = path.resolve("/repo");
	assert.ok(isDescendant(path.resolve("/repo/a/b"), root));
	assert.ok(isDescendant(root, root));
	assert.ok(!isDescendant(path.resolve("/repo-evil"), root));
	assert.ok(!isDescendant(path.resolve("/other/repo"), root));
});

test("resolveRepoPath rejects absolute and .. escape", () => {
	const root = makeTempRepo();
	assert.throws(() => resolveRepoPath(root, path.resolve(root, "outside")), /absolute path/);
	assert.throws(() => resolveRepoPath(root, "../../etc/passwd"), /escapes repository root/);
	// A legitimate nested file resolves under the root.
	fs.mkdirSync(path.join(root, "sub"), { recursive: true });
	fs.writeFileSync(path.join(root, "sub", "f.txt"), "x");
	const ok = resolveRepoPath(root, "sub/f.txt");
	assert.ok(ok.startsWith(fs.realpathSync(root)));
	fs.rmSync(root, { recursive: true, force: true });
});

test("resolveRepoPath rejects symlink escape to outside the root", () => {
	const root = makeTempRepo();
	const outside = makeTempRepo();
	fs.writeFileSync(path.join(outside, "secret.txt"), "topsecret");
	let linkErr = null;
	try {
		fs.symlinkSync(outside, path.join(root, "escape"), "junction");
	} catch (err) {
		linkErr = err;
	}
	if (linkErr) {
		if (!/EPERM|ENOSYS|existing/i.test(linkErr.message)) throw linkErr;
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
		return; // symlinks not available on this CI user — skip the escape probe
	}
	// A nested path that crosses the symlink out of the root must be rejected.
	assert.throws(
		() => resolveRepoPath(root, "escape/secret.txt"),
		/escapes repository root via link/,
	);
	fs.rmSync(root, { recursive: true, force: true });
	fs.rmSync(outside, { recursive: true, force: true });
});

test("resolveRepoPath rejects a missing descendant beneath an escaping link", () => {
	const root = makeTempRepo();
	const outside = makeTempRepo();
	try {
		fs.symlinkSync(outside, path.join(root, "escape"), "junction");
	} catch (err) {
		if (/EPERM|ENOSYS|existing/i.test(err.message)) return;
		throw err;
	}
	assert.throws(
		() => resolveRepoPath(root, "escape/not-created-yet.json"),
		/escapes repository root via link/,
	);
	fs.rmSync(root, { recursive: true, force: true });
	fs.rmSync(outside, { recursive: true, force: true });
});

test("resolveConfiguredRepoPath accepts only configured repository bases", () => {
	const primary = makeTempRepo();
	const extra = makeTempRepo();
	const unconfigured = makeTempRepo();
	fs.mkdirSync(path.join(extra, "sub"));
	const configured = buildConfiguredTargets({ primary, extras: [extra] });

	assert.equal(
		resolveConfiguredRepoPath({ configured, target: extra, relativePath: "sub" }),
		path.join(fs.realpathSync(extra), "sub"),
	);
	assert.throws(
		() => resolveConfiguredRepoPath({ configured, target: unconfigured, relativePath: "anything" }),
		/not a configured repository/,
	);

	fs.rmSync(primary, { recursive: true, force: true });
	fs.rmSync(extra, { recursive: true, force: true });
	fs.rmSync(unconfigured, { recursive: true, force: true });
});

test("resolveTargetOverride: undefined override yields null (use primary)", () => {
	const a = makeTempRepo();
	const configured = buildConfiguredTargets({ primary: a });
	assert.equal(resolveTargetOverride({ override: undefined, configured, cwd: os.tmpdir() }), null);
	fs.rmSync(a, { recursive: true, force: true });
});

test("resolveTargetOverride: configured member resolves to its canonical path", () => {
	const a = makeTempRepo();
	const b = makeTempRepo();
	const configured = buildConfiguredTargets({ primary: a, extras: [b] });
	const resolved = resolveTargetOverride({ override: b, configured, cwd: os.tmpdir() });
	assert.equal(resolved, fs.realpathSync(b));
	fs.rmSync(a, { recursive: true, force: true });
	fs.rmSync(b, { recursive: true, force: true });
});

test("resolveTargetOverride: existing directory NOT in the configured set is rejected (-32602 contract)", () => {
	const a = makeTempRepo();
	const b = makeTempRepo(); // exists, but not configured
	const configured = buildConfiguredTargets({ primary: a });
	assert.throws(
		() => resolveTargetOverride({ override: b, configured, cwd: os.tmpdir() }),
		/not a configured repository/,
	);
	fs.rmSync(a, { recursive: true, force: true });
	fs.rmSync(b, { recursive: true, force: true });
});

test("resolveTargetOverride: missing directory is rejected", () => {
	const a = makeTempRepo();
	const configured = buildConfiguredTargets({ primary: a });
	assert.throws(
		() =>
			resolveTargetOverride({ override: "definitely-missing-dir", configured, cwd: os.tmpdir() }),
		/does not exist|not a directory/,
	);
	fs.rmSync(a, { recursive: true, force: true });
});
