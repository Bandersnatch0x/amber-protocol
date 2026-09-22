"use strict";

// Harness Contract admission core (F065 H0; ADR-0100).
//
// Owns every semantic verdict of admitting and reading a Harness Contract:
// schema validation through the one schema seam, canonical-JSON SHA-256
// Snapshot Hash identity, immutability after admission (byte-identical
// re-admission is idempotent; any other change to an admitted id refuses),
// and fail-closed reads that re-derive the hash on the way out. Storage lives
// under the harness state area; every path resolves through the state-dir
// seam. Admission executes nothing and grants no authority — it witnesses
// the governed gates the contract references.

const fs = require("node:fs");
const path = require("node:path");

const { compileSchema } = require("../core/schema-contract");
const { canonicalHashOf } = require("../core/registry-ledger");
const { statePath, statePathForCreate } = require("../state-dir-resolver");

const CODE_IMMUTABLE = "AMBER_E_HARNESS_CONTRACT_IMMUTABLE";
const CODE_NOT_FOUND = "AMBER_E_HARNESS_CONTRACT_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_CONTRACT_CORRUPT";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function contractsDirForCreate(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "contracts");
}

function contractFileForCreate(targetRoot, contractId) {
	return path.join(contractsDirForCreate(targetRoot), `${safeId(contractId)}.json`);
}

function contractFileForRead(targetRoot, contractId) {
	return statePath(targetRoot, "harness", "contracts", `${safeId(contractId)}.json`);
}

// Metadata ids are validated by the schema; the file name keeps the same
// closed character set so an id can never escape the contracts directory.
function safeId(contractId) {
	return String(contractId).replace(/[^A-Za-z0-9._-]/g, "-");
}

function readContractFile(file) {
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (err) {
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw typedError(CODE_CORRUPT, `harness contract admission record is not valid JSON: ${file}`);
	}
}

function validateContractDocument(candidate) {
	const validate = compileSchema("harness-contract");
	if (validate(candidate)) return null;
	const detail = (validate.errors || [])
		.map((e) => `${e.instancePath || "/"} ${e.message}`)
		.join("; ");
	return typedError(
		CODE_INVALID_ARG,
		`contract does not satisfy schemas/harness-contract.schema.json: ${detail}`,
	);
}

/**
 * Admit one Harness Contract.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.contractPath Path to the contract JSON document.
 * @param {string} [opts.now] ISO timestamp override (tests); defaults to clock.
 */
function admitHarnessContract(targetRoot, { contractPath, now } = {}) {
	if (!contractPath || typeof contractPath !== "string") {
		throw typedError(CODE_INVALID_ARG, "--file <contract.json> is required to admit a contract");
	}
	const resolved = path.resolve(targetRoot, contractPath);
	let candidate;
	try {
		candidate = JSON.parse(fs.readFileSync(resolved, "utf8"));
	} catch (err) {
		throw typedError(
			CODE_INVALID_ARG,
			`cannot read contract document at ${resolved}: ${err.message}`,
		);
	}
	const schemaError = validateContractDocument(candidate);
	if (schemaError) throw schemaError;

	const contractId = candidate.metadata.id;
	const snapshotHash = canonicalHashOf(candidate);
	const file = contractFileForCreate(targetRoot, contractId);

	if (fs.existsSync(file)) {
		const existing = readContractFile(file);
		if (existing && existing.snapshotHash === snapshotHash) {
			// Byte-identical re-admission is idempotent: the admitted record is
			// returned unchanged, never rewritten.
			return {
				ok: true,
				idempotent: true,
				id: contractId,
				snapshotHash,
				admittedAt: existing.admittedAt,
				contractFile: file,
			};
		}
		throw typedError(
			CODE_IMMUTABLE,
			`contract "${contractId}" is already admitted with snapshot ${existing ? existing.snapshotHash : "unknown"}; ` +
				"Harness Contracts are immutable after admission (ADR-0100) — admit the changed document under a new id or version",
		);
	}

	const admittedAt = now || new Date().toISOString();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(
		file,
		`${JSON.stringify({ snapshotHash, admittedAt, contract: candidate }, null, "\t")}\n`,
		"utf8",
	);
	return {
		ok: true,
		idempotent: false,
		id: contractId,
		snapshotHash,
		admittedAt,
		contractFile: file,
	};
}

/**
 * Read one admitted contract, re-deriving the snapshot hash on the way out.
 * A stored record whose contract no longer hashes to its snapshot fails
 * closed (AMBER_E_HARNESS_CONTRACT_CORRUPT) — never silently returned.
 */
function inspectHarnessContract(targetRoot, { contractId } = {}) {
	if (!contractId || typeof contractId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--contract <id> is required to inspect a contract");
	}
	const file = contractFileForRead(targetRoot, contractId);
	const record = readContractFile(file);
	if (!record || !record.contract) {
		throw typedError(
			CODE_NOT_FOUND,
			`no admitted contract "${contractId}" under the harness state area`,
		);
	}
	const derived = canonicalHashOf(record.contract);
	if (derived !== record.snapshotHash) {
		throw typedError(
			CODE_CORRUPT,
			`admitted contract "${contractId}" no longer hashes to its snapshot (${record.snapshotHash} != ${derived}); refusing to present it`,
		);
	}
	return {
		ok: true,
		id: contractId,
		snapshotHash: record.snapshotHash,
		admittedAt: record.admittedAt,
		contract: record.contract,
		contractFile: file,
	};
}

/**
 * List admitted contracts (id, snapshot, admitted time) in id order.
 * A directory that does not exist yet is an empty list, not an error.
 */
/**
 * List admitted contracts in id order, re-deriving each snapshot hash. A
 * record that no longer hashes to its snapshot is a flagged tombstone
 * (corrupt: true, no snapshot presented) — the list never presents unproven
 * bytes as admitted, and never hides them; single reads refuse closed.
 * (T3: aligned with the F067 tool-list semantics — the dual-axis review's
 * standing consistency candidate.)
 */
function listHarnessContracts(targetRoot) {
	const dir = statePath(targetRoot, "harness", "contracts");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			try {
				const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
				const id = record.contract && record.contract.metadata ? record.contract.metadata.id : name;
				const derived = record.contract ? canonicalHashOf(record.contract) : null;
				if (derived !== record.snapshotHash) {
					return { id, snapshotHash: null, admittedAt: null, corrupt: true };
				}
				return {
					id,
					snapshotHash: record.snapshotHash,
					admittedAt: record.admittedAt,
				};
			} catch (err) {
				return { id: name, snapshotHash: null, admittedAt: null, corrupt: true };
			}
		});
}

module.exports = {
	admitHarnessContract,
	inspectHarnessContract,
	listHarnessContracts,
	CODE_IMMUTABLE,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_INVALID_ARG,
};
