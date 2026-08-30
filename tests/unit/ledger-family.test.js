"use strict";

// F061 T2 (#299) — the defineLedgerFamily factory skeleton (ADR-0028).
// A synthetic family fixture proves the produced surface carries the full
// governed-ledger ritual end to end: declaration → governed append (with
// Decision-pin events guarded by the shared spend-scan kernel) →
// chain-head read → fold read → green chain walk; an in-place edit, a
// held lock, and an oversized append each fail closed with the DECLARED
// stable codes; and a malformed declaration refuses at definition time —
// missing fields, unknown knobs, path escapes, and duplicate ledger axes
// all throw before any surface exists.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { defineLedgerFamily } = require("../../scripts/lib/core/ledger-family");
const { typedError } = require("../../scripts/lib/core/error-catalog");
const {
	GENESIS_HASH,
	chainHash,
	chainLinkProblem,
	isNonEmptyString,
	closedFieldProblem,
	decisionPinProblem,
	findDecisionSpend,
} = require("../../scripts/lib/core/registry-ledger");
const { mkLedgerTarget, readEvents, writeEvents } = require("../helpers/harness");

const mkTarget = mkLedgerTarget("amber-ledger-family");

const AT = "2026-08-30T12:00:00.000Z";

// Synthetic stable codes: tests/ are outside the production error-catalog
// census, and typedError degrades gracefully for unregistered codes.
const SYNTH_INVALID_CODE = "AMBER_E_SYNTH_INVALID";
const SYNTH_CORRUPT_CODE = "AMBER_E_SYNTH_CORRUPT";
const SYNTH_LOCK_CODE = "AMBER_E_SYNTH_LOCK";
const SYNTH_SIZE_CEILING_CODE = "AMBER_E_SYNTH_SIZE_CEILING";
const SYNTH_ENV = "AMBER_SYNTH_MAX_SIGNALS_BYTES";

const SIGNAL_EVENT_FIELDS = Object.freeze([
	"kind",
	"schemaVersion",
	"at",
	"id",
	"note",
	"decision",
	"prevHash",
	"hash",
]);

const signalsCorrupt = (message) => typedError(SYNTH_CORRUPT_CODE, message);

// The synthetic family's domain half, shaped like a real family fold:
// schema, kind, closed field set, Decision pin, and unique-id application.
function applySignalEvent(state, event, lineIndex) {
	const label = `synthetic signal event ${lineIndex}`;
	if (event.schemaVersion !== 1)
		throw signalsCorrupt(
			`${label} declares unsupported schemaVersion ${JSON.stringify(event.schemaVersion)}`,
		);
	if (event.kind !== "emit")
		throw signalsCorrupt(`${label} carries unknown kind ${JSON.stringify(event.kind)}`);
	const closed = closedFieldProblem(event, SIGNAL_EVENT_FIELDS, label);
	if (closed !== null) throw signalsCorrupt(closed);
	if (!isNonEmptyString(event.id)) throw signalsCorrupt(`${label}.id must be a non-empty string`);
	const pin = decisionPinProblem(event.decision);
	if (pin !== null) throw signalsCorrupt(`${label}: ${pin}`);
	if (state.byId.has(event.id))
		throw signalsCorrupt(`${label} reuses signal id ${JSON.stringify(event.id)}`);
	const signal = { id: event.id, note: event.note, decision: event.decision };
	state.signals.push(signal);
	state.byId.set(event.id, signal);
}

const SIGNAL_FOLD = Object.freeze({
	init: () => ({ signals: [], byId: new Map() }),
	apply: applySignalEvent,
	result: (state) => state.signals,
});

// One fresh, fully valid declaration per call: the main family consumes it
// verbatim and the declaration-validation cases mutate their own copies.
function validDeclaration() {
	return {
		dir: "synth",
		label: "synthetic",
		ledgers: [
			{
				name: "signals",
				fileName: "signals.jsonl",
				lockName: "signals.lock",
				conflictCode: SYNTH_LOCK_CODE,
				corruptCode: SYNTH_CORRUPT_CODE,
				sizeCeilingCode: SYNTH_SIZE_CEILING_CODE,
				ceiling: { envName: SYNTH_ENV, defaultBytes: 1024 * 1024 },
				label: "synthetic signal ledger",
				eventLabel: "synthetic signal",
				fold: { ...SIGNAL_FOLD },
			},
		],
	};
}

const FAMILY = defineLedgerFamily(validDeclaration());

const pin = (identity, revision = 1) => ({ identity, revision });

