"use strict";

// issues/0347: the identity gate is only as good as the machine that runs it. These
// cases guard the wiring step itself - the drift report, the never-overwrite rule for a
// foreign core.hooksPath, and the fact that `npm install` cannot break on it.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { HOOKS_DIR, ensureDevHooks, main } = require("../../scripts/ensure-dev-hooks");

const ENSURE_DEV_HOOKS_MODULE = require.resolve("../../scripts/ensure-dev-hooks");
const REPO_ROOT = path.join(__dirname, "..", "..");

function shGit(args, cwd) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return String(result.stdout).trim();
}

function gitAvailable() {
	return spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
}

function makeRepo(options = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-dev-hooks-"));
	if (options.repo !== false) {
		shGit(["init", "-q", "-b", "master"], dir);
		if (options.hooks !== false) {
			fs.mkdirSync(path.join(dir, HOOKS_DIR), { recursive: true });
			fs.writeFileSync(path.join(dir, HOOKS_DIR, "pre-commit"), "#!/bin/sh\nexit 0\n");
		}
		if (options.hooksPath) shGit(["config", "--local", "core.hooksPath", options.hooksPath], dir);
	}
	return dir;
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch (error) {
		void error;
	}
}

function skipWithoutGit(t) {
	if (!gitAvailable()) t.skip("git unavailable");
	return !gitAvailable();
}

test("reports an unset core.hooksPath as drift", (t) => {
	if (skipWithoutGit(t)) return;
	const dir = makeRepo();
	try {
		const report = ensureDevHooks({ apply: false, repoRoot: dir });
		assert.equal(report.skipped, false);
		assert.equal(report.configured, null);
		assert.equal(report.problems.length, 1);
		assert.match(report.problems[0], /core.hooksPath is unset/);
		assert.match(report.problems[0], /npm run dev:hooks:install/);
	} finally {
		cleanup(dir);
	}
});

test("apply wires the hooks path and a second run is clean", (t) => {
	if (skipWithoutGit(t)) return;
	const dir = makeRepo();
	try {
		const first = ensureDevHooks({ apply: true, repoRoot: dir });
		assert.equal(first.changed, true);
		assert.equal(first.problems.length, 0);
		assert.equal(shGit(["config", "--local", "--get", "core.hooksPath"], dir), HOOKS_DIR);

		const second = ensureDevHooks({ apply: true, repoRoot: dir });
		assert.equal(second.changed, false);
		assert.equal(second.problems.length, 0);
		assert.equal(second.configured, HOOKS_DIR);
	} finally {
		cleanup(dir);
	}
});

test("a foreign hooks path is reported, never overwritten", (t) => {
	if (skipWithoutGit(t)) return;
	const dir = makeRepo({ hooksPath: ".husky" });
	try {
		const report = ensureDevHooks({ apply: true, repoRoot: dir });
		assert.equal(report.changed, false);
		assert.equal(report.problems.length, 1);
		assert.match(report.problems[0], /core\.hooksPath is "\.husky"/);
		// A setting made by the user or another tool survives an apply.
		assert.equal(shGit(["config", "--local", "--get", "core.hooksPath"], dir), ".husky");
	} finally {
		cleanup(dir);
	}
});

test("apply preserves an effective global hooks path", (t) => {
	if (skipWithoutGit(t)) return;
	const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-dev-hooks-global-"));
	const originalGlobal = process.env.GIT_CONFIG_GLOBAL;
	const originalNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
	process.env.GIT_CONFIG_GLOBAL = path.join(globalDir, "config");
	process.env.GIT_CONFIG_NOSYSTEM = "1";
	let dir;
	try {
		dir = makeRepo();
		shGit(["config", "--global", "core.hooksPath", "foreign hooks"], dir);
		const report = ensureDevHooks({ apply: true, repoRoot: dir });
		assert.equal(report.changed, false);
		assert.equal(report.configured, "foreign hooks");
		assert.equal(report.scope, "global");
		assert.match(report.problems[0], /core\.hooksPath is "foreign hooks" at global scope/);
		assert.equal(shGit(["config", "--get", "core.hooksPath"], dir), "foreign hooks");
		assert.equal(
			spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: dir }).status,
			1,
		);
	} finally {
		if (originalGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = originalGlobal;
		if (originalNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
		else process.env.GIT_CONFIG_NOSYSTEM = originalNoSystem;
		if (dir) cleanup(dir);
		cleanup(globalDir);
	}
});

