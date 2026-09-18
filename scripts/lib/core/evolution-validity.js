"use strict";

// Shared deterministic V1–V3 admission invariant (trusted-control evolution
// contract §6, docs/specs/trusted-control-evolution-contract.md).
//
// Implemented ONCE here; proposal destinations consume it at their admission
// boundary (today: `maintenance-propose.js`; the F064 card-admission path
// consumes it in a later slice). The checks are mechanical presence/shape
// checks executed by deterministic code — never a model, never a human:
//
//   V1 validity:no-evidence         ≥1 evidence reference, every reference
//                                   resolved against its owning source (the
//                                   tightened reading is normative per the
//                                   2026-09-19 §6 amendment).
//   V2 validity:capability-reduction no declared operation deletes or
//                                   downgrades a capability-registry entry.
//   V3 validity:eval-only-claim     readiness AND effectiveness statements,
//                                   neither solely an eval reference.
//
// Non-claims (spec E5): passing V1 proves an evidence reference exists and
// resolves — never that the evidence is true or independently verified.
// Passing V3 proves a dual-axis statement is present — never that the
// assessment is sound. The semantic judge is the stage-3 human reviewer.
// Ordering: V1→V2→V3; the first failure wins and its closed reason code is
// the rejection's reason (spec §5 stage 2).

const fs = require("node:fs");
const path = require("node:path");

const { pathExists, resolvePathWithin } = require("./fs-utils");
const { showEvidence } = require("./evidence-receipts");

// The closed reason-code set (spec §11). Rejection records carry exactly one.
const VALIDITY_REASON_CODES = Object.freeze([
	"validity:no-evidence",
	"validity:capability-reduction",
	"validity:eval-only-claim",
]);

// Evidence reference kinds supported today (closed set). A kind names the
// owning source that resolves the reference:
//   path    — a bounded local path under the target root (existence + line).
//   receipt — an Evidence receipt id resolved against the receipt ledger.
// Extensions require a contract change, not an implementation-side addition.
const EVIDENCE_REFERENCE_KINDS = Object.freeze(["path", "receipt"]);
const PATH_REFERENCE_FIELDS = Object.freeze(["kind", "path", "line"]);
const RECEIPT_REFERENCE_FIELDS = Object.freeze(["kind", "id"]);

// The capability-registry surface (F052 runner registry ledger) that V2
// protects: declared remove/update operations against these paths are
// capability reduction. Compare case-folded and separator-normalized so a
// Windows alias (`.AMBER\RUNNER\REGISTRY.JSONL`, `./`-prefixed, duplicate
// separators, in-root `..` hops) never slips through; the fold intentionally
// over-approximates on case-sensitive platforms — a refusal of an oddly-cased
// path that does not exist there costs nothing, a slipped alias costs the
// registry.
const CAPABILITY_REGISTRY_PATHS = Object.freeze(
	[".amber/runner/registry.jsonl", ".harness/runner/registry.jsonl"].map((entry) =>
		entry.toLowerCase(),
	),
);

// The closed operation verb set mirrors the existing proposal-operations
// vocabulary (F064 planner). An operation outside it cannot be classified as
// non-reducing, so it fails V2 — unknown shapes never pass as safe.
const OPERATION_VERBS = Object.freeze(["create", "update", "remove"]);

// Words an eval-only axis statement can consist of. When every word of a
// statement is one of these (plus ids, digits, punctuation), the statement is
// solely an eval reference and carries no readiness/effectiveness claim.
const EVAL_ONLY_WORDS = new Set([
	"eval",
	"evals",
	"evaluation",
	"run",
	"runs",
	"suite",
	"result",
	"results",
	"report",
	"reports",
	"evidence",
	"reference",
	"references",
	"check",
	"checks",
	"see",
	"the",
	"a",
	"an",
	"and",
	"is",
	"are",
	"was",
	"were",
	"shows",
	"show",
	"shown",
	"pass",
	"passes",
	"passed",
	"passing",
	"green",
	"above",
	"below",
]);

const EXPECTED_EFFECT_FIELDS = Object.freeze(["readiness", "effectiveness"]);

