"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	patchObjectFields,
	patchValuesByKey,
	detectIndent,
} = require("../../scripts/lib/core/json-text");

// Authored style: tab-indented, short arrays inline — exactly what a full
// re-serialization destroys.
const TABBED = [
	"{",
	'\t"features": [',
	"\t\t{",
	'\t\t\t"id": "F001",',
	'\t\t\t"title": "one",',
	'\t\t\t"paths": ["a.js", "b.js"],',
	'\t\t\t"status": "planned"',
	"\t\t},",
	"\t\t{",
	'\t\t\t"id": "F002",',
	'\t\t\t"status": "planned",',
	'\t\t\t"updated": "2026-01-01"',
	"\t\t}",
	"\t]",
	"}",
	"",
].join("\n");

test("patchObjectFields changes the named fields and leaves the rest byte-identical", () => {
	const before = JSON.parse(TABBED);
	const expected = {
		...before,
		features: before.features.map((f) =>
			f.id === "F002" ? { ...f, status: "accepted", updated: "2026-09-29" } : f,
		),
	};

	const patched = patchObjectFields(TABBED, {
		identityKey: "id",
		identityValue: "F002",
		fields: { status: "accepted", updated: "2026-09-29" },
		expected,
	});

	assert.ok(patched, "a faithful patch is produced");
	assert.equal(JSON.stringify(JSON.parse(patched)), JSON.stringify(expected));
	assert.match(
		patched,
		/"paths": \["a\.js", "b\.js"\]/,
		"an unrelated short array is not expanded",
	);
	const changed = patched.split("\n").filter((line, i) => line !== TABBED.split("\n")[i]);
	assert.equal(
		changed.length,
		2,
		`exactly the two intended lines changed, got: ${changed.join(" | ")}`,
	);
});

test("patchObjectFields inserts a missing field in the object's own layout", () => {
	const before = JSON.parse(TABBED);
	const expected = {
		...before,
		features: before.features.map((f) =>
			f.id === "F001" ? { ...f, status: "accepted", updated: "2026-09-29" } : f,
		),
	};

	const patched = patchObjectFields(TABBED, {
		identityKey: "id",
		identityValue: "F001",
		fields: { status: "accepted", updated: "2026-09-29" },
		expected,
	});

	assert.ok(patched, "the missing field is inserted rather than refusing");
	assert.equal(JSON.stringify(JSON.parse(patched)), JSON.stringify(expected));
	assert.match(
		patched,
		/\t\t\t"updated": "2026-09-29"\n\t\t\}/,
		"the inserted field matches the object's tab indentation",
	);
});

test("patchObjectFields refuses an edit it cannot show to be faithful", () => {
	// Two entries share the id; the helper can only address the first one, so the
	// intended document (which changes the second) must be refused, never guessed.
	const text =
		'{\n\t"features": [\n\t\t{ "id": "F001", "status": "planned" },\n\t\t{ "id": "F001", "status": "planned" }\n\t]\n}\n';
	const patched = patchObjectFields(text, {
		identityKey: "id",
		identityValue: "F001",
		fields: { status: "accepted" },
		expected: {
			features: [
				{ id: "F001", status: "planned" },
				{ id: "F001", status: "accepted" },
			],
		},
	});
	assert.equal(patched, null);
});

test("patchObjectFields keeps a single-line object on one line", () => {
	const text = '{ "features": [ { "id": "F001", "status": "planned" } ] }\n';
	const expected = { features: [{ id: "F001", status: "planned", updated: "2026-09-29" }] };
	const patched = patchObjectFields(text, {
		identityKey: "id",
		identityValue: "F001",
		fields: { updated: "2026-09-29" },
		expected,
	});
	assert.ok(patched);
	assert.equal(
		patched,
		'{ "features": [ { "id": "F001", "status": "planned", "updated": "2026-09-29" } ] }\n',
	);
});

test("patchObjectFields refuses an insert when the key already exists with a shape it cannot rewrite", () => {
	// `paths` holds an array: the helper will not rewrite it, so it must refuse the
	// field rather than append a SECOND `"paths": …` that JSON.parse would hide by
	// keeping the last one — the guard would still pass and the document would carry
	// the key twice.
	const text = '{ "features": [ { "id": "F001", "paths": ["a.js"] } ] }\n';
	const patched = patchObjectFields(text, {
		identityKey: "id",
		identityValue: "F001",
		fields: { paths: "b.js" },
		expected: { features: [{ id: "F001", paths: "b.js" }] },
	});
	assert.equal(patched, null);
});

test("patchValuesByKey rewrites the changed value wherever the old one appears", () => {
	const text =
		'{\n\t"version": "1.0.0",\n\t"packages": {\n\t\t"": { "version": "1.0.0" }\n\t}\n}\n';
	const expected = { version: "2.0.0", packages: { "": { version: "2.0.0" } } };

	const patched = patchValuesByKey(text, expected);

	assert.ok(patched);
	assert.equal((patched.match(/"version": "2\.0\.0"/g) || []).length, 2);
	assert.match(patched, /\t"version": "2\.0\.0"/, "indentation is preserved");
});

test("patchValuesByKey refuses when the result would not match the document", () => {
	const text = '{\n\t"version": "1.0.0"\n}\n';
	assert.equal(patchValuesByKey(text, { version: "2.0.0", extra: true }), null);
});

test("detectIndent reads the document's own indentation", () => {
	assert.equal(detectIndent('{\n\t"a": 1\n}\n'), "\t");
	assert.equal(detectIndent('{\n    "a": 1\n}\n'), "    ");
	assert.equal(detectIndent("{}"), "\t", "falls back to a tab");
});