test("apply preserves an effective system hooks path", (t) => {
	if (skipWithoutGit(t)) return;
	const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-dev-hooks-system-"));
	const originalSystem = process.env.GIT_CONFIG_SYSTEM;
	const originalGlobal = process.env.GIT_CONFIG_GLOBAL;
	const originalNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
	process.env.GIT_CONFIG_SYSTEM = path.join(configDir, "system-config");
	process.env.GIT_CONFIG_GLOBAL = path.join(configDir, "global-config");
	delete process.env.GIT_CONFIG_NOSYSTEM;
	let dir;
	try {
		dir = makeRepo();
		shGit(["config", "--system", "core.hooksPath", "foreign-system-hooks"], dir);
		const report = ensureDevHooks({ apply: true, repoRoot: dir });
		assert.equal(report.changed, false);
		assert.equal(report.configured, "foreign-system-hooks");
		assert.equal(report.scope, "system");
		assert.match(report.problems[0], /core\.hooksPath is "foreign-system-hooks" at system scope/);
		assert.equal(shGit(["config", "--get", "core.hooksPath"], dir), "foreign-system-hooks");
		assert.equal(
			spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: dir }).status,
			1,
		);
	} finally {
		if (originalSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
		else process.env.GIT_CONFIG_SYSTEM = originalSystem;
		if (originalGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = originalGlobal;
		if (originalNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
		else process.env.GIT_CONFIG_NOSYSTEM = originalNoSystem;
		if (dir) cleanup(dir);
		cleanup(configDir);
	}
});

test("apply refuses to write when git cannot read the effective hooks path", (t) => {
	if (skipWithoutGit(t)) return;
	const dir = makeRepo();
	const cachedModule = require.cache[ENSURE_DEV_HOOKS_MODULE];
	const originalSpawnSync = childProcess.spawnSync;
	try {
		childProcess.spawnSync = (command, args, options) => {
			if (command === "git" && args[0] === "config" && args.includes("--show-scope")) {
				return { status: 128, stdout: "", stderr: "fatal: bad config" };
			}
			return originalSpawnSync(command, args, options);
		};
		delete require.cache[ENSURE_DEV_HOOKS_MODULE];
		const isolated = require(ENSURE_DEV_HOOKS_MODULE);
		const report = isolated.ensureDevHooks({ apply: true, repoRoot: dir });
		assert.equal(report.changed, false);
		assert.deepEqual(report.problems, ["unable to read core.hooksPath: fatal: bad config"]);
		assert.equal(
			spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: dir }).status,
			1,
		);
	} finally {
		childProcess.spawnSync = originalSpawnSync;
		delete require.cache[ENSURE_DEV_HOOKS_MODULE];
		if (cachedModule) require.cache[ENSURE_DEV_HOOKS_MODULE] = cachedModule;
		cleanup(dir);
	}
});

test("outside a checkout the step skips instead of failing", (t) => {
	if (skipWithoutGit(t)) return;
	const plain = makeRepo({ repo: false });
	const noHooksDir = makeRepo({ hooks: false });
	try {
		for (const dir of [plain, noHooksDir]) {
			const report = ensureDevHooks({ apply: true, repoRoot: dir });
			assert.equal(report.skipped, true);
			assert.equal(report.problems.length, 0);
			// npm install runs this through prepare: exit 0, never break the install.
			assert.equal(main([], dir), 0);
		}
	} finally {
		cleanup(plain);
		cleanup(noHooksDir);
	}
});

test("--check fails on drift and passes once wired", (t) => {
	if (skipWithoutGit(t)) return;
	const dir = makeRepo();
	try {
		assert.equal(main(["--check"], dir), 1); // drift is a failing gate
		assert.equal(main([], dir), 0); // prepare path wires it and never fails
		assert.equal(main(["--check"], dir), 0);
		shGit(["config", "--local", "core.hooksPath", ".husky"], dir);
		assert.equal(main(["--check"], dir), 1); // a foreign owner fails the gate
		assert.equal(main([], dir), 0); // but must not break npm install
	} finally {
		cleanup(dir);
	}
});

test("rejects an unknown argument", () => {
	assert.equal(main(["--apply-please"]), 2);
});

test("package.json wires the step into install and exposes a check", () => {
	const pkg = require("../../package.json");
	// `prepare` is what makes a fresh `npm install` self-wire the identity gate.
	assert.match(pkg.scripts.prepare, /ensure-dev-hooks\.js/);
	assert.equal(pkg.scripts["dev:hooks:check"], "node scripts/ensure-dev-hooks.js --check");
	assert.equal(pkg.scripts["dev:hooks:install"], "git config --local core.hooksPath .githooks");
});

test("the repo pre-commit hook still runs the identity check", () => {
	const hook = fs.readFileSync(path.join(REPO_ROOT, HOOKS_DIR, "pre-commit"), "utf8");
	assert.match(hook, /validate-git-identity\.js/);
	assert.match(hook, /\|\| exit 1/);
});

test("hooks are executable in the index so POSIX clones run them", (t) => {
	if (skipWithoutGit(t)) return;
	const listed = shGit(["ls-files", "-s", HOOKS_DIR], REPO_ROOT);
	const modes = listed
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => line.split(" ")[0]);
	assert.ok(modes.length > 0);
	// git silently skips a 100644 hook on Linux/macOS: the gate would look installed
	// and never fire, which is the exact failure mode issues/0347 is about.
	assert.deepEqual(
		modes.filter((mode) => mode !== "100755"),
		[],
	);
});
