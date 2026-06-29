"use strict";

// GLX policy gate (B): a small, non-Turing-complete allow/deny evaluator for the
// command a loop contract declares in `governed.command`. Deny always wins; an
// unlisted command is rejected under the safe `defaultAction: "deny"`.
const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead } = require("../state-dir-resolver");

const MAX_PATTERN_LEN = 200;

const DEFAULT_RULES = {
	schemaVersion: 1,
	defaultAction: "deny",
	rules: [
		{
			id: "deny-destructive",
			action: "deny",
			match: "regex",
			pattern: "rm\\s+-rf|git\\s+push\\s+--force|:\\s*>\\s*/|DROP\\s+TABLE|mkfs|dd\\s+if=",
			mapsTo: ["ASI02", "ASI04"],
		},
		{
			id: "allow-amber-cli",
			action: "allow",
			match: "prefix",
			pattern: "node scripts/amber.js ",
			mapsTo: ["ASI04"],
		},
		{
			id: "allow-npm-checks",
			action: "allow",
			match: "regex",
			pattern: "^npm (test|run (doctor|manifests))$",
			mapsTo: ["ASI04"],
		},
	],
};

function matches(rule, command) {
	const cmd = String(command || "");
	const pat = String(rule.pattern || "").slice(0, MAX_PATTERN_LEN);
	if (rule.match === "exact") return cmd === pat;
	if (rule.match === "prefix") return cmd.startsWith(pat);
	if (rule.match === "regex") {
		try {
			return new RegExp(pat).test(cmd);
		} catch {
			return false;
		}
	}
	return false;
}

// Pure function: deny wins, then allow, then defaultAction.
function evaluateCommandPolicy(command, rules = DEFAULT_RULES) {
	const list = Array.isArray(rules?.rules) ? rules.rules : [];
	for (const rule of list) {
		if (rule.action === "deny" && matches(rule, command)) {
			return { allowed: false, matchedRule: rule.id, reason: `denied by rule ${rule.id}` };
		}
	}
	for (const rule of list) {
		if (rule.action === "allow" && matches(rule, command)) {
			return { allowed: true, matchedRule: rule.id, reason: `allowed by rule ${rule.id}` };
		}
	}
	const allowByDefault = rules?.defaultAction === "allow";
	return {
		allowed: allowByDefault,
		matchedRule: null,
		reason: allowByDefault
			? "no rule matched; defaultAction=allow"
			: "no allow rule matched; defaultAction=deny",
	};
}

function loadPolicyRules(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const rulesPath = path.join(stateDir, "governance", "rules.json");
	if (!fs.existsSync(rulesPath)) return DEFAULT_RULES;
	try {
		const parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
		if (parsed && Array.isArray(parsed.rules)) return parsed;
	} catch {
		/* fall through to defaults on unparseable rules */
	}
	return DEFAULT_RULES;
}

module.exports = { evaluateCommandPolicy, loadPolicyRules, DEFAULT_RULES, matches };
