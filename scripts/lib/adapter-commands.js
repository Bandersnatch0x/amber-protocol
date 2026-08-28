"use strict";

// F051 public CLI seam for read-only Adapter registration, read receipts,
// migration candidate preparation, shadow comparison receipts, and governed
// cutover/rollback events. This adapter parses flags only; the core owns
// every registry/read/comparison/cutover verdict and never mutates Canonical
// Artifacts.

const fs = require("node:fs");

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");
const { resolvePathWithin } = require("./core/fs-utils");

const READ_FAILURE_CODE = "AMBER_E_ADAPTER_REGISTRY_CORRUPT";
const MAX_COMPARISON_FIXTURE_BYTES = 512 * 1024;

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
		["expectedSourceHash", "--expected-source-hash"],
		["fixture", "--fixture"],
		["cutoverId", "--cutover-id"],
		["artifactType", "--artifact-type"],
		["generation", "--generation"],
		["comparisonIndex", "--comparison-index"],
		["decisionIdentity", "--decision-identity"],
		["revision", "--revision"],
		["confirmedBy", "--confirmed-by"],
		["rollbackEvidence", "--rollback-evidence"],
		["evidence", "--evidence"],
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

// Number("") coerces to 0, so a blank value must be refused explicitly or it
// would silently select index 0.
function nonNegativeInt(args, key, flag) {
	const raw = args[key];
	if (raw === undefined || String(raw).trim().length === 0)
		return { error: `${flag} must be a non-negative integer; got ${JSON.stringify(raw)}` };
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0)
		return { error: `${flag} must be a non-negative integer; got ${JSON.stringify(raw)}` };
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

function readFixture(target, fixture) {
	if (fixture === undefined || fixture === null || String(fixture).trim().length === 0) {
		return { error: `--fixture is required and must be a non-empty path` };
	}
	let fullPath;
	try {
		fullPath = resolvePathWithin(target, String(fixture), {
			label: "Adapter comparison fixture",
			canonicalExisting: true,
		});
	} catch (err) {
		return { error: err.message || String(err) };
	}
	let size;
	try {
		size = fs.statSync(fullPath).size;
	} catch (err) {
		return { error: err.message || String(err) };
	}
	if (size > MAX_COMPARISON_FIXTURE_BYTES) {
		return {
			error: `--fixture is ${size} bytes, above the ${MAX_COMPARISON_FIXTURE_BYTES} byte ceiling`,
		};
	}
	let text;
	try {
		text = fs.readFileSync(fullPath, "utf8");
	} catch (err) {
		return { error: err.message || String(err) };
	}
	try {
		return { value: JSON.parse(text) };
	} catch (err) {
		return { error: `--fixture must contain JSON: ${err.message}` };
	}
}

// Shared list handler for scoped adapter ledgers (comparisons, cutovers):
// optional non-empty --id/--scope filters over a fail-closed core read.
function listScopedLedger(args, fallbackCode, listFn) {
	const truncated = missingValueFlag(args);
	if (truncated)
		return invalidArg(`${truncated} requires a value; it was the last token on the command line`);
	const target = targetValue(args);
	if (target.error) return invalidArg(target.error);
	const adapterId = args.id === undefined ? null : String(args.id);
	if (adapterId !== null && adapterId.trim().length === 0) {
		return invalidArg(`--id must be non-empty when provided; got ${JSON.stringify(args.id)}`);
	}
	const scope = args.scope === undefined ? null : String(args.scope);
	if (scope !== null && scope.trim().length === 0) {
		return invalidArg(`--scope must be non-empty when provided; got ${JSON.stringify(args.scope)}`);
	}
	try {
		return { text: JSON.stringify(listFn(target.value, { adapterId, scope }), null, 2) };
	} catch (err) {
		const failure = readFailure(args, err, fallbackCode);
		return { ...failure.result, exitCode: failure.exitCode };
	}
}

