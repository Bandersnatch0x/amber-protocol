"use strict";

// ADR-0020 Stage A governed local transport (F041).
//
// Amber's first governed mutation of the user's real checkout. The gate set
// reuses three proven primitives instead of a new dialect:
//   * approval  — loop-ledger shape: an `approved` record with a UUID
//                 approvalKey, consumable exactly once by an `executed`
//                 record (latestUnconsumedApproval);
//   * policy    — loop-policy deny-wins rules over the derived git ops;
//   * identity  — memory-style gate: non-TTY without --yes fails closed.
//
// The transport ledger lives at .amber/sync/transport/ledger.jsonl and is
// hash-chained via appendLedgerRecord. It is NEVER staged by the transport
// itself: only .amber/sync/envelopes and .amber/sync/transport/decisions are
// committed (adjudication 4). `git push` is never executed, evaluated, or
// proposed by the executing path in Stage A.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { statePathForCreate } = require("../state-dir-resolver");
const {
	appendLedgerRecord,
	canonicalize,
	verifyLedgerChain,
	verifyLedgerOutcome,
	latestUnconsumedApproval,
	readLedger,
} = require("./loop-ledger");
const { loadPolicyRules, evaluateGovernedPolicy } = require("./loop-policy");
const { codedError } = require("./error-catalog");
const { gitExec } = require("./git-exec");
const { pushEnvelopes } = require("./sync-session");
const { sha256Hex } = require("./context-hash");

// The one derivation from a structured op to the shell line a human would
// type. One-way: policy evaluates and the CLI renders these lines; nothing
// ever parses a shell string back into an operation (the injection hazard
// ADR-0020 Option 3 removes). Owned here so the executing path and the
// display path can never disagree.
function proposedOpText(op) {
	if (op.verb === "add") return `git add ${op.paths.join(" ")}`;
	if (op.verb === "commit") return `git commit -m "${op.message}"`;
	return "git push";
}

// Adjudication 4: Stage A stages exactly the envelopes home plus transport
// decision records — never the pull-side conflict ledger, never the transport
// ledger itself.
const STAGE_A_ADD_PATHS = [".amber/sync/envelopes", ".amber/sync/transport/decisions"];
const [ENVELOPES_HOME, DECISIONS_HOME] = STAGE_A_ADD_PATHS;

function stageAOps(envelopePathCount) {
	return [
		{ verb: "add", paths: [...STAGE_A_ADD_PATHS] },
		{ verb: "commit", message: `amber sync: ${envelopePathCount} envelope(s)` },
	];
}

function transportLedgerPath(targetRoot) {
	return statePathForCreate(targetRoot, "sync", "transport", "ledger.jsonl");
}

function transportDecisionsDir(targetRoot) {
	return statePathForCreate(targetRoot, "sync", "transport", "decisions");
}

function opsFingerprint(envelopeIds, affectedPaths) {
	return sha256Hex(
		canonicalize({
			envelopeIds: [...envelopeIds].sort(),
			affectedPaths: [...affectedPaths].sort(),
		}),
	);
}

/**
 * Record a single-use transport approval on the hash-chained transport
 * ledger. The reviewer is required: Stage A's first real-checkout mutation
 * must name the human who authorized it.
 * @param {{target: string, reviewer?: string}} input
 * @returns {{target: string, approvalKey: string, record: object, text: string, errors: string[], warnings: string[]}}
 */
function approveTransport({ target, reviewer }) {
	if (!reviewer || !String(reviewer).trim()) {
		return {
			target,
			errors: [
				"sync session approve requires --reviewer <name> [AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED] → fix: re-run with --reviewer <name>",
			],
			warnings: [],
		};
	}
	const approvalKey = crypto.randomUUID();
	const record = appendLedgerRecord(transportLedgerPath(target), {
		schemaVersion: 2,
		kind: "approved",
		approvalState: "approved",
		approvalKey,
		reviewer: String(reviewer).trim(),
		recordedAt: new Date().toISOString(),
		executesAnything: false,
	});
	return {
		target,
		approvalKey,
		record,
		text: `Approved sync transport (approvalKey ${approvalKey}, reviewer ${String(reviewer).trim()}). Now run: amber sync session push --execute --yes`,
		errors: [],
		warnings: [],
	};
}

/**
 * Read-only transport ledger report: chain integrity plus the count of
 * unconsumed approvals.
 * @param {string} target
 */
