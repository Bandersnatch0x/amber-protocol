"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveTarget, readJsonSafe, writeJson } = require("./core/fs-utils");
const { codedError } = require("./core/error-catalog");

const COMPLETE_STATUSES = new Set(["passing", "accepted", "done"]);

// C1 — a feature must not claim completion without evidence.
function checkFeatureEvidence(targetRoot) {
	const flPath = path.join(targetRoot, "feature_list.json");
	const { value } = readJsonSafe(flPath);
	if (!value || typeof value !== "object" || !Array.isArray(value.features)) return [];
	const findings = [];
	for (const f of value.features) {
		if (!f || typeof f !== "object") continue;
		const hasEvidence = Array.isArray(f.evidence) && f.evidence.length > 0;
		if (COMPLETE_STATUSES.has(f.status) && !hasEvidence) {
			findings.push(
				codedError(
					"AMBER_E_FEATURE_NO_EVIDENCE",
					`Feature ${f.id || "?"} is "${f.status}" but has no evidence`,
				),
			);
		}
	}
	return findings;
}

function checkGovernance(target, { warnOnly = false } = {}) {
	const targetRoot = resolveTarget(target);
	const findings = checkFeatureEvidence(targetRoot);

	const errors = [];
	const warnings = [];
	if (findings.length > 0) {
		const bucket = warnOnly ? warnings : errors;
		bucket.push(
			codedError("AMBER_E_HOOK_PRECOMMIT_BLOCKED", `${findings.length} governance check(s) failed`),
		);
		for (const f of findings) bucket.push(f);
	}
	// bypassPrint (non-JSON) only echoes `text`, so surface the lines there too.
	const lines = [...errors, ...warnings];
	const text = lines.length > 0 ? lines.join("\n") : "Governance checks passed.";
	return { target: targetRoot, text, errors, warnings };
}

const HOOK_MARKER = "# amber-managed-hook v1";

function amberEntryPosix() {
	// Absolute path to scripts/amber.js, normalised to forward slashes for sh.
	const abs = path.resolve(__dirname, "..", "amber.js");
	return abs.split(path.sep).join("/");
}

function hooksDir(targetRoot) {
	return path.join(targetRoot, ".git", "hooks");
}

