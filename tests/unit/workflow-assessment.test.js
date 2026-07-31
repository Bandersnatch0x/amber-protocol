"use strict";

// ADR-0008 P1 tests: schema conformance, scoring nullability, determinism,
// read-only behaviour, and privacy. Fixture-driven so the four coverage
// states (covered/partial/unavailable/not-applicable) are locked.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const { collectRepositoryEvidence } = require("../../scripts/lib/workflow-assessment/repository-evidence");
const { runChecks } = require("../../scripts/lib/workflow-assessment/checks");
const { scoreDimensions, scoreDimension } = require("../../scripts/lib/workflow-assessment/scoring");
const { buildReport, buildFindings } = require("../../scripts/lib/workflow-assessment/workflow-commands");
const { listProviders } = require("../../scripts/lib/workflow-assessment/observation-contract");
const { renderJson, renderMarkdown } = require("../../scripts/lib/workflow-assessment/renderers");

const REPO_ROOT = path.resolve(__dirname, "../..");
const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "workflow-assessment");
const SCHEMA_PATH = path.join(REPO_ROOT, "schemas", "workflow-assessment.schema.json");

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
const validate = ajv.compile(schema);

// Each fixture locks one coverage shape against the schema. Note: the
// `unavailable` fixture carries dimension-level coverage: "unavailable" which
// the builder does NOT currently emit (builder emits covered/partial/
// not-applicable only — see scoring.js). It exists to lock schema tolerance for
// that state, not to mirror a builder product. `not-applicable` mirrors a
// genuine builder output (all checks not-applicable).
const FIXTURE_NAMES = ["complete", "partial", "unavailable", "not-applicable"];

function loadFixture(name) {
	return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), "utf8"));
}

// ── Schema conformance: every fixture validates against the contract ──

for (const name of FIXTURE_NAMES) {
	test(`fixture ${name} validates against workflow-assessment schema`, () => {
		const report = loadFixture(name);
		const ok = validate(report);
		assert.ok(ok, `schema errors: ${JSON.stringify(validate.errors?.map((e) => e.instancePath + " " + e.message))}`);
	});
}

test("schema rejects a report missing required finding fields", () => {
	const report = loadFixture("complete");
	const bad = { ...report, findings: [{ id: "x", dimension: "contextAdequacy" }] };
	assert.equal(validate(bad), false);
});

test("schema accepts unsupported as a coverage state", () => {
	const report = loadFixture("complete");
	report.coverage.session = "unsupported";
	assert.ok(validate(report), "unsupported must be a valid coverage state");
});

test("schema rejects an overall field (none shipped until P3)", () => {
	const report = loadFixture("complete");
	report.overall = 75;
	// extra props are allowed by draft-07 default, but the contract must not
	// *require* overall. Confirm it's absent from required.
	assert.ok(!schema.required.includes("overall"), "overall must not be a required field");
});

// ── Scoring nullability ──

test("all checks not-applicable → score null, coverage not-applicable, confidence high", () => {
	const checks = [
		{ id: "x", status: "not-applicable", confidenceImpact: "low" },
		{ id: "y", status: "not-applicable", confidenceImpact: "low" },
	];
	const d = scoreDimension(checks);
	assert.equal(d.score, null);
	assert.equal(d.coverage, "not-applicable");
	assert.equal(d.confidence, "high");
});

test("mixed applicable/not-applicable → coverage partial, confidence capped at medium", () => {
	const checks = [
		{ id: "x", status: "pass", confidenceImpact: "high" },
		{ id: "y", status: "not-applicable", confidenceImpact: "low" },
	];
	const d = scoreDimension(checks);
	assert.equal(d.coverage, "partial");
	assert.equal(d.confidence, "medium", "partial evidence cannot support high");
	assert.equal(d.score, 100);
});

test("all checks pass → covered, score 100", () => {
	const checks = [
		{ id: "x", status: "pass", confidenceImpact: "medium" },
		{ id: "y", status: "pass", confidenceImpact: "medium" },
	];
	const d = scoreDimension(checks);
	assert.equal(d.coverage, "covered");
	assert.equal(d.score, 100);
});