function transportLedgerStatus(target) {
	const lp = transportLedgerPath(target);
	const outcome = verifyLedgerOutcome(lp);
	const records = outcome.found ? readLedger(lp) : [];
	return {
		found: outcome.found,
		intact: outcome.intact,
		records: records.length,
		unconsumedApprovals: outcome.intact ? (latestUnconsumedApproval(records) ? 1 : 0) : 0,
		...(outcome.tamperedMessage ? { tampered: outcome.tamperedMessage } : {}),
	};
}

// Every governed refusal is appended to the transport ledger with the gate
// that refused, its typed code, and the ops fingerprint of what was attempted.
function denied(targetRoot, lp, gate, code, reason, subject) {
	appendLedgerRecord(lp, {
		schemaVersion: 2,
		kind: "denied",
		gate,
		code,
		command: "sync transport",
		reason,
		recordedAt: new Date().toISOString(),
		executesAnything: false,
		...subject,
	});
	return {
		target: targetRoot,
		executed: false,
		code,
		errors: [codedError(code, reason)],
		warnings: [],
	};
}

// git commit commits the WHOLE index, so the empty-index check is the
// load-bearing confinement: a pathspec add cannot sweep working-tree changes,
// but anything pre-staged by someone else would ride along in the commit.
function stagedIndexPaths(targetRoot) {
	const res = gitExec(targetRoot, ["diff", "--cached", "--name-only"]);
	if (!res.ok) return null;
	return res.stdout.length ? res.stdout.split(/\r?\n/) : [];
}

// Realpath confinement: every path the transport would stage must resolve
// inside the target repository. A symlinked (or junctioned) envelopes dir or
// file that resolves outside refuses execution. Enumerated directly rather
// than via collectFilesBySuffix, whose dirent-based isFile() skips symlink
// entries — exactly the entries this check exists to catch.
function confinementViolations(targetRoot) {
	const rootReal = fs.realpathSync(path.resolve(targetRoot));
	const inside = (real) => real === rootReal || real.startsWith(rootReal + path.sep);
	const violations = [];
	const checkPath = (abs, rel) => {
		if (!fs.existsSync(abs)) return;
		const real = fs.realpathSync(abs);
		if (!inside(real)) {
			violations.push(rel);
			return;
		}
		if (fs.statSync(real).isDirectory()) {
			for (const name of fs.readdirSync(abs)) {
				checkPath(path.join(abs, name), `${rel}/${name}`);
			}
		}
	};
	for (const spec of STAGE_A_ADD_PATHS) {
		checkPath(path.resolve(targetRoot, spec), spec);
	}
	return violations;
}

// Identity gate (memory precedent): agents run non-TTY and never pass --yes;
// a human in a TTY gets the F019-shaped approval envelope instead.
function identityRefusal(targetRoot, yes, isTTY) {
	if (yes) return null;
	if (!isTTY) {
		return {
			target: targetRoot,
			executed: false,
			code: "AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED",
			errors: [
				codedError(
					"AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED",
					"non-interactive invocation without --yes",
				),
			],
			warnings: [],
		};
	}
	return {
		target: targetRoot,
		executed: false,
		approvalRequired: true,
		hint: "Governed transport requires explicit approval (--yes) after `amber sync session approve --reviewer <name>`.",
		errors: [],
		warnings: [],
	};
}

// Policy gate (loop precedent): required rules.json, deny-wins, evaluated
// over each derived op's shell line (add/commit only — push is never
// evaluated or executed in Stage A).
function policyRefusal(targetRoot, lp, envelopePathCount, subject) {
	const rules = loadPolicyRules(targetRoot, { required: true });
	if (!rules) {
		return denied(
			targetRoot,
			lp,
			"policy",
			"AMBER_E_SYNC_TRANSPORT_POLICY_REFUSED",
			"governance rules.json is missing or invalid; governed transport requires an explicit policy",
			subject,
		);
	}
	for (const op of stageAOps(envelopePathCount)) {
		const verdict = evaluateGovernedPolicy(proposedOpText(op), rules);
		if (!verdict.allowed) {
			return denied(
				targetRoot,
				lp,
				"policy",
				"AMBER_E_SYNC_TRANSPORT_POLICY_REFUSED",
				`${proposedOpText(op)} — ${verdict.reason}`,
				{ ...subject, matchedRule: verdict.matchedRule },
			);
		}
	}
	return null;
}

// Approval gate (loop precedent): one approval authorizes exactly one
// execution.
function approvalRefusal(targetRoot, lp, subject) {
	if (latestUnconsumedApproval(readLedger(lp))) return null;
	return denied(
		targetRoot,
		lp,
		"approval",
		"AMBER_E_SYNC_TRANSPORT_NOT_APPROVED",
		"no unconsumed transport approval; each approval authorizes exactly one execution",
		subject,
	);
}

