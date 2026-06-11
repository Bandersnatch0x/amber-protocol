"use strict";

const assert = require("node:assert");
const test = require("node:test");
const {
	ERROR_TYPES,
	classifyError,
	withRetry,
	gracefulFallback,
} = require("../../scripts/lib/error-recovery");

test("classifyError - transient network errors", () => {
	const err = new Error("Connection failed");
	err.code = "ECONNREFUSED";

	const result = classifyError(err);
	assert.strictEqual(result.type, ERROR_TYPES.TRANSIENT);
	assert.strictEqual(result.retryable, true);
});

test("classifyError - permanent errors", () => {
	const err = new Error("Invalid schema");

	const result = classifyError(err);
	assert.strictEqual(result.type, ERROR_TYPES.PERMANENT);
	assert.strictEqual(result.retryable, false);
});

test("classifyError - resource errors", () => {
	const err = new Error("Out of disk space");
	err.code = "ENOSPC";

	const result = classifyError(err);
	assert.strictEqual(result.type, ERROR_TYPES.RESOURCE);
	assert.strictEqual(result.retryable, false);
});

test("classifyError - user errors", () => {
	const err = new Error("Permission denied");
	err.code = "EACCES";

	const result = classifyError(err);
	assert.strictEqual(result.type, ERROR_TYPES.USER);
	assert.strictEqual(result.retryable, false);
});

test("withRetry - succeeds on first attempt", async () => {
	let calls = 0;
	const fn = async () => {
		calls++;
		return "success";
	};

	const result = await withRetry(fn, { maxAttempts: 3 });
	assert.strictEqual(result, "success");
	assert.strictEqual(calls, 1);
});

test("withRetry - succeeds on second attempt", async () => {
	let calls = 0;
	const fn = async () => {
		calls++;
		if (calls === 1) {
			const err = new Error("Timeout");
			err.code = "ETIMEDOUT";
			throw err;
		}
		return "success";
	};

	const result = await withRetry(fn, {
		maxAttempts: 3,
		backoffMs: [10, 20, 30],
	});
	assert.strictEqual(result, "success");
	assert.strictEqual(calls, 2);
});

test("withRetry - fails after max attempts", async () => {
	let calls = 0;
	const fn = async () => {
		calls++;
		const err = new Error("Timeout");
		err.code = "ETIMEDOUT";
		throw err;
	};

	await assert.rejects(
		async () => {
			await withRetry(fn, { maxAttempts: 2, backoffMs: [10, 20] });
		},
		{ message: "Timeout" },
	);
	assert.strictEqual(calls, 2);
});

test("withRetry - does not retry permanent errors", async () => {
	let calls = 0;
	const fn = async () => {
		calls++;
		throw new Error("Invalid schema");
	};

	await assert.rejects(
		async () => {
			await withRetry(fn, { maxAttempts: 3 });
		},
		{ message: "Invalid schema" },
	);
	assert.strictEqual(calls, 1);
});

test("gracefulFallback - uses primary when it succeeds", () => {
	const primary = () => "primary result";
	const fallback = () => "fallback result";

	const result = gracefulFallback(primary, fallback);
	assert.strictEqual(result, "primary result");
});

test("gracefulFallback - uses fallback on permanent error", () => {
	const primary = () => {
		throw new Error("Invalid config");
	};
	const fallback = (err) => `fallback: ${err.message}`;

	const result = gracefulFallback(primary, fallback);
	assert.strictEqual(result, "fallback: Invalid config");
});

test("gracefulFallback - throws on transient error", () => {
	const primary = () => {
		const err = new Error("Network error");
		err.code = "ECONNREFUSED";
		throw err;
	};
	const fallback = () => "should not reach";

	assert.throws(() => gracefulFallback(primary, fallback), {
		message: "Network error",
	});
});
