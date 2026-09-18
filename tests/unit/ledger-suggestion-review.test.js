"use strict";

// F064 Slice 3 — the `suggestion-review` ledger family (trusted-control
// evolution contract §8). Family declaration through `defineLedgerFamily`
// (ADR-0028), the closed five-kind set, payload correlation, writer guards,
// fail-closed corruption, ceiling/lock refusals, the §8.3 rejection-history
// hint (unknown ≠ empty), and the §8.6 precheck (nothing written on either
// outcome).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const review = require("../../scripts/lib/core/ledger-suggestion-review");
const { chainHash } = require("../../scripts/lib/core/registry-ledger");

const ATTRIBUTION = Object.freeze({
	entrySurface: "tool-output",
	impactSurface: "context",
	failureMode: "enoent: no such file or directory",
	responsibleArtifact: "wiki",
});

const CORRUPT_CODE = "AMBER_E_SUGGESTION_REVIEW_CORRUPT";
const LOCK_CODE = "AMBER_E_SUGGESTION_REVIEW_LOCK";
const CEILING_CODE = "AMBER_E_SUGGESTION_REVIEW_SIZE_CEILING";
const STATE_CODE = "AMBER_E_SUGGESTION_REVIEW_STATE";
const INVALID_ARG_CODE = "AMBER_E_INVALID_ARG";

