"use strict";

// issues/357: a CLI flag that is advertised in help but missing from FLAG_SPECS
// is not an error - parseArgs drops it into args._ and the handler never sees it,
// so the command succeeds while silently ignoring what the user asked for.
// `--replay-scope`, `--claim` and `--yaml` were all documented and all no-ops.
//
// Two layers, because either alone under-covers the defect class:
//   1. a static seam rule over the help surface `amber <command> --help` prints;
//   2. a real-CLI behavior check per flag, so a registered-but-ignored flag is
//      also caught (rule 1 only proves parseArgs keeps the token).
//
// What rule 1 does NOT see: it reads commandUsageLine + commandSummary, so a flag
// documented only in docs/*.md, or only in a nested subcommand string that is not
// projected into the command's own help, is invisible here. Neither rule proves a
// flag is wired to the RIGHT args key - rule 2 does that only for the flags it
// names. Adding a flag without adding its behavior case is the gap to watch.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { trackTempDir } = require("../helpers/harness");
const {
	COMMANDS,
	commandSummary,
	commandUsageLine,
} = require("../../scripts/lib/command-registry");
const { getFlagSpec } = require("../../scripts/lib/core/cli-output");
const memoryStore = require("../../scripts/lib/core/memory-store");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

// A flag may be absent from FLAG_SPECS only with a named escape hatch that
// actually reads the token. --platform is scoped to `hooks breadcrumb install`,
// whose handler scans args._ for both `--platform <value>` and `--platform=<value>`
// (scripts/lib/hooks-commands.js, hooksBreadcrumbPlatform); args.platform is only
// its fallback. Every other advertised flag must be registered.
const FLAGS_PARSED_BY_A_HANDLER = new Set(["--platform"]);

function advertisedFlags() {
	const flags = new Map();
	for (const command of COMMANDS) {
		const help = `${commandUsageLine(command)}\n${commandSummary(command)}`;
		for (const match of help.matchAll(/--[a-z][a-z0-9-]*/g)) {
			if (!flags.has(match[0])) flags.set(match[0], []);
			flags.get(match[0]).push(command);
		}
	}
	return flags;
}

function mkTarget(label) {
	return trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), `amber-flags-${label}-`)));
}

