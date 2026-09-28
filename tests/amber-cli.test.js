"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { readSessionArtifacts } = require("./helpers/session-artifacts");
const { installTargetRoutes } = require("./helpers/target-routes");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-${name}-`));
}

function runHarness(args, options = {}) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: ROOT,
		encoding: "utf8",
		...options,
	});
}

function startConfirmedSession(target, goal, route) {
	const start = runHarness([
		"session",
		"start",
		"--goal",
		goal,
		"--route",
		route,
		"--target",
		target,
		"--confirm",
		"--json",
	]);
	assert.equal(start.status, 0, start.stderr || start.stdout);
	return JSON.parse(start.stdout).sessionId;
}

function runSuccessfulSessionCommand(target, sessionId, action, extraArgs = []) {
	const command = runHarness([
		"session",
		action,
		"--target",
		target,
		"--session",
		sessionId,
		...extraArgs,
		"--json",
	]);
	assert.equal(command.status, 0, command.stderr || command.stdout);
	return command;
}

test("Context CLI approval follows the selected Action variant", () => {
	const target = tempDir("context-approval");

	const rebuildBlocked = runHarness([
		"context",
		"projection",
		"rebuild",
		"--target",
		target,
		"--json",
	]);
	assert.equal(rebuildBlocked.status, 1);
	assert.equal(JSON.parse(rebuildBlocked.stdout).approvalRequired, true);

	const loadBlocked = runHarness([
		"context",
		"load",
		"--route",
		"feature-standard",
		"--target",
		target,
		"--json",
	]);
	assert.equal(loadBlocked.status, 1);
	assert.equal(JSON.parse(loadBlocked.stdout).approvalRequired, true);
	assert.equal(fs.existsSync(path.join(target, ".amber")), false);

	const rebuild = runHarness([
		"context",
		"projection",
		"rebuild",
		"--confirm",
		"--target",
		target,
		"--json",
	]);
	assert.equal(rebuild.status, 0, rebuild.stderr || rebuild.stdout);

	const status = runHarness(["context", "projection", "status", "--target", target, "--json"]);
	assert.equal(status.status, 0, status.stderr || status.stdout);
	assert.equal(JSON.parse(status.stdout).approvalRequired, undefined);
});

test("default help projects journey and core commands", () => {
	const result = runHarness([]);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Commands: .*next/);
	assert.match(result.stdout, /governance/);
	assert.doesNotMatch(result.stdout, /Commands: .*adoption/);
	assert.doesNotMatch(result.stdout, /Commands: .*maintenance/);
	assert.doesNotMatch(result.stdout, /amber (pack|profile|task|result) /);
	assert.match(result.stdout, /amber --all/);
});

test("--all exposes deprecated and expert commands", () => {
	const result = runHarness(["--all"]);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Commands: .*profile/);
	assert.match(result.stdout, /Commands: .*maintenance/);
});

test("hidden commands retain command-specific help", () => {
	const result = runHarness(["profile", "--help"]);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Usage: amber profile/);
	const alias = runHarness(["help", "profile"]);
	assert.equal(alias.status, 0, alias.stderr);
	assert.match(alias.stdout, /Usage: amber profile/);
});

test("removed command families are gone and route to the unknown-command error", () => {
	// issues/0068: agent / team / adoption were removed, not hidden. A removal
	// must be total — the command is not callable and has no help surface.
	for (const command of ["agent", "team", "adoption"]) {
		const result = runHarness([command, "--help"]);
		assert.notEqual(result.status, 0, `${command} must not resolve`);
		assert.match(`${result.stdout}${result.stderr}`, /Unknown command/i);
	}
});

test("init command scaffolds a Harness without overwriting existing files", () => {
	const target = tempDir("init");
	fs.writeFileSync(path.join(target, "AGENTS.md"), "# Existing rules\n");

	const result = runHarness(["init", "--target", target]);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Created:/);
	assert.match(result.stdout, /Skipped:/);
	assert.equal(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8"), "# Existing rules\n");
	assert.equal(fs.existsSync(path.join(target, "feature_list.json")), true);
});

test("audit command is read-only and reports missing Amber starter files", () => {
	const target = tempDir("audit");
	fs.writeFileSync(path.join(target, "AGENTS.md"), "# Existing rules\n");
	fs.mkdirSync(path.join(target, "docs"), { recursive: true });
	fs.writeFileSync(path.join(target, "docs", "README.md"), "# Existing docs\n");

	const result = runHarness(["audit", "--target", target]);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Read-only: true/);
	assert.match(result.stdout, /Missing Amber starter files:/);
	assert.match(result.stdout, /Suggested additions:/);
	assert.match(result.stdout, /Existing docs:/);
	assert.match(result.stdout, /docs\/README\.md/);
	assert.match(result.stdout, /Suggested patches requiring approval:/);
	assert.match(result.stdout, /Unknowns:/);
	assert.match(result.stdout, /No package, test, build, or verification command detected/);
	assert.match(result.stdout, /Next safe command:/);
	assert.equal(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8"), "# Existing rules\n");
});

test("audit command reports tooling evidence without detected commands", () => {
	const target = tempDir("audit-tooling");
	fs.writeFileSync(path.join(target, "package-lock.json"), "{}\n");

	const result = runHarness(["audit", "--target", target]);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Tooling evidence:/);
	assert.match(result.stdout, /package-lock\.json: npm/);
	assert.doesNotMatch(result.stdout, /Detected commands:/);
	assert.match(result.stdout, /exact verification command is unknown/);
});

test("audit summary limits long docs output while preserving actions", () => {
	const target = tempDir("audit-summary");
	fs.writeFileSync(path.join(target, "pyproject.toml"), "[project]\nname = 'example'\n");
	fs.mkdirSync(path.join(target, "tests"), { recursive: true });
	fs.mkdirSync(path.join(target, "docs"), { recursive: true });
	for (let index = 0; index < 20; index += 1) {
		fs.writeFileSync(path.join(target, "docs", `page-${index}.md`), `# Page ${index}\n`);
	}

	const result = runHarness(["audit", "--target", target, "--summary"]);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Audit summary/);
	assert.match(result.stdout, /Existing docs: 20/);
	assert.match(result.stdout, /Wiki-like files: 20/);
	assert.match(result.stdout, /Suggested additions: 20/);
	assert.match(result.stdout, /Candidate commands requiring confirmation:/);
	assert.match(result.stdout, /python -m pytest/);
	assert.match(result.stdout, /Unknowns:/);
	assert.match(result.stdout, /Next safe command:/);
	assert.equal(result.stdout.includes("docs/page-19.md"), false);
	assert.doesNotMatch(result.stdout, /Suggested additions:\\n\\s+- AGENTS\\.md/);
});

