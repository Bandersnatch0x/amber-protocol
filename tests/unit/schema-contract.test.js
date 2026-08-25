"use strict";

// F042 Slice 1 (red-first): the schema-contract seam's shape — schemaName
// resolution against schemas/, compiled-validator caching, idempotent format
// registration, allErrors, the generalized formatErrors mapper, and fail-closed
// unknown-schema handling. Per the seam-adoption ritual, these tests pin the
// adapter's shape BEFORE any consumer migrates.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	validate,
	compileSchema,
	compileInline,
	formatErrors,
} = require("../../scripts/lib/core/schema-contract");

test("validate resolves a schemaName against schemas/ and passes a valid document", () => {
	const result = validate("sync-transport-report", {
		schemaVersion: "1.0.0",
		mode: "prepare",
		envelopeCount: 0,
		envelopeIds: [],
		envelopePaths: [],
		affectedPaths: [],
		proposedOps: [],
		remoteConfigured: false,
		conflictCount: 0,
		refusedCount: 0,
		note: "none",
		errors: [],
	});
	assert.deepEqual(result, { valid: true, errors: [] });
});

test("validate reports all violations (allErrors) with shaped error strings", () => {
	const result = validate("sync-transport-report", {
		schemaVersion: "9.9.9",
		mode: "bogus",
		envelopeCount: "many",
		proposedOps: "git add .",
	});
	assert.equal(result.valid, false);
	assert.ok(result.errors.length >= 4, `expected all errors surfaced, got ${result.errors.length}`);
	assert.match(result.errors.join("\n"), /schemaVersion must be one of/);
	assert.match(result.errors.join("\n"), /mode must be one of/);
	assert.match(result.errors.join("\n"), /envelopeCount must be of type/);
	assert.match(result.errors.join("\n"), /proposedOps must be of type/);
});

test("an unknown schemaName fails closed with a typed error", () => {
	const result = validate("no-such-schema-xyz", {});
	assert.equal(result.valid, false);
	assert.match(
		result.errors.join("\n"),
		/schema-contract: cannot load schema "no-such-schema-xyz"/,
	);
});

test("compiled validators are cached: the same function object is returned per schemaName", () => {
	const a = compileSchema("sync-envelope");
	const b = compileSchema("sync-envelope");
	assert.equal(a, b, "compile-once cache");
});

test("compileInline compiles a dynamically-provided schema without a schemas/ file", () => {
	const validateFn = compileInline({
		type: "object",
		required: ["name"],
		properties: { name: { type: "string" } },
		additionalProperties: false,
	});
	assert.equal(typeof validateFn, "function");
	assert.equal(validateFn({ name: "x" }), true);
	assert.equal(validateFn({}), false);
});

test("format registration is idempotent: repeated compile calls do not throw", () => {
	assert.doesNotThrow(() => compileSchema("sync-envelope"));
	assert.doesNotThrow(() => compileSchema("sync-transport-report"));
	assert.doesNotThrow(() => compileSchema("sync-envelope"));
});

test("formatErrors generalizes the sync-envelope mapper with a custom label", () => {
	const errors = formatErrors(
		[
			{
				keyword: "required",
				instancePath: "",
				params: { missingProperty: "title" },
				message: "must have required property 'title'",
			},
			{
				keyword: "additionalProperties",
				instancePath: "/foo",
				params: { additionalProperty: "bar" },
				message: "must NOT have additional properties",
			},
			{
				keyword: "enum",
				instancePath: "/state",
				params: { allowedValues: ["a", "b"] },
				message: "must be equal to one of the allowed values",
			},
			{
				keyword: "minLength",
				instancePath: "/name",
				params: { limit: 1 },
				message: "must NOT have fewer than 1 characters",
			},
			{
				keyword: "minItems",
				instancePath: "/items",
				params: { limit: 1 },
				message: "must NOT have fewer than 1 items",
			},
			{
				keyword: "minimum",
				instancePath: "/count",
				params: { limit: 0 },
				message: "must be >= 0",
			},
			{
				keyword: "type",
				instancePath: "/n",
				params: { type: "string" },
				message: "must be string",
			},
			{
				keyword: "pattern",
				instancePath: "/id",
				data: "X 1",
				params: {},
				message: 'must match pattern "^\\S+$"',
			},
			{
				keyword: "format",
				instancePath: "/when",
				params: { format: "date-time" },
				message: 'must match format "date-time"',
			},
		],
		"page",
	);
	assert.deepEqual(errors, [
		'page missing required field "title"',
		'page.foo has additional property "bar"',
		"page.state must be one of a, b",
		"page.name must be at least 1 character(s)",
		"page.items must contain at least 1 item(s)",
		"page.count must be >= 0",
		"page.n must be of type string",
		'page.id "X 1" does not match required pattern',
		'page.when must match format "date-time"',
	]);
});

test("formatErrors with no label defaults to the root label", () => {
	const errors = formatErrors([
		{
			keyword: "required",
			instancePath: "",
			params: { missingProperty: "x" },
			message: "must have required property 'x'",
		},
	]);
	assert.deepEqual(errors, ['schema missing required field "x"']);
});

test("the strict date-time format is registered on the shared instance", () => {
	// session-manifest / memory schemas use format: date-time; a document with
	// an invalid timestamp must fail with the format keyword.
	const validateFn = compileInline({
		type: "object",
		properties: { when: { type: "string", format: "date-time" } },
	});
	assert.equal(validateFn({ when: "2026-08-25T10:00:00Z" }), true);
	assert.equal(validateFn({ when: "not-a-timestamp" }), false);
});

test("date format keywords from ajv-formats are registered", () => {
	const validateFn = compileInline({
		type: "object",
		properties: { day: { type: "string", format: "date" } },
	});
	assert.equal(validateFn({ day: "2026-08-25" }), true);
	assert.equal(validateFn({ day: "25/08/2026" }), false);
});
