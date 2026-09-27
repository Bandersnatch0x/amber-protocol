"use strict";

// Structured governance ledger gates (issues/0155, adopted under the 0141
// consistency review D-4).
//
// The reference repo records rule adjudications as a structured, chain-hashed
// event stream; this repository had only prose `issues/` Log. This ledger closes
// that gap. Like the canonical-source gates (issues/0150), these checks are
// read-only and repository-local: the ledger is tracked at docs/governance/, so
// the chain verifies on a fresh clone and in CI without any `.amber/` runtime.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	LEDGER_PATH,
	SCHEMA_NAME,
	computeHash,
	readEvents,
	verifyChain,
	validateEvents,
	appendEvent,
} = require("../../scripts/lib/core/governance-ledger");
const { compileSchema } = require("../../scripts/lib/core/schema-contract");

function tmpLedger() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-ledger-"));
	return path.join(dir, "governance-ledger.jsonl");
}

describe("governance-event schema", () => {
	it("compiles through the shared schema-contract seam", () => {
		const validator = compileSchema(SCHEMA_NAME);
		assert.equal(typeof validator, "function");
	});
});

describe("committed governance ledger", () => {
	it("exists and is tracked at docs/governance/ (gate-able on a fresh clone)", () => {
		assert.ok(fs.existsSync(LEDGER_PATH), "docs/governance/governance-ledger.jsonl must exist");
	});

	it("every committed event satisfies the schema", () => {
		const result = validateEvents(readEvents());
		assert.ok(result.ok, `committed ledger has schema violations:\n${result.errors.join("\n")}`);
	});

	it("the committed chain verifies end to end", () => {
		const result = verifyChain(readEvents());
		assert.ok(result.ok, `committed ledger chain is broken:\n${result.errors.join("\n")}`);
	});
});

describe("chain gate discriminates tampering", () => {
	it("reports a mismatch when a committed event body is edited in place", () => {
		const events = readEvents();
		assert.ok(events.length >= 1, "need at least one committed event to tamper");
		const tampered = events.map((e) => ({ ...e }));
		tampered[0] = { ...tampered[0], rationale: `${tampered[0].rationale} (tampered)` };
		const result = verifyChain(tampered);
		assert.equal(result.ok, false);
		assert.ok(
			result.errors.some((e) => e.includes("hash mismatch")),
			"an in-place edit must be reported as a hash mismatch",
		);
	});

	it("reports a broken link when an event is dropped from the middle", () => {
		const events = readEvents();
		// A middle-drop only breaks linkage with 3+ events; with 2, dropping the
		// tail leaves a valid single-event chain. Prove the property on a
		// synthetic 3-event chain so the gate holds regardless of committed depth.
		const ledger = tmpLedger();
		const mk = (n, ev, extra) =>
			appendEvent(
				{
					id: `GOV-2026-09-27-3${n}0`,
					event: ev,
					candidateId: "CAND-mid",
					ruleId: "R-3@1",
					decidedBy: ev === "adjudicated" ? "user" : "agent",
					rationale: `e${n}`,
					confirmedAt: `2026-09-27T17:0${n}:00+08:00`,
					...extra,
				},
				ledger,
			);
		mk(1, "candidate_opened");
		mk(2, "candidate_opened");
		mk(3, "adjudicated", { decision: "promote" });
		const three = readEvents(ledger);
		void events;
		const dropped = [three[0], three[2]];
		const result = verifyChain(dropped);
		assert.equal(result.ok, false);
		assert.ok(
			result.errors.some((e) => e.includes("does not link")),
			"dropping a middle event must break the prevHash link",
		);
	});
});

describe("adjudicated events are user-only", () => {
	it("appendEvent refuses an adjudicated event decidedBy agent", () => {
		const ledger = tmpLedger();
		assert.throws(
			() =>
				appendEvent(
					{
						id: "GOV-2026-09-27-101",
						event: "adjudicated",
						candidateId: "CAND-test",
						ruleId: "R-1@1",
						decision: "promote",
						decidedBy: "agent",
						rationale: "agent must not self-adjudicate",
						confirmedAt: "2026-09-27T16:00:00+08:00",
					},
					ledger,
				),
			/must be decidedBy "user"/,
		);
	});

	it("seals and verifies a fresh append on an isolated ledger", () => {
		const ledger = tmpLedger();
		const first = appendEvent(
			{
				id: "GOV-2026-09-27-201",
				event: "candidate_opened",
				candidateId: "CAND-x",
				ruleId: "R-9@1",
				decidedBy: "agent",
				rationale: "open",
				confirmedAt: "2026-09-27T16:10:00+08:00",
			},
			ledger,
		);
		const second = appendEvent(
			{
				id: "GOV-2026-09-27-202",
				event: "adjudicated",
				candidateId: "CAND-x",
				ruleId: "R-9@1",
				decision: "reject",
				decidedBy: "user",
				rationale: "reject",
				confirmedAt: "2026-09-27T16:12:00+08:00",
			},
			ledger,
		);
		assert.equal(second.prevHash, first.hash, "second event links onto the first");
		const result = verifyChain(readEvents(ledger));
		assert.ok(result.ok, `fresh append chain broke:\n${result.errors.join("\n")}`);
		// recomputing the genesis hash is stable
		assert.equal(first.hash, computeHash(first, null));
	});
});