// Escape a string for safe embedding inside a double-quoted POSIX sh literal.
// Guards against paths containing ", $, `, or \ (rare, but they would otherwise
// break out of the quoting or trigger shell expansion).
function shDquote(s) {
	return String(s).replace(/(["$`\\])/g, "\\$1");
}

function buildShim(targetRoot, { warnOnly = false } = {}) {
	const entry = amberEntryPosix();
	const root = path.resolve(targetRoot).split(path.sep).join("/");
	const modeFlag = warnOnly ? " --warn-only" : "";
	return [
		"#!/bin/sh",
		HOOK_MARKER + "  (opt-in governance guard — remove with: amber hooks uninstall)",
		'[ "$AMBER_SKIP_HOOKS" = "1" ] && exit 0',
		'command -v node >/dev/null 2>&1 || { echo "amber hooks: node not found, skipping"; exit 0; }',
		`[ -f "${shDquote(entry)}" ] || { echo "amber hooks: amber not found, skipping"; exit 0; }`,
		`node "${shDquote(entry)}" hooks check --target "${shDquote(root)}"${modeFlag} || exit 1`,
		"exit 0",
		"",
	].join("\n");
}

function installHook(target, { warnOnly = false, force = false } = {}) {
	const targetRoot = resolveTarget(target);
	if (!fs.existsSync(path.join(targetRoot, ".git"))) {
		return {
			target: targetRoot,
			text: "",
			errors: [
				codedError(
					"AMBER_E_MISSING_PATH_ARG",
					"No .git directory found — run inside a git repository",
				),
			],
			warnings: [],
		};
	}
	const dir = hooksDir(targetRoot);
	fs.mkdirSync(dir, { recursive: true });
	const hookPath = path.join(dir, "pre-commit");
	const warnings = [];

	if (fs.existsSync(hookPath)) {
		const existing = fs.readFileSync(hookPath, "utf8");
		if (!existing.includes(HOOK_MARKER) && !force) {
			const backup = hookPath + ".amber-backup";
			fs.writeFileSync(backup, existing);
			warnings.push(`Existing pre-commit hook backed up to ${path.basename(backup)}.`);
		}
	}

	fs.writeFileSync(hookPath, buildShim(targetRoot, { warnOnly }));
	try {
		fs.chmodSync(hookPath, 0o755);
	} catch (_) {
		// chmod is a no-op effect on Windows; ignore failures there.
	}
	return {
		target: targetRoot,
		text: `Installed Amber pre-commit guard${warnOnly ? " (warn-only)" : ""}.`,
		errors: [],
		warnings,
	};
}

function uninstallHook(target) {
	const targetRoot = resolveTarget(target);
	const hookPath = path.join(hooksDir(targetRoot), "pre-commit");
	if (!fs.existsSync(hookPath)) {
		return { target: targetRoot, text: "No pre-commit hook to remove.", errors: [], warnings: [] };
	}
	const body = fs.readFileSync(hookPath, "utf8");
	if (!body.includes(HOOK_MARKER)) {
		return {
			target: targetRoot,
			text: "pre-commit hook is not Amber-managed; left untouched.",
			errors: [],
			warnings: [],
		};
	}
	const backup = hookPath + ".amber-backup";
	if (fs.existsSync(backup)) {
		fs.writeFileSync(hookPath, fs.readFileSync(backup, "utf8"));
		fs.rmSync(backup, { force: true });
		return {
			target: targetRoot,
			text: "Removed Amber guard; restored prior hook.",
			errors: [],
			warnings: [],
		};
	}
	fs.rmSync(hookPath, { force: true });
	return { target: targetRoot, text: "Removed Amber pre-commit guard.", errors: [], warnings: [] };
}

function statusHook(target) {
	const targetRoot = resolveTarget(target);
	const hookPath = path.join(hooksDir(targetRoot), "pre-commit");
	if (!fs.existsSync(hookPath)) {
		return {
			target: targetRoot,
			text: "Amber pre-commit guard: not installed.",
			errors: [],
			warnings: [],
		};
	}
	const body = fs.readFileSync(hookPath, "utf8");
	if (body.includes(HOOK_MARKER)) {
		const mode = body.includes("--warn-only") ? "warn-only" : "blocking";
		return {
			target: targetRoot,
			text: `Amber pre-commit guard: installed (${mode}).`,
			errors: [],
			warnings: [],
		};
	}
	return {
		target: targetRoot,
		text: "A non-Amber pre-commit hook is present.",
		errors: [],
		warnings: [],
	};
}

// ── Per-turn workflow-state breadcrumb (F022) ─────────────────────────────────
//
// A read-only projection of the lifecycle context (`buildContext` /
// `inferNextStep` from core/lifecycle — the same single source of truth that
// powers `amber next`). No step text is duplicated here; the breadcrumb only
// renders what the lifecycle modules return.

const BREADCRUMB_OPEN = "<amber-workflow-state>";
const BREADCRUMB_CLOSE = "</amber-workflow-state>";

// AMBER_E_INVALID_ARG is not (yet) in the error catalog, so invalid-argument
// results are rendered in the catalog's coded-error shape inline.
function invalidArgError(message, remedy) {
	return `${message} [AMBER_E_INVALID_ARG] → fix: ${remedy}`;
}

// Same inline coded shape for settings files that cannot be safely merged.
function settingsUnmergeableError(message) {
	return `${message} [AMBER_E_SETTINGS_UNMERGEABLE] → fix: repair .claude/settings.json (valid JSON object with an optional hooks.UserPromptSubmit array), then retry.`;
}

function truncateGoal(goal, max = 100) {
	const text = String(goal).replace(/\s+/g, " ").trim();
	if (text.length <= max) return text;
	return `${text.slice(0, max - 3)}...`;
}

function breadcrumbFocusLine(focus) {
	if (focus && focus.type === "session" && focus.id) {
		const base = `Focus: session ${String(focus.id).slice(0, 8)}`;
		return focus.autoSelected ? `${base} (auto-selected)` : base;
	}
	if (focus && focus.type === "feature" && focus.id) {
		const base = `Focus: feature ${focus.id}`;
		return focus.autoSelected ? `${base} (auto-selected)` : base;
	}
	return "Focus: project bootstrap";
}

// Session detail lines; every value comes from the manifest or the lifecycle
// gate resolver — lines whose data is absent are simply not rendered.
function breadcrumbSessionLines(targetRoot, sessionId) {
	const { loadSessionManifest } = require("./session-commands");
	const { resolvePendingGate } = require("./core/lifecycle");
	const lines = [];

	let manifest = null;
	try {
		const loaded = loadSessionManifest(targetRoot, sessionId);
		if (loaded && loaded.manifest) manifest = loaded.manifest;
	} catch {
		// An unreadable manifest degrades to the focus + next-step lines only.
	}
	if (manifest) {
		if (manifest.status) {
			const routeId =
				manifest.route && (manifest.route.id || manifest.route.routeId)
					? manifest.route.id || manifest.route.routeId
					: "none";
			lines.push(`Session: ${manifest.status} | route ${routeId}`);
		}
		if (manifest.goal) lines.push(`Goal: ${truncateGoal(manifest.goal)}`);
		const stages = Array.isArray(manifest.completedStages)
			? manifest.completedStages.filter(Boolean)
			: [];
		lines.push(`Stages done: ${stages.length > 0 ? stages.join(", ") : "none"}`);
	}
	const gateInfo = resolvePendingGate(targetRoot, sessionId);
	// The resolver returns null when nothing is pending (no gates[0] fallback
	// since F024), so the next-gate hint is rendered unconditionally.
	lines.push(`Pending gates: ${gateInfo.pendingCount} (next: ${gateInfo.pendingGateId || "none"})`);
	return lines;
}

function renderBreadcrumbBlock(targetRoot, targetDisplay) {
	const { buildContext, inferNextStep } = require("./core/lifecycle");
	// targetDisplay threads the operator's --target into remedy lines, matching
	// how `amber next` renders (next-command.js passes the same option).
	const ctx = buildContext(targetRoot, { target: targetDisplay });
	const lines = [breadcrumbFocusLine(ctx.focus)];
	if (ctx.focus && ctx.focus.type === "session" && ctx.focus.id) {
		lines.push(...breadcrumbSessionLines(targetRoot, ctx.focus.id));
	}
	const step = inferNextStep(ctx);
	if (step) {
		lines.push(`Next step: ${step.label}`);
		lines.push(`Run: ${step.remedy}`);
	} else {
		lines.push("Next step: none — all lifecycle steps complete for this focus.");
	}
	return [BREADCRUMB_OPEN, ...lines, BREADCRUMB_CLOSE].join("\n");
}

function printBreadcrumb(target, { format = "json" } = {}) {
	const targetRoot = resolveTarget(target);
	// Bypass parity with the pre-commit guard: the env var wins silently.
	if (process.env.AMBER_SKIP_HOOKS === "1") {
		return { target: targetRoot, text: "", errors: [], warnings: [] };
	}
	if (format !== "json" && format !== "text") {
		return {
			target: targetRoot,
			text: "",
			errors: [
				invalidArgError(
					`Invalid breadcrumb format: ${JSON.stringify(format)} (expected "json" or "text")`,
					"amber hooks breadcrumb print --target <repo> --format json",
				),
			],
			warnings: [],
		};
	}
	let block;
	try {
		block = renderBreadcrumbBlock(targetRoot, target);
	} catch (error) {
		// Degraded is a successful, visible render — never silent, never
		// fabricated, and never an error (a context hook must not block a turn).
		block = [
			BREADCRUMB_OPEN,
			"Focus: unknown (degraded)",
			`Amber workflow-state unavailable: ${error && error.message ? error.message : String(error)}`,
			`Hint: run amber next --target "${targetRoot}" to inspect lifecycle state.`,
			BREADCRUMB_CLOSE,
		].join("\n");
	}
	const text =
		format === "text"
			? block
			: JSON.stringify({
					hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: block },
				});
	return { target: targetRoot, text, errors: [], warnings: [] };
}

function claudeSettingsPath(targetRoot) {
	return path.join(targetRoot, ".claude", "settings.json");
}

// Read .claude/settings.json as a merge base. Returns { settings } (a fresh {}
// when absent) or { problem } when the file cannot be safely merged; never
// throws and never mutates the file.
function readSettingsObject(settingsPath) {
	const label = ".claude/settings.json";
	if (!fs.existsSync(settingsPath)) return { settings: {} };
	const { value, error } = readJsonSafe(settingsPath);
	if (error) return { problem: `${label} is not valid JSON: ${error}` };
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { problem: `${label} does not contain a JSON object` };
	}
	return { settings: value };
}

// Both signals are required: the versioned HOOK_MARKER is shared with other
// Amber-managed entries, so the marker alone could match (and uninstall could
// remove) a foreign or future Amber entry that is not the breadcrumb.
//
// Shape note: Claude Code expects each hooks.<Event> entry to be
// { matcher, hooks: [ {type, command} ] }. Entries written by F022 at launch
// were flat { type, command } objects, which Claude Code refuses to load
// ("Expected array, but received undefined"). Detection accepts both shapes so
// uninstall can remove legacy flat entries and install can repair them.
function breadcrumbCommandOf(entry) {
	if (!entry || typeof entry !== "object") return null;
	if (typeof entry.command === "string") return entry.command; // legacy flat
	if (Array.isArray(entry.hooks)) {
		for (const hook of entry.hooks) {
			if (hook && typeof hook === "object" && typeof hook.command === "string") {
				return hook.command;
			}
		}
	}
	return null;
}

function isManagedBreadcrumbEntry(entry) {
	const command = breadcrumbCommandOf(entry);
	return (
		command !== null && command.includes(HOOK_MARKER) && command.includes("hooks breadcrumb print")
	);
}

function findManagedBreadcrumbEntry(entries) {
	if (!Array.isArray(entries)) return null;
	return entries.find(isManagedBreadcrumbEntry) || null;
}

// The Claude Code settings shape for one hooks.<Event> entry: a matcher plus a
// hooks array of {type, command} actions (see the Shape note above).
function buildBreadcrumbSettingsEntry(targetRoot) {
	return {
		matcher: "",
		hooks: [{ type: "command", command: buildBreadcrumbCommand(targetRoot) }],
	};
}

// True when the entry already carries the loadable {matcher, hooks} shape.
function isWrappedBreadcrumbEntry(entry) {
	return (
		Boolean(entry) &&
		typeof entry === "object" &&
		!Array.isArray(entry) &&
		Array.isArray(entry.hooks) &&
		typeof entry.command !== "string"
	);
}

// The hooks.UserPromptSubmit array of a parsed settings object, or null when
// the shape does not hold one.
function userPromptSubmitEntries(settings) {
	const hooks = settings && settings.hooks;
	return hooks &&
		typeof hooks === "object" &&
		!Array.isArray(hooks) &&
		Array.isArray(hooks.UserPromptSubmit)
		? hooks.UserPromptSubmit
		: null;
}

function buildBreadcrumbCommand(targetRoot) {
	const entry = amberEntryPosix();
	const root = path.resolve(targetRoot).split(path.sep).join("/");
	return `node "${shDquote(entry)}" hooks breadcrumb print --target "${shDquote(root)}" --format json ${HOOK_MARKER}`;
}

function installBreadcrumb(target, { platform = "claude" } = {}) {
	const targetRoot = resolveTarget(target);
	if (platform !== "claude") {
		return {
			target: targetRoot,
			text: "",
			errors: [
				invalidArgError(
					`Unsupported breadcrumb platform: ${JSON.stringify(platform)} (only "claude" is wired)`,
					"amber hooks breadcrumb install --target <repo> --platform claude",
				),
			],
			warnings: [],
		};
	}
	const settingsPath = claudeSettingsPath(targetRoot);
	const loaded = readSettingsObject(settingsPath);
	if (loaded.problem) {
		return {
			target: targetRoot,
			text: "",
			errors: [settingsUnmergeableError(`${loaded.problem} — leaving the file untouched.`)],
			warnings: [],
		};
	}
	const settings = loaded.settings;
	if (
		settings.hooks !== undefined &&
		(settings.hooks === null || typeof settings.hooks !== "object" || Array.isArray(settings.hooks))
	) {
		return {
			target: targetRoot,
			text: "",
			errors: [
				settingsUnmergeableError(
					'".hooks" in .claude/settings.json is not an object — leaving the file untouched.',
				),
			],
			warnings: [],
		};
	}
	const hooks = settings.hooks || (settings.hooks = {});
	if (hooks.UserPromptSubmit !== undefined && !Array.isArray(hooks.UserPromptSubmit)) {
		return {
			target: targetRoot,
			text: "",
			errors: [
				settingsUnmergeableError(
					'"hooks.UserPromptSubmit" in .claude/settings.json is not an array — leaving the file untouched.',
				),
			],
			warnings: [],
		};
	}
	const entries = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];
	const managedIndex = entries.findIndex(isManagedBreadcrumbEntry);
	if (managedIndex !== -1 && isWrappedBreadcrumbEntry(entries[managedIndex])) {
		return {
			target: targetRoot,
			text: "Amber workflow-state breadcrumb hook already installed in .claude/settings.json; nothing to do.",
			errors: [],
			warnings: [],
		};
	}
	// Append-only merge: foreign entries keep their positions, the Amber entry
	// carries the marker so uninstall removes exactly this entry. A legacy
	// flat managed entry (pre-shape-fix installs, unloadable by Claude Code)
	// is repaired in place instead of appended next to.
	if (managedIndex !== -1) {
		hooks.UserPromptSubmit = entries.map((entry, i) =>
			i === managedIndex ? buildBreadcrumbSettingsEntry(targetRoot) : entry,
		);
	} else {
		hooks.UserPromptSubmit = [...entries, buildBreadcrumbSettingsEntry(targetRoot)];
	}
	writeJson(settingsPath, settings);
	return {
		target: targetRoot,
		text:
			managedIndex !== -1
				? "Repaired Amber workflow-state breadcrumb hook in .claude/settings.json (legacy flat entry upgraded to the matcher+hooks shape; bypass a turn with AMBER_SKIP_HOOKS=1)."
				: "Installed Amber workflow-state breadcrumb hook in .claude/settings.json (bypass a turn with AMBER_SKIP_HOOKS=1).",
		errors: [],
		warnings: [],
	};
}

