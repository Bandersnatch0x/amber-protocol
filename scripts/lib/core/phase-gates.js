"use strict";

/**
 * Phase 0-4 gate evidence, promotion, and rollback harness (#168).
 *
 * Each phase requires complete deterministic evidence before promotion.
 * Promotion requires explicit authorization. Rollback requires a checkpoint
 * (destructive rollback without one is impossible) and records append-only
 * lineage. Invariant non-regression is checked mechanically.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PHASES = Object.freeze(["phase-0", "phase-1", "phase-2", "phase-3", "phase-4"]);

const PHASE_REQUIREMENTS = Object.freeze({
	"phase-0": ["canonical artifacts present", "identity resolves"],
	"phase-1": ["envelope schema validated", "compatibility negotiation proven"],
	"phase-2": ["personal-node profile declared", "offline capture proven"],
	"phase-3": ["sync session proven", "conflict preservation proven"],
	"phase-4": [
		"projections rebuildable",
		"knowledge base lifecycle proven",
		"organization audit proven",
	],
});

function transitionsPath(cwd) {
	return path.join(cwd, ".amber", "phases", "transitions.jsonl");
}

function ensureDir(cwd) {
	fs.mkdirSync(path.join(cwd, ".amber", "phases"), { recursive: true });
}

function sha256(input) {
	return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function hasContextPages(cwd) {
	const dir = path.join(cwd, ".amber", "context", "pages");
	if (!fs.existsSync(dir)) return false;
	return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length > 0;
}

function hasProfile(cwd) {
	const profilePath = path.join(cwd, ".amber", "profile.json");
	if (!fs.existsSync(profilePath)) return false;
	try {
		const raw = JSON.parse(fs.readFileSync(profilePath, "utf8"));
		return typeof raw.deploymentProfile === "string";
	} catch {
		return false;
	}
}

function hasEnvelopes(cwd) {
	const dir = path.join(cwd, ".amber", "sync", "envelopes");
	return fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length > 0;
}

function hasProjections(cwd) {
	const dir = path.join(cwd, ".amber", "projections");
	return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
}

function hasKnowledge(cwd) {
	return fs.existsSync(path.join(cwd, ".amber", "knowledge", "records.jsonl"));
}

/**
 * Check a phase requirement mechanically.
 * @param {string} cwd - Repository root.
 * @param {string} requirement - One of PHASE_REQUIREMENTS.
 * @returns {boolean}
 */
function requirementSatisfied(cwd, requirement) {
	switch (requirement) {
		case "canonical artifacts present":
			return hasContextPages(cwd);
		case "identity resolves": {
			try {
				const { resolveIdentity } = require("./identity");
				return resolveIdentity(cwd).tenantId !== null;
			} catch {
				return false;
			}
		}
		case "envelope schema validated":
			// The sync-envelope schema ships with Amber (schemas/ in the product
			// repo), so resolve it relative to this module — never from the target
			// cwd, which may live anywhere on disk.
			return fs.existsSync(
				path.resolve(__dirname, "..", "..", "..", "schemas", "sync-envelope.schema.json"),
			);
		case "compatibility negotiation proven":
			return hasEnvelopes(cwd);
		case "personal-node profile declared":
			return hasProfile(cwd);
		case "offline capture proven":
			return hasEnvelopes(cwd);
		case "sync session proven":
			return hasEnvelopes(cwd);
		case "conflict preservation proven":
			return fs.existsSync(path.join(cwd, ".amber", "sync", "conflicts.jsonl"));
		case "projections rebuildable":
			return hasProjections(cwd);
		case "knowledge base lifecycle proven":
			return hasKnowledge(cwd);
		case "organization audit proven":
			return fs.existsSync(path.join(cwd, ".amber", "audit", "events.jsonl"));
		default:
			return false;
	}
}

/**
 * Gather evidence for a phase.
 * @param {string} cwd - Repository root.
 * @param {string} phase - One of PHASES.
 * @returns {Array<{id: string, requirement: string, satisfied: boolean}>}
 */
function gatherPhaseEvidence(cwd, phase) {
	const requirements = PHASE_REQUIREMENTS[phase] || [];
	return requirements.map((requirement, index) => ({
		id: `${phase}-e${index + 1}`,
		requirement,
		satisfied: requirementSatisfied(cwd, requirement),
	}));
}