test("wiki, handoff, and doctor commands validate a scaffolded Harness", () => {
	const target = tempDir("validators");
	assert.equal(runHarness(["init", "--target", target]).status, 0);

	for (const command of ["wiki", "handoff", "doctor"]) {
		const result = runHarness([command, "--target", target]);
		assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
		assert.match(result.stdout, /Errors: 0/);
	}
});

test("governance report command exposes the complete product value loop", () => {
	const target = tempDir("governance-report-cli");
	const output = path.join("docs", "governance-report.md");
	const outputPath = path.join(target, output);
	assert.equal(runHarness(["init", "--target", target]).status, 0);

	const textResult = runHarness(["governance", "report", "--target", target]);
	assert.equal(textResult.status, 0, textResult.stderr);
	assert.match(textResult.stdout, /Amber Governance Report:/);
	assert.match(textResult.stdout, /Amber Readiness Score:/);
	assert.match(
		textResult.stdout,
		/Product Value Loop: Assess repo -> Score risks -> Recommend next actions -> Run governed workflow -> Verify evidence -> Produce handoff bundle/,
	);
	assert.match(textResult.stdout, /Next Actions:/);

	const jsonResult = runHarness([
		"governance",
		"report",
		"--target",
		target,
		"--output",
		output,
		"--confirm",
		"--json",
	]);
	assert.equal(jsonResult.status, 0, jsonResult.stderr);
	const payload = JSON.parse(jsonResult.stdout);
	assert.equal(payload.target, target);
	assert.equal(payload.outputPath, outputPath);
	assert.equal(typeof payload.scores.overall, "number");
	assert.ok(payload.nextActions.length > 0);
	assert.ok(
		payload.nextActions.every((action) => action.command.includes("node scripts/amber.js")),
	);
	assert.equal(fs.existsSync(outputPath), true);
	assert.match(fs.readFileSync(outputPath, "utf8"), /# Amber Governance Report/);
});

test("typed mutations require confirmation before writing", () => {
	const target = tempDir("typed-mutation-approval");
	const output = path.join(target, "governance-report.md");

	const start = runHarness([
		"session",
		"start",
		"--goal",
		"approval probe",
		"--target",
		target,
		"--json",
	]);
	assert.notEqual(start.status, 0);
	const startPayload = JSON.parse(start.stdout);
	assert.equal(startPayload.executed, false);
	assert.equal(startPayload.approvalRequired, true);
	assert.equal(fs.existsSync(path.join(target, ".amber", "sessions")), false);

	const report = runHarness([
		"governance",
		"report",
		"--target",
		target,
		"--output",
		output,
		"--json",
	]);
	assert.notEqual(report.status, 0);
	const reportPayload = JSON.parse(report.stdout);
	assert.equal(reportPayload.executed, false);
	assert.equal(reportPayload.approvalRequired, true);
	assert.equal(fs.existsSync(output), false);
});

test("typed-mutation approval block fails loudly in text mode (session verify --execute)", () => {
	const target = tempDir("typed-mutation-text-verify");

	// The typed seam intercepts `session verify --execute` (a write) before the
	// handler runs, so the session id is never resolved — no state is touched.
	// Text mode must fail loudly with the --yes guidance instead of rendering
	// the approval envelope like a success ("Target: n/a / Errors: 0").
	const blocked = runHarness([
		"session",
		"verify",
		"--session",
		"00000000-text-mode-probe",
		"--command",
		"npm test",
		"--result",
		"probe",
		"--execute",
		"--target",
		target,
	]);
	assert.notEqual(blocked.status, 0, `expected non-zero exit, got:\n${blocked.stdout}`);
	assert.match(
		blocked.stdout,
		/--yes|--confirm/,
		"text mode must tell the user how to approve the typed mutation",
	);
	assert.doesNotMatch(
		blocked.stdout,
		/Errors: 0/,
		"a blocked mutation must not render as error-free",
	);

	// The JSON envelope is the machine-readable contract and stays unchanged.
	const envelope = runHarness([
		"session",
		"verify",
		"--session",
		"00000000-text-mode-probe",
		"--command",
		"npm test",
		"--result",
		"probe",
		"--execute",
		"--target",
		target,
		"--json",
	]);
	assert.notEqual(envelope.status, 0);
	const payload = JSON.parse(envelope.stdout);
	assert.equal(payload.approvalRequired, true);
	assert.equal(payload.executed, false);
	assert.match(payload.hint, /--yes or --confirm/);
});

test("session verify --execute surfaces verify-policy denials after approval", () => {
	const target = tempDir("verify-policy-denial");
	installTargetRoutes(target);
	const sessionId = startConfirmedSession(target, "policy denial probe", "feature-standard");

	// `rtk node --test` is not on the default verify allow-list, so the
	// evidence runner must deny it and the CLI must report that denial
	// (non-zero exit + explicit denied-by-policy message), not return quietly.
	const denied = runHarness([
		"session",
		"verify",
		"--session",
		sessionId,
		"--command",
		"rtk node --test",
		"--execute",
		"--yes",
		"--target",
		target,
	]);
	assert.notEqual(denied.status, 0, `expected non-zero exit, got:\n${denied.stdout}`);
	assert.match(
		denied.stdout,
		/denied by policy/,
		"a verify-policy denial must be reported to the user",
	);
});

test("next command combines lifecycle guidance with top governance action", () => {
	const target = tempDir("next-governance-action");
	assert.equal(runHarness(["init", "--target", target]).status, 0);

	const textResult = runHarness(["next", "--target", target]);
	assert.equal(textResult.status, 0, textResult.stderr);
	assert.match(textResult.stdout, /Context:/);
	assert.match(textResult.stdout, /Governance action:/);
	assert.match(textResult.stdout, /Run: node scripts\/amber\.js/);

	const jsonResult = runHarness(["next", "--target", target, "--json"]);
	assert.equal(jsonResult.status, 0, jsonResult.stderr);
	const payload = JSON.parse(jsonResult.stdout);
	assert.ok(Array.isArray(payload.governanceActions));
	assert.ok(payload.governanceActions.length > 0);
	assert.match(payload.governanceActions[0].command, /node scripts\/amber\.js/);
});

test("handoff bundle and validate commands produce a portable continuation artifact", () => {
	const target = tempDir("handoff-bundle-cli");
	const bundleDir = path.join(".amber", "handoff", "latest");
	const bundlePath = path.join(target, bundleDir);
	assert.equal(runHarness(["init", "--target", target]).status, 0);

	const bundleResult = runHarness([
		"handoff",
		"bundle",
		"--target",
		target,
		"--output-dir",
		bundleDir,
		"--json",
	]);
	assert.equal(bundleResult.status, 0, bundleResult.stderr);
	const bundle = JSON.parse(bundleResult.stdout);
	assert.equal(bundle.outputDir, bundlePath);
	assert.equal(bundle.valid, true);
	assert.equal(bundle.files.length, 7);
	assert.deepEqual(bundle.errors, []);

	for (const rel of [
		"README.md",
		"session-summary.md",
		"verification-evidence.md",
		"next-actions.md",
		"risks.md",
		"recovery-commands.md",
		"manifest.json",
	]) {
		assert.equal(fs.existsSync(path.join(bundlePath, rel)), true, `${rel} exists`);
	}

	const validateResult = runHarness([
		"handoff",
		"validate",
		"--target",
		target,
		"--bundle-dir",
		bundleDir,
		"--json",
	]);
	assert.equal(validateResult.status, 0, validateResult.stderr);
	const validation = JSON.parse(validateResult.stdout);
	assert.equal(validation.valid, true);
	assert.deepEqual(validation.errors, []);
	assert.equal(validation.manifest.artifactType, "amber-handoff-bundle");
});

test("wiki command creates missing wiki files without overwriting existing pages", () => {
	const target = tempDir("wiki");
	const wikiRoot = path.join(target, "docs", "wiki");
	fs.mkdirSync(wikiRoot, { recursive: true });
	fs.writeFileSync(path.join(wikiRoot, "index.md"), "# Custom Wiki\n");

	const result = runHarness(["wiki", "--target", target]);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Created:/);
	assert.match(result.stdout, /Skipped:/);
	assert.equal(fs.readFileSync(path.join(wikiRoot, "index.md"), "utf8"), "# Custom Wiki\n");
	assert.equal(fs.existsSync(path.join(wikiRoot, "engineering", "verification.md")), true);
});

