"use strict";

// Unit tests for the shared deterministic V1–V3 admission invariant
// (scripts/lib/core/evolution-validity.js, trusted-control evolution
// contract §6). The invariant is implemented once here and consumed by the
// maintenance proposal path; F064 admission consumes it in a later slice.
//
// Contract under test:
//   V1 validity:no-evidence      — ≥1 evidence reference, EVERY reference
//                                  resolved against its owning source
//                                  (bounded path / evidence receipt), never
//                                  an arbitrary nonempty string.
//   V2 validity:capability-reduction — no declared operation deletes or
//                                  downgrades a capability-registry entry;
//                                  aliases and unknown shapes never pass
//                                  as safe.
//   V3 validity:eval-only-claim  — readiness AND effectiveness statements,
//                                  neither solely an eval reference.
// Passing proves form, never semantic truth (spec E5).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	VALIDITY_REASON_CODES,
	validateEvolutionAdmission,
	isEvalOnlyReference,
} = require("../../scripts/lib/core/evolution-validity");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");

function tmpTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `evo-validity-${label}-`));
}

function writeFile(targetRoot, relPath, content) {
	const fullPath = path.join(targetRoot, ...relPath.split("/"));
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, content);
	return relPath;
}

const TWO_AXIS_EFFECT = {
	readiness: "wiki instructions stay parseable after the change",
	effectiveness: "repeated fixture failures drop across sessions",
};

// ── closed reason-code set (spec §11) ──

test("validity reason codes are the spec's closed set of three", () => {
	assert.deepEqual(VALIDITY_REASON_CODES, [
		"validity:no-evidence",
		"validity:capability-reduction",
		"validity:eval-only-claim",
	]);
});

// ── V1: evidence resolution ──

