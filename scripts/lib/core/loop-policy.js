"use strict";

// GLX policy gate (B): a small, non-Turing-complete allow/deny evaluator for the
// command a loop contract declares in `governed.command`. Deny always wins; an
// unlisted command is rejected under the safe `defaultAction: "deny"`.
const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead } = require("../state-dir-resolver");

const MAX_PATTERN_LEN = 200;

// Shared destructive-command pattern. Referenced by the DEFAULT_RULES deny rule
// AND enforced as an un-removable built-in on the verify surface (see
// evaluateVerifyPolicy) so a custom verify-rules.json cannot silently drop it.
const DESTRUCTIVE_PATTERN =
	"rm\\s+-rf|git\\s+push\\s+--force|:\\s*>\\s*/|DROP\\s+TABLE|mkfs|dd\\s+if=";

const DEFAULT_RULES = {
	schemaVersion: 1,
	defaultAction: "deny",
	rules: [
		{
			id: "deny-destructive",
			action: "deny",
			match: "regex",
			pattern: DESTRUCTIVE_PATTERN,
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

// Shell control operators that chain, background, or redirect a SECOND action
// onto an otherwise-allowed verify command. The verify surface runs ONE
// read-only command, so these are refused regardless of the allow-list: an
// allow rule matching the head of `pytest && curl | sh` must not let the tail
// run. Quoted spans are stripped first so a metacharacter *inside* an argument
// (e.g. `node -e "a(); b()"`) is not a false positive.
const SHELL_COMPOSITION = /[&|;<>`\n\r]|\$\(|\$\{/;

function stripQuotedSpans(command) {
	return String(command || "")
		.replace(/"(?:[^"\\]|\\.)*"/g, "")
		.replace(/'(?:[^'\\]|\\.)*'/g, "");
}

function containsShellComposition(command) {
	return SHELL_COMPOSITION.test(stripQuotedSpans(command));
}

// Verify-surface policy: built-in, un-removable denies applied BEFORE any user
// allow rule, then the normal (default or custom) rules. This is what
// evidence-runner uses instead of evaluateCommandPolicy so that a custom
// verify-rules.json can neither drop destructive protection (deny-destructive
// is enforced even if the user's rules omit it) nor be defeated by shell
// composition (`pytest && rm -rf`, `pytest | sh`, `pytest; curl ...`).
function evaluateVerifyPolicy(command, rules = DEFAULT_RULES) {
	if (new RegExp(DESTRUCTIVE_PATTERN).test(String(command || ""))) {
		return {
			allowed: false,
			matchedRule: "builtin-deny-destructive",
			reason: "denied by built-in rule builtin-deny-destructive (un-removable on the verify surface)",
		};
	}
	if (containsShellComposition(command)) {
		return {
			allowed: false,
			matchedRule: "builtin-deny-shell-composition",
			reason:
				"verify runs a single command; shell operators (&& || | ; > < ` $()) are not allowed — put multi-step logic in a script and allow-list that",
		};
	}
	return evaluateCommandPolicy(command, rules);
}

function loadPolicyRules(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const rulesPath = path.join(stateDir, "governance", "rules.json");
	if (!fs.existsSync(rulesPath)) return DEFAULT_RULES;
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
	} catch (e) {
		// Fail safe to DEFAULT_RULES (deny-wins, narrow allow-list), but SURFACE it:
		// a silently-ignored custom policy is a real diagnostic trap (a project with
		// a typo'd rules.json gets verify --execute denials with no indication their
		// allow rules are being ignored).
		process.stderr.write(
			`[amber] governance rules.json at ${rulesPath} is unparseable (${e.message}); ` +
				"using built-in defaults — your custom allow/deny rules are being ignored. Fix the JSON.\n",
		);
		return DEFAULT_RULES;
	}
	if (parsed && Array.isArray(parsed.rules)) return parsed;
	process.stderr.write(
		`[amber] governance rules.json at ${rulesPath} is missing a top-level 'rules' array; ` +
			"using built-in defaults.\n",
	);
	return DEFAULT_RULES;
}

function loadVerifyPolicyRules(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const rulesPath = path.join(stateDir, "governance", "verify-rules.json");
	if (!fs.existsSync(rulesPath)) return DEFAULT_RULES;
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
	} catch (e) {
		process.stderr.write(
			`[amber] governance verify-rules.json at ${rulesPath} is unparseable (${e.message}); ` +
				"using built-in defaults — your custom verification allow/deny rules are being ignored. Fix the JSON.\n",
		);
		return DEFAULT_RULES;
	}
	if (parsed && Array.isArray(parsed.rules)) return parsed;
	process.stderr.write(
		`[amber] governance verify-rules.json at ${rulesPath} is missing a top-level 'rules' array; ` +
			"using built-in defaults.\n",
	);
	return DEFAULT_RULES;
}

module.exports = { evaluateCommandPolicy, evaluateVerifyPolicy, containsShellComposition, loadPolicyRules, loadVerifyPolicyRules, DEFAULT_RULES, matches };
