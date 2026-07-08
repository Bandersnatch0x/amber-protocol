"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	isLikelyDocumentation,
	isWikiLike,
	buildSuggestedPatches,
	buildAuditUnknowns,
	buildNextSafeCommand,
	addCandidateCommand,
	buildPythonCandidates,
	hasNextActionInContent,
	hasVerificationCommandInContent,
} = require("../../scripts/lib/core/audit");

// Characterization tests for the pure helpers exported from audit.js. These
// functions sit behind the fs-coupled auditTargetRepo/auditProductRepo flow;
// they are the testable seam. Pin current behavior (including its quirks)
// before any future refactor of the audit detection pipeline.

test("isLikelyDocumentation matches README/AGENTS/CLAUDE case-insensitively", () => {
	assert.equal(isLikelyDocumentation("README.md"), true);
	assert.equal(isLikelyDocumentation("readme.md"), true);
	assert.equal(isLikelyDocumentation("README.MD"), true);
	assert.equal(isLikelyDocumentation("AGENTS.md"), true);
	assert.equal(isLikelyDocumentation("agents.md"), true);
	assert.equal(isLikelyDocumentation("CLAUDE.md"), true);
	assert.equal(isLikelyDocumentation("claude.md"), true);
});

test("isLikelyDocumentation treats anything under docs/ as documentation regardless of extension", () => {
	assert.equal(isLikelyDocumentation("docs/x.md"), true);
	assert.equal(isLikelyDocumentation("docs/x.txt"), true);
	assert.equal(isLikelyDocumentation("DOCS/x.md"), true);
});

test("isLikelyDocumentation matches any .md path even outside docs/", () => {
	assert.equal(isLikelyDocumentation("src/foo.md"), true);
	assert.equal(isLikelyDocumentation("foo/agent.md"), true);
});

test("isLikelyDocumentation returns false for non-doc, non-md paths and empty input", () => {
	assert.equal(isLikelyDocumentation("src/foo.ts"), false);
	assert.equal(isLikelyDocumentation("readme.txt"), false);
	assert.equal(isLikelyDocumentation("a.markdown"), false); // only exact .md suffix
	assert.equal(isLikelyDocumentation(""), false);
});

test("isWikiLike matches docs/, wiki, architecture, runbook, progress, handoff case-insensitively", () => {
	assert.equal(isWikiLike("docs/x"), true);
	assert.equal(isWikiLike("DOCS/x"), true);
	assert.equal(isWikiLike("a/wiki/b"), true);
	assert.equal(isWikiLike("mywiki.md"), true);
	assert.equal(isWikiLike("architecture.md"), true);
	assert.equal(isWikiLike("runbook.md"), true);
	assert.equal(isWikiLike("progress.md"), true);
	assert.equal(isWikiLike("handoff.md"), true);
	assert.equal(isWikiLike("HANDOFF.md"), true);
});

test("isWikiLike returns false for unrelated paths", () => {
	assert.equal(isWikiLike("foo.ts"), false);
	assert.equal(isWikiLike(""), false);
});

test("buildSuggestedPatches returns an empty array when there are no conflicts", () => {
	assert.deepEqual(buildSuggestedPatches([]), []);
});

test("buildSuggestedPatches maps each conflict to a human-approval patch", () => {
	const result = buildSuggestedPatches(["AGENTS.md", "CLAUDE.md"]);
	assert.equal(result.length, 2);
	assert.deepEqual(result, [
		{
			file: "AGENTS.md",
			requiresApproval: true,
			reason: "Existing project instruction file must be merged by a human.",
			suggestion:
				"Review the Amber template and add a link to docs/wiki/index.md if appropriate.",
		},
		{
			file: "CLAUDE.md",
			requiresApproval: true,
			reason: "Existing project instruction file must be merged by a human.",
			suggestion:
				"Review the Amber template and add a link to docs/wiki/index.md if appropriate.",
		},
	]);
});

test("buildNextSafeCommand wraps the target in JSON.stringify so spaces and backslashes are quoted", () => {
	assert.equal(
		buildNextSafeCommand("/some/repo"),
		'node scripts/amber.js init --target "/some/repo"',
	);
	assert.equal(
		buildNextSafeCommand("a b"),
		'node scripts/amber.js init --target "a b"',
	);
	// Backslashes survive JSON stringification (escaped as \\).
	assert.equal(
		buildNextSafeCommand("C:\\proj\\x"),
		'node scripts/amber.js init --target "C:\\\\proj\\\\x"',
	);
});