const failVerdict = (code, errors) => ({ ok: false, code, record: null, errors });

// The family-shaped writer: guard enforces unique ids plus single-use
// Decision spending through the shared kernel, derive re-reads the record.
function emitSignal(dir, { id, note, decision }) {
	return FAMILY.ledgers.signals.append(
		dir,
		{ kind: "emit", schemaVersion: 1, at: AT, id, note, decision },
		(signals) => {
			if (signals.some((signal) => signal.id === id))
				return failVerdict(SYNTH_INVALID_CODE, [`signal ${JSON.stringify(id)} already exists`]);
			const spent = findDecisionSpend(signals, decision, ["decision"]);
			if (spent !== null)
				return failVerdict(SYNTH_INVALID_CODE, [
					`decision ${JSON.stringify(decision.identity)}@${decision.revision} already emitted signal ${JSON.stringify(spent.record.id)}; a synthetic Decision is single-use`,
				]);
			return null;
		},
		(signals) => signals.find((signal) => signal.id === id) ?? null,
	);
}

// ── The full ritual: declaration → append → chainHead → fold → walk ──────

test("the declared family runs the full ritual green end to end", () => {
	const dir = mkTarget("ritual");
	const signals = FAMILY.ledgers.signals;
	assert.equal(signals.path(dir), path.join(dir, ".amber", "synth", "signals.jsonl"));
	assert.equal(signals.chainHead(dir), GENESIS_HASH);
	assert.deepEqual(signals.fold(dir), []);
	const first = emitSignal(dir, { id: "s-1", note: "first", decision: pin("d-1") });
	assert.equal(first.ok, true, (first.errors || []).join("; "));
	assert.deepEqual(first.record, { id: "s-1", note: "first", decision: pin("d-1") });
	assert.equal(emitSignal(dir, { id: "s-2", note: "second", decision: pin("d-2") }).ok, true);
	const folded = signals.fold(dir);
	assert.deepEqual(
		folded.map((signal) => signal.id),
		["s-1", "s-2"],
	);
	const events = readEvents(signals.path(dir));
	assert.equal(events.length, 2);
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(events[1].prevHash, events[0].hash);
	assert.equal(signals.chainHead(dir), events[1].hash);
	// The recorded chain re-walks green through the shared prologue.
	assert.equal(chainLinkProblem(events[0], GENESIS_HASH, 1, "synthetic signal"), null);
	assert.equal(chainLinkProblem(events[1], events[0].hash, 2, "synthetic signal"), null);
});

test("the governed append evaluates a body factory against the in-lock fold", () => {
	const dir = mkTarget("body-factory");
	assert.equal(emitSignal(dir, { id: "s-1", note: "first", decision: pin("d-1") }).ok, true);
	const result = FAMILY.ledgers.signals.append(
		dir,
		(signals) => ({
			kind: "emit",
			schemaVersion: 1,
			at: AT,
			id: `s-${signals.length + 1}`,
			note: `after-${signals.length}`,
			decision: pin("d-2"),
		}),
		() => null,
		(signals) => signals[signals.length - 1],
	);
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.record.id, "s-2");
	assert.equal(result.record.note, "after-1");
});

test("a pinned Decision spends once: the kernel-backed guard refuses a replay", () => {
	const dir = mkTarget("decision-spend");
	assert.equal(emitSignal(dir, { id: "s-1", note: "first", decision: pin("d-1") }).ok, true);
	const replay = emitSignal(dir, { id: "s-2", note: "second", decision: pin("d-1") });
	assert.equal(replay.ok, false);
	assert.equal(replay.code, SYNTH_INVALID_CODE);
	assert.equal(
		replay.errors[0],
		'decision "d-1"@1 already emitted signal "s-1"; a synthetic Decision is single-use',
	);
	// The refused append left no durable trace behind.
	assert.equal(readEvents(FAMILY.ledgers.signals.path(dir)).length, 1);
	assert.equal(FAMILY.ledgers.signals.fold(dir).length, 1);
});

// ── Fail-closed reads: tamper, forgery, and unreadable bytes ─────────────

