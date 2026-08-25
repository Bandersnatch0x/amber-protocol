"use strict";

// Shared fail-closed ledger ritual (architecture survey Finding 5): the typed
// corruption contract (F035-S5, decision D4) that knowledge-base,
// organization-audit, and their command adapters used to copy verbatim. Only
// an ABSENT ledger is a legitimate empty state; a corrupt or unreadable
// ledger is a typed failure — never an empty success.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	readJSONL,
	foldJSONL,
	readLedgerFailClosed,
	foldLedgerFailClosed,
} = require("../../scripts/lib/core/jsonl");
const { readFailure } = require("../../scripts/lib/command-helpers");

const KB_CODE = "AMBER_E_KB_CORRUPT";
const ORG_CODE = "AMBER_E_ORG_CORRUPT";

function mkFile(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-ledger-${label}-`));
	return path.join(dir, "ledger.jsonl");
}

function writeLines(file, lines) {
	fs.writeFileSync(file, lines.join("\n") + "\n");
}

/** assert.throws validator factory: the error is the typed fail-closed failure. */
function assertFailClosed(code, label) {
	return (err) => {
		assert.equal(err.amberCode, code, "typed .amberCode");
		assert.ok(err.message.includes(code), "diagnostics carry the code");
		assert.ok(err.message.includes(label), "diagnostics name the ledger family");
		assert.ok(err.message.includes("failing closed"), "diagnostics say failing closed");
		assert.ok(err.message.length > code.length, "diagnostics are non-empty");
		assert.ok(err.cause, "the raw read failure is preserved as .cause");
		return true;
	};
}

// ── readLedgerFailClosed ──────────────────────────────────────

test("readLedgerFailClosed returns the parsed rows of a healthy ledger", () => {
	const file = mkFile("healthy");
	writeLines(file, ['{"a":1}', '{"a":2}']);
	assert.deepEqual(readLedgerFailClosed(file, KB_CODE, "knowledge"), [{ a: 1 }, { a: 2 }]);
});

test("readLedgerFailClosed treats an absent ledger as the legitimate empty state", () => {
	assert.deepEqual(readLedgerFailClosed(mkFile("absent"), KB_CODE, "knowledge"), []);
});

test("readLedgerFailClosed throws the typed corruption error on a corrupt line", () => {
	const file = mkFile("corrupt");
	writeLines(file, ['{"a":1}', "{ not json"]);
	assert.throws(
		() => readLedgerFailClosed(file, KB_CODE, "knowledge"),
		assertFailClosed(KB_CODE, "knowledge"),
	);
	assert.throws(
		() => readLedgerFailClosed(file, ORG_CODE, "organization audit"),
		assertFailClosed(ORG_CODE, "organization audit"),
	);
});

test("readLedgerFailClosed message renders the exact ledger-ritual template", () => {
	const file = mkFile("template");
	writeLines(file, ["{ not json"]);
	let raw;
	try {
		readJSONL(file, { onCorrupt: "throw" });
	} catch (err) {
		raw = err;
	}
	assert.ok(raw, "fixture read throws the raw corruption error");
	assert.throws(
		() => readLedgerFailClosed(file, KB_CODE, "knowledge"),
		(err) => {
			assert.equal(
				err.message,
				`knowledge ledger corrupt or unreadable — failing closed: ${raw.message} [${KB_CODE}]`,
			);
			assert.equal(err.cause && err.cause.message, raw.message, ".cause is the raw read failure");
			return true;
		},
	);
});

test("readLedgerFailClosed fails closed on an unreadable ledger (filesystem error)", () => {
	const file = mkFile("unreadable");
	// a directory where the ledger file is expected → readFileSync fails
	fs.mkdirSync(file, { recursive: true });
	assert.throws(
		() => readLedgerFailClosed(file, ORG_CODE, "organization audit"),
		assertFailClosed(ORG_CODE, "organization audit"),
	);
});

// ── foldLedgerFailClosed ──────────────────────────────────────

test("foldLedgerFailClosed folds last-writer-wins per key on a healthy ledger", () => {
	const file = mkFile("fold");
	writeLines(file, [
		JSON.stringify({ recordId: "r-1", status: "accepted" }),
		JSON.stringify({ recordId: "r-2", status: "accepted" }),
		JSON.stringify({ recordId: "r-1", status: "retired" }),
	]);
	assert.deepEqual(foldLedgerFailClosed(file, "recordId", KB_CODE, "knowledge"), [
		{ recordId: "r-1", status: "retired" },
		{ recordId: "r-2", status: "accepted" },
	]);
});

test("foldLedgerFailClosed matches foldJSONL semantics (first-seen order, last wins)", () => {
	const file = mkFile("fold-parity");
	writeLines(file, [
		JSON.stringify({ recordId: "r-1", status: "accepted" }),
		JSON.stringify({ recordId: "r-2", status: "accepted" }),
		JSON.stringify({ recordId: "r-1", status: "retired" }),
	]);
	assert.deepEqual(
		foldLedgerFailClosed(file, "recordId", KB_CODE, "knowledge"),
		foldJSONL(file, "recordId"),
	);
});

test("foldLedgerFailClosed treats an absent ledger as the legitimate empty state", () => {
	assert.deepEqual(
		foldLedgerFailClosed(mkFile("fold-absent"), "recordId", KB_CODE, "knowledge"),
		[],
	);
});

test("foldLedgerFailClosed throws the typed corruption error on a corrupt line", () => {
	const file = mkFile("fold-corrupt");
	writeLines(file, ['{"recordId":"r-1"}', "{ not json"]);
	assert.throws(
		() => foldLedgerFailClosed(file, "recordId", ORG_CODE, "organization audit"),
		assertFailClosed(ORG_CODE, "organization audit"),
	);
});

// ── readFailure (command envelope) ────────────────────────────

test("readFailure carries the typed amberCode when the error has one", () => {
	const err = new Error("boom");
	err.amberCode = KB_CODE;
	const envelope = readFailure({ target: "/repo", json: false }, err, ORG_CODE);
	assert.deepEqual(envelope, {
		result: {
			target: "/repo",
			text: "",
			errors: ["boom"],
			warnings: [],
			code: KB_CODE,
		},
		exitCode: 1,
		bypassPrint: true,
	});
});

test("readFailure falls back to the fallback code for untyped errors", () => {
	const envelope = readFailure({ target: "/repo", json: true }, new Error("boom"), ORG_CODE);
	assert.deepEqual(envelope.result, {
		target: "/repo",
		text: "",
		errors: ["boom"],
		warnings: [],
		code: ORG_CODE,
	});
	assert.equal(envelope.exitCode, 1, "read failures exit 1");
	assert.equal(envelope.bypassPrint, false, "json mode prints the envelope");
});

test("readFailure stringifies a non-Error throw", () => {
	const envelope = readFailure({ target: "/repo", json: true }, "bare string", KB_CODE);
	assert.deepEqual(envelope.result.errors, ["bare string"]);
	assert.equal(envelope.result.code, KB_CODE);
});