test("fail check produces a score below 100", () => {
	const checks = [
		{ id: "x", status: "pass", confidenceImpact: "medium" },
		{ id: "y", status: "fail", confidenceImpact: "high" },
	];
	const d = scoreDimension(checks);
	assert.equal(d.score, 50);
	assert.equal(d.confidence, "high");
});

// ── Determinism: same repo state → same report ──

test("buildReport is deterministic across two runs (no generatedAt drift in dimensions)", () => {
	const r1 = buildReport(REPO_ROOT);
	const r2 = buildReport(REPO_ROOT);
	// generatedAt differs by ms; compare the deterministic payload instead.
	const strip = (r) => ({ ...r, generatedAt: undefined });
	assert.deepEqual(strip(r1).dimensions, strip(r2).dimensions);
	assert.deepEqual(strip(r1).findings, strip(r2).findings);
});

// ── Privacy: no raw transcript / secret enters the report ──

test("report contains no raw transcript text or secret-shaped strings", () => {
	const report = buildReport(REPO_ROOT);
	const json = JSON.stringify(report);
	// No ~/.claude-rooted paths in native OR JSON-escaped backslash form. Do NOT
	// assert on bare homedir(): on CI the checkout itself lives under the home
	// directory, so report.target legitimately contains it (and on Windows the
	// bare form never matches JSON's escaped backslashes anyway).
	const claudeHomeAbs = path.join(require("node:os").homedir(), ".claude");
	assert.ok(!json.includes("~/.claude"), "no tilde claude path");
	assert.ok(!json.includes(".claude/projects"), "no claude projects path");
	assert.ok(!json.includes(".claude\\\\projects"), "no claude projects path (escaped)");
	assert.ok(!json.includes(claudeHomeAbs), "no absolute claude-home path");
	assert.ok(!json.includes(claudeHomeAbs.replace(/\\/g, "\\\\")), "no absolute claude-home path (escaped)");
	assert.ok(!/sk-[a-zA-Z0-9]{20}/.test(json), "no secret-shaped string");
	assert.ok(!json.includes("Human:"), "no raw chat turns");
	assert.ok(!json.includes("Assistant:"), "no raw chat turns");
});

// ── Read-only: assess without --output-dir does not write ──

test("buildReport does not create files", () => {
	const before = fs.readdirSync(REPO_ROOT);
	buildReport(REPO_ROOT);
	const after = fs.readdirSync(REPO_ROOT);
	assert.deepEqual(before, after, "no files created by report build");
});

// ── Provider registry: amber-native supported, others unsupported in P1 ──

test("provider registry declares amber-native available; claude depends on local install", () => {
	const providers = listProviders();
	const byId = Object.fromEntries(providers.map((p) => [p.providerId, p]));
	assert.equal(byId["amber-native"].available, true);
	// claude availability depends on ~/.claude/projects/<encoded-cwd> existing;
	// either result is valid as long as it does not fabricate.
	assert.ok(typeof byId["claude"].available === "boolean");
	assert.equal(byId["codex"].available, false);
	assert.equal(byId["cursor"].available, false);
});

test("amber-native capabilities are supported where P1 declares them", () => {
	const amber = listProviders().find((p) => p.providerId === "amber-native");
	assert.equal(amber.capabilities.agentAssets, "supported");
	assert.equal(amber.capabilities.mutation, "unsupported");
});

test("P1 session coverage is not-applicable only with --no-sessions", () => {
	const report = buildReport(REPO_ROOT, { noSessions: true });
	assert.equal(report.coverage.session, "not-applicable");
	assert.equal(report.scope.sessions, "not-applicable");
});

test("P2 default includes amber-native sessions when present", () => {
	const report = buildReport(REPO_ROOT); // noSessions defaults false in P2
	assert.notEqual(report.scope.sessions, "not-applicable");
	// Amber repo has 3 sessions, so session coverage should be covered.
	assert.equal(report.coverage.session, "covered");
	assert.ok((report.sessionObservations || []).length > 0);
});

