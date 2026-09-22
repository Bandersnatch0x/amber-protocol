"use strict";

// Harness Tool registry core (F067 H1; Harness v2 §12/§25/§30).
//
// Owns every semantic verdict of the Tool declaration surface: schema
// validation through the one schema seam, capability pins resolved ONLY
// through the existing governed registries (F052 resolveRequestCapability,
// F056 showExternalEffect — an unresolvable pin refuses admission),
// canonical-JSON SHA-256 Snapshot Hash identity, immutability after
// admission, and fail-closed reads. Admitting a tool grants zero authority
// (connector ≠ permission): the runner/external gates stay the only
// enforcement, and the tool check is report-only.

const fs = require("node:fs");
const path = require("node:path");

const { compileSchema } = require("../core/schema-contract");
const { canonicalHashOf } = require("../core/registry-ledger");
const { resolveRequestCapability } = require("../core/runner-registry");
const { showExternalEffect } = require("../core/external-registry");
const { loadPolicyRules } = require("../core/loop-policy");
const { statePath, statePathForCreate } = require("../state-dir-resolver");

const CODE_IMMUTABLE = "AMBER_E_HARNESS_TOOL_IMMUTABLE";
const CODE_NOT_FOUND = "AMBER_E_HARNESS_TOOL_NOT_FOUND";
const CODE_CORRUPT = "AMBER_E_HARNESS_TOOL_CORRUPT";
const CODE_PIN_UNRESOLVED = "AMBER_E_HARNESS_TOOL_PIN_UNRESOLVED";
const CODE_INVALID_ARG = "AMBER_E_INVALID_ARG";

// The closed §9 default-posture table: recorded for the report-only check,
// never enforced here — enforcement stays with the existing gates.
const EFFECT_DEFAULT_POSTURE = Object.freeze({
	read_only: "allow",
	local_write: "scoped allow",
	command_execution: "policy",
	external_read: "policy",
	external_write: "ask",
	credential_use: "explicit grant",
	destructive: "deny",
	irreversible: "deny / human approval",
});

function typedError(code, message) {
	const err = new Error(message);
	err.amberCode = code;
	return err;
}

function toolsDirForCreate(targetRoot) {
	return statePathForCreate(targetRoot, "harness", "tools");
}

function toolFileForCreate(targetRoot, toolId) {
	return path.join(toolsDirForCreate(targetRoot), `${safeId(toolId)}.json`);
}

function toolFileForRead(targetRoot, toolId) {
	return statePath(targetRoot, "harness", "tools", `${safeId(toolId)}.json`);
}

function safeId(toolId) {
	return String(toolId).replace(/[^A-Za-z0-9._-]/g, "-");
}

// The capability pin resolves ONLY through the registries the existing gates
// already enforce (F052 runner registry, F056 external-effect registry). This
// is the compose-not-duplicate rule: a tool names authority, never defines it.
function resolveCapabilityPin(targetRoot, capability) {
	if (capability.kind === "runner") {
		const resolved = resolveRequestCapability(targetRoot, {
			runnerId: capability.runnerId,
			runnerVersion: capability.runnerVersion,
			name: capability.name,
			capabilityVersion: capability.capabilityVersion,
		});
		if (!resolved.ok) {
			throw typedError(
				CODE_PIN_UNRESOLVED,
				`capability pin does not resolve in the runner registry: ${resolved.errors ? resolved.errors[0] : "unknown"}`,
			);
		}
		return { kind: "runner", resolved: resolved.capability };
	}
	let effect;
	try {
		effect = showExternalEffect(targetRoot, capability.id, capability.version);
	} catch (err) {
		throw typedError(
			CODE_PIN_UNRESOLVED,
			`capability pin does not resolve in the external-effect registry: ${err.message || String(err)}`,
		);
	}
	if (!effect) {
		throw typedError(
			CODE_PIN_UNRESOLVED,
			`external effect ${JSON.stringify(capability.id)}@${JSON.stringify(capability.version)} is not registered; a tool names governed authority, never invents it`,
		);
	}
	return { kind: "external", resolved: effect };
}

function validateToolDocument(candidate) {
	const validate = compileSchema("tool");
	if (validate(candidate)) return null;
	const detail = (validate.errors || [])
		.map((e) => `${e.instancePath || "/"} ${e.message}`)
		.join("; ");
	return typedError(CODE_INVALID_ARG, `tool does not satisfy schemas/tool.schema.json: ${detail}`);
}

function readToolFile(file) {
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (err) {
		return null;
	}
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw typedError(CODE_CORRUPT, `harness tool admission record is not valid JSON: ${file}`);
	}
}

/**
 * Admit one Tool declaration.
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.toolPath
 * @param {string} [opts.now]
 */
function admitHarnessTool(targetRoot, { toolPath, now } = {}) {
	if (!toolPath || typeof toolPath !== "string") {
		throw typedError(CODE_INVALID_ARG, "--file <tool.json> is required to admit a tool");
	}
	const resolvedPath = path.resolve(targetRoot, toolPath);
	let candidate;
	try {
		candidate = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
	} catch (err) {
		throw typedError(
			CODE_INVALID_ARG,
			`cannot read tool document at ${resolvedPath}: ${err.message}`,
		);
	}
	const schemaError = validateToolDocument(candidate);
	if (schemaError) throw schemaError;
	resolveCapabilityPin(targetRoot, candidate.capability);

	const toolId = candidate.metadata.id;
	const snapshotHash = canonicalHashOf(candidate);
	const file = toolFileForCreate(targetRoot, toolId);
	if (fs.existsSync(file)) {
		const existing = readToolFile(file);
		if (existing && existing.snapshotHash === snapshotHash) {
			return {
				ok: true,
				idempotent: true,
				id: toolId,
				snapshotHash,
				admittedAt: existing.admittedAt,
				toolFile: file,
			};
		}
		throw typedError(
			CODE_IMMUTABLE,
			`tool "${toolId}" is already admitted with snapshot ${existing ? existing.snapshotHash : "unknown"}; tool declarations are immutable after admission — admit the changed document under a new id or version`,
		);
	}
	const admittedAt = now || new Date().toISOString();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(
		file,
		`${JSON.stringify({ snapshotHash, admittedAt, tool: candidate }, null, "\t")}\n`,
		"utf8",
	);
	return { ok: true, idempotent: false, id: toolId, snapshotHash, admittedAt, toolFile: file };
}