test("buildAuditUnknowns flags a missing command when nothing is detected", () => {
	assert.deepEqual(buildAuditUnknowns([]), [
		"No package, test, build, or verification command detected.",
	]);
});

test("buildAuditUnknowns surfaces tooling evidence only when no command is present", () => {
	// With a command, no missing-command unknowns are emitted.
	assert.deepEqual(
		buildAuditUnknowns([{ source: "package.json", name: "test", command: "npm test" }]),
		[],
	);
	// Without a command but with tooling evidence, both the missing-command and
	// the tooling-evidence unknowns appear, joined by source name.
	assert.deepEqual(
		buildAuditUnknowns([], [{ source: "pyproject.toml", name: "python" }]),
		[
			"No package, test, build, or verification command detected.",
			"Tooling evidence found (pyproject.toml), but the exact verification command is unknown.",
		],
	);
});

test("buildAuditUnknowns formats parse issues and candidate-command notices in order", () => {
	// Parse issues appear after the missing-command notice.
	assert.deepEqual(
		buildAuditUnknowns([], [], [{ source: "package.json", message: "boom" }]),
		[
			"No package, test, build, or verification command detected.",
			"package.json could not be parsed: boom",
		],
	);
	// Candidate commands suppress the missing-command notice — the candidates
	// themselves are the partial detection, so "no command detected" is misleading.
	assert.deepEqual(
		buildAuditUnknowns([], [], [], [{ command: "python -m pytest" }]),
		[
			"Candidate verification commands require confirmation before being treated as project commands.",
		],
	);
	// All four channels together preserve insertion order: parse, tooling,
	// candidates.  The missing-command notice is suppressed when candidates exist.
	assert.deepEqual(
		buildAuditUnknowns(
			[],
			[{ source: "x", name: "python" }],
			[{ source: "p", message: "m" }],
			[{ command: "c" }],
		),
		[
			"p could not be parsed: m",
			"Tooling evidence found (x); candidate commands proposed below require project-owner confirmation.",
			"Candidate verification commands require confirmation before being treated as project commands.",
		],
	);
});

test("buildAuditUnknowns emits only the candidate notice when a command exists but candidates also exist", () => {
	assert.deepEqual(
		buildAuditUnknowns([{ command: "x" }], [], [], [{ command: "c" }]),
		[
			"Candidate verification commands require confirmation before being treated as project commands.",
		],
	);
});

test("buildAuditUnknowns throws when commands is omitted (no default on the first parameter)", () => {
	// The signature only defaults parameters 2-4; calling with zero args leaves
	// commands undefined and the function throws on .length. Pin this so a future
	// default is a deliberate change.
	assert.throws(
		() => buildAuditUnknowns(),
		/Cannot read properties of undefined \(reading 'length'\)/,
	);
});

test("addCandidateCommand pushes a new command and dedups by the command string only", () => {
	const arr = [];
	addCandidateCommand(arr, { command: "x", name: "n" });
	addCandidateCommand(arr, { command: "x", name: "other" }); // same command -> skipped
	addCandidateCommand(arr, { command: "y", name: "n" }); // new command -> pushed
	assert.deepEqual(arr, [
		{ command: "x", name: "n" },
		{ command: "y", name: "n" },
	]);
});

test("addCandidateCommand mutates and returns nothing (undefined)", () => {
	const arr = [];
	const ret = addCandidateCommand(arr, { command: "z" });
	assert.equal(ret, undefined);
	assert.equal(arr.length, 1);
});

// ---- buildPythonCandidates: pure decision core of detectCandidateCommands ----

test("buildPythonCandidates emits the default pytest candidate when no evidence", () => {
	const [candidate] = buildPythonCandidates({
		hasTestsDirectory: false,
		hasPytestEvidence: false,
		hasRuffEvidence: false,
	});
	assert.equal(candidate.name, "pytest");
	assert.equal(candidate.source, "python tooling evidence");
	assert.equal(candidate.command, "python -m pytest");
	assert.equal(candidate.confidence, "candidate");
});

test("buildPythonCandidates labels pytest source as tests/ when a tests dir exists", () => {
	const [candidate] = buildPythonCandidates({
		hasTestsDirectory: true,
		hasPytestEvidence: true,
		hasRuffEvidence: false,
	});
	assert.equal(candidate.name, "pytest");
	assert.equal(candidate.source, "tests/");
});