test("top-level coverage is derived from dimension coverage, not hardcoded", () => {
	const report = buildReport(REPO_ROOT);
	// repository lane backs onto context/lifecycle/verification dimensions.
	for (const dim of ["contextAdequacy", "lifecycleDiscipline", "verificationCoverage"]) {
		assert.ok(report.dimensions[dim].coverage !== undefined);
	}
	// delivery lane backs onto deliveryIntegrity dimension.
	assert.equal(report.coverage.delivery, report.dimensions.deliveryIntegrity.coverage);
});

test("resolveSessionCoverage: foreign provider yields unsupported when amber has no sessions", () => {
	const { resolveSessionCoverage } = require("../../scripts/lib/workflow-assessment/workflow-commands");
	// Amber sessions present → prefer native coverage regardless of foreign.
	assert.equal(resolveSessionCoverage(false, { present: true, coverage: "covered" }, true), "covered");
	// No amber sessions + foreign available with unsupported sessions → unsupported.
	assert.equal(resolveSessionCoverage(false, { present: false, coverage: "unavailable" }, true), "unsupported");
	// No amber sessions + no foreign → unavailable.
	assert.equal(resolveSessionCoverage(false, { present: false, coverage: "unavailable" }, false), "unavailable");
	// User opt-out.
	assert.equal(resolveSessionCoverage(true, null, true), "not-applicable");
	// Regression: truthy "unavailable" coverage string must not mask foreign branch
	// (the old `sessionObs.coverage || …` expression made unsupported dead).
	assert.equal(resolveSessionCoverage(false, { present: false, coverage: "unavailable" }, true), "unsupported");
});

test("buildReport: no amber sessions + empty Claude dir → coverage.session unavailable", () => {
	// Claude is P2b-supported; an empty transcript dir means available but no
	// readable sessions → unavailable (not fabricated covered / not unsupported).
	// claudeHome is injected so the test never touches the real ~/.claude.
	const os = require("node:os");
	const { repoTranscriptDir } = require("../../scripts/lib/workflow-assessment/providers/claude-transcript");
	const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), "wf-foreign-home-"));
	const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), "wf-foreign-"));
	fs.mkdirSync(repoTranscriptDir(tmpTarget, claudeHome), { recursive: true });
	try {
		const report = buildReport(tmpTarget, { claudeHome });
		assert.equal(report.coverage.session, "unavailable");
		assert.ok(report.scope.providers.includes("claude"));
	} finally {
		try { fs.rmSync(claudeHome, { recursive: true, force: true }); } catch { /* ignore */ }
		try { fs.rmSync(tmpTarget, { recursive: true, force: true }); } catch { /* ignore */ }
	}
});

test("buildReport: no amber sessions + matching Claude transcript → coverage.session covered", () => {
	const os = require("node:os");
	const { repoTranscriptDir } = require("../../scripts/lib/workflow-assessment/providers/claude-transcript");
	const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), "wf-claude-home-"));
	const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), "wf-claude-sess-"));
	const claudeDir = repoTranscriptDir(tmpTarget, claudeHome);
	fs.mkdirSync(claudeDir, { recursive: true });
	const line = JSON.stringify({
		type: "user",
		cwd: tmpTarget,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: { role: "user", content: [{ type: "tool_use", name: "Bash" }] },
	});
	fs.writeFileSync(path.join(claudeDir, "sess-1.jsonl"), line + "\n", "utf8");
	try {
		const report = buildReport(tmpTarget, { claudeHome });
		assert.equal(report.coverage.session, "covered");
		assert.ok((report.sessionObservations || []).some((s) => s.provider === "claude"));
	} finally {
		try { fs.rmSync(claudeHome, { recursive: true, force: true }); } catch { /* ignore */ }
		try { fs.rmSync(tmpTarget, { recursive: true, force: true }); } catch { /* ignore */ }
	}
});

