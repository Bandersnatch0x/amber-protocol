"use strict";

/**
 * Projection Read Receipts (#162 criterion 3).
 *
 * Every read of a rebuildable read-only projection records an immutable
 * receipt: receiptId (UUID), scope, projection type, result hash, and
 * timestamp. Receipts are append-only in .amber/projections/receipts.jsonl
 * and can be verified — a receipt is proof that a read happened against a
 * specific projection state.
 *
 * Receipts are themselves read-only evidence, never mutated.
 */

const crypto = require("node:crypto");
const path = require("node:path");
const { readJSONL, appendJSONL } = require("./jsonl");

function receiptsLedgerPath(cwd) {
	return path.join(cwd, ".amber", "projections", "receipts.jsonl");
}

/**
 * Record an immutable read receipt.
 * @param {string} cwd - Repository root.
 * @param {{scope: string, projectionType: string, resultHash: string}} input
 * @returns {object} The receipt.
 */
function recordReadReceipt(cwd, { scope, projectionType, resultHash }) {
	const receipt = {
		receiptId: crypto.randomUUID(),
		scope: scope || null,
		projectionType,
		resultHash,
		readAt: new Date().toISOString(),
	};
	return appendJSONL(receiptsLedgerPath(cwd), receipt);
}

/**
 * List all read receipts in order.
 * @param {string} cwd - Repository root.
 * @returns {Array<object>}
 */
function listReadReceipts(cwd) {
	return readJSONL(receiptsLedgerPath(cwd), { onCorrupt: "skip" });
}

/**
 * Verify a receipt by id.
 * @param {string} cwd - Repository root.
 * @param {string} receiptId - The receipt id to verify.
 * @returns {{ok: boolean, receipt: object|null}}
 */
function verifyReceipt(cwd, receiptId) {
	const receipts = listReadReceipts(cwd);
	const receipt = receipts.find((r) => r.receiptId === receiptId) || null;
	return { ok: receipt !== null, receipt };
}

module.exports = {
	receiptsLedgerPath,
	recordReadReceipt,
	listReadReceipts,
	verifyReceipt,
};