test("an in-place edit fails fold and append closed with the declared corrupt code", () => {
	const dir = mkTarget("tamper-edit");
	assert.equal(emitSignal(dir, { id: "s-1", note: "first", decision: pin("d-1") }).ok, true);
	assert.equal(emitSignal(dir, { id: "s-2", note: "second", decision: pin("d-2") }).ok, true);
	const ledgerPath = FAMILY.ledgers.signals.path(dir);
	const events = readEvents(ledgerPath);
	writeEvents(ledgerPath, [{ ...events[0], note: "rewritten" }, events[1]]);
	assert.throws(
		() => FAMILY.ledgers.signals.fold(dir),
		(err) =>
			err.amberCode === SYNTH_CORRUPT_CODE &&
			/synthetic signal event 1 carries a hash that does not match its content/.test(err.message),
	);
	const refused = emitSignal(dir, { id: "s-3", note: "third", decision: pin("d-3") });
	assert.equal(refused.ok, false);
	assert.equal(refused.code, SYNTH_CORRUPT_CODE);
});

test("a broken link and a validly re-chained forgery both fail the walk closed", () => {
	const dir = mkTarget("tamper-chain");
	assert.equal(emitSignal(dir, { id: "s-1", note: "first", decision: pin("d-1") }).ok, true);
	assert.equal(emitSignal(dir, { id: "s-2", note: "second", decision: pin("d-2") }).ok, true);
	const ledgerPath = FAMILY.ledgers.signals.path(dir);
	const events = readEvents(ledgerPath);
	writeEvents(ledgerPath, [events[0], { ...events[1], prevHash: GENESIS_HASH }]);
	assert.throws(
		() => FAMILY.ledgers.signals.fold(dir),
		(err) =>
			err.amberCode === SYNTH_CORRUPT_CODE &&
			/synthetic signal event 2 breaks the hash chain/.test(err.message),
	);
	// A forged event whose chain link IS valid still hits the family's
	// domain checks inside the same walk — the fold hands over every
	// linked event in ledger order.
	const bogus = {
		kind: "bogus",
		schemaVersion: 1,
		at: AT,
		id: "s-9",
		note: "forged",
		decision: pin("d-9"),
	};
	writeEvents(ledgerPath, [
		events[0],
		{ ...bogus, prevHash: events[0].hash, hash: chainHash(bogus, events[0].hash) },
	]);
	assert.throws(
		() => FAMILY.ledgers.signals.fold(dir),
		(err) =>
			err.amberCode === SYNTH_CORRUPT_CODE &&
			/synthetic signal event 2 carries unknown kind "bogus"/.test(err.message),
	);
});

test("unreadable bytes fail chainHead and fold closed with the corrupt code", () => {
	const dir = mkTarget("tamper-bytes");
	assert.equal(emitSignal(dir, { id: "s-1", note: "first", decision: pin("d-1") }).ok, true);
	fs.appendFileSync(FAMILY.ledgers.signals.path(dir), "not-json\n", "utf8");
	for (const read of [
		() => FAMILY.ledgers.signals.chainHead(dir),
		() => FAMILY.ledgers.signals.fold(dir),
	]) {
		assert.throws(
			read,
			(err) => err.amberCode === SYNTH_CORRUPT_CODE && /corrupt or unreadable/.test(err.message),
		);
	}
});

// ── Lock conflicts and append-size ceilings ──────────────────────────────

test("a fresh lock held by another writer refuses with the declared conflict code", () => {
	const dir = mkTarget("lock-conflict");
	assert.equal(emitSignal(dir, { id: "s-1", note: "first", decision: pin("d-1") }).ok, true);
	const lockPath = path.join(path.dirname(FAMILY.ledgers.signals.path(dir)), "signals.lock");
	fs.writeFileSync(lockPath, "held-by-a-live-writer", "utf8");
	try {
		const refused = emitSignal(dir, { id: "s-2", note: "second", decision: pin("d-2") });
		assert.equal(refused.ok, false);
		assert.equal(refused.code, SYNTH_LOCK_CODE);
		assert.match(refused.errors[0], /another synthetic signal ledger write is in flight/);
	} finally {
		fs.rmSync(lockPath, { force: true });
	}
	// Releasing the conflicting writer restores the append path.
	assert.equal(emitSignal(dir, { id: "s-2", note: "second", decision: pin("d-2") }).ok, true);
});

test("the declared default ceiling refuses before any durable state is touched", () => {
	const dir = mkTarget("ceiling-default");
	const declaration = validDeclaration();
	declaration.ledgers[0].ceiling.defaultBytes = 1;
	const tiny = defineLedgerFamily(declaration);
	const refused = tiny.ledgers.signals.append(
		dir,
		{ kind: "emit", schemaVersion: 1, at: AT, id: "s-1", note: "first", decision: pin("d-1") },
		() => null,
		(signals) => signals[0] ?? null,
	);
	assert.equal(refused.ok, false);
	assert.equal(refused.code, SYNTH_SIZE_CEILING_CODE);
	assert.equal(refused.errors[0], "synthetic signal ledger event would exceed 1 bytes");
	assert.equal(fs.existsSync(tiny.ledgers.signals.path(dir)), false);
});

