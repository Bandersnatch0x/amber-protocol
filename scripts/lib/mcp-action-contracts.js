"use strict";

// Deep Action contract / runtime module for the Amber MCP server.
//
// Owns the **contract parity**, **read-only**, and **governed execution**
// invariants from F018 (Slices 3 and 4):
//   * COMMAND_CAPABILITIES is the single comparison surface for Action
//     registration. An Action's mode, effects, approver, evidence, and
//     execution mapping must all agree with the capability of its mapped
//     command(s) before it is registered.
//   * An operation is executable without approval ONLY when its complete
//     parameterized behavior is read-only (cannot write, approve, execute a
//     target-project command, or create durable evidence).
//   * The MCP adapter never directly executes a mutating Action. Mutation is
//     returned as an approval-required submission.
//
// Design reference: docs/plans/F018-Amber-MCP.md (Slices 3-4) and
// docs/wiki/amber-ontology-mcp.md. `scripts/amber-mcp.js` consumes this module
// so it stays a thin stdio/MCP adapter instead of owning policy decisions.

// ---- command-capability registry ----------------------------------------
// Keyed by `${command}/${subcommand}`. Each capability declares:
//   effect               : "read" | "write"
//   approver             : strongest approver the command requires
//                          ("human" gates behind a human round-trip;
//                          "system" is internal programmatic approval)
//   evidence             : evidence kind the command persists, or null for
//                          pure reads (must match the Action declaration)
//   directReadOnlyExec   : the MCP adapter may spawn this variant directly
//                          without approval (true only for proven reads)
//   writeFlags           : flags that turn an otherwise-read command into a
//                          write (e.g. governance report --output). An Action
//                          classified read-only must never bind these.
const COMMAND_CAPABILITIES = {
	"session/start": {
		effect: "write",
		approver: "system",
		evidence: "timeline-event",
		directReadOnlyExec: false,
		edits: [
			".amber/sessions/<id>/manifest.json",
			".amber/sessions/<id>/timeline.jsonl",
			".amber/sessions/<id>/gates/<gate>.gate.json",
			"MEMORY.md",
			"notes.md",
			"tasks/README.md",
		],
		sideEffects: ["timeline-event"],
	},
	"session/verify": {
		effect: "write",
		approver: "system",
		evidence: "timeline-event",
		directReadOnlyExec: false,
		edits: [
			".amber/sessions/<id>/timeline.jsonl",
			".amber/sessions/<id>/ledger.jsonl",
			".amber/sessions/<id>/manifest.json",
		],
		sideEffects: ["timeline-event", "ledger-append"],
	},
	"session/approve": {
		effect: "write",
		approver: "human",
		evidence: "approval-record",
		directReadOnlyExec: false,
		edits: [
			".amber/sessions/<id>/manifest.json",
			".amber/sessions/<id>/ledger.jsonl",
			".amber/sessions/<id>/gates/<gate>.decision.json",
			".amber/sessions/<id>/timeline.jsonl",
		],
		sideEffects: ["timeline-event", "ledger-append"],
	},
	"session/status": {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
	},
	"route/list": {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
	},
	"route/test": {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
	},
	"context/ingest": {
		effect: "write",
		approver: "human",
		evidence: "ingest-record",
		directReadOnlyExec: false,
		edits: [".amber/context/"],
		sideEffects: ["ingest-record"],
	},
	"context/preview": {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
	},
	"governance/report": {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
		writeFlags: ["--output"],
	},
	"ledger/export": {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
		writeFlags: ["--out"],
	},
	"loop/recommend": {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
	},
	"memory/approve": {
		effect: "write",
		approver: "human",
		evidence: "approval-record",
		directReadOnlyExec: false,
		edits: [".amber/memory/registry/", ".amber/context/events.jsonl"],
		sideEffects: ["ledger-append"],
	},
	"memory/abandon": {
		effect: "write",
		approver: "human",
		evidence: "ingest-record",
		directReadOnlyExec: false,
		edits: [".amber/memory/registry/", ".amber/memory/requests/", ".amber/context/events.jsonl"],
		sideEffects: ["ledger-append"],
	},
	"memory/status": {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
	},
	"eval/run": {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
	},
};

// ---- capability derivation (single shape for JSON → declared values) ----
// Derives the declared capability fields from an Action Type's JSON so
// validateActionContract compares one derived shape against the registry
// instead of re-implementing the extraction inline per field. Only fields
// used in parity validation are derived; directReadOnlyExec and writeFlags
// are registry-side concepts (not declared in Action JSON) so they stay out.
function deriveCapabilityFromAction(action) {
	const declaredEdits = (action.effects && action.effects.edits) || [];
	const declaredSideEffects = (action.effects && action.effects.sideEffects) || [];
	const approvers = (action.governance && action.governance.approver) || [];
	const evidenceRequired = action.evidenceRequired || [];
	const governanceEvidence = (action.governance && action.governance.evidence) || [];
	const effect = declaredEdits.length > 0 ? "write" : "read";
	return {
		effect,
		approvers,
		evidenceRequired,
		governanceEvidence,
		declaredEdits,
		declaredSideEffects,
	};
}

