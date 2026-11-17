"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
	isPlainObject,
	isStrictPlainObject,
	isPositiveInt,
	isNullableNonEmptyString,
} = require("../../scripts/lib/core/registry-ledger");

test("isPlainObject accepts any non-array object; isStrictPlainObject only literal-shaped ones", () => {
	const inherited = Object.create({ a: 1 });
	const nullProto = Object.create(null);
	const date = new Date(0);
	assert.deepEqual([{}, nullProto, inherited, date, [], null, "x"].map(isPlainObject), [
		true,
		true,
		true,
		true,
		false,
		false,
		false,
	]);
	assert.deepEqual([{}, nullProto, inherited, date, [], null, "x"].map(isStrictPlainObject), [
		true,
		true,
		false,
		false,
		false,
		false,
		false,
	]);
});

test("isPositiveInt accepts integers above zero only", () => {
	assert.deepEqual([1, 2, 100].map(isPositiveInt), [true, true, true]);
	assert.deepEqual([0, -1, 1.5, NaN, Infinity, "1", null].map(isPositiveInt), [
		false,
		false,
		false,
		false,
		false,
		false,
		false,
	]);
});

test("isNullableNonEmptyString accepts null and non-empty strings, not the empty string", () => {
	// Whitespace-only is accepted: this predicate checks length, not trim
	// (unlike isNonEmptyString). Pinning it keeps the three merged registries
	// on the behavior they had before the guard was shared.
	assert.deepEqual([null, "x", " "].map(isNullableNonEmptyString), [true, true, true]);
	assert.deepEqual([undefined, "", 0, false].map(isNullableNonEmptyString), [
		false,
		false,
		false,
		false,
	]);
});
