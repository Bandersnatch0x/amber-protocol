"use strict";

// GLX policy gate (B): a small, non-Turing-complete allow/deny evaluator for the
// command a loop contract declares in `governed.command`. Deny always wins; an
// unlisted command is rejected under the safe `defaultAction: "deny"`.
const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead } = require("../state-dir-resolver");
const { computeConfidenceClasses } = require("./governance-readiness");

const MAX_PATTERN_LEN = 200;

// Shared destructive-command pattern. Referenced by the DEFAULT_RULES deny rule
// AND enforced as an un-removable built-in on the verify surface (see
// evaluateVerifyPolicy) so a custom verify-rules.json cannot silently drop it.
// Applied case-insensitively so `RM -RF`, `DROP table`, `MKFS` cannot bypass it.
// rm flags: covers -rf, -fr, -r -f, -Rf, etc.; git push --force anywhere on the line.
const DESTRUCTIVE_PATTERN =
	"rm\\s+(?:-\\w*[rRfF]\\w*\\s*)+|git\\s+push\\s.*--force|:\\s*>\\s*/|DROP\\s+TABLE|mkfs|dd\\s+if=";

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
			// Optional trailing FD-to-FD redirects (2>&1) only — file redirects and
			// extra args still fail. Mirrors containsShellComposition's FD strip.
			pattern: "^npm (test|run (doctor|manifests))(?:\\s+\\d*>&\\d+)*\\s*$",
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
			return { allowed: false, matchedRule: rule.id, reason: `denied by rule ${rule.id}`, ...confidenceSpread(rules, rule.id) };
		}
	}
	for (const rule of list) {
		if (rule.action === "allow" && matches(rule, command)) {
			return { allowed: true, matchedRule: rule.id, reason: `allowed by rule ${rule.id}`, ...confidenceSpread(rules, rule.id) };
		}
	}
	const allowByDefault = rules?.defaultAction === "allow";
	return {
		allowed: allowByDefault,
		matchedRule: null,
		reason: allowByDefault
			? "no rule matched; defaultAction=allow"
			: "no allow rule matched; defaultAction=deny",
		...confidenceSpread(rules, null),
	};
}

// Optional confidence_gating block (T1, ADR-0011). When present AND enabled, the
// policy evaluator attaches a `confidence` field (high|medium|low) to its output
// so the caller can pick the execution shape: high → governed execution, medium →
// dry-run only, low → human review and refusal. The block carries confidence
// information two ways:
//   - `byRule` pins explicit confidence per rule id, e.g. { "allow-amber-cli": "high" };
//   - otherwise confidence is derived from the rule structure via
//     computeConfidenceClasses (rules.json), and rules without an entry — plus
//     unlisted (default-deny) commands — fall back to `defaultConfidence`.
// When the block is absent or `enabled: false`, the output is byte-identical to
// the pre-gating behaviour (no confidence key). Example:
//   { schemaVersion: 1, defaultAction: "deny",
//     confidence_gating: { enabled: true, byRule: { "allow-amber-cli": "high" }, defaultConfidence: "low" },
//     rules: [...] }
function confidenceSpread(rules, ruleId) {
	const gating = rules?.confidence_gating;
	if (!gating || gating.enabled === false) return {};
	return { confidence: confidenceForRule(rules, ruleId) };
}

function confidenceForRule(rules, ruleId) {
	const gating = rules?.confidence_gating;
	const byRule = gating?.byRule;
	if (ruleId && byRule && typeof byRule[ruleId] === "string") {
		const pinned = byRule[ruleId];
		if (pinned === "high" || pinned === "medium" || pinned === "low") return pinned;
	}
	if (ruleId) {
		const entry = computeConfidenceClasses(rules).find((item) => item.ruleId === ruleId);
		if (entry) return entry.confidence;
	}
	const fallback = gating?.defaultConfidence;
	return fallback === "high" || fallback === "medium" || fallback === "low" ? fallback : "low";
}

