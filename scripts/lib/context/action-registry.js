"use strict";

function contract(name, effect, evidence, approvalRequired, variant) {
	return Object.freeze({
		name,
		...(variant ? { variant } : {}),
		effect,
		evidence: Object.freeze(evidence),
		approvalRequired,
	});
}

const DEFINITIONS = [
	contract("request", "write", ["context-request"], true),
	contract("ingest", "write", ["context-page"], true),
	contract("verify", "read", ["context-verification"], false),
	contract("list", "read", [], false),
	contract("show", "read", [], false),
	contract("refresh", "write", ["context-request"], true),
	contract("stats", "read", ["context-stats"], false),
	contract("delete", "write", ["context-page"], true),
	contract("preview", "read", [], false),
	contract("load", "write", ["loadout"], true),
	contract("benchmark", "write", ["context-benchmark"], true),
	contract("source-adapter", "read", ["source-bundle"], false),
	contract("retention", "read", ["context-retention-report"], false),
];

const PROJECTION_VARIANTS = Object.freeze({
	status: contract("projection", "read", ["context-projection"], false, "status"),
	rebuild: contract("projection", "write", ["context-projection"], true, "rebuild"),
});
const PROJECTION = contract("projection", "read", ["context-projection"], false);

const ACTIONS = Object.freeze([...DEFINITIONS.map((definition) => definition.name), "projection"]);
const ACTIONS_BY_NAME = new Map([
	...DEFINITIONS.map((definition) => [definition.name, definition]),
	["projection", PROJECTION],
]);
const ALIASES = new Map([
	["projection-status", PROJECTION_VARIANTS.status],
	["projection-rebuild", PROJECTION_VARIANTS.rebuild],
	["source", "source-adapter"],
]);

function resolveContextAction(action, args = {}) {
	const alias = ALIASES.get(action);
	if (alias && typeof alias === "object") return alias;
	const canonical = alias || action;
	if (canonical !== "projection") return ACTIONS_BY_NAME.get(canonical) || null;
	const subaction = Array.isArray(args._) ? args._[args._.length - 1] : null;
	return PROJECTION_VARIANTS[subaction] || PROJECTION;
}

// Project a context contract to the unified capability shape that
// classifyCliInvocation uses for every command. Context actions have no
// writeFlags (no --output/--out args), and evidence is the contract's
// evidence array (empty for pure reads). This keeps the context branch
// and the COMMAND_CAPABILITIES branch in the same shape.
function toCapability(contextAction) {
	return {
		key: `context/${contextAction.name}`,
		effect: contextAction.effect,
		approver: contextAction.approvalRequired ? "human" : "system",
		directReadOnlyExec: !contextAction.approvalRequired && contextAction.effect === "read",
		writeFlags: [],
		evidence: contextAction.evidence,
	};
}

module.exports = { ACTIONS, ALIASES, resolveContextAction, toCapability };