test("wiki command dry-run reports missing wiki files without writing them", () => {
	const target = tempDir("wiki-dry-run");

	const result = runHarness(["wiki", "--target", target, "--dry-run"]);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Created:/);
	assert.equal(fs.existsSync(path.join(target, "docs", "wiki", "index.md")), false);
});

test("unknown command returns a clear error", () => {
	const result = runHarness(["work", "--target", tempDir("unknown")]);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Unknown command: work/);
	assert.match(result.stderr, /audit, init, doctor, next, plan, handoff, session/);
});

test("help scopes dry-run to commands that support it", () => {
	const globalHelp = runHarness(["--help"]);
	const allHelp = runHarness(["--all"]);
	const initHelp = runHarness(["init", "--help"]);
	const wikiHelp = runHarness(["wiki", "--help"]);
	const doctorHelp = runHarness(["doctor", "--help"]);
	const executionHelp = runHarness(["execution", "--help"]);

	assert.equal(globalHelp.status, 0);
	assert.equal(allHelp.status, 0);
	assert.equal(initHelp.status, 0);
	assert.equal(wikiHelp.status, 0);
	assert.equal(doctorHelp.status, 0);
	assert.equal(executionHelp.status, 0);
	assert.match(globalHelp.stdout, /^Usage: amber <command> --target <repo> \[--json\]$/m);
	assert.match(allHelp.stdout, /maintenance inspect --target path\/to\/repo --json/);
	assert.match(initHelp.stdout, /--dry-run/);
	assert.match(wikiHelp.stdout, /--dry-run/);
	assert.doesNotMatch(doctorHelp.stdout, /--dry-run/);
	assert.match(executionHelp.stdout, /validate-integration/);
	assert.match(executionHelp.stdout, /readiness/);
	assert.doesNotMatch(executionHelp.stdout, /validate-loop/);
});

