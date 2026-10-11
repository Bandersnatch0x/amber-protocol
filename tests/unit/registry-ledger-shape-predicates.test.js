"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { isPlainObject, isStrictPlainObject } = require("../../scripts/lib/core/registry-ledger");

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
