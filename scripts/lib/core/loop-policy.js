"use strict";

// GLX policy gate (B): a small, non-Turing-complete allow/deny evaluator for the
// command a loop contract declares in `governed.command`. Deny always wins; an
// unlisted command is rejected under the safe `defaultAction: "deny"`.
const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead } = require("../state-dir-resolver");
const { computeConfidenceClasses } = require("./governance-readiness");
const { admittedUnderCeiling } = require("./classification");
const { typedError } = require("./error-catalog");

const MAX_PATTERN_LEN = 200;

// npm and npx are the two names that are not real executables on a standard Windows
// install: npm ships npm.cmd, and Node cannot launch a .cmd shim with shell:false.
// Resolve them to the Node entry point beside the running interpreter, so the governed
// spawn stays shell-free everywhere. This is a spawn-resolution map, not a policy
// allowlist: the policy still decides which commands may run, and the map is closed, so
// any other name is spawned exactly as parsed.
const WINDOWS_NPM_ENTRY = Object.freeze(
	Object.assign(Object.create(null), {
		npm: ["node_modules", "npm", "bin", "npm-cli.js"],
		npx: ["node_modules", "npm", "bin", "npx-cli.js"],
	}),
);

/**
 * The argv to spawn for a parsed governed command. On Windows, npm and npx are
 * rewritten to `node <npm entry>` when that entry exists beside the interpreter;
 * otherwise the argv is returned unchanged so the failure stays visible.
 * @param {string[]} argv - Parsed governed argv.
 * @param {NodeJS.Platform} [platform] - Injected for tests.
 * @param {string} [interpreter] - Injected for tests; defaults to the running node.
 * @returns {string[]} The argv to hand to spawn.
 */
function toSpawnArgv(argv, platform = process.platform, interpreter = process.execPath) {
	if (platform !== "win32" || argv.length === 0) return argv;
	// A null-prototype map, so an inherited name such as `constructor` reads as absent
	// rather than resolving to something that cannot be spread.
	const entry = WINDOWS_NPM_ENTRY[argv[0]];
	if (!entry) return argv;
	const cli = path.join(path.dirname(interpreter), ...entry);
	return fs.existsSync(cli) ? [interpreter, cli, ...argv.slice(1)] : argv;
}

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
			// The FD-redirect tail is unreachable (argv parsing refuses `>` and `&`)
			// but stays so the default policy keeps the hash approvals were bound to.
			pattern: "^npm (test|run (doctor|manifests))(?:\\s+\\d*>&\\d+)*\\s*$",
			mapsTo: ["ASI04"],
		},
	],
};

// Exact rules compare argv word for word. Prefix and regex rules read the
// command text, which has already parsed to the argv that will run; a deny rule
// also reads the unquoted argv so quoting (`rm "-rf"`) cannot slip past it.
function matches(rule, command, argv) {
	const pat = String(rule.pattern || "").slice(0, MAX_PATTERN_LEN);
	if (rule.match === "exact") return sameArgv(argv, pat);
	const texts = rule.action === "deny" ? [command, argv.join(" ")] : [command];
	if (rule.match === "prefix") return texts.some((text) => text.startsWith(pat));
	if (rule.match === "regex") {
		try {
			const re = new RegExp(pat);
			return texts.some((text) => re.test(text));
		} catch {
			return false;
		}
	}
	return false;
}

function sameArgv(argv, pattern) {
	let expected;
	try {
		expected = parseGovernedArgv(pattern);
	} catch {
		return false;
	}
	return expected.length === argv.length && expected.every((word, i) => word === argv[i]);
}

// A governed command is spawned as argv with no shell, so the only quoting it
// honours is the literal kind: single quotes take everything verbatim, double
// quotes take everything except `$` and backticks (which a reader would expect
// to expand), and a backslash outside single quotes escapes the next character.
// Anything that would ask a shell to compose, redirect, or substitute is refused.
const SHELL_META_OUTSIDE_SINGLE_QUOTES = new Set([";", "|", "&", ">", "<", "`", "$"]);

function refuseShellMeta(command, detail) {
	return typedError(
		"AMBER_E_POLICY_SHELL_META",
		`governed command ${JSON.stringify(command)} ${detail}; it runs as argv with no shell — put multi-step logic in a script and allow-list that`,
	);
}