test("primary docs expose the safe loop recommendation path", () => {
	const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
	const readmeZh = fs.readFileSync(path.join(ROOT, "README.zh-CN.md"), "utf8");
	const cliReference = fs.readFileSync(path.join(ROOT, "docs", "CLI_REFERENCE.md"), "utf8");

	for (const content of [readme, readmeZh, cliReference]) {
		assert.match(content, /loop recommend/);
		assert.match(content, /continuous improvement/);
		assert.match(content, /daily-amber-triage/);
		assert.match(content, /--dry-run/);
	}
	assert.match(cliReference, /never schedules work or executes workflow steps/);
	assert.match(cliReference, /Live scheduling is disabled/);
});

test("version command prints the package version", () => {
	const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

	const result = runHarness(["--version"]);

	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), packageJson.version);
});

test("package exposes amber as primary bin with a legacy coding-harness alias", () => {
	const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

	assert.equal(packageJson.name, "amber-protocol");
	assert.equal(packageJson.bin.amber, "scripts/amber.js");
	assert.equal(packageJson.bin["coding-harness"], "scripts/compat/coding-harness.js");
});

test("migrate state copies legacy .harness into .amber via the CLI", () => {
	const target = tempDir("migrate-state");
	const legacySession = path.join(target, ".harness", "sessions", "legacy-1");
	fs.mkdirSync(legacySession, { recursive: true });
	fs.writeFileSync(
		path.join(legacySession, "manifest.json"),
		JSON.stringify({ sessionId: "legacy-1" }),
	);

	const result = runHarness(["migrate", "state", "--target", target, "--json"]);

	assert.equal(result.status, 0, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.errors.length, 0);
	assert.ok(payload.copied.length >= 1);
	assert.equal(
		fs.existsSync(path.join(target, ".amber", "sessions", "legacy-1", "manifest.json")),
		true,
	);
	assert.equal(
		fs.existsSync(path.join(target, ".harness", "sessions", "legacy-1", "manifest.json")),
		true,
	);
});