function runCli(args, cwd = ROOT) {
	return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

test("every flag advertised by command help is registered in FLAG_SPECS", () => {
	const unregistered = [...advertisedFlags()]
		.filter(([flag]) => !getFlagSpec(flag) && !FLAGS_PARSED_BY_A_HANDLER.has(flag))
		.map(([flag, commands]) => `${flag} (${[...new Set(commands)].join(", ")})`);
	assert.deepEqual(
		unregistered,
		[],
		`unregistered flags are silently dropped by parseArgs: ${unregistered.join("; ")}`,
	);
});

test("the escape-hatch exemption stays narrow and really is handled by the command", () => {
	for (const flag of FLAGS_PARSED_BY_A_HANDLER) {
		assert.equal(getFlagSpec(flag), null, `${flag} is exempt only while unregistered`);
	}
	// The exemption is only honest while the handler reads the raw token out of
	// args._. Proven by behavior: an unsupported value must reach installBreadcrumb
	// and be refused. If the hatch is ever removed, --platform falls back to the
	// default "claude" and this fails.
	const target = mkTarget("platform-hatch");
	const rejected = runCli([
		"hooks",
		"breadcrumb",
		"install",
		"--target",
		target,
		"--platform",
		"cursor",
	]);
	assert.equal(rejected.status, 1);
	assert.match(`${rejected.stdout}${rejected.stderr}`, /Unsupported breadcrumb platform: "cursor"/);

	const eqTarget = mkTarget("platform-eq");
	const installed = runCli([
		"hooks",
		"breadcrumb",
		"install",
		"--target",
		eqTarget,
		"--platform=claude",
	]);
	assert.equal(installed.status, 0, installed.stderr || installed.stdout);
});

// ── layer 2: each flag changes what the CLI actually does ────────────────────

test("--replay-scope reaches writeHandoffBundle: real slices for a scope, error for none", () => {
	const target = mkTarget("replay-scope");
	fs.mkdirSync(path.join(target, ".amber", "sessions", "known"), { recursive: true });
	fs.writeFileSync(path.join(target, ".amber", "sessions", "known", "ledger.jsonl"), "");
	// The bundle validates the live handoff at the target root; create it first so
	// a failure below means the scope, not the fixture.
	assert.equal(runCli(["handoff", "--target", target]).status, 0);

	const plain = runCli(["handoff", "bundle", "--target", target, "--output-dir", "plain"]);
	assert.equal(plain.status, 0, plain.stderr || plain.stdout);
	assert.equal(fs.existsSync(path.join(target, "plain", "replay-slices.json")), false);

	const known = runCli([
		"handoff",
		"bundle",
		"--target",
		target,
		"--replay-scope",
		"known",
		"--output-dir",
		"known",
	]);
	assert.equal(known.status, 0, known.stderr || known.stdout);
	assert.ok(
		fs.existsSync(path.join(target, "known", "replay-slices.json")),
		"a resolvable scope must emit the replay slices",
	);
	assert.ok(fs.existsSync(path.join(target, "known", "replay", "manifest.json")));

	const unknown = runCli([
		"handoff",
		"bundle",
		"--target",
		target,
		"--replay-scope",
		"nope",
		"--output-dir",
		"bad",
	]);
	assert.equal(unknown.status, 1, "an unresolvable replay scope must fail the bundle");
	assert.match(
		`${unknown.stdout}${unknown.stderr}`,
		/no session ledger exists for scope nope|must be a sessionId or a full runId/,
		"the documented handoff-bundle refusal must surface",
	);

	const malformed = runCli([
		"handoff",
		"bundle",
		"--target",
		target,
		"--replay-scope",
		"run-truncated",
		"--output-dir",
		"junk",
	]);
	assert.equal(malformed.status, 1);
	assert.match(
		`${malformed.stdout}${malformed.stderr}`,
		/--replay-scope must be a sessionId or a full runId \(run-truncated\)/,
	);
});

test("--yaml selects the YAML knowledge-plan template", () => {
	const jsonTarget = mkTarget("yaml-off");
	const jsonForm = runCli(["wiki", "knowledge", "scaffold", "--target", jsonTarget]);
	assert.equal(jsonForm.status, 0, jsonForm.stderr || jsonForm.stdout);
	assert.ok(
		fs.existsSync(path.join(jsonTarget, "docs", "wiki", "knowledge-plan.json")),
		"the default stays JSON",
	);

	const yamlTarget = mkTarget("yaml-on");
	const yamlForm = runCli(["wiki", "knowledge", "scaffold", "--target", yamlTarget, "--yaml"]);
	// scaffoldKnowledgePlan re-reads the plan it just wrote and folds the schema
	// errors into its own result, so this rc 0 is also the proof that the YAML
	// template is a valid plan. It was not - the block was `knowledgecard.notes`
	// with no schemaVersion - and that stayed hidden while --yaml was a no-op.
	assert.equal(yamlForm.status, 0, yamlForm.stderr || yamlForm.stdout);
	assert.ok(
		fs.existsSync(path.join(yamlTarget, "docs", "wiki", "knowledge-plan.yaml")),
		"--yaml must write the YAML variant",
	);
	assert.equal(
		fs.existsSync(path.join(yamlTarget, "docs", "wiki", "knowledge-plan.json")),
		false,
		"--yaml must not fall back to the JSON template",
	);

	// The adapter's internal `--yml` alias is reachable from the CLI too. It is not
	// advertised in help, so the census rule above cannot see it - this is its case.
	const aliasTarget = mkTarget("yml");
	const aliasForm = runCli(["wiki", "knowledge", "scaffold", "--target", aliasTarget, "--yml"]);
	assert.equal(aliasForm.status, 0, aliasForm.stderr || aliasForm.stdout);
	assert.ok(fs.existsSync(path.join(aliasTarget, "docs", "wiki", "knowledge-plan.yaml")));
});

test("--claim carries the ratified heading into the memory registry", () => {
	const target = mkTarget("claim");
	fs.writeFileSync(
		path.join(target, "MEMORY.md"),
		["# Memory", "", "## Entries", "", "## Prefer explicit --target over cwd", ""].join("\n"),
	);

	const ratified = runCli([
		"memory",
		"book",
		"--target",
		target,
		"--ratify",
		"--claim",
		"Prefer explicit --target over cwd",
		"--yes",
		"--json",
	]);
	assert.equal(ratified.status, 0, ratified.stderr || ratified.stdout);
	const result = JSON.parse(ratified.stdout);
	assert.equal(result.origin, "human-direct-ratification");
	assert.match(result.entryId, /^sha256:/);
	// The claim text keys the entry, so it must have reached the store - not just
	// parsed, but honoured.
	const entry = memoryStore.readEntry(target, result.entryId);
	assert.equal(entry.claim, "Prefer explicit --target over cwd");

	// Without --claim the documented refusal still fires: proof the passing case
	// above passed because of the flag, not around it.
	const missing = runCli(["memory", "book", "--target", target, "--ratify", "--yes", "--json"]);
	assert.equal(missing.status, 1);
	assert.match(`${missing.stdout}${missing.stderr}`, /ratification requires --claim/);
});