// Shell control operators that chain, background, or redirect a SECOND action
// onto an otherwise-allowed verify command. The verify surface runs ONE
// read-only command, so these are refused regardless of the allow-list: an
// allow rule matching the head of `pytest && curl | sh` must not let the tail
// run. Quoted spans are stripped first so a metacharacter *inside* an argument
// (e.g. `node -e "a(); b()"`) is not a false positive.
const SHELL_COMPOSITION = /[&|;<>`\n\r]|\$\(|\$\{/;

// Pure FD-to-FD redirects (2>&1, 1>&2, >&1) rebind streams of the SAME process;
// they do not introduce a second command. They still contain `&` and `>` which
// would otherwise false-positive SHELL_COMPOSITION and block common verify
// idioms like `npm test 2>&1`. File redirects (`> out`, `2>err.log`) and
// chains (`2>&1 | tee`) remain blocked.
const FD_TO_FD_REDIRECT = /(?:\d*)>&\d+/g;

function stripQuotedSpans(command) {
	return String(command || "")
		.replace(/"(?:[^"\\]|\\.)*"/g, "")
		.replace(/'(?:[^'\\]|\\.)*'/g, "");
}

function stripFdToFdRedirects(command) {
	return String(command || "").replace(FD_TO_FD_REDIRECT, " ");
}

function containsShellComposition(command) {
	return SHELL_COMPOSITION.test(stripFdToFdRedirects(stripQuotedSpans(command)));
}

// Built-in, un-removable denies applied BEFORE any user allow rule on BOTH the
// verify surface (evidence-runner) and the governed-command surface
// (governed-runner). A custom rules.json / verify-rules.json can neither drop
// destructive protection (deny-destructive is enforced even if the user's rules
// omit it) nor be defeated by shell composition (`pytest && rm -rf`,
// `pytest | sh`, `pytest; curl ...`). Extracted so the two surfaces share one
// implementation — without it the governed surface missed both checks (G1+G2):
// a prefix allow let `node ... x && <non-destructive evil>` past the gate, and
// an uppercase `RM -RF` slipped the case-sensitive deny rule. Returns null when
// no built-in fires so the caller falls through to its normal allow/deny.
function applyBuiltinDenies(command) {
	if (new RegExp(DESTRUCTIVE_PATTERN, "i").test(String(command || ""))) {
		return {
			allowed: false,
			matchedRule: "builtin-deny-destructive",
			reason: "denied by built-in rule builtin-deny-destructive (un-removable on the verify and governed surfaces)",
		};
	}
	if (containsShellComposition(command)) {
		return {
			allowed: false,
			matchedRule: "builtin-deny-shell-composition",
			reason:
				"the gate runs a single command; shell operators (&& || | ; > < ` $()) are not allowed — put multi-step logic in a script and allow-list that",
		};
	}
	return null;
}

// Both policy surfaces (verify + governed) share one baseline: the built-in,
// un-removable denies applied before any user allow rule, then the normal
// (default or custom) rules file. evaluateVerifyPolicy / evaluateGovernedPolicy
// are intentional semantic aliases over this single implementation — named
// surfaces for evidence-runner vs governed-runner (loops + route command-stages),
// not divergent logic. They were previously two byte-identical bodies that could
// drift apart; one baseline cannot drift from itself.
function evaluateWithBaseline(command, rules = DEFAULT_RULES) {
	const builtin = applyBuiltinDenies(command);
	if (builtin) {
		// Built-in un-removable denies are the most deterministic control on the
		// surface; when confidence_gating is active they are graded high so a
		// caller cannot misread a built-in refusal as low-confidence uncertainty.
		const gating = rules?.confidence_gating;
		if (gating && gating.enabled !== false) return { ...builtin, confidence: "high" };
		return builtin;
	}
	return evaluateCommandPolicy(command, rules);
}
const evaluateVerifyPolicy = evaluateWithBaseline;
const evaluateGovernedPolicy = evaluateWithBaseline;

// Load a governance rules file (rules.json / verify-rules.json), failing safe to
// DEFAULT_RULES but SURFACING the problem: a silently-ignored custom policy is a
// real diagnostic trap (a project with a typo'd rules.json gets verify --execute
// denials with no indication their allow rules are being ignored). `scope` is ""
// for the governed surface and "verification " for the verify surface, preserving
// each surface's historical message wording exactly.
function loadRulesFile(stateDir, filename, scope) {
	const rulesPath = path.join(stateDir, "governance", filename);
	if (!fs.existsSync(rulesPath)) return DEFAULT_RULES;
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
	} catch (e) {
		process.stderr.write(
			`[amber] governance ${filename} at ${rulesPath} is unparseable (${e.message}); ` +
				`using built-in defaults — your custom ${scope}allow/deny rules are being ignored. Fix the JSON.\n`,
		);
		return DEFAULT_RULES;
	}
	if (parsed && Array.isArray(parsed.rules)) return parsed;
	process.stderr.write(
		`[amber] governance ${filename} at ${rulesPath} is missing a top-level 'rules' array; ` +
			"using built-in defaults.\n",
	);
	return DEFAULT_RULES;
}

function loadPolicyRules(targetRoot) {
	return loadRulesFile(resolveStateDirForRead(targetRoot), "rules.json", "");
}

function loadVerifyPolicyRules(targetRoot) {
	return loadRulesFile(resolveStateDirForRead(targetRoot), "verify-rules.json", "verification ");
}

module.exports = { evaluateCommandPolicy, evaluateVerifyPolicy, evaluateGovernedPolicy, containsShellComposition, loadPolicyRules, loadVerifyPolicyRules, DEFAULT_RULES, matches };