// Confinement gate: path-and-state isolation replaces the loop worktree.
function confinementRefusal(targetRoot, lp, subject) {
	if (!fs.existsSync(path.join(targetRoot, ".git"))) {
		return {
			target: targetRoot,
			executed: false,
			code: "AMBER_E_MISSING_PATH_ARG",
			errors: [codedError("AMBER_E_MISSING_PATH_ARG", "not a git repository")],
			warnings: [],
		};
	}
	const staged = stagedIndexPaths(targetRoot);
	if (staged === null) {
		return denied(
			targetRoot,
			lp,
			"confinement",
			"AMBER_E_SYNC_TRANSPORT_DIRTY_TREE",
			"could not inspect the git index (git diff --cached failed)",
			subject,
		);
	}
	if (staged.length > 0) {
		return denied(
			targetRoot,
			lp,
			"confinement",
			"AMBER_E_SYNC_TRANSPORT_DIRTY_TREE",
			`index already holds staged paths: ${staged.join(", ")}`,
			subject,
		);
	}
	const violations = confinementViolations(targetRoot);
	if (violations.length > 0) {
		return denied(
			targetRoot,
			lp,
			"confinement",
			"AMBER_E_SYNC_TRANSPORT_DIRTY_TREE",
			`staged paths resolve outside the repository: ${violations.join(", ")}`,
			subject,
		);
	}
	return null;
}

/**
 * Governed execution of the Stage A local transport (ADR-0020):
 * git add <envelopes + decision records> && git commit — never git push.
 *
 * Gate order (each governed refusal appends a ledger record):
 *   report → no-change → ledger-chain → conflict downgrade → identity →
 *   policy → approval → confinement → execution.
 *
 * @param {{target: string, yes?: boolean, isTTY?: boolean}} input
 */
function executeTransport({ target, yes = false, isTTY = process.stdout.isTTY }) {
	const targetRoot = path.resolve(target);
	const report = pushEnvelopes(targetRoot);
	if (report.errors.length > 0) {
		return { target: targetRoot, executed: false, errors: [...report.errors], warnings: [] };
	}
	if (report.envelopePaths.length === 0) {
		return {
			target: targetRoot,
			executed: false,
			outcome: "no-change",
			errors: [],
			warnings: [],
			note: report.note,
		};
	}

	const lp = transportLedgerPath(targetRoot);
	const chain = verifyLedgerChain(lp);
	if (!chain.intact) {
		return {
			target: targetRoot,
			executed: false,
			code: "AMBER_E_LEDGER_TAMPERED",
			errors: [
				codedError(
					"AMBER_E_LEDGER_TAMPERED",
					`transport ledger broken at record ${chain.brokenAt}: ${chain.reason}`,
				),
			],
			warnings: [],
		};
	}

	const subject = {
		envelopeIds: report.envelopeIds,
		opsFingerprint: opsFingerprint(report.envelopeIds, report.affectedPaths),
	};

	// Adjudication 2: pending conflicts downgrade to preparation-only — a
	// typed outcome, not an error.
	if (report.conflictCount > 0) {
		appendLedgerRecord(lp, {
			schemaVersion: 2,
			kind: "downgraded",
			reason: `pending conflicts (${report.conflictCount}) downgrade governed transport to preparation-only`,
			recordedAt: new Date().toISOString(),
			executesAnything: false,
			...subject,
		});
		return {
			target: targetRoot,
			executed: false,
			outcome: "preparation-only",
			conflictCount: report.conflictCount,
			errors: [],
			warnings: [],
		};
	}

	const refusal =
		identityRefusal(targetRoot, yes, isTTY) ||
		policyRefusal(targetRoot, lp, report.envelopePaths.length, subject) ||
		approvalRefusal(targetRoot, lp, subject) ||
		confinementRefusal(targetRoot, lp, subject);
	if (refusal) return refusal;

	const approval = latestUnconsumedApproval(readLedger(lp));
	return runStageAExecution(targetRoot, lp, approval, report, subject);
}

// The decision record is written BEFORE the commit so it is staged with the
// envelopes (the chicken-egg: commitSha can only ride in the ledger, never in
// the record it produced).
function writeDecisionRecord(targetRoot, batchId, approval, report, subject, ops) {
	const decisionsDir = transportDecisionsDir(targetRoot);
	const decisionPath = path.join(decisionsDir, `${batchId}.json`);
	fs.mkdirSync(decisionsDir, { recursive: true });
	fs.writeFileSync(
		decisionPath,
		JSON.stringify(
			{
				schemaVersion: 1,
				kind: "transport-decision",
				batchId,
				approvalKey: approval.approvalKey,
				reviewer: approval.reviewer,
				envelopeIds: report.envelopeIds,
				opsFingerprint: subject.opsFingerprint,
				ops,
				recordedAt: new Date().toISOString(),
				note: "ADR-0020 Stage A governed local commit; git push is not executed by Amber.",
			},
			null,
			2,
		) + "\n",
	);
	return decisionPath;
}

