"use strict";

// Integration tests for evolution Slice 2 (B2M): structured evolution
// findings flowing from the REAL maintenance inspection producer
// (inspectMaintenance → collectEvidence → evolution-findings) into
// proposeMaintenance, where the shared V1–V3 admission invariant
// (evolution-validity.js) decides between a normal proposal and a durable
// ## Rejection record.
//
// Pinned boundaries:
//   - legacy text APIs (countEvolutionFindings / significantEvolutionFindings
//     / extractEvolutionFindings) keep their shapes; block interiors are not
//     counted as legacy prose;
//   - legacy observations stay explicitly legacy — never promoted as
//     validated structured findings;
//   - malformed or secret-bearing external attribution is refused at the
//     pre-admission boundary (nothing written), never laundered as legacy;
//   - a valid attribution failing V1–V3 writes the owning proposal record
//     with a durable ## Rejection section (reason code, timestamp, redacted
//     summary, canonical correlation hash); retry finds prior rejections by
//     that correlation and preserves history;
//   - proposals are propose-only: no target source file is ever touched.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runMaintenanceAction } = require("../../scripts/lib/core/maintenance");
const { proposeMaintenance } = require("../../scripts/lib/core/maintenance-propose");
const {
	countEvolutionFindings,
	extractStructuredFindings,
} = require("../../scripts/lib/core/evolution-findings");
// The evidence facade is the sanctioned surface for collectEvidence (F014-M4:
// ordinary tests never import maintenance/internal/* directly).
const { evidence: collectEvidence } = require("../../scripts/lib/maintenance");

const ATTRIBUTION = {
	entrySurface: "tool-output",
	impactSurface: "target-repo",
	failureMode: "fixture drift between docs and source",
	responsibleArtifact: "wiki",
};

const TWO_AXIS_EFFECT = {
	readiness: "wiki instructions stay parseable after the change",
	effectiveness: "repeated fixture failures drop across sessions",
};

function tmpTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `evo-admission-${label}-`));
}

function evolutionPath(target) {
	return path.join(target, "docs", "wiki", "engineering", "harness-evolution.md");
}

function writeEvolution(target, content) {
	fs.mkdirSync(path.dirname(evolutionPath(target)), { recursive: true });
	fs.writeFileSync(evolutionPath(target), content);
}

function structuredBlock(body) {
	return ["```amber-finding", JSON.stringify(body, null, 2), "```", ""].join("\n");
}

// One significant structured finding: the block plus one legacy line with the
// same failure-mode text (recurrence ≥ 2), citing a real fixture file.
function seedSignificantStructured(target, overrides = {}) {
	const evidenceFile = path.join(target, "docs", "wiki", "runbook.md");
	fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
	fs.writeFileSync(evidenceFile, "# Runbook\nline two\n");
	const body = {
		findingAttribution: overrides.findingAttribution || ATTRIBUTION,
		evidenceReferences: overrides.evidenceReferences || [
			{ kind: "path", path: "docs/wiki/runbook.md", line: 1 },
		],
		...(overrides.expectedEffect === null
			? {}
			: { expectedEffect: overrides.expectedEffect || TWO_AXIS_EFFECT }),
		...(overrides.operations ? { operations: overrides.operations } : {}),
	};
	writeEvolution(
		target,
		[
			"# Amber Evolution Log",
			"",
			`Finding: ${body.findingAttribution.failureMode}`,
			"",
			structuredBlock(body),
		].join("\n"),
	);
	return body;
}

function proposalsDir(target) {
	const dir = path.join(target, ".amber", "maintenance", "proposals");
	return fs.existsSync(dir) ? dir : null;
}

function listProposalFiles(target) {
	const dir = proposalsDir(target);
	return dir
		? fs
				.readdirSync(dir)
				.filter((name) => name.endsWith(".md"))
				.sort()
		: [];
}

function readProposal(target, relativePath) {
	return fs.readFileSync(path.join(target, relativePath), "utf8");
}

function snapshotTree(root) {
	const entries = {};
	const walk = (dir) => {
		for (const name of fs.readdirSync(dir)) {
			const full = path.join(dir, name);
			const stat = fs.lstatSync(full);
			if (stat.isDirectory()) walk(full);
			else entries[path.relative(root, full).split(path.sep).join("/")] = fs.readFileSync(full);
		}
	};
	walk(root);
	return entries;
}

