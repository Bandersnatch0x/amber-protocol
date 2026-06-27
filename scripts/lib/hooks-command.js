"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveTarget, readJsonSafe } = require("./core/fs-utils");
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
			codedError(
				"AMBER_E_HOOK_PRECOMMIT_BLOCKED",
				`${findings.length} governance check(s) failed`,
			),
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

module.exports = { checkGovernance, installHook, uninstallHook, statusHook, HOOK_MARKER, shDquote };

