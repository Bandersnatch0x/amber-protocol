"use strict";

// F051 ticket 1 (#233) — public CLI seam for read-only Adapter registration
// and read receipts. This adapter parses flags only; the core owns every
// registry/read/receipt verdict and never mutates Canonical Artifacts.

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const READ_FAILURE_CODE = "AMBER_E_ADAPTER_REGISTRY_CORRUPT";

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function missingValueFlag(args) {
	const valueFlags = [
		["id", "--id"],
		["adapterOwner", "--adapter-owner"],
		["adapterVersion", "--adapter-version"],
		["recordType", "--record-type"],
		["recordVersion", "--record-version"],
		["scope", "--scope"],
		["identityMap", "--identity-map"],
		["freshnessMs", "--freshness-ms"],
		["allowPath", "--allow-path"],
		["source", "--source"],
		["recordId", "--record-id"],
		["target", "--target"],
	];
	for (const [key, flag] of valueFlags) {
		if (key in args && args[key] === undefined) return flag;
	}
	return null;
}

function targetValue(args) {
	if (args.target === undefined || args.target === null) return { value: resolveTarget(args) };
	const target = String(args.target);
	if (target.trim().length === 0)
		return { error: `--target must be non-empty; got ${JSON.stringify(args.target)}` };
	return { value: target };
}

function requiredString(args, key, flag, example) {
	const value = args[key] === undefined ? null : String(args[key]);
	if (value === null || value.trim().length === 0) {
		return {
			error: `${flag} is required and must be non-empty (e.g. ${flag} ${example}); got ${JSON.stringify(args[key])}`,
		};
	}
	return { value };
}

function positiveInt(args, key, flag) {
	const value = Number(args[key]);
	if (!Number.isInteger(value) || value < 1)
		return { error: `${flag} must be a positive integer; got ${JSON.stringify(args[key])}` };
	return { value };
}

function registerInput(args) {
	const id = requiredString(args, "id", "--id", "adapter/legacy");
	if (id.error) return id;
	const owner = requiredString(args, "adapterOwner", "--adapter-owner", "legacy-team");
	if (owner.error) return owner;
	const recordType = requiredString(args, "recordType", "--record-type", "legacy-ticket");
	if (recordType.error) return recordType;
	const recordVersion = requiredString(args, "recordVersion", "--record-version", "v1");
	if (recordVersion.error) return recordVersion;
	const scope = requiredString(args, "scope", "--scope", "team-a");
	if (scope.error) return scope;
	const identityMap = requiredString(args, "identityMap", "--identity-map", "path");
	if (identityMap.error) return identityMap;
	const freshness = positiveInt(args, "freshnessMs", "--freshness-ms");
	if (freshness.error) return freshness;
	return {
		value: {
			id: id.value,
			owner: owner.value,
			adapterVersion: args.adapterVersion === undefined ? "1" : String(args.adapterVersion),
			recordTypes: [{ type: recordType.value, versions: [recordVersion.value] }],
			scope: scope.value,
			identityMapping: { strategy: identityMap.value },
			freshness: { maxAgeMs: freshness.value },
			permissions: {
				readOnly: true,
				allowedPaths: args.allowPath === undefined ? null : [String(args.allowPath)],
			},
		},
	};
}

const dispatch = defineCommand({
	command: "adapter",
	actions: ["register", "read", "show", "list", "receipts"],
	handlers: {
		register: (args) => {
			const { registerAdapter } = require("./core/adapter-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const input = registerInput(args);
			if (input.error) return invalidArg(input.error);
			const result = registerAdapter(target.value, input.value);
			return {
				text: result.ok ? JSON.stringify(result.adapter, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		read: (args) => {
			const { readAdapterRecord } = require("./core/adapter-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "adapter/legacy"],
				["source", "--source", "legacy/item.json"],
				["recordId", "--record-id", "legacy-1"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const result = readAdapterRecord(target.value, {
				id: String(args.id),
				source: String(args.source),
				recordId: String(args.recordId),
				recordType: args.recordType === undefined ? null : String(args.recordType),
				scope: args.scope === undefined ? null : String(args.scope),
			});
			return {
				text: result.ok
					? JSON.stringify({ receipt: result.receipt, source: result.source }, null, 2)
					: "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		show: (args) => {
			const { showAdapter } = require("./core/adapter-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "adapter/legacy");
			if (id.error) return invalidArg(id.error);
			let record;
			try {
				record = showAdapter(target.value, id.value);
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return record === null
				? {
						text: "",
						errors: [`adapter "${id.value}" is not registered`],
						warnings: [],
						exitCode: 1,
						code: "AMBER_E_ADAPTER_NOT_FOUND",
					}
				: { text: JSON.stringify(record, null, 2) };
		},
		list: (args) => {
			const { listAdapters } = require("./core/adapter-registry");
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			try {
				return { text: JSON.stringify(listAdapters(target.value), null, 2) };
			} catch (err) {
				const failure = readFailure(args, err, READ_FAILURE_CODE);
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
		receipts: (args) => {
			const { listReadReceipts } = require("./core/adapter-registry");
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			try {
				return {
					text: JSON.stringify(
						listReadReceipts(target.value, { adapterId: args.id || null }),
						null,
						2,
					),
				};
			} catch (err) {
				const failure = readFailure(args, err, "AMBER_E_ADAPTER_READ_RECEIPT_CORRUPT");
				return { ...failure.result, exitCode: failure.exitCode };
			}
		},
	},
});

function adapterDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { adapterDispatch };