function parseGovernedArgv(command) {
	const text = String(command ?? "");
	if (/[\n\r]/.test(text)) throw refuseShellMeta(text, "contains a newline");
	const argv = [];
	let word = null;
	let quote = null;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (quote === "'") {
			if (ch === "'") quote = null;
			else word += ch;
			continue;
		}
		if (quote === '"') {
			if (ch === '"') quote = null;
			else if (ch === "$" || ch === "`")
				throw refuseShellMeta(text, `uses ${JSON.stringify(ch)} inside double quotes`);
			else if (ch === "\\" && i + 1 < text.length && '"\\'.includes(text[i + 1])) word += text[++i];
			else word += ch;
			continue;
		}
		if (ch === " " || ch === "\t") {
			if (word !== null) argv.push(word);
			word = null;
			continue;
		}
		if (SHELL_META_OUTSIDE_SINGLE_QUOTES.has(ch))
			throw refuseShellMeta(text, `uses the shell metacharacter ${JSON.stringify(ch)}`);
		word ??= "";
		if (ch === "'" || ch === '"') quote = ch;
		else if (ch === "\\" && i + 1 < text.length) word += text[++i];
		else word += ch;
	}
	if (quote !== null) throw refuseShellMeta(text, `has an unterminated ${quote} quote`);
	if (word !== null) argv.push(word);
	if (argv.length === 0) throw refuseShellMeta(text, "is empty");
	return argv;
}

// The closed five-value decision enumeration (governance contract §6.1,
// extend-only): `deny` and `allow` are the v1 faces; `require_approval` and
// `allow_with_limits` are v2 rule decisions; `unknown` replaces the implicit
// default-deny when `defaultAction:"unknown"` is configured — it fails closed
// like deny but additionally names the cause (`no-rule-matched`). `defer` is
// deliberately NOT introduced: async PDP semantics contradict ADR-0001's
// synchronous artifact-first boundary (require_approval is the human-delay
// path).
const POLICY_DECISIONS = Object.freeze([
	"deny",
	"allow",
	"require_approval",
	"allow_with_limits",
	"unknown",
]);

// Pure function: deny wins, then allow, then defaultAction — extended with
// the v2 decision faces (§6.2). v1 command-text rules (`action`/`match`/
// `pattern`) and v2 capability rules (`decision` + `match{capability,target,
// effect,constraints}`) share one deny-wins precision order; the caller
// resolves `require_approval` into the capture→grant→execute path and
// `allow_with_limits` into RunScope-constrained execution.
function evaluateCommandPolicy(command, rules = DEFAULT_RULES, subject = null) {
	const parsed = parseOrRefuse(command, rules);
	return parsed.refusal ?? evaluateParsedPolicy(String(command), parsed.argv, rules, subject);
}