// ── structured extraction and legacy compatibility ──

test("a legacy-only evolution log keeps every legacy API shape untouched", () => {
	const target = tmpTarget("legacy-only");
	try {
		writeEvolution(target, "Finding: alpha\nFinding: alpha\nFinding: beta\n");
		const structured = extractStructuredFindings(target);
		assert.deepEqual(structured.findings, []);
		assert.deepEqual(structured.problems, []);
		assert.deepEqual(
			countEvolutionFindings(target).map((item) => [item.finding, item.count]),
			[
				["alpha", 2],
				["beta", 1],
			],
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a missing evolution log yields empty structured findings and problems", () => {
	const target = tmpTarget("missing");
	try {
		assert.deepEqual(extractStructuredFindings(target), { findings: [], problems: [] });
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("structured findings carry the attribution block, evidence, and effect", () => {
	const target = tmpTarget("extract");
	try {
		const body = seedSignificantStructured(target);
		const structured = extractStructuredFindings(target);
		assert.equal(structured.problems.length, 0);
		assert.equal(structured.findings.length, 1);
		const finding = structured.findings[0];
		assert.equal(finding.finding, ATTRIBUTION.failureMode);
		assert.equal(finding.count, 2, "the block plus the legacy line recur together");
		assert.deepEqual(finding.findingAttribution, body.findingAttribution);
		assert.deepEqual(finding.evidenceReferences, body.evidenceReferences);
		assert.deepEqual(finding.expectedEffect, TWO_AXIS_EFFECT);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("legacy counting ignores block interiors — JSON data is not prose findings", () => {
	const target = tmpTarget("block-interior");
	try {
		fs.mkdirSync(path.dirname(evolutionPath(target)), { recursive: true });
		fs.writeFileSync(
			evolutionPath(target),
			[
				"# Amber Evolution Log",
				"",
				structuredBlock({
					findingAttribution: ATTRIBUTION,
					evidenceReferences: [{ kind: "path", path: "docs/wiki/runbook.md" }],
					expectedEffect: { readiness: "stays parseable", effectiveness: "Finding: booby-trap" },
				}),
				"Finding: real legacy finding",
			].join("\n"),
		);
		const legacy = countEvolutionFindings(target);
		assert.deepEqual(
			legacy.map((item) => item.finding),
			["real legacy finding"],
			"block interiors are excluded from the legacy lens",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("malformed, mis-shaped, and secret-bearing blocks are problems, never findings", () => {
	const target = tmpTarget("bad-blocks");
	try {
		fs.mkdirSync(path.dirname(evolutionPath(target)), { recursive: true });
		const secret = "SyntheticSecretGhIjKlMnOpQrStUvWx";
		fs.writeFileSync(
			evolutionPath(target),
			[
				"# Amber Evolution Log",
				"",
				"```amber-finding",
				"{ not json",
				"```",
				"",
				structuredBlock({ findingAttribution: { ...ATTRIBUTION, extra: "unknown field" } }),
				"",
				structuredBlock({
					findingAttribution: { ...ATTRIBUTION, responsibleArtifact: "prod-database" },
				}),
				"",
				structuredBlock({
					findingAttribution: { ...ATTRIBUTION, failureMode: `Bearer ${secret}` },
				}),
				"",
			].join("\n"),
		);
		const structured = extractStructuredFindings(target);
		assert.equal(structured.findings.length, 0, "no invalid block becomes a finding");
		assert.equal(structured.problems.length, 4);
		const joined = structured.problems.join("\n");
		assert.match(joined, /structured finding block #1/);
		assert.match(joined, /credential material/);
		// Type-only problem strings never echo the rejected content.
		assert.ok(!joined.includes(secret), "the secret must not be echoed");
		assert.ok(!joined.includes("prod-database"), "the invalid enum value must not be echoed");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ── evidence facade: carrier selection ──

test("collectEvidence lifts one significant structured finding into the carrier", () => {
	const target = tmpTarget("carrier");
	try {
		seedSignificantStructured(target);
		const outcome = collectEvidence(target);
		assert.equal(outcome.errors.length, 0);
		assert.equal(outcome.evolution.structured.length, 1);
		const carrier = outcome.evolution.carrier;
		assert.ok(carrier, "a single distinct significant attribution becomes the carrier");
		assert.deepEqual(carrier.findingAttribution, ATTRIBUTION);
		assert.deepEqual(carrier.evidenceReferences, [
			{ kind: "path", path: "docs/wiki/runbook.md", line: 1 },
		]);
		assert.deepEqual(carrier.expectedEffect, TWO_AXIS_EFFECT);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("two significant findings with distinct attributions yield no carrier and a warning", () => {
	const target = tmpTarget("ambiguous");
	try {
		const first = seedSignificantStructured(target);
		const second = {
			...first,
			findingAttribution: {
				...ATTRIBUTION,
				responsibleArtifact: "route",
				failureMode: "route drift blocks handoff",
			},
		};
		fs.appendFileSync(
			evolutionPath(target),
			`Finding: ${second.findingAttribution.failureMode}\n\n${structuredBlock(second)}`,
		);
		const outcome = collectEvidence(target);
		assert.equal(
			outcome.evolution.carrier,
			null,
			"no attribution is invented to collapse two claims",
		);
		assert.ok(
			outcome.warnings.some((warning) => /distinct attributed recurring findings/.test(warning)),
			"the ambiguity is visible, not silent",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("an insignificant structured finding produces no carrier and no warning", () => {
	const target = tmpTarget("insignificant");
	try {
		fs.mkdirSync(path.dirname(evolutionPath(target)), { recursive: true });
		fs.writeFileSync(
			evolutionPath(target),
			[
				"# Amber Evolution Log",
				"",
				structuredBlock({
					findingAttribution: ATTRIBUTION,
					evidenceReferences: [{ kind: "path", path: "docs/wiki/runbook.md" }],
					expectedEffect: TWO_AXIS_EFFECT,
				}),
			].join("\n"),
		);
		const outcome = collectEvidence(target);
		assert.equal(outcome.evolution.carrier, null);
		assert.deepEqual(outcome.warnings, []);
		assert.equal(
			outcome.evolution.structured.length,
			1,
			"still listed — visibility without promotion",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a malformed block makes the evidence outcome refuse, not degrade to legacy", () => {
	const target = tmpTarget("refuse-malformed");
	try {
		fs.mkdirSync(path.dirname(evolutionPath(target)), { recursive: true });
		fs.writeFileSync(
			evolutionPath(target),
			["# Amber Evolution Log", "", "```amber-finding", "{ not json", "```", ""].join("\n"),
		);
		const outcome = collectEvidence(target);
		assert.ok(outcome.errors.length > 0, "malformed external attribution is an error");
		assert.match(outcome.errors.join(" "), /structured finding block #1/);
		assert.ok(!outcome.errors.join(" ").includes("{ not json"), "the malformed body is not echoed");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ── real producer wiring: inspectMaintenance ──

test("inspectMaintenance surfaces the carrier as own keys only when structured evidence exists", () => {
	const structured = tmpTarget("inspect-structured");
	const legacy = tmpTarget("inspect-legacy");
	try {
		seedSignificantStructured(structured);
		const inspection = runMaintenanceAction("inspect", structured, {});
		assert.equal(inspection.errors.length, 0, inspection.errors.join("; "));
		assert.ok(Array.isArray(inspection.structuredFindings));
		assert.equal(inspection.structuredFindings.length, 1);
		assert.deepEqual(inspection.findingAttribution, ATTRIBUTION);
		assert.deepEqual(inspection.evidenceReferences, [
			{ kind: "path", path: "docs/wiki/runbook.md", line: 1 },
		]);
		assert.deepEqual(inspection.expectedEffect, TWO_AXIS_EFFECT);

		writeEvolution(legacy, "Finding: plain legacy finding\nFinding: plain legacy finding\n");
		const legacyInspection = runMaintenanceAction("inspect", legacy, {});
		assert.equal(legacyInspection.errors.length, 0);
		assert.equal(
			Object.hasOwn(legacyInspection, "findingAttribution"),
			false,
			"legacy stays legacy: no own key",
		);
		assert.equal(Object.hasOwn(legacyInspection, "evidenceReferences"), false);
		assert.equal(Object.hasOwn(legacyInspection, "expectedEffect"), false);
		assert.deepEqual(legacyInspection.structuredFindings, []);
	} finally {
		fs.rmSync(structured, { recursive: true, force: true });
		fs.rmSync(legacy, { recursive: true, force: true });
	}
});

// ── real producer → proposeMaintenance: the valid path ──

test("a valid structured finding produces a proposal with attribution, evidence, and effect", () => {
	const target = tmpTarget("propose-valid");
	try {
		seedSignificantStructured(target);
		const result = runMaintenanceAction("propose", target, {});
		assert.deepEqual(result.errors, []);
		assert.equal(result.attributionStatus, "validated");
		assert.deepEqual(result.validity, { ok: true });
		assert.equal(result.reviewable, true);
		assert.match(result.attributionCorrelation, /^sha256:[0-9a-f]{64}$/);

		const written = readProposal(target, result.proposalPath);
		assert.match(written, /## Attribution/);
		assert.match(written, /- Responsible artifact: wiki/);
		assert.match(written, /## Evidence/);
		assert.match(written, /^ {2}> docs\/wiki\/runbook\.md \(line 1\)$/m);
		assert.match(written, /## Expected Effect/);
		assert.match(written, /^ {2}> wiki instructions stay parseable after the change$/m);
		assert.match(written, /^ {2}> repeated fixture failures drop across sessions$/m);
		assert.ok(!written.includes("## Rejection"), "a valid proposal is not a rejection record");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("legacy inspections keep their exact historical proposal output through the real path", () => {
	const target = tmpTarget("propose-legacy");
	try {
		writeEvolution(target, "Finding: plain legacy finding\nFinding: plain legacy finding\n");
		const result = runMaintenanceAction("propose", target, {});
		assert.deepEqual(result.errors, []);
		assert.equal(result.attributionStatus, "legacy-unattributed");
		assert.equal(result.findingAttribution, null);
		assert.equal(result.validity, null, "V1–V3 gate the structured path only");
		const written = readProposal(target, result.proposalPath);
		assert.ok(!written.includes("## Attribution"));
		assert.ok(!written.includes("## Evidence"));
		assert.ok(!written.includes("## Expected Effect"));
		assert.ok(!written.includes("## Rejection"));
		assert.match(written, /- plain legacy finding \(2 occurrences\)/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ── the rejection record ──

test("V1 failure writes a durable rejected record with correlation and no untrusted echo", () => {
	const target = tmpTarget("reject-v1");
	try {
		seedSignificantStructured(target, {
			evidenceReferences: [{ kind: "path", path: "docs/wiki/invented.md" }],
		});
		const result = runMaintenanceAction("propose", target, {});
		assert.deepEqual(result.errors, []);
		assert.equal(result.validity.ok, false);
		assert.equal(result.validity.code, "validity:no-evidence");
		assert.equal(result.reviewable, false);
		assert.equal(result.rejection.code, "validity:no-evidence");
		assert.match(result.rejection.correlation, /^sha256:[0-9a-f]{64}$/);

		const written = readProposal(target, result.proposalPath);
		assert.match(written, /^## Rejection$/m);
		assert.match(written, /^- Reason code: `validity:no-evidence`$/m);
		assert.match(written, /^- Rejected at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
		assert.match(written, /^- Correlation: `sha256:[0-9a-f]{64}`$/m);
		assert.match(written, /^- Redacted summary: /m);
		assert.ok(!written.includes("invented.md"), "the unresolvable reference text is never echoed");
		assert.ok(!written.includes("## Evidence"), "unadmitted evidence is not rendered as evidence");
		assert.ok(written.includes("## Attribution"), "the rejected claim stays identified");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("V2 and V3 failures write rejected records with their closed reason codes", () => {
	const v2 = tmpTarget("reject-v2");
	const v3 = tmpTarget("reject-v3");
	try {
		seedSignificantStructured(v2, {
			operations: [{ verb: "remove", path: ".amber/runner/registry.jsonl" }],
		});
		const v2Result = runMaintenanceAction("propose", v2, {});
		assert.equal(v2Result.validity.code, "validity:capability-reduction");
		assert.equal(v2Result.rejection.code, "validity:capability-reduction");
		assert.match(
			readProposal(v2, v2Result.proposalPath),
			/^- Reason code: `validity:capability-reduction`$/m,
		);

		seedSignificantStructured(v3, {
			expectedEffect: { readiness: "eval F058 passes", effectiveness: "see eval results" },
		});
		const v3Result = runMaintenanceAction("propose", v3, {});
		assert.equal(v3Result.validity.code, "validity:eval-only-claim");
		assert.match(
			readProposal(v3, v3Result.proposalPath),
			/^- Reason code: `validity:eval-only-claim`$/m,
		);

		// A block with no effect statement at all is also a V3 failure.
		const v3b = tmpTarget("reject-v3-missing");
		try {
			seedSignificantStructured(v3b, { expectedEffect: null });
			const v3bResult = runMaintenanceAction("propose", v3b, {});
			assert.equal(v3bResult.validity.code, "validity:eval-only-claim");
		} finally {
			fs.rmSync(v3b, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(v2, { recursive: true, force: true });
		fs.rmSync(v3, { recursive: true, force: true });
	}
});

test("retry after fixing the evidence passes and sees the prior rejection history", () => {
	const target = tmpTarget("retry-pass");
	try {
		seedSignificantStructured(target, {
			evidenceReferences: [{ kind: "path", path: "docs/wiki/runbook.md", line: 99 }],
		});
		const first = runMaintenanceAction("propose", target, {});
		assert.equal(first.validity.code, "validity:no-evidence", "line 99 is out of range");
		const rejectedPath = first.proposalPath;
		const rejectedBytes = readProposal(target, rejectedPath);

		// Retry with the same attribution and now-valid evidence: a NEW record
		// that acknowledges the prior rejection without overwriting it.
		seedSignificantStructured(target);
		const second = runMaintenanceAction("propose", target, {});
		assert.deepEqual(second.errors, []);
		assert.deepEqual(second.validity, { ok: true });
		assert.equal(second.priorRejections.count, 1);
		assert.equal(second.priorRejections.unknown, false);
		assert.ok(second.priorRejections.lastAt);
		assert.notEqual(second.proposalPath, rejectedPath);
		const written = readProposal(target, second.proposalPath);
		assert.match(written, /Prior rejections with this attribution: 1/);
		assert.ok(!written.includes("## Rejection"), "the retry itself is not rejected");

		// History preserved: the first record is untouched on disk.
		assert.equal(readProposal(target, rejectedPath), rejectedBytes);
		assert.equal(listProposalFiles(target).length, 2);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("two Propose runs in the same millisecond keep both proposal records", (t) => {
	// The proposal filename is a millisecond-resolution stamp. Two runs landing
	// in the same millisecond used to render the same path, so the second write
	// silently overwrote the first — destroying exactly the rejection history
	// scanPriorRejections reads back. Pin the clock so the collision is
	// deterministic rather than a race a fast machine has to win.
	const target = tmpTarget("proposal-collision");
	t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-01-01T00:00:00.000Z") });
	try {
		seedSignificantStructured(target);
		const first = runMaintenanceAction("propose", target, {});
		assert.deepEqual(first.errors, []);
		const firstBytes = readProposal(target, first.proposalPath);

		seedSignificantStructured(target);
		const second = runMaintenanceAction("propose", target, {});
		assert.deepEqual(second.errors, []);

		assert.notEqual(second.proposalPath, first.proposalPath);
		assert.equal(listProposalFiles(target).length, 2);
		assert.equal(readProposal(target, first.proposalPath), firstBytes);
	} finally {
		t.mock.timers.reset();
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a still-failing retry records the prior rejection count in its own record", () => {
	const target = tmpTarget("retry-fail");
	try {
		seedSignificantStructured(target, {
			evidenceReferences: [{ kind: "path", path: "docs/wiki/invented.md" }],
		});
		const first = runMaintenanceAction("propose", target, {});
		assert.equal(first.priorRejections.count, 0);

		const second = runMaintenanceAction("propose", target, {});
		assert.equal(second.validity.ok, false);
		assert.equal(
			second.priorRejections.count,
			1,
			"the retry finds the prior rejection by correlation",
		);
		const written = readProposal(target, second.proposalPath);
		assert.match(written, /^- Prior rejections with this correlation: 1 \(first: /m);
		assert.equal(listProposalFiles(target).length, 2);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("unreadable proposal records make the prior-rejection history unknown, not empty", () => {
	const target = tmpTarget("history-unknown");
	try {
		seedSignificantStructured(target, {
			evidenceReferences: [{ kind: "path", path: "docs/wiki/invented.md" }],
		});
		const first = runMaintenanceAction("propose", target, {});
		assert.equal(first.validity.ok, false);
		// A directory posing as a record makes the scan fail: history reads as
		// unknown (never "no prior rejection" — F055 discipline).
		fs.mkdirSync(path.join(proposalsDir(target), "2020-01-01T00-00-00-000Z-corrupt.md"));
		const second = runMaintenanceAction("propose", target, {});
		assert.equal(second.validity.ok, false);
		assert.equal(second.priorRejections.unknown, true);
		assert.equal(second.priorRejections.count, null);
		const written = readProposal(target, second.proposalPath);
		assert.match(written, /^- Prior rejection history: unknown/m);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ── pre-admission boundary (nothing written) ──

test("a malformed structured block in the source refuses the whole proposal — nothing is written", () => {
	const target = tmpTarget("pre-malformed");
	try {
		fs.mkdirSync(path.dirname(evolutionPath(target)), { recursive: true });
		fs.writeFileSync(
			evolutionPath(target),
			["# Amber Evolution Log", "", "```amber-finding", '"just a string"', "```", ""].join("\n"),
		);
		const result = runMaintenanceAction("propose", target, {});
		assert.ok(result.errors.length > 0, "malformed external attribution refuses at pre-admission");
		assert.match(result.errors.join(" "), /structured finding block #1/);
		assert.equal(proposalsDir(target), null, "no proposal directory may be created");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a secret-bearing expectedEffect refuses at pre-admission with no echo and no write", () => {
	const target = tmpTarget("pre-secret");
	try {
		const token = "SyntheticSecretGhIjKlMnOpQrStUvWx";
		const result = proposeMaintenance(target, null, null, () => ({
			target,
			errors: [],
			warnings: [],
			staleDocs: [],
			upgradeAssistant: { currentVersion: null, latestVersion: null },
			rulePackDrift: { drifted: false, expected: [], actual: [] },
			evolutionRollup: [],
			regressionProposals: [],
			findingAttribution: ATTRIBUTION,
			evidenceReferences: [{ kind: "path", path: "docs/wiki/runbook.md" }],
			expectedEffect: { readiness: `Bearer ${token}`, effectiveness: "failures drop" },
		}));
		assert.ok(result.errors.length > 0, "secret-bearing carrier text must refuse");
		assert.ok(!JSON.stringify(result).includes(token), "the envelope must not echo the secret");
		assert.match(result.errors.join(" "), /credential material/);
		assert.equal(proposalsDir(target), null, "nothing written");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a secret-bearing evidence path refuses at pre-admission with no echo and no write", () => {
	const target = tmpTarget("pre-secret-path");
	try {
		const token = "ghp_SyntheticTokenAbCdEfGhIj";
		const result = proposeMaintenance(target, null, null, () => ({
			target,
			errors: [],
			warnings: [],
			staleDocs: [],
			upgradeAssistant: { currentVersion: null, latestVersion: null },
			rulePackDrift: { drifted: false, expected: [], actual: [] },
			evolutionRollup: [],
			regressionProposals: [],
			findingAttribution: ATTRIBUTION,
			evidenceReferences: [{ kind: "path", path: `docs/${token}.md` }],
			expectedEffect: TWO_AXIS_EFFECT,
		}));
		assert.ok(result.errors.length > 0);
		assert.ok(!JSON.stringify(result).includes(token));
		assert.equal(proposalsDir(target), null);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("malformed carrier fields (not secrets) flow to their validity rule and write a rejection record", () => {
	const target = tmpTarget("shape-to-rule");
	try {
		const result = proposeMaintenance(target, null, null, () => ({
			target,
			errors: [],
			warnings: [],
			staleDocs: [],
			upgradeAssistant: { currentVersion: null, latestVersion: null },
			rulePackDrift: { drifted: false, expected: [], actual: [] },
			evolutionRollup: [],
			regressionProposals: [],
			findingAttribution: ATTRIBUTION,
			evidenceReferences: "see the transcripts",
			expectedEffect: TWO_AXIS_EFFECT,
		}));
		assert.deepEqual(result.errors, [], "a shape failure is a governed rejection, not a refusal");
		assert.equal(result.validity.code, "validity:no-evidence");
		assert.ok(result.proposalPath, "the rejection record is written");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ── write safety ──

test("a validity rejection never writes anything outside the owning proposal record", () => {
	const target = tmpTarget("no-write");
	try {
		fs.mkdirSync(path.join(target, ".git"), { recursive: true });
		fs.writeFileSync(path.join(target, ".git", "HEAD"), "ref: refs/heads/main\n");
		seedSignificantStructured(target, {
			evidenceReferences: [{ kind: "path", path: "docs/wiki/invented.md" }],
		});
		const before = snapshotTree(target);
		const result = runMaintenanceAction("propose", target, {});
		assert.equal(result.validity.ok, false);
		const after = snapshotTree(target);
		const added = Object.keys(after).filter((key) => !before[key]);
		const changed = Object.keys(before).filter(
			(key) => after[key] && !before[key].equals(after[key]),
		);
		assert.deepEqual(changed, [], "no pre-existing file changed");
		for (const key of added) {
			assert.match(
				key,
				/^\.amber\/maintenance\/proposals\/.+\.md$/,
				`only the owning record is added: ${key}`,
			);
		}
		assert.equal(added.length, 1);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a failed record write is an explicit refusal, never a silent success", () => {
	const target = tmpTarget("write-fail");
	try {
		seedSignificantStructured(target);
		// The proposals directory is occupied by a regular file: persistence
		// cannot succeed.
		fs.mkdirSync(path.join(target, ".amber", "maintenance"), { recursive: true });
		fs.writeFileSync(path.join(target, ".amber", "maintenance", "proposals"), "not a directory");
		const result = runMaintenanceAction("propose", target, {});
		assert.ok(result.errors.length > 0, "a failed write must surface errors");
		assert.match(result.errors.join(" "), /failed to persist/);
		assert.equal(result.reviewable, undefined);
		assert.equal(result.proposalPath, undefined);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a failed rejection-record write is an explicit refusal too", () => {
	const target = tmpTarget("write-fail-reject");
	try {
		seedSignificantStructured(target, {
			evidenceReferences: [{ kind: "path", path: "docs/wiki/invented.md" }],
		});
		fs.mkdirSync(path.join(target, ".amber", "maintenance"), { recursive: true });
		fs.writeFileSync(path.join(target, ".amber", "maintenance", "proposals"), "not a directory");
		const result = runMaintenanceAction("propose", target, {});
		assert.ok(result.errors.length > 0, "failed audit persistence is never success");
		assert.match(result.errors.join(" "), /failed to persist/);
		assert.equal(result.proposalPath, undefined);
		assert.equal(result.rejection, undefined);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ── untrusted text rendering in new sections ──

test("multiline effect statements render as quoted data and cannot become headings", () => {
	const target = tmpTarget("multiline");
	try {
		fs.mkdirSync(path.join(target, "docs", "wiki"), { recursive: true });
		fs.writeFileSync(path.join(target, "docs", "wiki", "runbook.md"), "# Runbook\n");
		const result = proposeMaintenance(target, null, null, () => ({
			target,
			errors: [],
			warnings: [],
			staleDocs: [],
			upgradeAssistant: { currentVersion: null, latestVersion: null },
			rulePackDrift: { drifted: false, expected: [], actual: [] },
			evolutionRollup: [],
			regressionProposals: [],
			findingAttribution: ATTRIBUTION,
			evidenceReferences: [{ kind: "path", path: "docs/wiki/runbook.md" }],
			expectedEffect: {
				readiness: "readiness text\r\n\r\n# UNTRUSTED_READINESS_MARKER\nsource text",
				effectiveness: "effectiveness text\n# UNTRUSTED_EFFECT_MARKER",
			},
		}));
		assert.deepEqual(result.errors, []);
		const written = readProposal(target, result.proposalPath);
		const normalized = written.replace(/\r\n?/g, "\n");
		assert.ok(
			!/^# UNTRUSTED_\w+_MARKER$/m.test(normalized),
			"no raw heading from untrusted effect text",
		);
		assert.match(written, /^ {2}> # UNTRUSTED_READINESS_MARKER\r?$/m);
		assert.match(written, /^ {2}> # UNTRUSTED_EFFECT_MARKER\r?$/m);
		assert.match(written, /^ {2}> readiness text\r?$/m);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("rejection correlation is the canonical hash of the attribution block", () => {
	const target = tmpTarget("correlation");
	try {
		seedSignificantStructured(target);
		const result = runMaintenanceAction("propose", target, {});
		const { canonicalHashOf } = require("../../scripts/lib/core/registry-ledger");
		assert.equal(result.attributionCorrelation, canonicalHashOf(ATTRIBUTION));
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
