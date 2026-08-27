"use strict";

// Single composer for MCP tools/list descriptions (F058).
// `amber-mcp.js` and the instruction-surface Eval must use this function so a
// description cannot drift from the Action Type / Function contract.

const INSTRUCTION_OVERRIDE_RE =
	/\b(ignore (all )?(previous|prior) (instructions|rules|prompts)|disregard (all )?(previous|prior) (instructions|rules)|you are now|reveal (your |the )?(hidden )?system prompt|developer mode)\b/i;

const UNAUTHORIZED_MUTATING_CLAIM_RE =
	/\b(write files?|overwrite (user|target) files?|execute (a |the )?(target[- ]?)?commands?|grant break-glass|git push)\b/i;

function composeMcpToolDescription(action) {
	const approver = ((action.governance && action.governance.approver) || []).join("/");
	const goal = action.goal || "";
	const mode = action.mode || "interactive";
	return `${goal} Mode: ${mode}. Approver: ${approver}.`;
}

function composeFunctionToolDescription(fn) {
	return `${fn.description} Function (in-process, read-only).`;
}

function findInstructionOverride(text) {
	const match = String(text || "").match(INSTRUCTION_OVERRIDE_RE);
	return match ? match[0] : null;
}

function findUnauthorizedMutatingClaim(text) {
	const match = String(text || "").match(UNAUTHORIZED_MUTATING_CLAIM_RE);
	return match ? match[0] : null;
}

module.exports = {
	composeMcpToolDescription,
	composeFunctionToolDescription,
	findInstructionOverride,
	findUnauthorizedMutatingClaim,
	INSTRUCTION_OVERRIDE_RE,
	UNAUTHORIZED_MUTATING_CLAIM_RE,
};