test("migrate state can archive legacy .harness via the CLI after a clean copy", () => {
	const target = tempDir("migrate-state-archive");
	const legacySession = path.join(target, ".harness", "sessions", "legacy-1");
	fs.mkdirSync(legacySession, { recursive: true });
	fs.writeFileSync(
		path.join(legacySession, "manifest.json"),
		JSON.stringify({ sessionId: "legacy-1" }),
	);

	const result = runHarness(["migrate", "state", "--target", target, "--archive-legacy", "--json"]);

	assert.equal(result.status, 0, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.errors.length, 0);
	assert.equal(payload.archivedLegacy, true);
	assert.equal(fs.existsSync(path.join(target, ".harness")), false);
	assert.ok(payload.legacyBackupPath.includes(".amber-legacy-harness-backup-"));
	assert.equal(
		fs.existsSync(path.join(target, ".amber", "sessions", "legacy-1", "manifest.json")),
		true,
	);
});

test("legacy entrypoints forward to the amber CLI", () => {
	for (const entry of ["scripts/harness.js", "scripts/compat/coding-harness.js"]) {
		const result = spawnSync(process.execPath, [path.join(ROOT, entry), "--help"], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, `${entry} --help should exit 0`);
		assert.match(result.stdout, /amber|harness/i);
	}
	const compat = spawnSync(
		process.execPath,
		[path.join(ROOT, "scripts", "compat", "coding-harness.js"), "--help"],
		{ encoding: "utf8" },
	);
	assert.match(compat.stderr, /deprecated/i, "compat shim warns on stderr");
});