test("V1 passes with one resolvable bounded path reference", () => {
	const target = tmpTarget("v1-ok");
	try {
		const rel = writeFile(target, "docs/wiki/runbook.md", "# Runbook\nline two\n");
		const result = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [{ kind: "path", path: rel, line: 2 }],
			expectedEffect: TWO_AXIS_EFFECT,
		});
		assert.deepEqual(result, { ok: true });
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V1 fails when evidenceReferences is absent, empty, or not an array", () => {
	const target = tmpTarget("v1-missing");
	try {
		for (const evidenceReferences of [undefined, [], "see the transcripts", 42, null]) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences,
				expectedEffect: TWO_AXIS_EFFECT,
			});
			assert.equal(
				result.ok,
				false,
				`absent/empty/malformed must fail: ${JSON.stringify(evidenceReferences)}`,
			);
			assert.equal(result.code, "validity:no-evidence");
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V1 fails on malformed reference shapes — never pass-as-safe", () => {
	const target = tmpTarget("v1-shape");
	try {
		const rel = writeFile(target, "docs/wiki/runbook.md", "# Runbook\n");
		for (const ref of [
			"docs/wiki/runbook.md",
			42,
			null,
			{},
			{ kind: "hyperlink", url: "https://example.com" },
			{ kind: "path" },
			{ kind: "path", path: "" },
			{ kind: "path", path: rel, extra: "no" },
			{ kind: "receipt" },
			{ kind: "receipt", id: "" },
		]) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences: [ref],
				expectedEffect: TWO_AXIS_EFFECT,
			});
			assert.equal(result.ok, false, `malformed ref must fail: ${JSON.stringify(ref)}`);
			assert.equal(result.code, "validity:no-evidence");
			assert.match(result.detail, /malformed-shape/);
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V1 fails on absolute, escaping, and unresolvable paths with explicit reason classes", () => {
	const target = tmpTarget("v1-unresolvable");
	try {
		writeFile(target, "docs/wiki/runbook.md", "# Runbook\n");
		const cases = [
			[{ kind: "path", path: "/etc/passwd" }, /absolute-path/],
			[{ kind: "path", path: "../outside.md" }, /escapes-root/],
			[{ kind: "path", path: "docs/wiki/missing.md" }, /not-found/],
		];
		// The drive-letter form is absolute on win32 only; on POSIX it is a
		// legal relative filename (containing a colon), so asserting
		// /absolute-path/ for it there would be asserting a platform
		// coincidence. Covered on the platform where it means something.
		if (process.platform === "win32") {
			cases.push([{ kind: "path", path: "C:/windows/system32/config.sys" }, /absolute-path/]);
		}
		for (const [ref, pattern] of cases) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences: [ref],
				expectedEffect: TWO_AXIS_EFFECT,
			});
			assert.equal(result.ok, false, `unresolvable ref must fail: ${JSON.stringify(ref)}`);
			assert.equal(result.code, "validity:no-evidence");
			assert.match(result.detail, pattern);
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V1 fails when the cited line is out of range and passes for line 1", () => {
	const target = tmpTarget("v1-line");
	try {
		const rel = writeFile(target, "docs/wiki/runbook.md", "# Runbook\nline two\n");
		const outOfRange = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [{ kind: "path", path: rel, line: 9999 }],
			expectedEffect: TWO_AXIS_EFFECT,
		});
		assert.equal(outOfRange.ok, false);
		assert.equal(outOfRange.code, "validity:no-evidence");
		assert.match(outOfRange.detail, /line-out-of-range/);

		const inRange = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [{ kind: "path", path: rel, line: 1 }],
			expectedEffect: TWO_AXIS_EFFECT,
		});
		assert.deepEqual(inRange, { ok: true });
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V1 requires EVERY reference to resolve — a fabricated citation riding a real one fails", () => {
	const target = tmpTarget("v1-all");
	try {
		const rel = writeFile(target, "docs/wiki/runbook.md", "# Runbook\n");
		const result = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [
				{ kind: "path", path: rel },
				{ kind: "path", path: "docs/wiki/invented.md" },
			],
			expectedEffect: TWO_AXIS_EFFECT,
		});
		assert.equal(result.ok, false, "one resolvable reference must not bless an invented one");
		assert.equal(result.code, "validity:no-evidence");
		assert.match(result.detail, /reference #2/);
		assert.match(result.detail, /not-found/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V1 resolves a receipt reference against the evidence receipt ledger", () => {
	const target = tmpTarget("v1-receipt");
	try {
		const seeded = registerPrincipal(target, {
			id: "ci-runner",
			principalKind: "service",
			capability: "execute",
		});
		assert.equal(seeded.ok, true, (seeded.errors || []).join("; "));
		const recorded = recordEvidence(target, {
			id: "evidence/run-1",
			producer: "ci-runner",
			assurance: "observed",
			scope: "F063",
			subject: "spec/evolution@1",
			inputs: ["npm test"],
			tools: ["node"],
			environment: { os: "win32" },
			outputs: ["all green"],
			status: "pass",
		});
		assert.equal(recorded.ok, true, (recorded.errors || []).join("; "));

		const resolved = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [{ kind: "receipt", id: "evidence/run-1" }],
			expectedEffect: TWO_AXIS_EFFECT,
		});
		assert.deepEqual(resolved, { ok: true });

		const missing = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [{ kind: "receipt", id: "evidence/never-recorded" }],
			expectedEffect: TWO_AXIS_EFFECT,
		});
		assert.equal(missing.ok, false);
		assert.equal(missing.code, "validity:no-evidence");
		assert.match(missing.detail, /receipt-not-found/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ── V2: capability reduction ──

test("V2 passes with no declared operations (vacuously — nothing is declared)", () => {
	const target = tmpTarget("v2-none");
	try {
		for (const operations of [undefined, null, []]) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences: [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }],
				operations,
				expectedEffect: TWO_AXIS_EFFECT,
			});
			assert.deepEqual(result, { ok: true }, `no declared operations must pass: ${operations}`);
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V2 refuses declared deletion and downgrade of capability-registry entries", () => {
	const target = tmpTarget("v2-registry");
	try {
		for (const verb of ["remove", "update"]) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences: [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }],
				operations: [{ verb, path: ".amber/runner/registry.jsonl" }],
				expectedEffect: TWO_AXIS_EFFECT,
			});
			assert.equal(result.ok, false, `"${verb}" on the registry must fail`);
			assert.equal(result.code, "validity:capability-reduction");
		}

		// The registry's own file may be created/appended through its owner
		// surface (F052 typed mutation) — V2 refuses delete/downgrade only.
		const benign = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [{ kind: "path", path: "docs/wiki/x.md" }],
			operations: [{ verb: "create", path: ".amber/runner/registry.jsonl" }],
			expectedEffect: TWO_AXIS_EFFECT,
		});
		assert.deepEqual(benign, { ok: true }, "create is not a reduction; F052 owns registration");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V2 refuses registry targeting through path aliases and mixed case", () => {
	const target = tmpTarget("v2-alias");
	try {
		const aliases = [
			".amber\\runner\\registry.jsonl",
			"./.amber/runner/registry.jsonl",
			".amber/runner/./registry.jsonl",
			".amber//runner/registry.jsonl",
			".AMBER/RUNNER/REGISTRY.JSONL",
			".amber/runner/../runner/registry.jsonl",
		];
		for (const alias of aliases) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences: [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }],
				operations: [{ verb: "remove", path: alias }],
				expectedEffect: TWO_AXIS_EFFECT,
			});
			assert.equal(result.ok, false, `alias must not slip through: ${alias}`);
			assert.equal(result.code, "validity:capability-reduction");
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V2 refuses unknown or malformed operation shapes — never pass-as-safe", () => {
	const target = tmpTarget("v2-shape");
	try {
		const evidence = [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }];
		for (const operations of [
			"delete the registry",
			42,
			[{ verb: "delete", path: ".amber/runner/registry.jsonl" }],
			[{ path: ".amber/runner/registry.jsonl" }],
			[{ verb: "remove" }],
			[{ verb: "remove", path: 42 }],
			["remove"],
		]) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences: evidence,
				operations,
				expectedEffect: TWO_AXIS_EFFECT,
			});
			assert.equal(result.ok, false, `unknown shape must fail: ${JSON.stringify(operations)}`);
			assert.equal(result.code, "validity:capability-reduction");
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V2 passes benign operations on ordinary destinations", () => {
	const target = tmpTarget("v2-benign");
	try {
		const result = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }],
			operations: [
				{ verb: "create", path: "docs/wiki/agent/friction/deadbeef.md", summary: "note" },
				{ verb: "update", path: "AGENTS.md" },
				{ verb: "remove", path: "docs/wiki/draft.md" },
			],
			expectedEffect: TWO_AXIS_EFFECT,
		});
		assert.deepEqual(result, { ok: true });
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ── V3: dual-axis effect statement ──