function uninstallBreadcrumb(target) {
	const targetRoot = resolveTarget(target);
	const settingsPath = claudeSettingsPath(targetRoot);
	if (!fs.existsSync(settingsPath)) {
		return {
			target: targetRoot,
			text: "No .claude/settings.json — nothing to remove.",
			errors: [],
			warnings: [],
		};
	}
	const loaded = readSettingsObject(settingsPath);
	if (loaded.problem) {
		return {
			target: targetRoot,
			text: "",
			errors: [settingsUnmergeableError(`${loaded.problem} — leaving the file untouched.`)],
			warnings: [],
		};
	}
	const settings = loaded.settings;
	const hooks = settings.hooks;
	const entries = userPromptSubmitEntries(settings);
	if (!entries || !findManagedBreadcrumbEntry(entries)) {
		return {
			target: targetRoot,
			text: "Amber workflow-state breadcrumb hook is not installed; .claude/settings.json left unchanged.",
			errors: [],
			warnings: [],
		};
	}
	const kept = entries.filter((entry) => !isManagedBreadcrumbEntry(entry));
	if (kept.length === 0) {
		delete hooks.UserPromptSubmit;
		if (Object.keys(hooks).length === 0) delete settings.hooks;
	} else {
		hooks.UserPromptSubmit = kept;
	}
	writeJson(settingsPath, settings);
	return {
		target: targetRoot,
		text: "Removed Amber workflow-state breadcrumb hook from .claude/settings.json.",
		errors: [],
		warnings: [],
	};
}