/**
 * Read one admitted tool, re-deriving the snapshot hash (fail closed).
 */
function inspectHarnessTool(targetRoot, { toolId } = {}) {
	if (!toolId || typeof toolId !== "string") {
		throw typedError(CODE_INVALID_ARG, "--tool <id> is required to inspect a tool");
	}
	const file = toolFileForRead(targetRoot, toolId);
	const record = readToolFile(file);
	if (!record || !record.tool) {
		throw typedError(CODE_NOT_FOUND, `no admitted tool "${toolId}" under the harness state area`);
	}
	const derived = canonicalHashOf(record.tool);
	if (derived !== record.snapshotHash) {
		throw typedError(
			CODE_CORRUPT,
			`admitted tool "${toolId}" no longer hashes to its snapshot (${record.snapshotHash} != ${derived}); refusing to present it`,
		);
	}
	return {
		ok: true,
		id: toolId,
		snapshotHash: record.snapshotHash,
		admittedAt: record.admittedAt,
		tool: record.tool,
		toolFile: file,
	};
}

/**
 * List admitted tools in id order, re-deriving each snapshot hash. A record
 * that no longer hashes to its snapshot is a flagged tombstone (corrupt:
 * true, no snapshot presented) — the list never presents unproven bytes as
 * admitted, and never hides them; single reads refuse closed.
 */
function listHarnessTools(targetRoot) {
	const dir = statePath(targetRoot, "harness", "tools");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.map((name) => {
			try {
				const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
				const id = record.tool && record.tool.metadata ? record.tool.metadata.id : name;
				const derived = record.tool ? canonicalHashOf(record.tool) : null;
				if (derived !== record.snapshotHash) {
					return { id, snapshotHash: null, admittedAt: null, corrupt: true };
				}
				return {
					id,
					effect: record.tool.effect,
					snapshotHash: record.snapshotHash,
					admittedAt: record.admittedAt,
				};
			} catch (err) {
				return { id: name, snapshotHash: null, admittedAt: null, corrupt: true };
			}
		});
}

/**
 * The Run tool-set snapshot (F067, Harness v2 §30 acceptance 5): sorted
 * admitted set folded to one canonical hash. Empty registry → null (runs
 * started before any tool admission carry no tools section).
 */
function toolsSnapshot(targetRoot) {
	const listed = listHarnessTools(targetRoot).filter(
		(entry) => !entry.corrupt && entry.snapshotHash,
	);
	if (listed.length === 0) return null;
	const shape = listed.map((entry) => ({ id: entry.id, snapshotHash: entry.snapshotHash }));
	return { snapshotHash: canonicalHashOf(shape), ids: listed.map((entry) => entry.id) };
}

/**
 * The report-only policy check (F067; connector ≠ permission): what verdict
 * would the EXISTING policy surface give this tool? Reads the loop-policy
 * rules (v2 capability rules, exact capability-string match) and falls back
 * to the §9 default posture; a missing rules file reports unknown rather
 * than inventing an allow. Enforcement stays with the existing gates — this
 * function never writes anything.
 */
function checkHarnessTool(targetRoot, { toolId } = {}) {
	const inspected = inspectHarnessTool(targetRoot, { toolId });
	const tool = inspected.tool;
	const capabilityString =
		tool.capability.kind === "runner"
			? `runner:${tool.capability.runnerId}/${tool.capability.name}@${tool.capability.capabilityVersion}`
			: `external:${tool.capability.id}@${tool.capability.version}`;
	const rules = loadPolicyRules(targetRoot);
	const basis = [];
	if (rules && Array.isArray(rules.rules)) {
		for (const rule of rules.rules) {
			const match = rule && typeof rule.match === "object" ? rule.match : null;
			if (match && match.capability === capabilityString) {
				basis.push({ rule: rule.id ?? null, decision: rule.decision ?? null });
			}
		}
	}
	let verdict;
	let source;
	if (basis.length > 0) {
		const denies = basis.filter((entry) => entry.decision === "deny");
		// deny-wins across matched rules, mirroring the policy ceiling.
		verdict = denies.length > 0 ? "deny" : basis[0].decision;
		source = "capability rule";
	} else if (rules && rules.defaultAction) {
		verdict = rules.defaultAction;
		source = "rules defaultAction";
	} else {
		verdict = "unknown";
		source = "no applicable rule and no policy surface loaded";
	}
	return {
		ok: true,
		id: toolId,
		capability: capabilityString,
		effect: tool.effect,
		effectDefaultPosture: EFFECT_DEFAULT_POSTURE[tool.effect],
		verdict,
		source,
		basis,
		reportOnly: true,
	};
}

module.exports = {
	admitHarnessTool,
	inspectHarnessTool,
	listHarnessTools,
	toolsSnapshot,
	checkHarnessTool,
	EFFECT_DEFAULT_POSTURE,
	CODE_IMMUTABLE,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_PIN_UNRESOLVED,
	CODE_INVALID_ARG,
};