test("the declared env override bounds the append at read time", () => {
	const dir = mkTarget("ceiling-env");
	assert.equal(emitSignal(dir, { id: "s-1", note: "first", decision: pin("d-1") }).ok, true);
	const ledgerPath = FAMILY.ledgers.signals.path(dir);
	process.env[SYNTH_ENV] = String(fs.statSync(ledgerPath).size + 10);
	try {
		const refused = emitSignal(dir, { id: "s-2", note: "second", decision: pin("d-2") });
		assert.equal(refused.ok, false);
		assert.equal(refused.code, SYNTH_SIZE_CEILING_CODE);
		assert.match(refused.errors[0], /synthetic signal ledger event would exceed \d+ bytes/);
	} finally {
		delete process.env[SYNTH_ENV];
	}
	assert.equal(FAMILY.ledgers.signals.fold(dir).length, 1);
});

// ── Declaration validation: fail-closed at definition time ───────────────

test("a malformed declaration refuses at definition time, field by field", () => {
	const cases = [
		["a missing top-level field", (d) => delete d.dir, /declaration is missing field "dir"/],
		[
			"an unknown top-level field",
			(d) => {
				d.extra = 1;
			},
			/declaration carries unknown field "extra"/,
		],
		[
			"a dir escaping the state directory",
			(d) => {
				d.dir = "synth/../elsewhere";
			},
			/declaration\.dir must be a bare name/,
		],
		[
			"a blank family label",
			(d) => {
				d.label = " ";
			},
			/declaration\.label must be a non-empty string/,
		],
		[
			"an empty ledger list",
			(d) => {
				d.ledgers = [];
			},
			/declaration\.ledgers must be a non-empty array/,
		],
		[
			"a non-object ledger entry",
			(d) => {
				d.ledgers = [null];
			},
			/declaration\.ledgers\[0\] must be an object/,
		],
		[
			"a missing ledger field",
			(d) => delete d.ledgers[0].lockName,
			/declaration\.ledgers\[0\] is missing field "lockName"/,
		],
		[
			"an unknown ledger knob",
			(d) => {
				d.ledgers[0].staleMs = 5;
			},
			/declaration\.ledgers\[0\] carries unknown field "staleMs"/,
		],
		[
			"a file name with a path separator",
			(d) => {
				d.ledgers[0].fileName = "nested/signals.jsonl";
			},
			/declaration\.ledgers\[0\]\.fileName must be a bare name/,
		],
		[
			"a ceiling missing its bound",
			(d) => delete d.ledgers[0].ceiling.defaultBytes,
			/declaration\.ledgers\[0\]\.ceiling is missing field "defaultBytes"/,
		],
		[
			"a non-positive ceiling bound",
			(d) => {
				d.ledgers[0].ceiling.defaultBytes = 0;
			},
			/declaration\.ledgers\[0\]\.ceiling\.defaultBytes must be a positive integer/,
		],
		[
			"a fold missing its projection",
			(d) => delete d.ledgers[0].fold.result,
			/declaration\.ledgers\[0\]\.fold is missing field "result"/,
		],
		[
			"a fold step that is not a function",
			(d) => {
				d.ledgers[0].fold.apply = 42;
			},
			/declaration\.ledgers\[0\]\.fold\.apply must be a function/,
		],
	];
	for (const [scenario, mutate, message] of cases) {
		const declaration = validDeclaration();
		mutate(declaration);
		assert.throws(
			() => defineLedgerFamily(declaration),
			{ name: "TypeError", message },
			`${scenario} must refuse`,
		);
	}
	assert.throws(() => defineLedgerFamily(null), {
		name: "TypeError",
		message: /declaration must be an object/,
	});
});

test("two ledgers can never share a name, file, or lock inside one family", () => {
	for (const [axis, message] of [
		["name", /reuses "signals"; every ledger in a family owns its own name/],
		["fileName", /reuses "signals\.jsonl"; every ledger in a family owns its own fileName/],
		["lockName", /reuses "signals\.lock"; every ledger in a family owns its own lockName/],
	]) {
		const declaration = validDeclaration();
		const twin = {
			...declaration.ledgers[0],
			name: "retirements",
			fileName: "retirements.jsonl",
			lockName: "retirements.lock",
			[axis]: declaration.ledgers[0][axis],
		};
		declaration.ledgers.push(twin);
		assert.throws(
			() => defineLedgerFamily(declaration),
			{ name: "TypeError", message },
			`duplicate ${axis} must refuse`,
		);
	}
});