test("V3 fails when the effect statement is absent or malformed", () => {
	const target = tmpTarget("v3-missing");
	try {
		const evidence = [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }];
		for (const expectedEffect of [undefined, null, "improves things", 42, [], { readiness: "a" }]) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences: evidence,
				expectedEffect,
			});
			assert.equal(
				result.ok,
				false,
				`absent/malformed effect must fail: ${JSON.stringify(expectedEffect)}`,
			);
			assert.equal(result.code, "validity:eval-only-claim");
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V3 fails when an axis is missing, empty, or not a string", () => {
	const target = tmpTarget("v3-axis");
	try {
		const evidence = [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }];
		for (const expectedEffect of [
			{ readiness: "parseable", effectiveness: "   " },
			{ readiness: "   ", effectiveness: "fewer failures" },
			{ readiness: "parseable" },
			{ effectiveness: "fewer failures" },
			{ readiness: 42, effectiveness: "fewer failures" },
			{ readiness: "parseable", effectiveness: "fewer failures", note: "extra" },
		]) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences: evidence,
				expectedEffect,
			});
			assert.equal(
				result.ok,
				false,
				`missing/empty axis must fail: ${JSON.stringify(expectedEffect)}`,
			);
			assert.equal(result.code, "validity:eval-only-claim");
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V3 fails when an axis is solely an eval reference", () => {
	const target = tmpTarget("v3-evalonly");
	try {
		const evidence = [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }];
		for (const expectedEffect of [
			{ readiness: "eval F058 passes", effectiveness: "see eval results" },
			{ readiness: "the eval suite is green", effectiveness: "retrieval latency drops" },
			{ readiness: "wiki stays parseable", effectiveness: "eval run report F063" },
		]) {
			const result = validateEvolutionAdmission({
				targetRoot: target,
				evidenceReferences: evidence,
				expectedEffect,
			});
			assert.equal(result.ok, false, `eval-only axis must fail: ${JSON.stringify(expectedEffect)}`);
			assert.equal(result.code, "validity:eval-only-claim");
			assert.match(result.detail, /eval/);
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V3 passes a genuine two-axis statement and never scores its soundness", () => {
	const target = tmpTarget("v3-pass");
	try {
		const result = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }],
			expectedEffect: TWO_AXIS_EFFECT,
		});
		assert.deepEqual(result, { ok: true });
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ── ordering and the eval-only detector ──

test("rules run in V1→V2→V3 order; the first failure wins", () => {
	const target = tmpTarget("order");
	try {
		const result = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: [],
			operations: [{ verb: "remove", path: ".amber/runner/registry.jsonl" }],
			expectedEffect: { readiness: "eval passes", effectiveness: "eval passes" },
		});
		assert.equal(result.code, "validity:no-evidence", "V1 fails first");

		const evidence = [{ kind: "path", path: writeFile(target, "docs/wiki/x.md", "x") }];
		const v2First = validateEvolutionAdmission({
			targetRoot: target,
			evidenceReferences: evidence,
			operations: [{ verb: "remove", path: ".amber/runner/registry.jsonl" }],
			expectedEffect: { readiness: "eval passes", effectiveness: "eval passes" },
		});
		assert.equal(v2First.code, "validity:capability-reduction", "V2 precedes V3");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("isEvalOnlyReference detects eval-only text and keeps real statements", () => {
	const evalOnly = [
		"eval",
		"F058 eval",
		"see eval results",
		"the eval suite passes",
		"eval run report F063",
		"Eval: F050",
	];
	for (const text of evalOnly) {
		assert.equal(isEvalOnlyReference(text), true, `must classify as eval-only: ${text}`);
	}
	const real = [
		"wiki instructions stay parseable",
		"retrieval latency drops across sessions",
		"the eval suite passes and wiki retrieval stays correct",
		"测试覆盖双轴且描述真实效果",
	];
	for (const text of real) {
		assert.equal(isEvalOnlyReference(text), false, `must keep as a real statement: ${text}`);
	}
});