function capabilityKey(command, subcommand) {
	return `${command}/${subcommand}`;
}

// Return the capability for a plain execution mapping, or the variant
// selected by the submitted parameters. Throws when the mapping or the
// selected variant is not in the registry — fail-closed.
function resolveCapability(action, parameters = {}) {
	const ex = action.execution;
	if (!ex) {
		throw new Error(`action ${action.actionTypeId} has no execution mapping`);
	}
	const findings = [];
	if (ex.variants) {
		const variant = parameters[ex.variantParam];
		if (!variant || !ex.variants[variant]) {
			throw new Error(`unknown ${ex.variantParam}: ${variant}`);
		}
		const v = ex.variants[variant];
		return collectVariant(action, v, findings);
	}
	return collectVariant(action, ex, findings);
}

function collectVariant(action, mapping, findings) {
	const key = capabilityKey(mapping.command, mapping.subcommand);
	const cap = COMMAND_CAPABILITIES[key];
	if (!cap) {
		findings.push(`unknown command mapping: ${key}`);
	}
	return { action, mapping, key, capability: cap || null, findings };
}

// ---- effect / read-only classification ----------------------------------

// The set of flags that turn a read command into a write, for a capability.
function writeFlagsFor(capability) {
	return new Set(capability ? capability.writeFlags || [] : []);
}

// Does this resolved mapping bind any write-capable flag from a non-empty
// parameter source? An Action that declares itself read-only must not.
function bindsWriteFlag(resolved) {
	if (!resolved.capability) return false;
	const wf = writeFlagsFor(resolved.capability);
	if (wf.size === 0) return false;
	const args = resolved.mapping.args || [];
	for (const tmpl of args) {
		if (tmpl.flag && wf.has(tmpl.flag)) {
			// A write flag bound to a literal value, or to a present source, counts.
			if (tmpl.value !== undefined) return true;
			if (tmpl.source) return true;
		}
	}
	return false;
}

// An Action is directly executable as a read-only operation ONLY when every
// mapped variant is registry-proven read, directReadOnlyExec, and binds no
// write flag. variantParam Actions are checked across ALL variants so a single
// write variant cannot smuggle execution through a read-only declaration.
function isReadOnlyExecutable(action) {
	const ex = action.execution;
	if (!ex) return false;
	if (action.mode !== "dry-run") return false;
	if (hasDeclaredEdits(action)) return false;
	const variants = ex.variants ? Object.values(ex.variants) : [ex];
	for (const mapping of variants) {
		const key = capabilityKey(mapping.command, mapping.subcommand);
		const cap = COMMAND_CAPABILITIES[key];
		if (!cap) return false;
		if (cap.effect !== "read") return false;
		if (!cap.directReadOnlyExec) return false;
		const resolved = { mapping, capability: cap, findings: [] };
		if (bindsWriteFlag(resolved)) return false;
	}
	return true;
}

function hasDeclaredEdits(action) {
	const edits = action.effects && action.effects.edits;
	return Array.isArray(edits) && edits.length > 0;
}

// ---- semantic parity validation -----------------------------------------