function isPlainObject(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Deterministic eval-only detector: a statement is solely an eval reference
 * when, after removing eval-vocabulary words, feature ids, digits, and
 * punctuation, no letter (any script) remains. Untrusted text is classified,
 * never echoed.
 * @param {unknown} value
 * @returns {boolean}
 */
function isEvalOnlyReference(value) {
	if (typeof value !== "string") return false;
	const stripped = value
		.toLowerCase()
		.replace(/f\d{2,3}/g, " ")
		.replace(/[a-z]+/g, (word) => (EVAL_ONLY_WORDS.has(word) ? " " : word));
	return !/\p{L}/u.test(stripped);
}

// No unknown keys, and every required key present. Optional keys (e.g. a
// path reference's `line`) are allowed by construction: `allowed` ⊇ `required`.
function closedFieldProblem(value, allowed, required) {
	const keys = Object.keys(value);
	return keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key));
}

// ── V1 ──

/**
 * Resolve one path-kind reference against the target root. Bounded
 * (never escapes, junction-safe), existing, and — when a line is cited —
 * within the file's line count. Returns a reason class on failure; the
 * untrusted reference text is never echoed by the caller.
 */
function resolvePathReference(targetRoot, ref) {
	if (typeof ref.path !== "string" || ref.path.trim() === "") return "malformed-shape";
	// A drive-letter or POSIX-root path is absolute on sight — on win32 a
	// leading "/" is drive-root-relative and resolves outside any target.
	if (path.isAbsolute(ref.path) || ref.path.startsWith("/")) return "absolute-path";
	let resolved;
	try {
		resolved = resolvePathWithin(targetRoot, ref.path, { label: "evidence path" });
	} catch (error) {
		return /outside the target root/.test(String(error && error.message))
			? "escapes-root"
			: "malformed-shape";
	}
	if (!pathExists(resolved)) return "not-found";
	if (ref.line === undefined || ref.line === null) return null;
	if (!Number.isInteger(ref.line) || ref.line < 1) return "malformed-shape";
	let content;
	try {
		content = fs.readFileSync(resolved, "utf8");
	} catch {
		return "unreadable";
	}
	const lineCount = content.split(/\r\n|\r|\n/).length;
	return ref.line <= lineCount ? null : "line-out-of-range";
}

/**
 * Resolve one receipt-kind reference against the evidence receipt ledger
 * (`.amber/evidence/receipts.jsonl`). An absent ledger reads as empty (the
 * receipt does not exist); a corrupt ledger fails closed as unreadable.
 */
function resolveReceiptReference(targetRoot, ref) {
	if (typeof ref.id !== "string" || ref.id.trim() === "") return "malformed-shape";
	try {
		return showEvidence(targetRoot, ref.id) !== null ? null : "receipt-not-found";
	} catch {
		return "receipt-ledger-unreadable";
	}
}

function resolveEvidenceReference(targetRoot, ref) {
	if (!isPlainObject(ref)) return "malformed-shape";
	if (ref.kind === "path") {
		return closedFieldProblem(ref, PATH_REFERENCE_FIELDS, ["kind", "path"])
			? "malformed-shape"
			: resolvePathReference(targetRoot, ref);
	}
	if (ref.kind === "receipt") {
		return closedFieldProblem(ref, RECEIPT_REFERENCE_FIELDS, ["kind", "id"])
			? "malformed-shape"
			: resolveReceiptReference(targetRoot, ref);
	}
	return "malformed-shape";
}

/**
 * V1: ≥1 evidence reference, every one resolved against its owning source.
 * A resolvable reference proves the citation points at real recorded
 * material — never that the material is true (spec E5).
 */
function checkEvidence(targetRoot, evidenceReferences) {
	if (!Array.isArray(evidenceReferences) || evidenceReferences.length === 0) {
		return "no evidence reference is supplied (at least one resolvable reference is required)";
	}
	const failures = [];
	for (let index = 0; index < evidenceReferences.length; index += 1) {
		const reasonClass = resolveEvidenceReference(targetRoot, evidenceReferences[index]);
		if (reasonClass !== null) {
			failures.push(`reference #${index + 1}: ${reasonClass}`);
		}
	}
	if (failures.length === 0) return null;
	return (
		`${evidenceReferences.length} evidence reference(s) supplied, ` +
		`${evidenceReferences.length - failures.length} resolvable (${failures.join("; ")})`
	);
}

// ── V2 ──