function statusBreadcrumb(target) {
	const targetRoot = resolveTarget(target);
	const settingsPath = claudeSettingsPath(targetRoot);
	if (!fs.existsSync(settingsPath)) {
		return {
			target: targetRoot,
			text: "Workflow-state breadcrumb hook: not installed (no .claude/settings.json).",
			errors: [],
			warnings: [],
		};
	}
	const loaded = readSettingsObject(settingsPath);
	if (loaded.problem) {
		return {
			target: targetRoot,
			text: "Workflow-state breadcrumb hook: unknown (.claude/settings.json could not be read).",
			errors: [],
			warnings: [loaded.problem],
		};
	}
	const entries = userPromptSubmitEntries(loaded.settings) || [];
	const managed = findManagedBreadcrumbEntry(entries);
	if (!managed) {
		return {
			target: targetRoot,
			text: "Workflow-state breadcrumb hook: not installed.",
			errors: [],
			warnings: [],
		};
	}
	return {
		target: targetRoot,
		text: `Workflow-state breadcrumb hook: installed.\nCommand: ${breadcrumbCommandOf(managed)}`,
		errors: [],
		warnings: [],
	};
}

module.exports = {
	checkGovernance,
	installHook,
	uninstallHook,
	statusHook,
	printBreadcrumb,
	installBreadcrumb,
	uninstallBreadcrumb,
	statusBreadcrumb,
	HOOK_MARKER,
	shDquote,
};