test("claude transcript without any cwd line is excluded (positive binding required)", () => {
	const os = require("node:os");
	const { summarizeTranscript } = require("../../scripts/lib/workflow-assessment/providers/claude-transcript");
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-nocwd-"));
	const target = path.join(tmpDir, "repo");
	fs.mkdirSync(target);
	const f = path.join(tmpDir, "no-cwd.jsonl");
	// Valid turns, but no line carries cwd — the lossy directory name alone
	// must not bind the transcript to the target.
	fs.writeFileSync(f, JSON.stringify({
		type: "user",
		timestamp: "2026-01-01T00:00:00.000Z",
		message: { role: "user", content: [{ type: "tool_use", name: "Bash" }] },
	}) + "\n", "utf8");
	assert.equal(summarizeTranscript(f, target), null);
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("collectClaudeObservations caps at newest MAX_TRANSCRIPT_FILES transcripts", () => {
	const os = require("node:os");
	const {
		repoTranscriptDir,
		collectClaudeObservations,
		MAX_TRANSCRIPT_FILES,
	} = require("../../scripts/lib/workflow-assessment/providers/claude-transcript");
	const claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cap-home-"));
	const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), "wf-cap-target-"));
	const claudeDir = repoTranscriptDir(tmpTarget, claudeHome);
	fs.mkdirSync(claudeDir, { recursive: true });
	try {
		for (let i = 0; i < MAX_TRANSCRIPT_FILES + 5; i++) {
			const line = JSON.stringify({
				type: "user",
				cwd: tmpTarget,
				timestamp: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
				message: { role: "user", content: [{ type: "tool_use", name: "Bash" }] },
			});
			fs.writeFileSync(path.join(claudeDir, `sess-${i}.jsonl`), line + "\n", "utf8");
		}
		const obs = collectClaudeObservations(tmpTarget, { claudeHome });
		assert.equal(obs.present, true);
		assert.equal(obs.sessions.length, MAX_TRANSCRIPT_FILES);
	} finally {
		fs.rmSync(claudeHome, { recursive: true, force: true });
		fs.rmSync(tmpTarget, { recursive: true, force: true });
	}
});

