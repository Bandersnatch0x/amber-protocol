"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { checkGovernance } = require("../../scripts/lib/hooks-command");

const {
	installHook,
	uninstallHook,
	statusHook,
	HOOK_MARKER,
	shDquote,
	printBreadcrumb,
	installBreadcrumb,
	uninstallBreadcrumb,
	statusBreadcrumb,
} = require("../../scripts/lib/hooks-command");

function tmpGitRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-gh-"));
	fs.mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
	return dir;
}

function tmpRepo(featureList) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-hooks-"));
	if (featureList) {
		fs.writeFileSync(path.join(dir, "feature_list.json"), JSON.stringify(featureList));
	}
	return dir;
}

test("C1: a 'passing' feature with no evidence is blocked with its code", () => {
	const dir = tmpRepo({ features: [{ id: "F1", status: "passing", evidence: [] }] });
	const r = checkGovernance(dir, {});
	assert.equal(r.errors.length > 0, true);
	assert.ok(r.errors.join("\n").includes("AMBER_E_FEATURE_NO_EVIDENCE"));
	assert.ok(r.errors.join("\n").includes("AMBER_E_HOOK_PRECOMMIT_BLOCKED"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("C1: a 'passing' feature WITH evidence passes clean", () => {
	const dir = tmpRepo({
		features: [
			{
				id: "F1",
				status: "passing",
				evidence: [{ date: "2026-06-27", command: "npm test", result: "ok" }],
			},
		],
	});
	const r = checkGovernance(dir, {});
	assert.deepEqual(r.errors, []);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("not_started features and missing feature_list are clean", () => {
	const a = tmpRepo({ features: [{ id: "F1", status: "not_started", evidence: [] }] });
	assert.deepEqual(checkGovernance(a, {}).errors, []);
	const b = tmpRepo(null);
	assert.deepEqual(checkGovernance(b, {}).errors, []);
	fs.rmSync(a, { recursive: true, force: true });
	fs.rmSync(b, { recursive: true, force: true });
});

test("--warn-only downgrades errors to warnings (exit clean)", () => {
	const dir = tmpRepo({ features: [{ id: "F1", status: "accepted", evidence: [] }] });
	const r = checkGovernance(dir, { warnOnly: true });
	assert.deepEqual(r.errors, []);
	assert.ok(r.warnings.length > 0);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a literal-null feature_list does not crash", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-hooks-"));
	fs.writeFileSync(path.join(dir, "feature_list.json"), "null");
	assert.deepEqual(checkGovernance(dir, {}).errors, []);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("install writes a marked pre-commit shim with LF + forward-slash node path", () => {
	const dir = tmpGitRepo();
	const r = installHook(dir, {});
	assert.deepEqual(r.errors, []);
	const hook = path.join(dir, ".git", "hooks", "pre-commit");
	const body = fs.readFileSync(hook, "utf8");
	assert.ok(body.startsWith("#!/bin/sh"));
	assert.ok(body.includes(HOOK_MARKER));
	assert.ok(body.includes("hooks check"));
	assert.ok(!body.includes("\\"), "no backslashes in the shim path");
	assert.ok(!body.includes("\r"), "LF endings only");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("shim skips (does not block) when node or the amber entry is absent", () => {
	const dir = tmpGitRepo();
	installHook(dir, {});
	const body = fs.readFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "utf8");
	assert.ok(body.includes("command -v node"), "guards missing node");
	assert.ok(
		/\[ -f ".*" \] \|\| \{ echo "amber hooks: amber not found/.test(body),
		"guards missing entry",
	);
	assert.ok(body.includes("AMBER_SKIP_HOOKS"), "honours the skip env var");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("install --warn-only bakes the literal flag into the shim", () => {
	const dir = tmpGitRepo();
	installHook(dir, { warnOnly: true });
	const body = fs.readFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "utf8");
	assert.ok(body.includes("--warn-only"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("install is idempotent on its own managed hook", () => {
	const dir = tmpGitRepo();
	installHook(dir, {});
	const r = installHook(dir, {});
	assert.deepEqual(r.errors, []);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("install refuses to clobber a foreign hook and backs it up", () => {
	const dir = tmpGitRepo();
	const hook = path.join(dir, ".git", "hooks", "pre-commit");
	fs.writeFileSync(hook, "#!/bin/sh\necho mine\n");
	const r = installHook(dir, {});
	assert.equal(r.errors.length, 0);
	assert.ok(fs.existsSync(hook + ".amber-backup"), "foreign hook backed up");
	assert.ok(fs.readFileSync(hook, "utf8").includes(HOOK_MARKER), "now amber-managed");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("status reports installed / not-installed", () => {
	const dir = tmpGitRepo();
	assert.ok(statusHook(dir).text.toLowerCase().includes("not installed"));
	installHook(dir, {});
	assert.ok(statusHook(dir).text.toLowerCase().includes("installed"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("uninstall removes only an amber-managed hook and restores a backup", () => {
	const dir = tmpGitRepo();
	const hook = path.join(dir, ".git", "hooks", "pre-commit");
	fs.writeFileSync(hook, "#!/bin/sh\necho mine\n");
	installHook(dir, {});
	const r = uninstallHook(dir, {});
	assert.deepEqual(r.errors, []);
	assert.ok(fs.readFileSync(hook, "utf8").includes("echo mine"), "foreign hook restored");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("install errors clearly when there is no .git dir", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-nogit-"));
	const r = installHook(dir, {});
	assert.ok(r.errors.length > 0);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("shDquote escapes characters dangerous inside a double-quoted sh literal", () => {
	assert.equal(shDquote("/home/user/repo"), "/home/user/repo");
	assert.equal(shDquote('a"b'), 'a\\"b');
	assert.equal(shDquote("a$b"), "a\\$b");
	assert.equal(shDquote("a`b"), "a\\`b");
	assert.equal(shDquote("a\\b"), "a\\\\b");
});

// ── breadcrumb (F022) ────────────────────────────────────────────────────────

const CRUMB_SESSION_ID = "aaaabbbb-cccc-dddd-eeee-ffff00001111";

// Minimal repo whose lifecycle focus resolves to an active session: a manifest
// plus one timeline event (enough for buildContext; no routes dir needed).
function breadcrumbSessionRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-"));
	const sessionDir = path.join(dir, ".amber", "sessions", CRUMB_SESSION_ID);
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(
		path.join(sessionDir, "manifest.json"),
		JSON.stringify({
			sessionId: CRUMB_SESSION_ID,
			route: { id: "feature-standard" },
			goal: "wire the breadcrumb",
			status: "executing",
			completedStages: ["capture"],
		}),
	);
	fs.writeFileSync(
		path.join(sessionDir, "timeline.jsonl"),
		`${JSON.stringify({ type: "session_created", timestamp: "2026-08-15T00:00:00.000Z" })}\n`,
	);
	return dir;
}

test("breadcrumb: text print on an active session renders focus, next step, and run line", () => {
	const dir = breadcrumbSessionRepo();
	const r = printBreadcrumb(dir, { format: "text" });
	assert.deepEqual(r.errors, []);
	assert.deepEqual(r.warnings, []);
	assert.ok(r.text.includes("<amber-workflow-state>"));
	assert.ok(r.text.includes("</amber-workflow-state>"));
	assert.match(r.text, /Focus: session aaaabbbb/);
	assert.match(r.text, /Next step: /);
	assert.match(r.text, /Run: amber /);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: AMBER_SKIP_HOOKS=1 silences print with no errors (bypass parity)", () => {
	const dir = breadcrumbSessionRepo();
	const prior = process.env.AMBER_SKIP_HOOKS;
	process.env.AMBER_SKIP_HOOKS = "1";
	try {
		const r = printBreadcrumb(dir, { format: "text" });
		assert.equal(r.text, "");
		assert.deepEqual(r.errors, []);
		assert.deepEqual(r.warnings, []);
	} finally {
		if (prior === undefined) delete process.env.AMBER_SKIP_HOOKS;
		else process.env.AMBER_SKIP_HOOKS = prior;
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: unreadable state degrades visibly instead of erroring", () => {
	// docs/plans as a FILE makes gatherPlans readdir a non-directory (ENOTDIR),
	// so buildContext throws and print must render the degraded block.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-deg-"));
	fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "plans"), "not a directory");
	const r = printBreadcrumb(dir, { format: "text" });
	assert.deepEqual(r.errors, [], "a context hook must not block the turn");
	assert.ok(r.text.includes("<amber-workflow-state>"));
	assert.match(r.text, /degraded/);
	assert.match(r.text, /Hint: run amber next/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: an invalid format is the one argument error", () => {
	const dir = breadcrumbSessionRepo();
	const r = printBreadcrumb(dir, { format: "xml" });
	assert.ok(r.errors.length > 0);
	assert.equal(r.text, "");
	fs.rmSync(dir, { recursive: true, force: true });
});

function claudeSettings(dir) {
	return path.join(dir, ".claude", "settings.json");
}

const FOREIGN_SETTINGS = {
	permissions: { allow: ["Bash(npm test)"] },
	hooks: {
		UserPromptSubmit: [{ type: "command", command: "echo foreign-context" }],
		PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
	},
};

test("breadcrumb: install/uninstall/status round-trip preserves foreign settings", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-rt-"));
	fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
	fs.writeFileSync(claudeSettings(dir), JSON.stringify(FOREIGN_SETTINGS, null, 2) + "\n");

	// Install: append exactly one marker-carrying entry, foreign content intact.
	const ins = installBreadcrumb(dir);
	assert.deepEqual(ins.errors, []);
	let settings = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	assert.deepEqual(settings.permissions, FOREIGN_SETTINGS.permissions);
	assert.deepEqual(settings.hooks.PreToolUse, FOREIGN_SETTINGS.hooks.PreToolUse);
	assert.equal(settings.hooks.UserPromptSubmit.length, 2);
	assert.deepEqual(settings.hooks.UserPromptSubmit[0], FOREIGN_SETTINGS.hooks.UserPromptSubmit[0]);
	const managed = settings.hooks.UserPromptSubmit[1];
	// Claude Code loads only the {matcher, hooks:[{type,command}]} shape.
	assert.equal(managed.matcher, "");
	assert.ok(Array.isArray(managed.hooks), "managed entry wraps actions in a hooks array");
	assert.equal(managed.hooks.length, 1);
	assert.equal(managed.hooks[0].type, "command");
	assert.ok(managed.hooks[0].command.includes(HOOK_MARKER), "managed entry carries the marker");
	assert.ok(managed.hooks[0].command.includes("hooks breadcrumb print"));

	// Second install is idempotent: still exactly one managed entry.
	const again = installBreadcrumb(dir);
	assert.deepEqual(again.errors, []);
	assert.match(again.text, /already installed/);
	settings = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	assert.equal(settings.hooks.UserPromptSubmit.length, 2);

	// Status reports installed and echoes the command.
	const st = statusBreadcrumb(dir);
	assert.deepEqual(st.errors, []);
	assert.match(st.text, /installed/);
	assert.match(st.text, /hooks breadcrumb print/);

	// Uninstall removes only the marker entry: foreign content deep-equal intact.
	const un = uninstallBreadcrumb(dir);
	assert.deepEqual(un.errors, []);
	settings = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	assert.deepEqual(settings, FOREIGN_SETTINGS);
	const after = statusBreadcrumb(dir);
	assert.deepEqual(after.errors, []);
	assert.match(after.text, /not installed/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: install on missing .claude creates it; uninstall round-trips back to {}", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-new-"));
	const ins = installBreadcrumb(dir);
	assert.deepEqual(ins.errors, []);
	const settings = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	assert.equal(settings.hooks.UserPromptSubmit.length, 1);
	assert.ok(Array.isArray(settings.hooks.UserPromptSubmit[0].hooks));
	assert.ok(settings.hooks.UserPromptSubmit[0].hooks[0].command.includes(HOOK_MARKER));
	const un = uninstallBreadcrumb(dir);
	assert.deepEqual(un.errors, []);
	const after = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	assert.deepEqual(after, {});
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: corrupt settings.json fails closed and untouched; status warns", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-corrupt-"));
	fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
	const raw = "{ this is not json";
	fs.writeFileSync(claudeSettings(dir), raw);

	const ins = installBreadcrumb(dir);
	assert.ok(ins.errors.length > 0, "install refuses an unparseable settings file");
	const un = uninstallBreadcrumb(dir);
	assert.ok(un.errors.length > 0, "uninstall refuses too");
	assert.equal(fs.readFileSync(claudeSettings(dir), "utf8"), raw, "file bytes unchanged");

	const st = statusBreadcrumb(dir);
	assert.deepEqual(st.errors, [], "status never errors on an unreadable file");
	assert.ok(st.warnings.length > 0);
	assert.match(st.text, /unknown/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: an unsupported platform is rejected", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-plat-"));
	const r = installBreadcrumb(dir, { platform: "cursor" });
	assert.ok(r.errors.length > 0);
	assert.ok(!fs.existsSync(claudeSettings(dir)), "nothing written for an unknown platform");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: ambient AMBER_SKIP_HOOKS in the environment does not skew print assertions", () => {
	const dir = breadcrumbSessionRepo();
	const prior = process.env.AMBER_SKIP_HOOKS;
	delete process.env.AMBER_SKIP_HOOKS;
	try {
		const r = printBreadcrumb(dir, { format: "text" });
		assert.deepEqual(r.errors, []);
		assert.match(r.text, /Next step: /);
	} finally {
		if (prior !== undefined) process.env.AMBER_SKIP_HOOKS = prior;
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: legacy flat managed entry is repaired in place by install", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-repair-"));
	fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
	// The unloadable pre-shape-fix entry (F022 launch installs): flat {type, command}.
	const legacy = {
		hooks: {
			UserPromptSubmit: [
				{ type: "command", command: "echo keep-me" },
				{
					type: "command",
					command: `node amber.js hooks breadcrumb print --target . --format json ${HOOK_MARKER}`,
				},
			],
		},
	};
	fs.writeFileSync(claudeSettings(dir), JSON.stringify(legacy, null, 2));

	const ins = installBreadcrumb(dir);
	assert.deepEqual(ins.errors, []);
	assert.match(ins.text, /Repaired/);
	const settings = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	const entries = settings.hooks.UserPromptSubmit;
	assert.equal(entries.length, 2, "repair replaces in place, never appends a sibling");
	assert.equal(entries[0].command, "echo keep-me", "foreign entries untouched");
	const repaired = entries[1];
	assert.equal(repaired.matcher, "");
	assert.ok(Array.isArray(repaired.hooks));
	assert.ok(repaired.hooks[0].command.includes(HOOK_MARKER));

	// Uninstall still removes the (repaired) managed entry, leaving the foreign one.
	const un = uninstallBreadcrumb(dir);
	assert.deepEqual(un.errors, []);
	const after = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	assert.equal(after.hooks.UserPromptSubmit.length, 1);
	assert.equal(after.hooks.UserPromptSubmit[0].command, "echo keep-me");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: legacy flat managed entry is removed by uninstall", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-legacy-un-"));
	fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
	const legacy = {
		hooks: {
			UserPromptSubmit: [
				{
					type: "command",
					command: `node amber.js hooks breadcrumb print --target . --format json ${HOOK_MARKER}`,
				},
			],
		},
	};
	fs.writeFileSync(claudeSettings(dir), JSON.stringify(legacy));

	const un = uninstallBreadcrumb(dir);
	assert.deepEqual(un.errors, []);
	const after = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	assert.deepEqual(after, {}, "legacy flat entry fully removed, empty hooks object cleaned up");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: a foreign entry containing only the marker is not managed", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-collide-"));
	fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
	const foreign = {
		hooks: {
			UserPromptSubmit: [{ type: "command", command: `echo unrelated ${HOOK_MARKER} thing` }],
		},
	};
	fs.writeFileSync(claudeSettings(dir), JSON.stringify(foreign));
	const ins = installBreadcrumb(dir);
	assert.deepEqual(
		ins.errors,
		[],
		"install must not mistake a marker-mentioning foreign entry for its own",
	);
	const settings = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	assert.equal(settings.hooks.UserPromptSubmit.length, 2, "real breadcrumb appended");
	const un = uninstallBreadcrumb(dir);
	assert.deepEqual(un.errors, []);
	const after = JSON.parse(fs.readFileSync(claudeSettings(dir), "utf8"));
	assert.deepEqual(after, foreign, "only the genuine breadcrumb entry was removed");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: install/uninstall blocking errors carry a stable code", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-code-"));
	fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
	fs.writeFileSync(claudeSettings(dir), "{ not json");
	for (const r of [installBreadcrumb(dir), uninstallBreadcrumb(dir)]) {
		assert.ok(r.errors.length > 0);
		assert.match(r.errors.join("\n"), /AMBER_E_SETTINGS_UNMERGEABLE/);
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb: print is read-only (no file in the target changes)", () => {
	const dir = breadcrumbSessionRepo();
	const before = snapshotTree(dir);
	const r = printBreadcrumb(dir, { format: "json" });
	assert.deepEqual(r.errors, []);
	const after = snapshotTree(dir);
	assert.deepEqual(after, before, "print must not write anything anywhere");
	fs.rmSync(dir, { recursive: true, force: true });
});

function snapshotTree(root) {
	const entries = {};
	(function walk(dir) {
		for (const name of fs.readdirSync(dir).sort()) {
			const full = path.join(dir, name);
			const rel = path.relative(root, full);
			const stat = fs.statSync(full);
			entries[rel] = stat.isDirectory() ? "dir" : fs.readFileSync(full, "utf8");
			if (stat.isDirectory()) walk(full);
		}
	})(root);
	return entries;
}

test("breadcrumb: amber init never installs the breadcrumb entry", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-init-"));
	const { run } = require("../../scripts/amber.js");
	const originalLog = console.log;
	console.log = () => {};
	let exit;
	try {
		exit = await run(["init", "--target", dir]);
	} finally {
		console.log = originalLog;
	}
	assert.equal(exit, 0);
	const settings = claudeSettings(dir);
	if (fs.existsSync(settings)) {
		const parsed = JSON.parse(fs.readFileSync(settings, "utf8"));
		const entries = (parsed.hooks && parsed.hooks.UserPromptSubmit) || [];
		assert.equal(
			entries.filter(
				(e) => e && typeof e.command === "string" && e.command.includes("hooks breadcrumb print"),
			).length,
			0,
			"init must never install the breadcrumb hook",
		);
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

// CLI-level dispatch guard: the host pipes stdout straight into the
// conversation, so nothing but the envelope may appear there.
const { spawnSync } = require("node:child_process");
const CLI = path.join(__dirname, "..", "..", "scripts", "amber.js");

function runCli(args, env = {}) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: __dirname,
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
}

test("breadcrumb CLI: print emits exactly the envelope on stdout and exits 0", () => {
	const target = breadcrumbSessionRepo();
	const json = runCli(["hooks", "breadcrumb", "print", "--target", target, "--format", "json"]);
	assert.equal(json.status, 0);
	assert.equal(json.stderr, "");
	const lines = json.stdout.trimEnd().split("\n");
	assert.equal(lines.length, 1, "stdout is exactly one line");
	const envelope = JSON.parse(lines[0]);
	assert.equal(envelope.hookSpecificOutput.hookEventName, "UserPromptSubmit");
	assert.ok(envelope.hookSpecificOutput.additionalContext.includes("<amber-workflow-state>"));

	const text = runCli(["hooks", "breadcrumb", "print", "--target", target, "--format", "text"]);
	assert.equal(text.status, 0);
	assert.equal(text.stderr, "");
	assert.ok(text.stdout.startsWith("<amber-workflow-state>"));
	assert.ok(text.stdout.trimEnd().endsWith("</amber-workflow-state>"));
	fs.rmSync(target, { recursive: true, force: true });
});

test("breadcrumb CLI: bypass emits zero bytes; invalid format exits 1 with empty stdout", () => {
	const target = breadcrumbSessionRepo();
	const bypass = runCli(["hooks", "breadcrumb", "print", "--target", target, "--format", "text"], {
		AMBER_SKIP_HOOKS: "1",
	});
	assert.equal(bypass.status, 0);
	assert.equal(bypass.stdout, "");

	const bad = runCli(["hooks", "breadcrumb", "print", "--target", target, "--format", "xml"]);
	assert.equal(bad.status, 1);
	assert.equal(bad.stdout, "", "errors go to stderr, never stdout");
	assert.equal(bad.stdout.includes("ERROR:"), false);
	assert.match(bad.stderr, /^ERROR: /m);
	assert.match(bad.stderr, /AMBER_E_INVALID_ARG/);
	fs.rmSync(target, { recursive: true, force: true });
});

test("breadcrumb CLI: --platform=cursor is rejected, not silently treated as claude", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-platcli-"));
	const r = runCli(["hooks", "breadcrumb", "install", "--target", dir, "--platform=cursor"]);
	assert.equal(r.status, 1);
	assert.equal(r.stdout, "", "blocking errors stay off stdout");
	assert.match(r.stderr, /^ERROR: /m);
	assert.match(r.stderr, /Unsupported breadcrumb platform/);
	assert.ok(!fs.existsSync(claudeSettings(dir)), "nothing installed for a rejected platform");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("hooks CLI: check blocking errors prefix ERROR: on stderr, never stdout", () => {
	const dir = tmpRepo({ features: [{ id: "F1", status: "passing", evidence: [] }] });
	const r = runCli(["hooks", "check", "--target", dir]);
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /^ERROR: /m);
	assert.match(r.stderr, /AMBER_E_FEATURE_NO_EVIDENCE/);
	assert.equal(r.stdout.includes("ERROR:"), false);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("breadcrumb CLI: --json keeps errors in the stdout payload", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-crumb-platjson-"));
	const r = runCli([
		"hooks",
		"breadcrumb",
		"install",
		"--target",
		dir,
		"--platform=cursor",
		"--json",
	]);
	assert.equal(r.status, 1);
	const payload = JSON.parse(r.stdout);
	assert.ok(payload.errors.some((e) => /Unsupported breadcrumb platform/.test(e)));
	assert.equal(r.stderr, "");
	fs.rmSync(dir, { recursive: true, force: true });
});