// ── The produced surface: frozen, closed, and single-dialect ─────────────

test("the produced surface is frozen and exposes no private-append escape hatch", () => {
	assert.equal(Object.isFrozen(FAMILY), true);
	assert.equal(Object.isFrozen(FAMILY.ledgers), true);
	const signals = FAMILY.ledgers.signals;
	assert.equal(Object.isFrozen(signals), true);
	assert.equal(Object.isFrozen(signals.ceiling), true);
	// The append lock rides only inside the governed append: full
	// orchestration is the single dialect.
	assert.equal("acquire" in signals, false);
	assert.equal(FAMILY.dir, "synth");
	assert.equal(FAMILY.label, "synthetic");
	assert.equal(signals.name, "signals");
	assert.equal(signals.label, "synthetic signal ledger");
	assert.equal(signals.eventLabel, "synthetic signal");
	assert.equal(signals.conflictCode, SYNTH_LOCK_CODE);
	assert.equal(signals.corruptCode, SYNTH_CORRUPT_CODE);
	assert.equal(signals.sizeCeilingCode, SYNTH_SIZE_CEILING_CODE);
	assert.deepEqual(signals.ceiling, { envName: SYNTH_ENV, defaultBytes: 1024 * 1024 });
	const corrupt = signals.corrupt("boom");
	assert.equal(corrupt.amberCode, SYNTH_CORRUPT_CODE);
	assert.equal(corrupt.message, "boom");
});

test("a family declares several ledgers, each with its own independent ritual", () => {
	const RETIRE_CORRUPT_CODE = "AMBER_E_SYNTH_RETIRE_CORRUPT";
	const declaration = validDeclaration();
	declaration.ledgers.push({
		name: "retirements",
		fileName: "retirements.jsonl",
		lockName: "retirements.lock",
		conflictCode: "AMBER_E_SYNTH_RETIRE_LOCK",
		corruptCode: RETIRE_CORRUPT_CODE,
		sizeCeilingCode: "AMBER_E_SYNTH_RETIRE_SIZE_CEILING",
		ceiling: { envName: "AMBER_SYNTH_MAX_RETIREMENTS_BYTES", defaultBytes: 1024 * 1024 },
		label: "synthetic retirement ledger",
		eventLabel: "synthetic retirement",
		fold: {
			init: () => ({ retirements: [] }),
			apply: (state, event, lineIndex) => {
				if (event.kind !== "retire")
					throw typedError(
						RETIRE_CORRUPT_CODE,
						`synthetic retirement event ${lineIndex} carries unknown kind ${JSON.stringify(event.kind)}`,
					);
				state.retirements.push({ id: event.id });
			},
			result: (state) => state.retirements,
		},
	});
	const family = defineLedgerFamily(declaration);
	const dir = mkTarget("twin");
	assert.notEqual(family.ledgers.signals.path(dir), family.ledgers.retirements.path(dir));
	assert.equal(
		family.ledgers.retirements.path(dir),
		path.join(dir, ".amber", "synth", "retirements.jsonl"),
	);
	assert.equal(
		family.ledgers.signals.append(
			dir,
			{ kind: "emit", schemaVersion: 1, at: AT, id: "s-1", note: "first", decision: pin("d-1") },
			() => null,
			(signals) => signals[0],
		).ok,
		true,
	);
	const retired = family.ledgers.retirements.append(
		dir,
		{ kind: "retire", schemaVersion: 1, at: AT, id: "s-1" },
		() => null,
		(retirements) => retirements[retirements.length - 1],
	);
	assert.equal(retired.ok, true, (retired.errors || []).join("; "));
	// Each ledger folds its own file: one event apiece, chains independent.
	assert.deepEqual(family.ledgers.retirements.fold(dir), [{ id: "s-1" }]);
	assert.equal(family.ledgers.signals.fold(dir).length, 1);
	assert.equal(
		family.ledgers.signals.chainHead(dir),
		readEvents(family.ledgers.signals.path(dir))[0].hash,
	);
	assert.equal(
		family.ledgers.retirements.chainHead(dir),
		readEvents(family.ledgers.retirements.path(dir))[0].hash,
	);
});