function evaluateParsedPolicy(command, argv, rules, subject) {
	const list = Array.isArray(rules?.rules) ? rules.rules : [];
	// v1 deny (deny-wins first pass, all rules).
	for (const rule of list) {
		if (rule.action === "deny" && matches(rule, command, argv)) {
			return {
				allowed: false,
				matchedRule: rule.id,
				reason: `denied by rule ${rule.id}`,
				...confidenceSpread(rules, rule.id),
			};
		}
	}
	// v2 explicit deny decisions ride the same first pass (a v2 rule with
	// decision:"deny" is a deny, wherever it appears).
	for (const rule of list) {
		if (rule.decision === "deny" && v2RuleMatches(rule, subject)) {
			return {
				allowed: false,
				matchedRule: rule.id,
				reason: `denied by v2 rule ${rule.id}`,
				...confidenceSpread(rules, rule.id),
			};
		}
	}
	// require_approval beats allow in the precision order (§6.2).
	for (const rule of list) {
		if (rule.decision === "require_approval" && v2RuleMatches(rule, subject)) {
			return {
				allowed: false,
				matchedRule: rule.id,
				decision: "require_approval",
				reason: `require_approval by rule ${rule.id}; enter the capture→grant→execute path (governance contract §6.1)`,
				...confidenceSpread(rules, rule.id),
			};
		}
	}
	for (const rule of list) {
		if (rule.action === "allow" && matches(rule, command, argv)) {
			return {
				allowed: true,
				matchedRule: rule.id,
				reason: `allowed by rule ${rule.id}`,
				...confidenceSpread(rules, rule.id),
			};
		}
	}
	for (const rule of list) {
		if (rule.decision === "allow" && v2RuleMatches(rule, subject)) {
			return {
				allowed: true,
				matchedRule: rule.id,
				reason: `allowed by v2 rule ${rule.id}`,
				...confidenceSpread(rules, rule.id),
			};
		}
	}
	for (const rule of list) {
		if (rule.decision === "allow_with_limits" && v2RuleMatches(rule, subject)) {
			return {
				allowed: true,
				matchedRule: rule.id,
				decision: "allow_with_limits",
				limits: rule.match?.constraints ?? null,
				reason: `allowed with limits by rule ${rule.id}; the limits snapshot rides RunScope constraints`,
				...confidenceSpread(rules, rule.id),
			};
		}
	}
	const allowByDefault = rules?.defaultAction === "allow";
	if (!allowByDefault && rules?.defaultAction === "unknown") {
		// unknown ⊃ deny: fails closed identically, additionally names the
		// cause (§6.1).
		return {
			allowed: false,
			matchedRule: null,
			decision: "unknown",
			reason: "no-rule-matched; defaultAction=unknown — refused like deny, with the cause named",
			...confidenceSpread(rules, null),
		};
	}
	return {
		allowed: allowByDefault,
		matchedRule: null,
		reason: allowByDefault
			? "no rule matched; defaultAction=allow"
			: "no allow rule matched; defaultAction=deny",
		...confidenceSpread(rules, null),
	};
}