test("security audit command exposes help", () => {
	const result = runHarness(["security", "audit", "--help"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /security audit/);
	assert.match(result.stdout, /--target/);
	assert.match(result.stdout, /--output/);
});

test("session complete-check reports missing evidence for a new session", () => {
	const target = tempDir("session-complete-check");
	installTargetRoutes(target);
	const start = runHarness([
		"session",
		"start",
		"--goal",
		"test completion",
		"--route",
		"bugfix-quick",
		"--target",
		target,
		"--confirm",
		"--json",
	]);
	assert.equal(start.status, 0, start.stderr);
	const { sessionId } = JSON.parse(start.stdout);

	const check = runHarness([
		"session",
		"complete-check",
		"--target",
		target,
		"--session",
		sessionId,
		"--json",
	]);
	assert.equal(check.status, 0, check.stderr);
	const payload = JSON.parse(check.stdout);
	assert.match(payload.text, /Completion check status: fail/);
	assert.match(payload.text, /Missing:/);
});

test("session approval leaves a two-gate Session active until explicit completion", () => {
	const target = tempDir("session-approval-not-completion");
	installTargetRoutes(target);
	const sessionId = startConfirmedSession(
		target,
		"add approval lifecycle feature",
		"feature-standard",
	);
	runSuccessfulSessionCommand(target, sessionId, "continue");

	for (const gate of ["user-approval-plan", "user-approval-implement"]) {
		runSuccessfulSessionCommand(target, sessionId, "approve", ["--gate", gate, "--yes"]);
	}

	const { manifest, timeline } = readSessionArtifacts(target, sessionId);
	assert.equal(manifest.status, "executing");
	assert.equal(
		timeline.some((event) => event.type === "session_completed"),
		false,
	);

	const check = runHarness([
		"session",
		"complete-check",
		"--target",
		target,
		"--session",
		sessionId,
		"--strict",
		"--json",
	]);
	assert.equal(check.status, 1);
	assert.match(JSON.parse(check.stdout).text, /Missing: [^\n]*verification/);
});

test("maintenance distill writes a proposal from repeated plan headings", () => {
	const target = tempDir("maintenance-distill");
	fs.mkdirSync(path.join(target, "docs", "legacy", "plans"), {
		recursive: true,
	});
	fs.writeFileSync(path.join(target, "docs", "legacy", "plans", "a.md"), "# Refactor auth\n");
	fs.writeFileSync(path.join(target, "docs", "legacy", "plans", "b.md"), "# Refactor auth\n");
	const output = path.join(target, "docs", "maintenance", "distill-proposals.md");

	const result = runHarness([
		"maintenance",
		"distill",
		"--target",
		target,
		"--output",
		output,
		"--json",
	]);
	assert.equal(result.status, 0, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.outputPath, output);
	assert.ok(payload.candidateCount >= 1);
	const report = fs.readFileSync(output, "utf8");
	assert.match(report, /# Distill Proposals/);
	assert.match(report, /Refactor auth/);
});