function mkTarget(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-sr-${name}-`));
}

function ledgerLines(root) {
	const file = review.reviewLedgerPath(root);
	if (!fs.existsSync(file)) return [];
	return fs
		.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

function propose(root, fingerprint = "fp-1") {
	return review.ensureSuggestionProposed(root, {
		fingerprint,
		evidence: [{ host: "claude", transcriptId: "t1", excerpt: "boom" }],
		hosts: ["claude"],
		operations: [{ verb: "create", path: "docs/wiki/agent/friction/abc123.md" }],
		attribution: ATTRIBUTION,
	});
}

test("family declares one ledger under .amber/suggestions/review.jsonl with a closed five-kind set", () => {
	assert.deepEqual([...review.SUGGESTION_REVIEW_KINDS], [
		"proposed",
		"validated",
		"rejected",
		"applied",
		"undone",
	]);
	assert.equal(
		review.reviewLedgerPath("/repo"),
		path.join("/repo", ".amber", "suggestions", "review.jsonl"),
	);
	// Frozen: widening the closed set throws.
	assert.throws(() => review.SUGGESTION_REVIEW_KINDS.push("mystery"));
});

test("full lifecycle writes proposed → validated → applied → undone with correlated payloads", () => {
	const root = mkTarget("lifecycle");
	try {
		assert.equal(propose(root).appended, true);
		assert.equal(review.recordSuggestionValidated(root, { fingerprint: "fp-1" }).appended, true);
		assert.equal(
			review.recordSuggestionApplied(root, {
				fingerprint: "fp-1",
				applied: [
					{
						path: "docs/wiki/agent/friction/abc123.md",
						beforeHash: null,
						afterHash: "a".repeat(64),
					},
				],
			}).appended,
			true,
		);
		assert.equal(
			review.recordSuggestionUndone(root, {
				fingerprint: "fp-1",
				restored: [{ path: "docs/wiki/agent/friction/abc123.md", hash: null }],
			}).appended,
			true,
		);

		const lines = ledgerLines(root);
		assert.deepEqual(
			lines.map((event) => event.kind),
			["proposed", "validated", "applied", "undone"],
		);
		// Every event closes the fingerprint correlation chain — including
		// `validated` (§8.2), so a fold can key the whole trail by fingerprint.
		for (const event of lines) {
			assert.equal(event.fingerprint, "fp-1");
			assert.equal(event.schemaVersion, 1);
			assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/);
			assert.match(event.prevHash, /^[0-9a-f]{64}$/);
			assert.match(event.hash, /^[0-9a-f]{64}$/);
		}
		// §8.2 payload shapes: digests are digests — the proposed event never
		// carries raw evidence or operation contents.
		const proposed = lines[0];
		assert.match(proposed.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
		assert.match(proposed.operationsDigest, /^sha256:[0-9a-f]{64}$/);
		assert.deepEqual(proposed.hosts, ["claude"]);
		assert.deepEqual(proposed.attribution, ATTRIBUTION);
		assert.equal(JSON.stringify(proposed).includes("friction/abc123.md\""), false);
		assert.deepEqual(lines[1].checks, { v1: "pass", v2: "pass", v3: "pass" });
		assert.match(lines[2].appliedDigest, /^sha256:[0-9a-f]{64}$/);
		assert.match(lines[3].restoredDigest, /^sha256:[0-9a-f]{64}$/);

		const [record] = review.foldSuggestionReview(root);
		assert.equal(record.fingerprint, "fp-1");
		assert.ok(record.proposedAt);
		assert.ok(record.validatedAt);
		assert.equal(record.appliedCount, 1);
		assert.equal(record.undoneCount, 1);
		assert.deepEqual(record.rejections, []);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("scan-driven appends are idempotent: proposed/validated/validity-rejection append once", () => {
	const root = mkTarget("idempotent");
	try {
		assert.equal(propose(root).appended, true);
		assert.equal(propose(root).appended, false);
		assert.equal(review.recordSuggestionValidated(root, { fingerprint: "fp-1" }).appended, true);
		assert.equal(review.recordSuggestionValidated(root, { fingerprint: "fp-1" }).appended, false);
		const rejection = review.recordSuggestionValidityRejection(root, {
			fingerprint: "fp-2",
			reason: "validity:no-evidence",
			summary: "no resolvable citation",
		});
		assert.equal(rejection.ok, false, "an unproposed fingerprint is a state refusal");
		assert.equal(rejection.code, STATE_CODE);
		propose(root, "fp-2");
		assert.equal(
			review.recordSuggestionValidityRejection(root, {
				fingerprint: "fp-2",
				reason: "validity:no-evidence",
				summary: "no resolvable citation",
			}).appended,
			true,
		);
		assert.equal(
			review.recordSuggestionValidityRejection(root, {
				fingerprint: "fp-2",
				reason: "validity:no-evidence",
				summary: "no resolvable citation",
			}).appended,
			false,
			"a repeated failing scan does not grow the ledger",
		);
		// Dismissals, unlike validity rejections, are operator decisions and
		// always append.
		assert.equal(
			review.recordSuggestionDismissal(root, {
				fingerprint: "fp-2",
				reason: "dismissed-by-operator",
				summary: "Operator dismissed the suggestion card.",
			}).appended,
			true,
		);
		assert.equal(ledgerLines(root).filter((event) => event.kind === "rejected").length, 2);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("writer guards refuse impossible sequences with the state code", () => {
	const root = mkTarget("guards");
	try {
		// validated/rejected/applied/undone before proposed.
		assert.equal(review.recordSuggestionValidated(root, { fingerprint: "fp-x" }).code, STATE_CODE);
		assert.equal(
			review.recordSuggestionDismissal(root, {
				fingerprint: "fp-x",
				reason: "dismissed-by-operator",
				summary: "s",
			}).code,
			STATE_CODE,
		);
		assert.equal(
			review.recordSuggestionApplied(root, {
				fingerprint: "fp-x",
				applied: [{ path: "docs/wiki/a.md", beforeHash: null, afterHash: null }],
			}).code,
			STATE_CODE,
		);
		assert.equal(
			review.recordSuggestionUndone(root, {
				fingerprint: "fp-x",
				restored: [{ path: "docs/wiki/a.md", hash: null }],
			}).code,
			STATE_CODE,
		);
		assert.equal(ledgerLines(root).length, 0, "a refused guard appends nothing");

		propose(root, "fp-x");
		// applied before validated.
		assert.equal(
			review.recordSuggestionApplied(root, {
				fingerprint: "fp-x",
				applied: [{ path: "docs/wiki/a.md", beforeHash: null, afterHash: null }],
			}).code,
			STATE_CODE,
		);
		review.recordSuggestionValidated(root, { fingerprint: "fp-x" });
		const applied = {
			fingerprint: "fp-x",
			applied: [{ path: "docs/wiki/a.md", beforeHash: null, afterHash: "a".repeat(64) }],
		};
		assert.equal(review.recordSuggestionApplied(root, applied).ok, true);
		// applied twice without an undo in between; undone twice after one undo.
		assert.equal(review.recordSuggestionApplied(root, applied).code, STATE_CODE);
		assert.equal(
			review.recordSuggestionUndone(root, {
				fingerprint: "fp-x",
				restored: [{ path: "docs/wiki/a.md", hash: null }],
			}).ok,
			true,
		);
		assert.equal(
			review.recordSuggestionUndone(root, {
				fingerprint: "fp-x",
				restored: [{ path: "docs/wiki/a.md", hash: null }],
			}).code,
			STATE_CODE,
		);
		// After the undo the balance allows a re-apply (F064 re-apply after undo).
		assert.equal(review.recordSuggestionApplied(root, applied).ok, true);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("fold fails closed on tampered bytes, broken chains, and hand-built legal-chain impossibilities", () => {
	const root = mkTarget("corrupt");
	try {
		propose(root, "fp-1");
		const file = review.reviewLedgerPath(root);

		// Unparseable bytes.
		fs.appendFileSync(file, "not-json\n", "utf8");
		assert.throws(
			() => review.foldSuggestionReview(root),
			(err) => err.amberCode === CORRUPT_CODE && /corrupt or unreadable/.test(err.message),
		);
		fs.rmSync(root, { recursive: true, force: true });
		fs.mkdirSync(path.dirname(file), { recursive: true });

		// A hand-built event with a VALID chain but an unknown kind: the chain
		// walk passes and the domain fold must refuse the kind itself.
		propose(root, "fp-1");
		const head = ledgerLines(root).at(-1).hash;
		const bogus = { kind: "mystery", schemaVersion: 1, at: "2026-09-16T00:00:00.000Z", fingerprint: "fp-1" };
		fs.appendFileSync(
			file,
			`${JSON.stringify({ ...bogus, prevHash: head, hash: chainHash(bogus, head) })}\n`,
			"utf8",
		);
		assert.throws(
			() => review.foldSuggestionReview(root),
			(err) => err.amberCode === CORRUPT_CODE && /unknown kind "mystery"/.test(err.message),
		);

		// A valid-chain validated event for an unproposed fingerprint.
		fs.rmSync(root, { recursive: true, force: true });
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const orphan = {
			kind: "validated",
			schemaVersion: 1,
			at: "2026-09-16T00:00:00.000Z",
			fingerprint: "never-proposed",
			checks: { v1: "pass", v2: "pass", v3: "pass" },
		};
		fs.appendFileSync(
			file,
			`${JSON.stringify({ ...orphan, prevHash: "0".repeat(64), hash: chainHash(orphan, "0".repeat(64)) })}\n`,
			"utf8",
		);
		assert.throws(
			() => review.foldSuggestionReview(root),
			(err) => err.amberCode === CORRUPT_CODE && /never proposed/.test(err.message),
		);

		// Writers refuse on the same corruption (write side never degrades).
		const refused = review.recordSuggestionValidated(root, { fingerprint: "fp-1" });
		assert.equal(refused.ok, false);
		assert.equal(refused.code, CORRUPT_CODE);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("a fresh lock and an exhausted ceiling refuse appends and prechecks with nothing written", () => {
	const root = mkTarget("lock-ceiling");
	try {
		propose(root, "fp-1");
		review.recordSuggestionValidated(root, { fingerprint: "fp-1" });
		const appliedInput = {
			kind: "applied",
			fingerprint: "fp-1",
			applied: [{ path: "docs/wiki/a.md", beforeHash: null, afterHash: "a".repeat(64) }],
		};
		const before = fs.readFileSync(review.reviewLedgerPath(root), "utf8");

		// Fresh lock held by another writer.
		const lockPath = path.join(path.dirname(review.reviewLedgerPath(root)), "review.lock");
		fs.writeFileSync(lockPath, "held-by-a-live-writer", "utf8");
		const lockedAppend = review.recordSuggestionApplied(root, appliedInput);
		assert.equal(lockedAppend.ok, false);
		assert.equal(lockedAppend.code, LOCK_CODE);
		const lockedPrecheck = review.precheckSuggestionReviewAppend(root, appliedInput);
		assert.equal(lockedPrecheck.ok, false);
		assert.equal(lockedPrecheck.code, LOCK_CODE);
		fs.rmSync(lockPath, { force: true });

		// Exhausted ceiling.
		process.env.AMBER_SUGGESTION_REVIEW_MAX_BYTES = "1";
		try {
			const ceilingPrecheck = review.precheckSuggestionReviewAppend(root, appliedInput);
			assert.equal(ceilingPrecheck.ok, false);
			assert.equal(ceilingPrecheck.code, CEILING_CODE);
			const ceilingAppend = review.recordSuggestionApplied(root, appliedInput);
			assert.equal(ceilingAppend.ok, false);
			assert.equal(ceilingAppend.code, CEILING_CODE);
		} finally {
			delete process.env.AMBER_SUGGESTION_REVIEW_MAX_BYTES;
		}

		assert.equal(fs.readFileSync(review.reviewLedgerPath(root), "utf8"), before);
	} finally {
		delete process.env.AMBER_SUGGESTION_REVIEW_MAX_BYTES;
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("the rejection-history hint reports none, rejected, and unknown — never a false 'no prior rejection'", () => {
	const root = mkTarget("history");
	try {
		// Missing ledger ⇒ unknown.
		assert.deepEqual(review.suggestionReviewHistory(root, "fp-1"), { status: "unknown" });
		// Readable ledger without a rejection ⇒ none.
		propose(root, "fp-1");
		assert.deepEqual(review.suggestionReviewHistory(root, "fp-1"), { status: "none" });
		// A prior rejection ⇒ the last rejection's reason/summary/at.
		propose(root, "fp-2");
		review.recordSuggestionValidityRejection(root, {
			fingerprint: "fp-2",
			reason: "validity:eval-only-claim",
			summary: "expectedEffect.readiness is solely an eval reference",
		});
		const history = review.suggestionReviewHistory(root, "fp-2");
		assert.equal(history.status, "rejected");
		assert.equal(history.reason, "validity:eval-only-claim");
		assert.match(history.summary, /readiness/);
		assert.match(history.at, /^\d{4}-\d{2}-\d{2}T/);
		// Corrupt ledger ⇒ unknown (read side degrades to unknown, never empty).
		fs.appendFileSync(review.reviewLedgerPath(root), "garbage\n", "utf8");
		assert.deepEqual(review.suggestionReviewHistory(root, "fp-2"), { status: "unknown" });
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("the §8.6 precheck walks the chain, evaluates the guard, and writes nothing on either outcome", () => {
	const root = mkTarget("precheck");
	try {
		propose(root, "fp-1");
		const appliedInput = {
			kind: "applied",
			fingerprint: "fp-1",
			applied: [{ path: "docs/wiki/a.md", beforeHash: null, afterHash: "a".repeat(64) }],
		};
		// Guard refusal: applied before validated.
		const guardRefusal = review.precheckSuggestionReviewAppend(root, appliedInput);
		assert.equal(guardRefusal.ok, false);
		assert.equal(guardRefusal.code, STATE_CODE);

		review.recordSuggestionValidated(root, { fingerprint: "fp-1" });
		const before = fs.readFileSync(review.reviewLedgerPath(root), "utf8");
		assert.deepEqual(review.precheckSuggestionReviewAppend(root, appliedInput), { ok: true });
		// A passing precheck appends nothing.
		assert.equal(fs.readFileSync(review.reviewLedgerPath(root), "utf8"), before);
		// A corrupt ledger fails the precheck's chain walk.
		fs.appendFileSync(review.reviewLedgerPath(root), "garbage\n", "utf8");
		const corruptPrecheck = review.precheckSuggestionReviewAppend(root, appliedInput);
		assert.equal(corruptPrecheck.ok, false);
		assert.equal(corruptPrecheck.code, CORRUPT_CODE);
		// Malformed input is an argument refusal.
		const malformed = review.precheckSuggestionReviewAppend(root, { kind: "applied" });
		assert.equal(malformed.ok, false);
		assert.equal(malformed.code, INVALID_ARG_CODE);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test("writer inputs are validated fail-closed: closed sets, digests, no credential material", () => {
	const root = mkTarget("inputs");
	try {
		// Malformed attribution block.
		const badAttribution = propose(root, "fp-1") && null;
		assert.equal(badAttribution, null);
		const invalidAttribution = review.ensureSuggestionProposed(root, {
			fingerprint: "fp-2",
			evidence: [],
			hosts: ["claude"],
			operations: [],
			attribution: { entrySurface: "tool-output", impactSurface: "nowhere", failureMode: "x", responsibleArtifact: "wiki" },
		});
		assert.equal(invalidAttribution.ok, false);
		assert.equal(invalidAttribution.code, INVALID_ARG_CODE);

		// A validity rejection reason outside the closed validity set.
		propose(root, "fp-3");
		const badReason = review.recordSuggestionValidityRejection(root, {
			fingerprint: "fp-3",
			reason: "validity:made-up",
			summary: "s",
		});
		assert.equal(badReason.ok, false);
		assert.equal(badReason.code, INVALID_ARG_CODE);

		// Credential material never rides a ledger-bound field.
		const leaky = review.recordSuggestionDismissal(root, {
			fingerprint: "fp-3",
			reason: "dismissed-by-operator",
			summary: "Authorization: Bearer sk-ant-secret000111222333444",
		});
		assert.equal(leaky.ok, false);
		assert.equal(leaky.code, INVALID_ARG_CODE);

		// Unknown kind; unknown field on an applied record.
		assert.equal(review.precheckSuggestionReviewAppend(root, { kind: "mystery" }).code, INVALID_ARG_CODE);
		const extraField = review.recordSuggestionApplied(root, {
			fingerprint: "fp-3",
			applied: [{ path: "docs/wiki/a.md", beforeHash: null, afterHash: null, previousContents: "x" }],
		});
		assert.equal(extraField.ok, false);
		assert.equal(extraField.code, INVALID_ARG_CODE);
		assert.equal(ledgerLines(root).length, 2, "only fp-1 and fp-3 proposals were written");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