// The v2 capability face: a rule matches when every DECLARED dimension of
// its `match` object agrees with the subject ({capability, target, effect,
// constraints, contextClassification}). A rule without a `match` object is a
// v1-shaped record and never matches on the v2 face.
//
// §6.2 / C0 §3.3 — the classification ceiling constraint: a rule declaring
// `constraints.maxClassification` only matches a subject whose context
// classification is at or under that ceiling. A subject with no declared
// context classification (or `unknown`) NEVER satisfies any ceiling — the
// rule simply doesn't match and the request falls to lower precision and the
// fail-closed default (C0 §3.1: unknown is refused, never silently passed).
function v2RuleMatches(rule, subject) {
	if (!rule || typeof rule !== "object" || !rule.match || typeof rule.match !== "object") {
		return false;
	}
	if (!subject || typeof subject !== "object") return false;
	const match = rule.match;
	if (match.capability !== undefined && match.capability !== subject.capability) return false;
	if (match.effect !== undefined && match.effect !== subject.effect) return false;
	if (match.target && typeof match.target === "object") {
		if (match.target.pathPrefix !== undefined) {
			const subjectPaths = Array.isArray(subject.target?.paths) ? subject.target.paths : [];
			const prefix = String(match.target.pathPrefix);
			const inside = subjectPaths.some((candidate) => {
				const p = String(candidate);
				return prefix.endsWith("/")
					? p.startsWith(prefix)
					: p === prefix || p.startsWith(`${prefix}/`);
			});
			if (!inside) return false;
		}
	}
	if (
		match.constraints &&
		typeof match.constraints === "object" &&
		match.constraints.maxClassification !== undefined &&
		match.constraints.maxClassification !== null
	) {
		// §6.2/C0 §3.3 classification-ceiling constraint, direction per decision:
		//   deny — GUARD semantics: fires when the subject exceeds the ceiling
		//   (or is unknown/undeclared — fail-closed, C0 §3.1);
		//   allow/require_approval/allow_with_limits — ADMISSION semantics: the
		//   rule matches only when the subject is within the ceiling; unknown
		//   never satisfies it and the request falls to the fail-closed default.
		const violated = !admittedUnderCeiling(
			subject.contextClassification ?? "unknown",
			match.constraints.maxClassification,
		).ok;
		if (rule.decision === "deny") {
			if (!violated) return false;
		} else if (violated) {
			return false;
		}
	}
	return true;
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

// Built-in, un-removable denies applied BEFORE any user allow rule on BOTH the
// verify surface (evidence-runner) and the governed-command surface
// (governed-runner): a command that needs a shell is refused, and a destructive
// argv is refused even when a custom rules file omits deny-destructive. Graded
// high under confidence_gating so a built-in refusal never reads as uncertainty.
function builtinDenial(rules, denial) {
	const gating = rules?.confidence_gating;
	if (gating && gating.enabled !== false) return { ...denial, confidence: "high" };
	return denial;
}

function parseOrRefuse(command, rules) {
	try {
		return { argv: parseGovernedArgv(command) };
	} catch (error) {
		return {
			refusal: builtinDenial(rules, {
				allowed: false,
				matchedRule: "builtin-deny-shell-composition",
				code: error.amberCode,
				reason: error.message,
			}),
		};
	}
}

// Both policy surfaces (verify + governed) share one baseline: the built-in,
// un-removable denies applied before any user allow rule, then the normal
// (default or custom) rules file. evaluateVerifyPolicy / evaluateGovernedPolicy
// are intentional semantic aliases over this single implementation — named
// surfaces for evidence-runner vs governed-runner (loops + route command-stages),
// not divergent logic. They were previously two byte-identical bodies that could
// drift apart; one baseline cannot drift from itself. The optional `subject`
// ({capability, target, effect, constraints, contextClassification}) feeds the
// v2 capability face; null/absent (loops, verify) means no v2 match dimensions —
// ceiling-carrying v2 rules never match (fail-closed).
function evaluateWithBaseline(command, rules = DEFAULT_RULES, subject = null) {
	const parsed = parseOrRefuse(command, rules);
	if (parsed.refusal) return parsed.refusal;
	if (new RegExp(DESTRUCTIVE_PATTERN, "i").test(parsed.argv.join(" "))) {
		return builtinDenial(rules, {
			allowed: false,
			matchedRule: "builtin-deny-destructive",
			reason:
				"denied by built-in rule builtin-deny-destructive (un-removable on the verify and governed surfaces)",
		});
	}
	return evaluateParsedPolicy(String(command), parsed.argv, rules, subject);
}
const evaluateVerifyPolicy = evaluateWithBaseline;
const evaluateGovernedPolicy = evaluateWithBaseline;

// Load a governance rules file (rules.json / verify-rules.json), failing safe to
// DEFAULT_RULES but SURFACING the problem: a silently-ignored custom policy is a
// real diagnostic trap (a project with a typo'd rules.json gets verify --execute
// denials with no indication their allow rules are being ignored). `scope` is ""
// for the governed surface and "verification " for the verify surface, preserving
// each surface's historical message wording exactly.
function rulesFallback(filename, rulesPath, scope, problem, required) {
	const action = required
		? "governed execution will refuse until the policy is fixed"
		: `using built-in defaults — your custom ${scope}allow/deny rules are being ignored`;
	process.stderr.write(`[amber] governance ${filename} at ${rulesPath} ${problem}; ${action}.\n`);
	return required ? null : DEFAULT_RULES;
}

function loadRulesFile(stateDir, filename, scope, required = false) {
	const rulesPath = path.join(stateDir, "governance", filename);
	if (!fs.existsSync(rulesPath)) return required ? null : DEFAULT_RULES;
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
	} catch (e) {
		return rulesFallback(filename, rulesPath, scope, `is unparseable (${e.message})`, required);
	}
	if (parsed && Array.isArray(parsed.rules)) return parsed;
	return rulesFallback(
		filename,
		rulesPath,
		scope,
		"is missing a top-level 'rules' array",
		required,
	);
}

function loadPolicyRules(targetRoot, options = {}) {
	return loadRulesFile(
		resolveStateDirForRead(targetRoot),
		"rules.json",
		"",
		options.required === true,
	);
}

function loadVerifyPolicyRules(targetRoot) {
	return loadRulesFile(resolveStateDirForRead(targetRoot), "verify-rules.json", "verification ");
}

module.exports = {
	evaluateCommandPolicy,
	evaluateVerifyPolicy,
	evaluateGovernedPolicy,
	parseGovernedArgv,
	toSpawnArgv,
	loadPolicyRules,
	loadVerifyPolicyRules,
	DEFAULT_RULES,
	v2RuleMatches,
	POLICY_DECISIONS,
};
