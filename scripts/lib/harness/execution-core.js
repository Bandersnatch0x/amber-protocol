"use strict";

// Execution Contract registry core (F068 H2a; Harness v2 §13/§31).
//
// Owns every semantic verdict of the DECLARED boundary artifact: schema
// validation through the one schema seam, repo-relative prefix shape checks
// (no absolute paths, no traversal), canonical-JSON SHA-256 Snapshot Hash
// identity, immutability after admission, and fail-closed reads. Declaring a
// boundary grants zero authority — enforcement stays with the existing
// governed gates; the adapters (execution-adapter.js) prepare and report.

const fs = require("node:fs");
const path = require("node:path");

const { compileSchema } = require("../core/schema-contract");
const { canonicalHashOf } = require("../core/registry-ledger");
const { statePath, statePathForCreate } = require("../state-dir-resolver");

const CODE_IMMUTABLE = "AMBER_E_HARNESS_EXEC_IMMUTABLE";
const CODE_NOT_FOUND = "AMBER_E_HARNESS_EXEC_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_EXEC_CORRUPT";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function contractsDirForCreate(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "execution-contracts");
}

function contractFileForCreate(targetRoot, contractId) {
	return path.join(contractsDirForCreate(targetRoot), `${safeId(contractId)}.json`);
}

function contractFileForRead(targetRoot, contractId) {
	return statePath(targetRoot, "harness", "execution-contracts", `${safeId(contractId)}.json`);
}

function safeId(id) {
	return String(id).replace(/[^A-Za-z0-9._-]/g, "-");
}

// A prefix can never escape the repository: relative, posix-style, no
// traversal. This is a declaration-shape check — enforcement stays with the
// existing gates.
function prefixProblem(prefix) {
	if (typeof prefix !== "string" || prefix.trim().length === 0) {
		return "path prefixes must be non-empty strings";
	}
	if (path.isAbsolute(prefix) || prefix.includes("\\") || prefix.split("/").includes("..")) {
		return `path prefix ${JSON.stringify(prefix)} must be a repo-relative posix prefix without traversal`;
	}
	return null;
}

function contractProblemsBeyondSchema(candidate) {
	const problems = [];
	const sections = [
		["filesystem.read", candidate.filesystem && candidate.filesystem.read],
		["filesystem.write", candidate.filesystem && candidate.filesystem.write],
		["filesystem.deny", candidate.filesystem && candidate.filesystem.deny],
	];
	for (const [label, list] of sections) {
		if (!Array.isArray(list)) continue;
		for (const prefix of list) {
			const problem = prefixProblem(prefix);
			if (problem) problems.push(`${label}: ${problem}`);
		}
	}
	return problems;
}

function validateContractDocument(candidate) {
	const validate = compileSchema("execution-contract");
	if (validate(candidate)) return null;
	const detail = (validate.errors || [])
		.map((e) => `${e.instancePath || "/"} ${e.message}`)
		.join("; ");
	return typedError(
		CODE_INVALID_ARG,
		`execution contract does not satisfy schemas/execution-contract.schema.json: ${detail}`,
	);
}

function documentProblems(candidate) {
	const schemaError = validateContractDocument(candidate);
	if (schemaError) return schemaError;
	const problems = contractProblemsBeyondSchema(candidate);
	if (problems.length > 0) {
		return typedError(CODE_INVALID_ARG, problems.join("; "));
	}
	return null;
}

function readContractFile(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw typedError(CODE_CORRUPT, `execution contract record is not valid JSON: ${file}`);
	}
}

/**
 * Admit one Execution Contract.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.contractPath
 * @param {string} [opts.now]
 */
function admitExecutionContract(targetRoot, { contractPath, now } = {}) {
	if (!contractPath || typeof contractPath !== "string") {
		throw typedError(
			CODE_INVALID_ARG,
			"--file <contract.json> is required to admit an execution contract",
		);
	}
	const resolvedPath = path.resolve(targetRoot, contractPath);
	let candidate;
	try {
		candidate = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
	} catch (err) {
		throw typedError(
			CODE_INVALID_ARG,
			`cannot read execution contract at ${resolvedPath}: ${err.message}`,
		);
	}
	const documentError = documentProblems(candidate);
	if (documentError) throw documentError;

	const contractId = candidate.metadata.id;
	const snapshotHash = canonicalHashOf(candidate);
	const file = contractFileForCreate(targetRoot, contractId);
	if (fs.existsSync(file)) {
		const existing = readContractFile(file);
		if (existing && existing.snapshotHash === snapshotHash) {
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
			`execution contract "${contractId}" is already admitted with snapshot ${existing ? existing.snapshotHash : "unknown"}; contracts are immutable after admission — admit the changed document under a new id or version`,
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
 * Read one admitted contract, re-deriving the snapshot hash (fail closed).
 */
function inspectExecutionContract(targetRoot, { contractId } = {}) {
	if (!contractId || typeof contractId !== "string") {
		throw typedError(
			CODE_INVALID_ARG,
			"--contract <id> is required to inspect an execution contract",
		);
	}
	const file = contractFileForRead(targetRoot, contractId);
	const record = readContractFile(file);
	if (!record || !record.contract) {
		throw typedError(
			CODE_NOT_FOUND,
			`no admitted execution contract "${contractId}" under the harness state area`,
		);
	}
	const derived = canonicalHashOf(record.contract);
	if (derived !== record.snapshotHash) {
		throw typedError(
			CODE_CORRUPT,
			`admitted execution contract "${contractId}" no longer hashes to its snapshot (${record.snapshotHash} != ${derived}); refusing to present it`,
		);
	}
	return {
		ok: true,
		id: contractId,
		snapshotHash: record.snapshotHash,
		admittedAt: record.admittedAt,
		contract: record.contract,
	};
}

/**
 * List admitted execution contracts in id order (tombstones for corrupt
 * records; single reads refuse closed).
 */
function listExecutionContracts(targetRoot) {
	const dir = statePath(targetRoot, "harness", "execution-contracts");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			try {
				const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
				const derived = record.contract ? canonicalHashOf(record.contract) : null;
				if (derived !== record.snapshotHash) {
					return { id: name, snapshotHash: null, admittedAt: null, corrupt: true };
				}
				return {
					id: record.contract.metadata.id,
					snapshotHash: record.snapshotHash,
					admittedAt: record.admittedAt,
				};
			} catch (err) {
				return { id: name, snapshotHash: null, admittedAt: null, corrupt: true };
			}
		});
}

module.exports = {
	admitExecutionContract,
	inspectExecutionContract,
	listExecutionContracts,
	CODE_IMMUTABLE,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_INVALID_ARG,
};
