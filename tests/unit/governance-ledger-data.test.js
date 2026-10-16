"use strict";
const { trackTempDir } = require("../helpers/harness");

// Guard for the committed governance ledger (issues/0155, re-anchored by issues/0338).
//
// The ledger is repository data: `docs/governance/governance-ledger.jsonl` is tracked, and
// its whole point is that a fresh clone and CI can prove the chain still verifies. The
// module that wrote it (`scripts/lib/core/governance-ledger.js`) and the test that checked
// it were both deleted in the hardening stack, which left the committed data with no
// validator at all ? an edit in place would have failed nothing.
//
// This guard is deliberately NOT a revived writer module. `scripts/check-reachability.js`
// (tests/unit/module-reachability.test.js) fails any `scripts/lib` module nothing shipped
// from requires, and nothing requires this one: appends are made by hand. A data validator
// lives in `tests/` in this repository (see tests/unit/policy-ledger-bytes.test.js), so the
// chain logic is inlined here and stays the only copy that matters.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { compileSchema, validate } = require("../../scripts/lib/core/schema-contract");
const { sha256, canonicalJson } = require("../../scripts/lib/core/context-hash");
const { readJSONL } = require("../../scripts/lib/core/jsonl");

const SCHEMA_NAME = "governance-event";
const ROOT = path.join(__dirname, "..", "..");
const LEDGER_PATH = path.join(ROOT, "docs", "governance", "governance-ledger.jsonl");
const COMMITTED_TAIL_HASH =
	"sha256:291f7a8793550d0c0aa374d900c04a5621bc39bba533794d47dad7e13b1466f1";

/**
 * Chain hash of one event: sha256 over the canonical form of the event (its own
 * `hash` removed) chained onto the previous event's hash. Must match the sealed
 * committed data exactly ? the recorded hashes are the contract.
 */
function computeHash(event, prevHash) {
	const { hash: _ignored, ...rest } = event;
	rest.prevHash = prevHash ?? null;
	return sha256(`${prevHash ?? ""}\n${canonicalJson(JSON.stringify(rest))}`);
}

function readEvents(ledgerPath = LEDGER_PATH) {
	// fail closed: a corrupt line throws instead of being skipped.
	return readJSONL(ledgerPath, { onCorrupt: "throw", missing: "throw" });
}

function verifyChain(events, expectedTailHash) {
	const errors = [];
	let prevHash = null;
	events.forEach((event, index) => {
		const where = `event[${index}] ${event && event.id ? event.id : "(no id)"}`;
		if (!event || typeof event !== "object") {
			errors.push(`${where}: not an object`);
			return;
		}
		if ((event.prevHash ?? null) !== prevHash) {
			errors.push(`${where}: prevHash does not link to prior hash ${JSON.stringify(prevHash)}`);
		}
		if (event.hash !== computeHash(event, prevHash)) {
			errors.push(`${where}: hash mismatch`);
		}
		prevHash = event.hash;
	});
	if (expectedTailHash !== undefined && prevHash !== expectedTailHash) {
		errors.push("committed tail hash mismatch");
	}
	return { ok: errors.length === 0, errors };
}

function validateEvents(events) {
	for (let i = 0; i < events.length; i += 1) {
		const result = validate(SCHEMA_NAME, events[i]);
		if (!result.valid) {
			const id = events[i] && events[i.id] ? events[i.id] : `index ${i}`;
			return { ok: false, errors: result.errors.map((e) => `${id}: ${e}`) };
		}
	}
	return { ok: true, errors: [] };
}

function sealedEvent(partial, prevHash) {
	const sealed = { ...partial, prevHash };
	sealed.hash = computeHash(sealed, prevHash);
	return sealed;
}

const CANDIDATE = {
	id: "GOV-2026-09-27-901",
	event: "candidate_opened",
	candidateId: "CAND-guard",
	ruleId: "R-guard@1",
	decidedBy: "agent",
	rationale: "guard fixture",
	confirmedAt: "2026-09-27T16:10:00+08:00",
};

const ADJUDICATED = {
	id: "GOV-2026-09-27-902",
	event: "adjudicated",
	candidateId: "CAND-guard",
	ruleId: "R-guard@1",
	decision: "adopt",
	decidedBy: "user",
	rationale: "guard fixture",
	confirmedAt: "2026-09-27T16:12:00+08:00",
};

function tmpLedger() {
	const dir = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), "gov-ledger-")));
	return path.join(dir, "governance-ledger.jsonl");
}