// Stage A execution: decision record + pathspec-confined add + commit.
// Envelopes are staged first; if the index holds no change against HEAD the
// retry is a typed nothing-to-commit outcome — no duplicate empty commit is
// created.
function runStageAExecution(targetRoot, lp, approval, report, subject) {
	const batchId = crypto.randomUUID();
	const ops = stageAOps(report.envelopePaths.length);
	const [, commitOp] = ops;
	const lines = ops.map(proposedOpText);
	const executedRecord = (over) =>
		appendLedgerRecord(lp, {
			schemaVersion: 2,
			kind: "executed",
			approvalState: "executed",
			consumedApprovalKey: approval.approvalKey,
			batchId,
			reviewer: approval.reviewer,
			commitSha: null,
			stopReason: "commit-failed",
			action: { ops: lines, addExitCode: null, commitExitCode: null, stderr: "" },
			recordedAt: new Date().toISOString(),
			executesAnything: true,
			...subject,
			...over,
		});
	const failure = (details) => {
		executedRecord(details);
		return {
			target: targetRoot,
			executed: false,
			code: "AMBER_E_SYNC_TRANSPORT_COMMIT_FAILED",
			errors: [
				codedError(
					"AMBER_E_SYNC_TRANSPORT_COMMIT_FAILED",
					`${details.action.commitExitCode === null ? "git add" : "git commit"} failed: ${details.action.stderr}`,
				),
			],
			warnings: [],
		};
	};

	// 1. Stage the envelopes (pathspec-confined; the ledger is never staged).
	const addEnvelopes = gitExec(targetRoot, ["add", ENVELOPES_HOME]);
	if (!addEnvelopes.ok) {
		return failure({
			action: {
				ops: lines,
				addExitCode: addEnvelopes.status,
				commitExitCode: null,
				stderr: addEnvelopes.stderr,
			},
		});
	}

	// 2. Idempotent retry: nothing staged against HEAD → nothing to commit.
	const stagedNow = stagedIndexPaths(targetRoot);
	if (stagedNow !== null && stagedNow.length === 0) {
		executedRecord({
			stopReason: "nothing-to-commit",
			action: { ops: lines, addExitCode: addEnvelopes.status, commitExitCode: null, stderr: "" },
		});
		return {
			target: targetRoot,
			executed: false,
			outcome: "nothing-to-commit",
			batchId,
			errors: [],
			warnings: [],
		};
	}

	// 3. Decision record (pre-commit so it rides in the same commit).
	const decisionPath = writeDecisionRecord(targetRoot, batchId, approval, report, subject, ops);
	const addDecisions = gitExec(targetRoot, ["add", DECISIONS_HOME]);
	if (!addDecisions.ok) {
		return failure({
			action: {
				ops: lines,
				addExitCode: addDecisions.status,
				commitExitCode: null,
				stderr: addDecisions.stderr,
			},
		});
	}

	// 4. Commit with the derived message (whole index — the empty-index gate
	// above is what makes this safe).
	const commit = gitExec(targetRoot, ["commit", "-m", commitOp.message]);
	if (!commit.ok) {
		return failure({
			action: {
				ops: lines,
				addExitCode: addDecisions.status,
				commitExitCode: commit.status,
				stderr: commit.stderr,
			},
		});
	}
	const commitSha = gitExec(targetRoot, ["rev-parse", "HEAD"]).stdout;
	executedRecord({
		commitSha,
		stopReason: "completed",
		action: {
			ops: lines,
			addExitCode: addDecisions.status,
			commitExitCode: commit.status,
			stderr: commit.stderr,
		},
	});
	return {
		target: targetRoot,
		executed: true,
		outcome: "executed",
		commitSha,
		batchId,
		decisionRecord: path.relative(targetRoot, decisionPath).split(path.sep).join("/"),
		errors: [],
		warnings: [],
	};
}

module.exports = {
	proposedOpText,
	STAGE_A_ADD_PATHS,
	stageAOps,
	transportLedgerPath,
	transportDecisionsDir,
	opsFingerprint,
	approveTransport,
	transportLedgerStatus,
	executeTransport,
};
