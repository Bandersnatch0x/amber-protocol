"use strict";

// Single source of truth for user-facing Amber error codes.
// Each code maps to the Amber control layer it defends (see CLAUDE.md).
const CATALOG = {
	AMBER_E_FEATURE_NOT_FOUND: {
		title: "Feature not registered in feature_list.json",
		cause: "A command referenced a feature id that is not present in feature_list.json.",
		remedy: 'amber feature add --id <ID> --title "..."',
		layer: "Context",
		related: ["AMBER_E_FEATURE_NO_EVIDENCE"],
	},
	AMBER_E_GATE_UNCONFIRMED: {
		title: "Plan gate not confirmed",
		cause: "The plan's 'User Confirmation:' field is still 'pending'.",
		remedy: "amber gate --confirm --target . --plan <path>",
		layer: "Governance",
		related: ["AMBER_E_HOOK_PRECOMMIT_BLOCKED"],
	},
	AMBER_E_FEATURE_NO_EVIDENCE: {
		title: "Feature claims completion without evidence",
		cause: "A feature has status passing/accepted/done but an empty evidence array.",
		remedy: 'amber feature verify --feature <ID> --command "<cmd>" --result <pass|fail>',
		layer: "Verification",
		related: ["AMBER_E_HOOK_PRECOMMIT_BLOCKED"],
	},
	AMBER_E_ROUTE_NOT_FOUND: {
		title: "No route matched the session goal",
		cause: "session start could not match the goal to a route trigger and no --route was given.",
		remedy: "amber route list   # then: amber session start --goal <g> --route <name>",
		layer: "Lifecycle",
		related: [],
	},
	AMBER_E_PLAN_NOT_FOUND: {
		title: "Plan file not found",
		cause: "A command referenced a plan path that does not exist under the target repo.",
		remedy: 'amber plan --target . --feature <ID> --title "..."',
		layer: "Context",
		related: ["AMBER_E_GATE_UNCONFIRMED"],
	},
	AMBER_E_SESSION_INCOMPLETE: {
		title: "Session completion check failed",
		cause: "complete-check found missing verification and/or approval evidence for the session.",
		remedy: "amber session verify --session <id> ...   then   amber session approve --session <id>",
		layer: "Verification",
		related: [],
	},
	AMBER_E_MISSING_PATH_ARG: {
		title: "Required path argument missing",
		cause: "A command that needs a file/path argument was invoked without one.",
		remedy: "Re-run with the documented --flag <path> (see `amber <command> --help`).",
		layer: "Tooling",
		related: [],
	},
	AMBER_E_HOOK_PRECOMMIT_BLOCKED: {
		title: "Commit blocked by Amber governance guard",
		cause: "One or more commit-time governance assertions failed.",
		remedy: "Resolve the listed codes, or bypass once with: AMBER_SKIP_HOOKS=1 git commit ...",
		layer: "Governance",
		related: ["AMBER_E_FEATURE_NO_EVIDENCE"],
	},
	AMBER_E_POLICY_DENY: {
		title: "Command blocked by governance policy",
		cause: "A loop governed.command matched a deny rule (or no allow rule under defaultAction=deny).",
		remedy: "Adjust .amber/governance/rules.json or change the contract's governed.command.",
		layer: "Governance",
		related: ["AMBER_E_LOOP_NOT_APPROVED"],
	},
	AMBER_E_LOOP_NOT_APPROVED: {
		title: "Governed loop execution not approved",
		cause: "loop run --execute requires a prior, unconsumed approval record for the contract.",
		remedy: "amber loop approve --file <pack> --contract <id> --reviewer <name>",
		layer: "Governance",
		related: ["AMBER_E_POLICY_DENY"],
	},
	AMBER_E_LEDGER_TAMPERED: {
		title: "Loop ledger hash chain is broken",
		cause: "verify-ledger recomputed a record hash that does not match the stored chain.",
		remedy: "Investigate the flagged record; restore it from version control if it was edited.",
		layer: "Observability",
		related: [],
	},
};

// Format an error string that carries its code + remedy, matching the existing
// "<message>. → fix: <cmd>" convention rendered verbatim by cli-output.js.
function codedError(code, message) {
	const entry = CATALOG[code];
	if (!entry) return message || code;
	const head = message || entry.title;
	return `${head} [${code}] → fix: ${entry.remedy}`;
}

// Resolve a code from a full id or its bare suffix, case-insensitively.
function getEntry(code) {
	if (!code || typeof code !== "string") return null;
	const upper = code.toUpperCase();
	if (CATALOG[upper]) return CATALOG[upper];
	const prefixed = `AMBER_E_${upper}`;
	return CATALOG[prefixed] || null;
}

function listCodes() {
	return Object.keys(CATALOG).sort();
}

module.exports = { CATALOG, codedError, getEntry, listCodes };