function writeEvents(ledgerPath, events) {
	fs.writeFileSync(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

describe("governance-event schema", () => {
	it("compiles through the shared schema-contract seam", () => {
		assert.equal(typeof compileSchema(SCHEMA_NAME), "function");
	});
});

describe("committed governance ledger", () => {
	it("is tracked in version control (a delivered artifact, not runtime state)", () => {
		const listed = spawnSync("git", ["ls-files", "--", "docs/governance/governance-ledger.jsonl"], {
			cwd: ROOT,
			encoding: "utf8",
		});
		assert.equal(listed.status, 0);
		assert.ok(
			listed.stdout.trim().length > 0,
			"the ledger must stay tracked so a fresh clone verifies it",
		);
	});

	it("exists and carries at least one event", () => {
		assert.ok(fs.existsSync(LEDGER_PATH), "docs/governance/governance-ledger.jsonl must exist");
		assert.ok(readEvents().length >= 1, "an emptied ledger is not a ledger");
	});

	it("every committed event satisfies the schema", () => {
		const result = validateEvents(readEvents());
		assert.ok(result.ok, `committed ledger has schema violations:\n${result.errors.join("\n")}`);
	});

	it("the committed chain verifies end to end", () => {
		const result = verifyChain(readEvents(), COMMITTED_TAIL_HASH);
		assert.ok(result.ok, `committed ledger chain is broken:\n${result.errors.join("\n")}`);
	});

	it("the genesis event starts the chain with a null prevHash", () => {
		const [first] = readEvents();
		assert.equal(first.prevHash ?? null, null, "the first event must not link to anything");
	});
});

describe("chain gate discriminates tampering", () => {
	it("reports a mismatch when a committed event body is edited in place", () => {
		const events = readEvents();
		const tampered = events.map((event) => ({ ...event }));
		tampered[0] = { ...tampered[0], rationale: `${tampered[0].rationale} (tampered)` };
		const result = verifyChain(tampered);
		assert.equal(result.ok, false);
		assert.ok(
			result.errors.some((e) => e.includes("hash mismatch")),
			"an in-place edit must be reported as a hash mismatch",
		);
	});

	it("reports a mismatch when only the hash field is rewritten", () => {
		const events = readEvents();
		const forged = events.map((event) => ({ ...event }));
		forged[forged.length - 1].hash = `sha256:${"0".repeat(64)}`;
		const result = verifyChain(forged);
		assert.equal(result.ok, false);
		assert.deepEqual(result.errors, [
			`event[${forged.length - 1}] ${forged.at(-1).id}: hash mismatch`,
		]);
	});

	it("refuses a valid committed prefix that loses the pinned tail", () => {
		const prefix = readEvents().slice(0, -1);
		assert.equal(verifyChain(prefix).ok, true, "a valid prefix alone cannot detect truncation");
		const result = verifyChain(prefix, COMMITTED_TAIL_HASH);
		assert.equal(result.ok, false);
		assert.deepEqual(result.errors, ["committed tail hash mismatch"]);
	});

	it("refuses a corrupted line instead of skipping it", () => {
		const ledger = tmpLedger();
		writeEvents(ledger, [sealedEvent(CANDIDATE, null)]);
		fs.appendFileSync(ledger, "{ not json }\n", "utf8");
		assert.throws(() => readEvents(ledger), /corrupt JSONL line/);
	});

	it("breaks linkage when an event is dropped from the middle", () => {
		// A middle-drop only shows up with 3+ events, so prove the property on a
		// synthetic chain and keep the gate independent of committed depth.
		const first = sealedEvent(CANDIDATE, null);
		const second = sealedEvent(ADJUDICATED, first.hash);
		const third = sealedEvent({ ...CANDIDATE, id: "GOV-2026-09-27-903" }, second.hash);
		const dropped = [first, third];
		const result = verifyChain(dropped);
		assert.equal(result.ok, false);
		assert.ok(
			result.errors.some((e) => e.includes("does not link")),
			"dropping a middle event must break the prevHash link",
		);
	});
});

describe("adjudicated events are user-only", () => {
	it("the schema refuses an adjudicated event decided by an agent", () => {
		const sealed = sealedEvent({ ...ADJUDICATED, decidedBy: "agent" }, null);
		const result = validate(SCHEMA_NAME, sealed);
		assert.equal(result.valid, false, "an agent must not be able to self-adjudicate");
	});

	it("the schema requires candidateId, ruleId and decision on an adjudication", () => {
		const sealed = sealedEvent(
			{
				id: "GOV-2026-09-27-904",
				event: "adjudicated",
				decidedBy: "user",
				rationale: "missing the binding fields",
				confirmedAt: "2026-09-27T16:20:00+08:00",
			},
			null,
		);
		assert.equal(validate(SCHEMA_NAME, sealed).valid, false);
	});

	it("seals a fresh append that verifies against a two-event chain", () => {
		const first = sealedEvent(CANDIDATE, null);
		const second = sealedEvent(ADJUDICATED, first.hash);
		assert.equal(second.prevHash, first.hash, "second event links onto the first");
		assert.ok(verifyChain([first, second]).ok);
		assert.ok(validateEvents([first, second]).ok);
		const ledger = tmpLedger();
		writeEvents(ledger, [first, second]);
		assert.ok(verifyChain(readEvents(ledger)).ok, "a sealed chain must re-read identical");
	});
});