function normalizeOperationPath(value) {
	return path
		.normalize(String(value))
		.split(path.sep)
		.join("/")
		.replace(/^\.\//, "")
		.toLowerCase();
}

/**
 * V2: no declared operation deletes or downgrades a capability-registry
 * entry. Absent operations pass vacuously (nothing is declared — the
 * maintenance proposal shape); a present list must be classifiable: unknown
 * verbs, missing paths, and non-object entries fail rather than pass as safe.
 */
function checkCapabilityReduction(operations) {
	if (operations === undefined || operations === null) return null;
	if (!Array.isArray(operations)) {
		return "declared operations are not a list; an unclassifiable declaration never passes as safe";
	}
	for (let index = 0; index < operations.length; index += 1) {
		const operation = operations[index];
		if (!isPlainObject(operation)) {
			return `operation #${index + 1} is not a well-formed operation object`;
		}
		if (typeof operation.verb !== "string" || !OPERATION_VERBS.includes(operation.verb)) {
			return (
				`operation #${index + 1} carries an unknown verb; the closed set is ` +
				`${OPERATION_VERBS.join(" | ")} — an unclassifiable operation never passes as safe`
			);
		}
		if (typeof operation.path !== "string" || operation.path.trim() === "") {
			return `operation #${index + 1} declares no path; a targetless operation cannot be classified as non-reducing`;
		}
		if (
			(operation.verb === "remove" || operation.verb === "update") &&
			CAPABILITY_REGISTRY_PATHS.includes(normalizeOperationPath(operation.path))
		) {
			return (
				`operation #${index + 1} declares "${operation.verb}" on the capability-registry surface; ` +
				"proposals can never reduce the registry (V2)"
			);
		}
	}
	return null;
}

// ── V3 ──

/**
 * V3: the effect statement is present and names BOTH axes of the dual-axis
 * assessment (readiness + effectiveness), and neither axis is solely an eval
 * reference — an eval result is never an effect statement (F058 non-authority;
 * spec E4). Presence is proven, soundness is not (spec E5).
 */
function checkExpectedEffect(expectedEffect) {
	if (!isPlainObject(expectedEffect)) {
		return "the dual-axis effect statement is absent or malformed (expected { readiness, effectiveness })";
	}
	if (closedFieldProblem(expectedEffect, EXPECTED_EFFECT_FIELDS, EXPECTED_EFFECT_FIELDS)) {
		return "the effect statement must carry exactly the two axis fields (readiness, effectiveness)";
	}
	for (const axis of EXPECTED_EFFECT_FIELDS) {
		const value = expectedEffect[axis];
		if (typeof value !== "string" || value.trim() === "") {
			return `expectedEffect.${axis} is missing or empty; both axes are required`;
		}
		if (isEvalOnlyReference(value)) {
			return `expectedEffect.${axis} is solely an eval reference; an axis must state its own claim (eval results never authorize behavior change)`;
		}
	}
	return null;
}

/**
 * Run the V1–V3 admission invariant once for a proposal carrier.
 *
 * @param {{
 *   targetRoot: string,
 *   evidenceReferences?: unknown,
 *   operations?: unknown,
 *   expectedEffect?: unknown,
 * }} input
 * @returns {{ ok: true } | { ok: false, code: string, detail: string }}
 *   `detail` is deterministic and non-echoing: untrusted reference text,
 *   effect statements, and operation paths are never copied into it.
 */
function validateEvolutionAdmission(input) {
	const targetRoot = input && input.targetRoot;
	const v1 = checkEvidence(targetRoot, input && input.evidenceReferences);
	if (v1 !== null) return { ok: false, code: "validity:no-evidence", detail: v1 };

	const v2 = checkCapabilityReduction(input && input.operations);
	if (v2 !== null) return { ok: false, code: "validity:capability-reduction", detail: v2 };

	const v3 = checkExpectedEffect(input && input.expectedEffect);
	if (v3 !== null) return { ok: false, code: "validity:eval-only-claim", detail: v3 };

	return { ok: true };
}

module.exports = {
	VALIDITY_REASON_CODES,
	EVIDENCE_REFERENCE_KINDS,
	OPERATION_VERBS,
	EXPECTED_EFFECT_FIELDS,
	isEvalOnlyReference,
	validateEvolutionAdmission,
};