test("buildPythonCandidates labels pytest source as python tooling evidence without a tests dir", () => {
	const [candidate] = buildPythonCandidates({
		hasTestsDirectory: false,
		hasPytestEvidence: true,
		hasRuffEvidence: false,
	});
	assert.equal(candidate.name, "pytest");
	assert.equal(candidate.source, "python tooling evidence");
});

test("buildPythonCandidates emits ruff alone when only ruff evidence", () => {
	const result = buildPythonCandidates({
		hasTestsDirectory: false,
		hasPytestEvidence: false,
		hasRuffEvidence: true,
	});
	assert.equal(result.length, 1);
	assert.equal(result[0].name, "ruff");
	assert.equal(result[0].command, "python -m ruff check .");
});

test("buildPythonCandidates emits pytest then ruff when both present", () => {
	const result = buildPythonCandidates({
		hasTestsDirectory: true,
		hasPytestEvidence: true,
		hasRuffEvidence: true,
	});
	assert.equal(result.length, 2);
	assert.equal(result[0].name, "pytest");
	assert.equal(result[1].name, "ruff");
});

test("buildPythonCandidates does not emit the default when pytest evidence exists", () => {
	const result = buildPythonCandidates({
		hasTestsDirectory: false,
		hasPytestEvidence: true,
		hasRuffEvidence: false,
	});
	assert.equal(result.length, 1);
	assert.equal(result[0].name, "pytest");
});

// ---- hasNextActionInContent: pure line analysis of the handoff doc ----

test("hasNextActionInContent returns false when no Next Action section", () => {
	assert.equal(hasNextActionInContent("# Summary\n\nnothing here\n"), false);
});

test("hasNextActionInContent matches both Next Action and Next Actions headings", () => {
	assert.equal(
		hasNextActionInContent("## Next Action\n\n- Fix the bug\n"),
		true,
	);
	assert.equal(
		hasNextActionInContent("## Next Actions\n\n- Fix the bug\n"),
		true,
	);
});

test("hasNextActionInContent treats sentinel placeholders as no action", () => {
	for (const sentinel of ["none", "n/a", "tbd", "todo", "pending"]) {
		assert.equal(
			hasNextActionInContent(`## Next Action\n\n- ${sentinel}\n`),
			false,
			`sentinel "${sentinel}" should be treated as no action`,
		);
	}
});

test("hasNextActionInContent ignores blank lines and HTML comments", () => {
	assert.equal(
		hasNextActionInContent("## Next Action\n\n<!-- todo later -->\n\n"),
		false,
	);
});

test("hasNextActionInContent strips list markers and trailing dots before matching", () => {
	assert.equal(
		hasNextActionInContent("## Next Action\n\n- none.\n"),
		false,
	);
	assert.equal(
		hasNextActionInContent("## Next Action\n\n- Ship the feature.\n"),
		true,
	);
});

test("hasNextActionInContent returns false for an empty section body", () => {
	assert.equal(hasNextActionInContent("## Next Action\n\n"), false);
});

test("hasNextActionInContent recognizes the long-form 'no next actions recorded' sentinel", () => {
	assert.equal(
		hasNextActionInContent("## Next Action\n\nNo next actions are recorded here.\n"),
		false,
	);
});

// ---- hasVerificationCommandInContent: pure fenced-block detection ----

test("hasVerificationCommandInContent detects a sh fenced block", () => {
	assert.equal(
		hasVerificationCommandInContent("```\n```"),
		false,
	);
	assert.equal(
		hasVerificationCommandInContent("```sh\nnpm test\n```"),
		true,
	);
});

test("hasVerificationCommandInContent detects bash/powershell/cmd fenced blocks", () => {
	assert.equal(hasVerificationCommandInContent("```bash\nmake test\n```"), true);
	assert.equal(hasVerificationCommandInContent("```powershell\nInvoke-Pester\n```"), true);
	assert.equal(hasVerificationCommandInContent("```cmd\ndir\n```"), true);
});

test("hasVerificationCommandInContent detects a lang-less fenced block with content", () => {
	assert.equal(hasVerificationCommandInContent("```\nnode --test\n```"), true);
});

test("hasVerificationCommandInContent returns false for plain text without a fence", () => {
	assert.equal(
		hasVerificationCommandInContent("Run npm test to verify.\n"),
		false,
	);
});

test("hasVerificationCommandInContent returns false for an empty fence", () => {
	assert.equal(hasVerificationCommandInContent("```\n```"), false);
});
