"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readJSONL, appendJSONL, writeJSONL, foldJSONL } = require("../../scripts/lib/core/jsonl");

function mkFile(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-jsonl-${label}-`));
	return path.join(dir, "data.jsonl");
}

test("appendJSONL appends lines and readJSONL round-trips them", () => {
	const file = mkFile("roundtrip");
	appendJSONL(file, { a: 1 });
	appendJSONL(file, { a: 2 });
	const rows = readJSONL(file);
	assert.equal(rows.length, 2);
	assert.equal(rows[1].a, 2);
});

test("readJSONL treats a missing file as empty by default", () => {
	assert.deepEqual(readJSONL(mkFile("missing")), []);
});

test("readJSONL onCorrupt=skip drops corrupt lines", () => {
	const file = mkFile("skip");
	writeJSONL(file, [{ a: 1 }]);
	fs.appendFileSync(file, "{ broken\n");
	fs.appendFileSync(file, '{"a":2}\n');
	const rows = readJSONL(file, { onCorrupt: "skip" });
	assert.deepEqual(rows, [{ a: 1 }, { a: 2 }]);
});

test("readJSONL onCorrupt=throw fails closed on any corrupt line", () => {
	const file = mkFile("throw");
	writeJSONL(file, [{ a: 1 }]);
	fs.appendFileSync(file, "{ broken\n");
	assert.throws(() => readJSONL(file, { onCorrupt: "throw" }), /corrupt JSONL/);
});

test("readJSONL onCorrupt=mark keeps unparseable lines visible", () => {
	const file = mkFile("mark");
	writeJSONL(file, [{ a: 1 }]);
	fs.appendFileSync(file, "not-json\n");
	const rows = readJSONL(file, { onCorrupt: "mark" });
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[1], { _unparseable: "not-json" });
});

test("foldJSONL resolves current state per key (last line wins)", () => {
	const file = mkFile("fold");
	appendJSONL(file, { id: "r1", status: "accepted" });
	appendJSONL(file, { id: "r2", status: "accepted" });
	appendJSONL(file, { id: "r1", status: "retired" });
	const rows = foldJSONL(file, "id");
	assert.equal(rows.length, 2);
	assert.equal(rows[0].id, "r1");
	assert.equal(rows[0].status, "retired");
	assert.equal(rows[1].id, "r2");
});