// Validate an Action Type against the capability registry. Returns an array of
// human-readable findings (empty == valid). Rejects:
//   * unknown command mappings / unsupported variants
//   * approver mismatch (registry approver not declared)
//   * evidence mismatch (registry evidence not in evidenceRequired/governance)
//   * effect mismatch (write effect without edits, read effect with edits)
//   * write-capable parameters hidden behind a read-only declaration
//   * autonomous mode (no governed adapter exists — F018 Slice 4)
function validateActionContract(action) {
	const findings = [];
	if (!action || !action.actionTypeId) {
		return ["action is missing an actionTypeId"];
	}
	const id = action.actionTypeId;

	if (action.mode === "autonomous") {
		findings.push(`${id}: autonomous mode is not permitted (no governed execution adapter exists)`);
	}

	const ex = action.execution;
	if (!ex) {
		findings.push(`${id}: missing execution mapping`);
		return findings;
	}

	const variants = ex.variants ? Object.entries(ex.variants) : [["", ex]];
	const { approvers, evidenceRequired, governanceEvidence, declaredEdits, declaredSideEffects } =
		deriveCapabilityFromAction(action);

	for (const [variantName, mapping] of variants) {
		const key = capabilityKey(mapping.command, mapping.subcommand);
		const cap = COMMAND_CAPABILITIES[key];
		const label = variantName ? `${id} [${variantName}]` : id;
		if (!cap) {
			findings.push(`${label}: unknown command mapping ${key} (not in capability registry)`);
			continue;
		}

		// Approver parity: the registry's required approver must be declared.
		if (!approvers.includes(cap.approver)) {
			findings.push(
				`${label}: approver mismatch — command ${key} requires "${cap.approver}" ` +
					`but action declares [${approvers.join(", ")}]`,
			);
		}

		// Evidence parity: the command's persisted evidence must be declared.
		if (cap.evidence && !evidenceRequired.includes(cap.evidence)) {
			findings.push(
				`${label}: evidence mismatch — command ${key} persists "${cap.evidence}" ` +
					`but evidenceRequired is [${evidenceRequired.join(", ")}]`,
			);
		}
		// Reverse evidence parity: the Action must not invent evidence the
		// command does not produce (e.g. require "verify-result" from a command
		// that only persists "timeline-event").
		if (cap.evidence) {
			const invented = evidenceRequired.filter((e) => e !== cap.evidence);
			if (invented.length > 0) {
				findings.push(
					`${label}: evidence mismatch — action declares evidence [${invented.join(", ")}] ` +
						`that command ${key} does not produce (only "${cap.evidence}")`,
				);
			}
		}
		if (!cap.evidence && evidenceRequired.length > 0) {
			findings.push(
				`${label}: evidence mismatch — read command ${key} persists no evidence ` +
					`but evidenceRequired is [${evidenceRequired.join(", ")}]`,
			);
		}
		if (cap.evidence && !governanceEvidence.includes(cap.evidence)) {
			findings.push(
				`${label}: governance evidence mismatch — command ${key} persists "${cap.evidence}" ` +
					`but governance.evidence is [${governanceEvidence.join(", ")}]`,
			);
		}
		if (!cap.evidence && governanceEvidence.length > 0) {
			findings.push(
				`${label}: governance evidence mismatch — read command ${key} persists no evidence ` +
					`but governance.evidence is [${governanceEvidence.join(", ")}]`,
			);
		}

		// Effect parity.
		if (cap.effect === "write" && declaredEdits.length === 0) {
			findings.push(
				`${label}: effect mismatch — command ${key} is a write but effects.edits is empty`,
			);
		}
		const expectedEdits = [...(cap.edits || [])].sort();
		const actualEdits = [...declaredEdits].sort();
		if (expectedEdits.join("\n") !== actualEdits.join("\n")) {
			findings.push(
				`${label}: edits mismatch — expected [${expectedEdits.join(", ")}] but action declares [${actualEdits.join(", ")}]`,
			);
		}
		const expectedSideEffects = [...(cap.sideEffects || [])].sort();
		const actualSideEffects = [...declaredSideEffects].sort();
		if (expectedSideEffects.join("\n") !== actualSideEffects.join("\n")) {
			findings.push(
				`${label}: sideEffects mismatch — expected [${expectedSideEffects.join(", ")}] but action declares [${actualSideEffects.join(", ")}]`,
			);
		}
		if (cap.effect === "read" && declaredEdits.length > 0) {
			findings.push(
				`${label}: effect mismatch — command ${key} is a read but effects.edits is non-empty`,
			);
		}
		if (cap.effect === "read" && declaredSideEffects.length > 0) {
			findings.push(
				`${label}: side-effect mismatch — command ${key} is a read but effects.sideEffects is non-empty`,
			);
		}
		if (cap.effect === "write" && action.mode === "dry-run") {
			findings.push(
				`${label}: mode mismatch — command ${key} is a write but action mode is dry-run`,
			);
		}

		// Write-capable params behind a read-only declaration.
		if (cap.effect === "read") {
			const resolved = { mapping, capability: cap, findings: [] };
			if (bindsWriteFlag(resolved)) {
				findings.push(
					`${label}: read-only command ${key} binds a write-capable flag ` +
						`(${[...writeFlagsFor(cap)].join(", ")})`,
				);
			}
		}
	}

	return findings;
}

// Validate a whole whitelist; returns { valid, findings }. The MCP adapter
// refuses to start (fail-closed) when any registered Action is invalid.
function validateWhitelist(actions) {
	const findings = [];
	for (const action of actions) {
		findings.push(...validateActionContract(action));
	}
	return { valid: findings.length === 0, findings };
}

module.exports = {
	COMMAND_CAPABILITIES,
	capabilityKey,
	deriveCapabilityFromAction,
	resolveCapability,
	bindsWriteFlag,
	isReadOnlyExecutable,
	hasDeclaredEdits,
	validateActionContract,
	validateWhitelist,
};