const dispatch = defineCommand({
	command: "adapter",
	actions: [
		"register",
		"read",
		"candidate",
		"compare",
		"comparisons",
		"cutover",
		"rollback",
		"cutovers",
		"show",
		"list",
		"receipts",
	],
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
				recordVersion: args.recordVersion === undefined ? null : String(args.recordVersion),
				expectedSourceHash:
					args.expectedSourceHash === undefined ? null : String(args.expectedSourceHash),
				scope: args.scope === undefined ? null : String(args.scope),
			});
			return {
				text: result.receipt
					? JSON.stringify({ receipt: result.receipt, source: result.source }, null, 2)
					: "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		candidate: (args) => {
			const { prepareMigrationCandidate } = require("./core/adapter-registry");
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
			const result = prepareMigrationCandidate(target.value, {
				id: String(args.id),
				source: String(args.source),
				recordId: String(args.recordId),
				recordType: args.recordType === undefined ? null : String(args.recordType),
				recordVersion: args.recordVersion === undefined ? null : String(args.recordVersion),
				expectedSourceHash:
					args.expectedSourceHash === undefined ? null : String(args.expectedSourceHash),
				scope: args.scope === undefined ? null : String(args.scope),
			});
			return {
				text: result.receipt
					? JSON.stringify(
							{
								state: result.state,
								receipt: result.receipt,
								source: result.source,
								candidate: result.candidate,
							},
							null,
							2,
						)
					: "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		compare: (args) => {
			const { compareAdapterShadow } = require("./core/adapter-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			const id = requiredString(args, "id", "--id", "adapter/legacy");
			if (id.error) return invalidArg(id.error);
			const fixture = readFixture(target.value, args.fixture);
			if (fixture.error) return invalidArg(fixture.error);
			if (
				fixture.value === null ||
				typeof fixture.value !== "object" ||
				Array.isArray(fixture.value)
			) {
				return invalidArg("--fixture must contain a JSON object");
			}
			const result = compareAdapterShadow(target.value, {
				...fixture.value,
				id: id.value,
				scope: args.scope === undefined ? fixture.value.scope : String(args.scope),
			});
			return {
				text: result.receipt ? JSON.stringify(result.receipt, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		comparisons: (args) => {
			const { listShadowComparisons } = require("./core/adapter-registry");
			return listScopedLedger(args, "AMBER_E_ADAPTER_COMPARISON_CORRUPT", listShadowComparisons);
		},
		cutover: (args) => {
			const { recordCutover } = require("./core/adapter-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["id", "--id", "adapter/legacy"],
				["cutoverId", "--cutover-id", "cutover/legacy-gen-1"],
				["artifactType", "--artifact-type", "intent"],
				["generation", "--generation", "gen-1"],
				["decisionIdentity", "--decision-identity", "decision/cutover-legacy"],
				["confirmedBy", "--confirmed-by", "legacy-team"],
				["rollbackEvidence", "--rollback-evidence", "evidence/rollback-plan"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const comparisonIndex = nonNegativeInt(args, "comparisonIndex", "--comparison-index");
			if (comparisonIndex.error) return invalidArg(comparisonIndex.error);
			const revision = positiveInt(args, "revision", "--revision");
			if (revision.error) return invalidArg(revision.error);
			const result = recordCutover(target.value, {
				id: String(args.id),
				cutoverId: String(args.cutoverId),
				artifactType: String(args.artifactType),
				scope: args.scope === undefined ? null : String(args.scope),
				generation: String(args.generation),
				comparisonIndex: comparisonIndex.value,
				decision: { identity: String(args.decisionIdentity), revision: revision.value },
				confirmedBy: String(args.confirmedBy),
				rollbackEvidence: String(args.rollbackEvidence),
			});
			return {
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		rollback: (args) => {
			const { recordCutoverRollback } = require("./core/adapter-registry");
			const truncated = missingValueFlag(args);
			if (truncated)
				return invalidArg(
					`${truncated} requires a value; it was the last token on the command line`,
				);
			const target = targetValue(args);
			if (target.error) return invalidArg(target.error);
			for (const [key, flag, example] of [
				["cutoverId", "--cutover-id", "cutover/legacy-gen-1"],
				["decisionIdentity", "--decision-identity", "decision/rollback-legacy"],
				["confirmedBy", "--confirmed-by", "legacy-team"],
				["evidence", "--evidence", "evidence/rollback-run"],
			]) {
				const required = requiredString(args, key, flag, example);
				if (required.error) return invalidArg(required.error);
			}
			const revision = positiveInt(args, "revision", "--revision");
			if (revision.error) return invalidArg(revision.error);
			const result = recordCutoverRollback(target.value, {
				cutoverId: String(args.cutoverId),
				decision: { identity: String(args.decisionIdentity), revision: revision.value },
				confirmedBy: String(args.confirmedBy),
				evidence: String(args.evidence),
			});
			return {
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		cutovers: (args) => {
			const { listCutovers } = require("./core/adapter-registry");
			return listScopedLedger(args, "AMBER_E_ADAPTER_CUTOVER_CORRUPT", listCutovers);
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