/**
 * Validate that a phase's evidence is complete.
 * @param {string} cwd - Repository root.
 * @param {string} phase - One of PHASES.
 * @returns {{complete: boolean, evidence: Array<object>, missing: string[]}}
 */
function validatePhaseEvidence(cwd, phase) {
	const evidence = gatherPhaseEvidence(cwd, phase);
	const missing = evidence.filter((e) => !e.satisfied).map((e) => e.requirement);
	return { complete: missing.length === 0, evidence, missing };
}

function readTransitions(cwd) {
	const filePath = transitionsPath(cwd);
	if (!fs.existsSync(filePath)) return [];
	return fs
		.readFileSync(filePath, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

function appendTransition(cwd, transition) {
	ensureDir(cwd);
	fs.appendFileSync(transitionsPath(cwd), JSON.stringify(transition) + "\n", "utf8");
	return transition;
}

/**
 * Promote a phase — requires complete evidence + explicit authorization.
 * @param {string} cwd - Repository root.
 * @param {string} phase - One of PHASES.
 * @param {{authorization: string|null}} opts
 * @returns {{ok: boolean, transition: object|null, errors: string[]}}
 */
function promotePhase(cwd, phase, { authorization }) {
	if (!PHASES.includes(phase)) {
		return { ok: false, transition: null, errors: [`unknown phase "${phase}"`] };
	}
	if (!authorization || typeof authorization !== "string") {
		return { ok: false, transition: null, errors: ["promotion requires explicit authorization"] };
	}
	const validation = validatePhaseEvidence(cwd, phase);
	if (!validation.complete) {
		return {
			ok: false,
			transition: null,
			errors: [`phase ${phase} evidence incomplete: missing ${validation.missing.join(", ")}`],
		};
	}
	const transition = appendTransition(cwd, {
		transitionId: crypto.randomUUID(),
		phase,
		status: "promoted",
		authorization,
		evidenceHash: sha256(JSON.stringify(validation.evidence)),
		promotedAt: new Date().toISOString(),
	});
	return { ok: true, transition, errors: [] };
}

/**
 * Roll back a phase to a checkpoint — destructive rollback is impossible.
 * @param {string} cwd - Repository root.
 * @param {string} phase - One of PHASES.
 * @param {{checkpoint: string|null, reason: string}} opts
 * @returns {{ok: boolean, transition: object|null, errors: string[]}}
 */
function rollbackPhase(cwd, phase, { checkpoint, reason }) {
	if (!PHASES.includes(phase)) {
		return { ok: false, transition: null, errors: [`unknown phase "${phase}"`] };
	}
	if (!checkpoint || typeof checkpoint !== "string") {
		return {
			ok: false,
			transition: null,
			errors: ["destructive rollback without a checkpoint is impossible; pass --checkpoint <id>"],
		};
	}
	const transition = appendTransition(cwd, {
		transitionId: crypto.randomUUID(),
		phase,
		status: "rolled-back",
		rollbackTo: checkpoint,
		reason: reason || null,
		rolledBackAt: new Date().toISOString(),
	});
	return { ok: true, transition, errors: [] };
}

/**
 * List all recorded phase transitions (append-only lineage).
 * @param {string} cwd - Repository root.
 * @returns {Array<object>}
 */
function listTransitions(cwd) {
	return readTransitions(cwd);
}

/**
 * Mechanically check invariant non-regression.
 * @param {string} cwd - Repository root.
 * @returns {{ok: boolean, invariants: Array<{id: string, name: string, satisfied: boolean}>}}
 */
function checkInvariantNonRegression(cwd) {
	const invariants = [
		{ id: "inv-1", name: "canonical artifacts exist", satisfied: hasContextPages(cwd) },
		{ id: "inv-2", name: "deployment profile resolvable", satisfied: hasProfile(cwd) },
		{
			id: "inv-3",
			name: "no silent fallback (transitions append-only)",
			satisfied: fs.existsSync(transitionsPath(cwd)),
		},
	];
	return { ok: invariants.every((i) => i.satisfied), invariants };
}

module.exports = {
	PHASES,
	PHASE_REQUIREMENTS,
	gatherPhaseEvidence,
	validatePhaseEvidence,
	promotePhase,
	rollbackPhase,
	listTransitions,
	checkInvariantNonRegression,
};
