"use strict";

/**
 * Error recovery utilities for graceful degradation.
 * Provides error classification, retry logic, and fallback strategies.
 */

const ERROR_TYPES = {
	TRANSIENT: "transient", // Network, timeout, temporary failures
	PERMANENT: "permanent", // Schema errors, missing files, invalid config
	RESOURCE: "resource", // Out of disk/memory
	USER: "user", // Invalid input, permission denied
};

const RETRYABLE_ERRORS = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"ENOTFOUND",
]);

function classifyError(error) {
	if (!error) return { type: ERROR_TYPES.PERMANENT, retryable: false };

	const message = error.message || String(error);
	const code = error.code;

	if (RETRYABLE_ERRORS.has(code)) {
		return { type: ERROR_TYPES.TRANSIENT, retryable: true };
	}

	if (code === "ENOSPC" || message.includes("out of memory")) {
		return { type: ERROR_TYPES.RESOURCE, retryable: false };
	}

	if (code === "EACCES" || code === "EPERM") {
		return { type: ERROR_TYPES.USER, retryable: false };
	}

	if (message.includes("timeout")) {
		return { type: ERROR_TYPES.TRANSIENT, retryable: true };
	}

	return { type: ERROR_TYPES.PERMANENT, retryable: false };
}

async function withRetry(fn, options = {}) {
	const { maxAttempts = 3, backoffMs = [1000, 5000, 15000] } = options;

	let lastError;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			const classification = classifyError(error);

			if (!classification.retryable || attempt === maxAttempts - 1) {
				throw error;
			}

			const delay = backoffMs[attempt] || backoffMs[backoffMs.length - 1];
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}

function gracefulFallback(primary, fallback) {
	try {
		return primary();
	} catch (error) {
		const classification = classifyError(error);
		if (classification.retryable) {
			throw error;
		}
		return fallback(error);
	}
}

module.exports = {
	ERROR_TYPES,
	classifyError,
	withRetry,
	gracefulFallback,
};
