"use strict";

// Harness Release Manifest (R-ET-5 / 0175; plan §3 E).
//
// A ValidationReceipt answers "did this run pass"; the manifest answers "what
// did it validate" — the exact code/task/evaluator/provider/model versions,
// bound to a sha256 and frozen into the receipt. Without it a receipt cannot
// name the thing it judged.
//
// Amber OWNS four of the five axes and reads each from a record the receipt
// path already reads (the run, its execution record, the F077 eval binding) —
// nothing is probed afresh and nothing is inferred. `model` has no record
// point at all, so it is declared null rather than omitted: an absent axis must
// read as "declared absent", never as "forgotten" (§4 Compatibility).
//
// Two different questions, deliberately never merged (R-ET-5.3):
//   integrity — does the STORED snapshot still hash to its recorded sha256?
//               (`receiptProblem` re-derives it on read; tamper fails closed —
//               the `inspectHarnessContract` precedent, R-ET-5.2)
//   staleness — has the repository moved on since the snapshot was frozen?
//               (`manifestStaleness`; a finding, never an integrity failure.
//               Re-verifying artifact bytes on read would misreport every
//               historical receipt once the repo moves on.)

const fs = require("node:fs");
const path = require("node:path");

const { compileSchema } = require("../core/schema-contract");
const { canonicalHashOf } = require("../core/registry-ledger");
const { gitOutput } = require("../core/git-exec");
const { readExecutionRecord } = require("./execution-adapter");

const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

// The code axis has exactly two ambient sources — the only axes that can go
// stale. A missing package.json or a non-repository target is an ABSENT value,
// never an error: the manifest records what exists.
function currentCodeVersion(targetRoot) {
	try {
		const parsed = JSON.parse(fs.readFileSync(path.join(targetRoot, "package.json"), "utf8"));
		const version = parsed && parsed.version;
		return typeof version === "string" && version.length > 0 ? version : null;
	} catch (err) {
		return null;
	}
}

function currentCommit(targetRoot) {
	const head = gitOutput(targetRoot, ["rev-parse", "HEAD"]);
	return head && COMMIT_PATTERN.test(head) ? head : null;
}

/**
 * The repository's ambient code state — the ONLY axes a later commit can move,
 * and therefore the only input the staleness check needs beyond the frozen
 * snapshot. Exported so a caller checking many manifests (the lifecycle view
 * walks every run) reads it ONCE: spawning git is ~190ms on Windows, and a
 * per-run read would scale that by the run count.
 * @param {string} targetRoot
 * @returns {{version: string|null, commit: string|null}}
 */
function ambientCodeState(targetRoot) {
	return { version: currentCodeVersion(targetRoot), commit: currentCommit(targetRoot) };
}

/**
 * Build the release manifest for one run — the versions its receipt will bind.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {object} opts.run The run record (subject + harness contract pointers).
 * @param {object|null} [opts.bound] The resolved F077 eval binding, or null.
 * @returns {object} The manifest, validated against its schema.
 */
function buildReleaseManifest(targetRoot, { run, bound = null } = {}) {
	if (!run || typeof run !== "object" || Array.isArray(run)) {
		throw typedError(CODE_INVALID_ARG, "buildReleaseManifest requires the run record");
	}
	const executionRecord = readExecutionRecord(targetRoot, { runId: run.id });
	const effective = executionRecord && executionRecord.effective ? executionRecord.effective : null;
	const harness = run.harness && typeof run.harness === "object" ? run.harness : {};
	const subject = run.subject && typeof run.subject === "object" ? run.subject : {};
	const manifest = {
		apiVersion: "amber.dev/v1",
		kind: "ReleaseManifest",
		code: { version: currentCodeVersion(targetRoot), commit: currentCommit(targetRoot) },
		task: {
			id: subject.task ?? null,
			contract: harness.contract ?? null,
			contractSnapshotHash: harness.contractSnapshotHash ?? null,
		},
		// The F077 binding verbatim, minus its `overall` verdict: this axis names
		// what was bound, and the receipt's own eval check already carries how it
		// judged. Two records of one verdict is the drift surface §4.6 refuses.
		evaluator:
			bound === null
				? null
				: {
						identity: bound.binding.identity,
						revision: bound.binding.revision,
						contentHash: bound.binding.contentHash,
						definition: bound.binding.definition,
					},
		provider: {
			workspace: effective && effective.workspace ? (effective.workspace.type ?? null) : null,
			enforcement: effective ? (effective.enforcement ?? null) : null,
		},
		// No record point exists (replay-core's `model-drift` residual).
		model: null,
	};
	const validate = compileSchema("release-manifest");
	if (!validate(manifest)) {
		const detail = (validate.errors || [])
			.map((e) => `${e.instancePath || "/"} ${e.message}`)
			.join("; ");
		throw typedError(
			CODE_INVALID_ARG,
			`release manifest does not satisfy schemas/release-manifest.schema.json: ${detail}`,
		);
	}
	return manifest;
}

/** The frozen identity of one manifest: canonical-JSON SHA-256 (ADR-0100). */
function manifestSha256(manifest) {
	return canonicalHashOf(manifest);
}

/**
 * The STALENESS check (R-ET-5.3) — the second question, never an integrity
 * verdict. Compares the frozen manifest's ambient axes against the repository
 * as it stands now; a moved version or commit is a finding, and a receipt that
 * carries it stays perfectly readable.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {object} opts.manifest A stored release manifest snapshot.
 * @param {{version: string|null, commit: string|null}} [opts.current] The
 *   ambient state, when the caller already read it (a multi-manifest walk).
 * @returns {{stale: boolean, findings: Array<{field: string, frozen: string|null, current: string|null}>}}
 */
function manifestStaleness(targetRoot, { manifest, current } = {}) {
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw typedError(CODE_INVALID_ARG, "manifestStaleness requires a release manifest");
	}
	const code = manifest.code && typeof manifest.code === "object" ? manifest.code : {};
	const now = current || ambientCodeState(targetRoot);
	const findings = [];
	for (const field of ["version", "commit"]) {
		const frozen = code[field] ?? null;
		if (frozen !== now[field]) {
			findings.push({ field: `code.${field}`, frozen, current: now[field] });
		}
	}
	return { stale: findings.length > 0, findings };
}

module.exports = {
	buildReleaseManifest,
	manifestSha256,
	manifestStaleness,
	ambientCodeState,
	CODE_INVALID_ARG,
};