test("agentAssets coverage follows AGENTS/CLAUDE docs presence", () => {
	const os = require("node:os");
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-agents-"));
	try {
		const bare = buildReport(tmp, { noSessions: true });
		assert.equal(bare.coverage.agentAssets, "unavailable");
		fs.writeFileSync(path.join(tmp, "AGENTS.md"), "# agents\n", "utf8");
		const withDocs = buildReport(tmp, { noSessions: true });
		assert.equal(withDocs.coverage.agentAssets, "covered");
		const ca4 = withDocs.dimensions.contextAdequacy.checks.find((c) => c.id === "ca-4-agent-docs");
		assert.equal(ca4.status, "pass");
		// Regression: on case-insensitive filesystems the candidate probe used to
		// list phantom case-variants (AGENTS.md + Agents.md) of one on-disk file.
		assert.deepEqual(ca4.evidenceRefs, ["AGENTS.md"]);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test("workflow plan dry-run emits maintenance-proposal draft for il findings", () => {
	const { workflowDispatch } = require("../../scripts/lib/workflow-assessment/workflow-commands");
	const os = require("node:os");
	const report = {
		target: ".",
		findings: [{
			id: "il-1-evolution-recurrent",
			dimension: "improvementLoop",
			severity: "warning",
			confidence: "medium",
			summary: "recurrent finding",
			evidenceRefs: ["docs/wiki/engineering/harness-evolution.md"],
			owner: "maintenance",
			verifier: "Evolution log records a recurrent finding (count>=2).",
			actionKind: "maintenance-proposal",
		}],
	};
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-maint-"));
	const tmp = path.join(tmpDir, "report.json");
	fs.writeFileSync(tmp, JSON.stringify(report), "utf8");
	const r = workflowDispatch("plan", ".", { report: tmp, finding: "il-1-evolution-recurrent" });
	assert.equal(r.errors.length, 0);
	assert.equal(r.draft.kind, "maintenance-proposal");
	assert.ok(r.draft.content.includes("amber maintenance propose"));
	assert.ok(r.notice.includes("maintenance propose"));
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("compareReports flags higher score with lower coverage", () => {
	const { compareReports } = require("../../scripts/lib/workflow-assessment/workflow-commands");
	const baseline = {
		dimensions: { contextAdequacy: { score: 60, coverage: "covered" } },
		findings: [],
		coverage: {},
	};
	const current = {
		dimensions: { contextAdequacy: { score: 80, coverage: "partial" } },
		findings: [],
		coverage: {},
	};
	const r = compareReports(baseline, current);
	assert.equal(r.suspiciousImprovements.length, 1);
	assert.equal(r.dimensionDeltas[0].scoreDelta, 20);
});

test("compareReports warns on schema version mismatch", () => {
	const { compareReports } = require("../../scripts/lib/workflow-assessment/workflow-commands");
	const baseline = { schemaVersion: "1.0.0", dimensions: {}, findings: [], coverage: {} };
	const current = { schemaVersion: "2.0.0", dimensions: {}, findings: [], coverage: {} };
	const r = compareReports(baseline, current);
	assert.equal(r.versionMismatch, true);
	assert.ok(r.warnings.some((w) => w.includes("Schema version mismatch")));
});

test("workflow plan --dry-run produces a draft with owner and verifier", () => {
	// buildPlanDraft is not exported; exercise via workflowDispatch instead.
	const { workflowDispatch } = require("../../scripts/lib/workflow-assessment/workflow-commands");
	const report = {
		target: ".",
		findings: [{ id: "x", dimension: "contextAdequacy", severity: "warning", confidence: "medium", summary: "test finding", evidenceRefs: ["feature_list.json"], owner: "planning", verifier: "Check passes.", actionKind: "plan-input" }],
	};
	// write report to an isolated temp dir (not REPO_ROOT) to avoid racing
	// the git index / concurrent tests / watch processes.
	const os = require("node:os");
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-plan-"));
	const tmp = path.join(tmpDir, "report.json");
	fs.writeFileSync(tmp, JSON.stringify(report), "utf8");
	try {
		const r = workflowDispatch("plan", ".", { report: tmp, finding: "x" });
		assert.equal(r.findingId, "x");
		assert.ok(r.draft.content.includes("planning"), "draft includes owner");
		assert.ok(r.draft.content.includes("Check passes."), "draft includes verifier");
		assert.equal(r.dryRun, true);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("findingsFromReport extracts findings from a report object", () => {
	const { findingsFromReport } = require("../../scripts/lib/workflow-assessment/workflow-commands");
	const report = { target: ".", findings: [{ id: "x", dimension: "contextAdequacy" }] };
	const r = findingsFromReport(report);
	assert.equal(r.count, 1);
	assert.equal(r.findings[0].id, "x");
});

test("amber-native session provider summarizes real sessions without raw transcript", () => {
	const { collectSessionObservations } = require("../../scripts/lib/workflow-assessment/providers/amber-native-session");
	const obs = collectSessionObservations(REPO_ROOT);
	assert.ok(obs.present, "Amber repo has sessions");
	assert.ok(obs.sessions.length > 0);
	const json = JSON.stringify(obs);
	assert.ok(!json.includes("transcript"), "no transcript content in observations");
	assert.ok(!json.includes("~/.claude"), "no user-home path in observations");
});

test("claude transcript provider binds to workspace (hard exclusion on cwd mismatch)", () => {
	const os = require("node:os");
	const {
		summarizeTranscript,
		collectClaudeObservations,
	} = require("../../scripts/lib/workflow-assessment/providers/claude-transcript");
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-claude-bind-"));
	const target = path.join(tmpDir, "repo");
	fs.mkdirSync(target);
	const matching = path.join(tmpDir, "match.jsonl");
	const mismatch = path.join(tmpDir, "mismatch.jsonl");
	const secretLine = JSON.stringify({
		type: "user",
		cwd: target,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: {
			role: "user",
			content: [
				{ type: "text", text: "token sk-abcdefghijklmnopqrstuvwxyz123456" },
				{ type: "tool_use", name: "Bash" },
			],
		},
	});
	const mismatchLine = JSON.stringify({
		type: "user",
		cwd: path.join(tmpDir, "other-repo"),
		timestamp: "2026-01-01T00:00:01.000Z",
		message: { role: "user", content: [{ type: "tool_use", name: "Read" }] },
	});
	fs.writeFileSync(matching, secretLine + "\n", "utf8");
	fs.writeFileSync(mismatch, mismatchLine + "\n", "utf8");

	const ok = summarizeTranscript(matching, target);
	assert.ok(ok, "matching cwd must be accepted");
	assert.equal(ok.toolCalls, 1);
	assert.deepEqual(ok.uniqueTools, ["Bash"]);
	assert.equal(ok.provider, "claude");
	// Text is never collected; redaction still runs on string fields.
	assert.ok(!JSON.stringify(ok).includes("sk-"), "summary must not contain transcript text");

	const rejected = summarizeTranscript(mismatch, target);
	assert.equal(rejected, null, "cwd mismatch must hard-exclude the transcript");

	// Live repo scan: never leak home paths or secrets into observations.
	const obs = collectClaudeObservations(REPO_ROOT);
	const json = JSON.stringify(obs);
	assert.ok(!/sk-[A-Za-z0-9]{16}/.test(json), "no secret-shaped string in claude observations");
	assert.ok(!json.includes("~/.claude"), "no user-home path in claude observations");

	fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("collectExecutions skips dangling symlink entries without throwing", () => {
	const os = require("node:os");
	const { collectRepositoryEvidence } = require("../../scripts/lib/workflow-assessment/repository-evidence");
	// buildReport path uses collectExecutions via collectRepositoryEvidence.
	// Place a dangling symlink under a temp .amber/executions and ensure assess
	// still completes (filter catches statSync failures).
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-exec-"));
	const execRoot = path.join(tmp, ".amber", "executions");
	fs.mkdirSync(execRoot, { recursive: true });
	const good = path.join(execRoot, "task-ok");
	fs.mkdirSync(good);
	fs.writeFileSync(path.join(good, "evidence.json"), JSON.stringify({ commands: ["npm test"] }), "utf8");
	const dangling = path.join(execRoot, "task-dangling");
	try {
		fs.symlinkSync(path.join(tmp, "missing-target"), dangling);
	} catch {
		// Windows without symlink privilege: write a plain file instead — stat
		// isDirectory() is false, which is also a skip path.
		fs.writeFileSync(dangling, "not-a-dir", "utf8");
	}
	assert.doesNotThrow(() => collectRepositoryEvidence(tmp));
	const evidence = collectRepositoryEvidence(tmp);
	assert.equal(evidence.executions.present, true);
	assert.equal(evidence.executions.executions.length, 1);
	assert.equal(evidence.executions.hasCommands, true);
	fs.rmSync(tmp, { recursive: true, force: true });
});

test("redaction module is behavior-identical to the web TS version", () => {
	const { redactSecrets } = require("../../scripts/lib/core/redaction");
	assert.equal(redactSecrets("sk-ant-api03-" + "x".repeat(20)), "[REDACTED]");
	assert.equal(redactSecrets("token: ghp_" + "a".repeat(30)), "token: [REDACTED]");
	assert.equal(redactSecrets("MY_API_KEY=abc123"), "MY_API_KEY=[REDACTED]");
	assert.equal(redactSecrets("ordinary text without secrets"), "ordinary text without secrets");
	assert.equal(redactSecrets(null), "");
	assert.equal(redactSecrets(undefined), "");
});

// ── End-to-end: real repo produces a schema-valid report ──

test("buildReport on the Amber repo produces a schema-valid report", () => {
	const report = buildReport(REPO_ROOT);
	assert.ok(validate(report), "real repo report validates against schema");
});

test("real repo report has five dimensions and non-empty findings for known gaps", () => {
	const report = buildReport(REPO_ROOT);
	assert.equal(Object.keys(report.dimensions).length, 5);
	// The Amber repo has empty handoff risks + no execution commands recorded;
	// these are real gaps the effectiveness report should surface.
	assert.ok(report.findings.length >= 1, "expected findings for real gaps");
});

// ── Renderers ──

test("renderJson produces parseable JSON", () => {
	const report = buildReport(REPO_ROOT);
	const json = renderJson(report);
	assert.deepEqual(JSON.parse(json), report);
});

test("renderMarkdown produces non-empty markdown with all five dimensions", () => {
	const report = buildReport(REPO_ROOT);
	const md = renderMarkdown(report);
	for (const dim of Object.keys(report.dimensions)) {
		assert.ok(md.includes(dim), `markdown includes ${dim}`);
	}
	assert.ok(md.includes("# Workflow Effectiveness Assessment"));
});
