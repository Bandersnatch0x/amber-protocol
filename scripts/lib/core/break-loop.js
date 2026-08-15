"use strict";

// Break-loop post-mortem scaffold (F025).
//
// Single source of truth for the recurring-defect escalation path: the
// root-cause taxonomy, the prevention-mechanism menu (each entry mapped to its
// Amber write-back surface), the post-mortem template sections, and the
// scaffold + validate functions. Scaffold, validate, and `amber break-loop
// --help` all render from these constants so they can never disagree. Amber
// scaffolds and validates; the analysis itself stays with the operator — no
// issue-tracker access, no recurrence auto-detection.

const fs = require("node:fs");
const path = require("node:path");

const {
	resolveTarget,
	resolvePathWithin,
	pathExists,
	readText,
	isMissingPath,
} = require("./fs-utils");
const { localIsoDate, slugify, getSectionBody } = require("./text-utils");

// Directory (relative to the target root) where post-mortems live.
const BREAK_LOOP_DIR = path.posix.join("docs", "quality", "break-loops");

// The placeholder marker convention: every scaffolded prompt is written as
// `<fill: ...>` and validate refuses any marker that survives. Exported so
// tests (and fillers) can detect/replace markers without re-hardcoding.
const PLACEHOLDER_PATTERN = /<fill:[^>]*>/;

// ── Root-cause taxonomy (exactly five; pick by id) ───────────────────────────

const ROOT_CAUSE_CATEGORIES = Object.freeze([
	{
		id: "missing-contract",
		description: "The rule existed nowhere in writing, so nothing could enforce or re-teach it.",
	},
	{
		id: "cross-layer-drift",
		description: "Two layers disagreed because nothing kept their shared contract in step.",
	},
	{
		id: "change-propagation-failure",
		description: "A change landed in one place and never reached every place that depends on it.",
	},
	{
		id: "verification-gap",
		description:
			"No test anchored the behavior, so the break reached mainline without failing anything.",
	},
	{
		id: "implicit-assumption",
		description:
			"An unstated assumption held quietly until conditions changed and it stopped holding.",
	},
]);

// ── Prevention-mechanism menu (each mapped to its write-back surface) ────────

const PREVENTION_MECHANISMS = Object.freeze([
	{
		id: "contract-and-anchor",
		description:
			"Write the contract doc section plus a mandatory test anchor that fails whenever the rule is violated.",
		surface: "docs/specs/ + tests/",
	},
	{
		id: "parity-guard",
		description: "Extend an existing coverage or parity walk so the drift itself fails CI.",
		surface: "the relevant parity test",
	},
	{
		id: "centralized-helper",
		description: "Replace scattered copies with one shared helper so the class cannot re-scatter.",
		surface: "the helper module + its unit test",
	},
	{
		id: "checklist-item",
		description: "Add the consideration to the ritual or wiki checklist where it will be re-read.",
		surface: "docs/wiki or the ritual doc",
	},
]);

// ── Template sections ────────────────────────────────────────────────────────

const POSTMORTEM_SECTIONS = Object.freeze([
	{
		title: "Symptom & evidence",
		guidance:
			"Lead with commands and observed-versus-expected output; interpretation belongs later.",
		placeholder: "<fill: the exact command, what it did, and what it should have done>",
	},
	{
		title: "Recurrence & why previous fixes failed",
		guidance:
			"One entry per earlier fix: what changed, why it looked sufficient, why the class still returned.",
		placeholder: "<fill: what the earlier fix changed and why that was not enough>",
	},
	{
		title: "Root-cause classification",
		guidance:
			"Name exactly one primary category by id from the taxonomy; a secondary id is optional.",
		placeholder: "<fill: category id>",
	},
	{
		title: "Prevention mechanism",
		guidance:
			"Pick exactly one mechanism by id from the menu; its write-back surface is where the durable fix lands.",
		placeholder: "<fill: mechanism id>",
	},
	{
		title: "Write-back record",
		guidance:
			"Record what actually landed: the surface path and the test anchor that now guards the rule.",
		placeholder: "<fill: path of the knowledge surface written>",
	},
	{
		title: "Verification",
		guidance:
			"Give the runnable command that proves the loop is broken and the output it must show.",
		placeholder: "<fill: runnable command plus the output it must show>",
	},
]);

const CATEGORY_IDS = ROOT_CAUSE_CATEGORIES.map((category) => category.id);
const MECHANISM_IDS = PREVENTION_MECHANISMS.map((mechanism) => mechanism.id);

function sectionByTitle(title) {
	return POSTMORTEM_SECTIONS.find((section) => section.title === title) || null;
}

// Taxonomy/menu renderers shared by the scaffold template and command help, so
// the filler reads identical wording in both places.
function renderTaxonomyLines(indent) {
	return ROOT_CAUSE_CATEGORIES.map(
		(category) => `${indent}- ${category.id} — ${category.description}`,
	);
}

function renderMenuLines(indent) {
	return PREVENTION_MECHANISMS.map(
		(mechanism) =>
			`${indent}- ${mechanism.id} — ${mechanism.description} (write-back surface: ${mechanism.surface})`,
	);
}

// ── Template rendering ───────────────────────────────────────────────────────

function renderPostMortemTemplate({ issue, title, recurrence, day = localIsoDate() }) {
	const rootCause = sectionByTitle("Root-cause classification");
	const prevention = sectionByTitle("Prevention mechanism");
	const writeBack = sectionByTitle("Write-back record");
	const verification = sectionByTitle("Verification");

	return [
		`# Post-mortem: ${title}`,
		"",
		`Issue: ${issue}`,
		`Title: ${title}`,
		`Recurrence: ${recurrence}`,
		`Date: ${day}`,
		"",
		"Break-loop record for a defect class that came back after a fix. Fill every",
		"section, choose ids from the taxonomy and menu below, then validate:",
		"`amber break-loop validate --target <repo> --file <this file>`. Validation refuses",
		"any `<fill: ...>` marker left behind.",
		"",
		"## Symptom & evidence",
		"",
		sectionByTitle("Symptom & evidence").guidance,
		"",
		`- Observed: ${sectionByTitle("Symptom & evidence").placeholder}`,
		`- Expected: <fill: the behavior the command should have produced>`,
		"",
		"## Recurrence & why previous fixes failed",
		"",
		sectionByTitle("Recurrence & why previous fixes failed").guidance,
		"",
		`- Fix 1: ${sectionByTitle("Recurrence & why previous fixes failed").placeholder}`,
		"- Fix 2: <fill: add one entry per earlier fix attempt>",
		"",
		"## Root-cause classification",
		"",
		rootCause.guidance,
		"",
		`- Primary: ${rootCause.placeholder}`,
		"- Secondary: <fill: category id or none>",
		"",
		"Taxonomy (pick by id):",
		"",
		...renderTaxonomyLines(""),
		"",
		"## Prevention mechanism",
		"",
		prevention.guidance,
		"",
		`- Mechanism: ${prevention.placeholder}`,
		"",
		"Menu (pick by id):",
		"",
		...renderMenuLines(""),
		"",
		"## Write-back record",
		"",
		writeBack.guidance,
		"",
		`- Surface: ${writeBack.placeholder}`,
		"- Test anchor: <fill: test file and case that anchors the rule>",
		"",
		"## Verification",
		"",
		verification.guidance,
		"",
		verification.placeholder,
		"",
	];
}

// ── Scaffold ─────────────────────────────────────────────────────────────────

// The title becomes the filename slug; slugify collapses any run outside
// [a-zA-Z0-9], so a title without an ASCII letter/digit would collide every
// such post-mortem onto the same fallback name on a given day.
function hasSlugCharacter(title) {
	return /[a-zA-Z0-9]/.test(String(title));
}

function parseRecurrence(value) {
	if (value === undefined || value === null) return null;
	const text = String(value).trim();
	if (!/^\d+$/.test(text)) return null;
	const parsed = Number.parseInt(text, 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Scaffold one post-mortem under docs/quality/break-loops/.
 *
 * `recurrence` must be an integer >= 2 (the operator declares the loop; Amber
 * never auto-detects it) and `title` is required; both are refused with
 * visible errors and nothing is written. The file is named
 * `<localIsoDate()>-<slugify(title)>.md`; an existing file is never
 * overwritten — the refusal error names it. Returns the standard envelope
 * `{ target, path, text, errors, warnings }`.
 */
function scaffoldPostMortem(target, { issue, title, recurrence } = {}) {
	const targetRoot = resolveTarget(target);
	const errors = [];
	const warnings = [];

	// The issue is a recorded reference number only — a string from the CLI or
	// a number from direct callers; any non-blank value is accepted, never
	// dereferenced, and no tracker is contacted.
	if (issue === undefined || issue === null || String(issue).trim() === "") {
		errors.push(
			"break-loop requires --issue <n> (a recorded reference number; no tracker access).",
		);
	}
	if (!title || String(title).trim() === "") {
		errors.push('break-loop requires --title "<title>".');
	} else if (!hasSlugCharacter(title)) {
		errors.push(
			"--title must contain at least one ASCII letter or digit (it becomes the filename slug).",
		);
	}
	const parsedRecurrence = parseRecurrence(recurrence);
	if (parsedRecurrence === null || parsedRecurrence < 2) {
		errors.push(
			"break-loop requires --recurrence <n> with n >= 2 — the operator declares the loop; " +
				"Amber never auto-detects recurrence.",
		);
	}
	if (errors.length > 0) {
		return { target: targetRoot, path: null, text: "", errors, warnings };
	}

	const day = localIsoDate();
	const relativePath = path.posix.join(BREAK_LOOP_DIR, `${day}-${slugify(title)}.md`);
	const destination = path.join(targetRoot, relativePath);
	if (pathExists(destination)) {
		return {
			target: targetRoot,
			path: destination,
			text: "",
			errors: [
				`Post-mortem already exists — refusing to overwrite: ${relativePath}. ` +
					"Edit or validate that file instead of scaffolding a duplicate.",
			],
			warnings,
		};
	}

	fs.mkdirSync(path.dirname(destination), { recursive: true });
	const text = renderPostMortemTemplate({ issue, title, recurrence: parsedRecurrence, day }).join(
		"\n",
	);
	fs.writeFileSync(destination, `${text}\n`);

	return {
		target: targetRoot,
		path: destination,
		text: [
			`Break-loop post-mortem scaffolded: ${relativePath}`,
			"Fill every section (choose ids from the taxonomy and menu), then validate:",
			`  amber break-loop validate --target <repo> --file ${relativePath}`,
		].join("\n"),
		errors,
		warnings,
	};
}

// ── Validation ───────────────────────────────────────────────────────────────

// A runnable command line: a line that starts (after optional "$ "/"`") with a
// known runner, or an inline code span that does. Deterministic, no execution.
const RUNNABLE_START =
	/^\s*(?:[$>]\s*)?`?(node|npm|npx|yarn|pnpm|bun|git|amber|python3?|pytest|make)\s+\S/;
const RUNNABLE_INLINE = /`\$?\s?(node|npm|npx|yarn|pnpm|bun|git|amber|python3?|pytest|make)\s+\S/;

function hasRunnableCommand(body) {
	return body
		.split(/\r?\n/)
		.some((line) => RUNNABLE_START.test(line) || RUNNABLE_INLINE.test(line));
}

// Placeholder words that satisfy non-empty but carry no commitment.
const VACUOUS_TOKEN = /^(none|tbd|todo|n\/a|-|pending|later)$/i;

// Extract the value of a `- Field:` bullet from a section body, or null when
// the field has no bullet at all.
function readBulletField(body, field) {
	// [ \t]* (not \s*) so a blank value cannot slide the capture onto the
	// following line and validate an empty field as its neighbor.
	const pattern = new RegExp(`^[ \\t]*-[ \\t]*${field}:[ \\t]*([^\\n]*)$`, "im");
	const match = body.match(pattern);
	return match ? match[1].trim() : null;
}

// How many valid ids the field value names, and which ones.
function countValidIds(value, validIds) {
	const tokens = String(value || "")
		.split(/[\s,]+/)
		.filter(Boolean);
	const named = tokens.filter((token) => validIds.includes(token));
	return { named, count: named.length };
}

/**
 * Pure core of validatePostMortem: classify a filled post-mortem's content
 * without touching the filesystem. Extracted so the section, placeholder,
 * taxonomy, menu, write-back, and verification checks are unit-testable.
 */
function validatePostMortemContent(content) {
	const errors = [];
	const warnings = [];
	const bodies = new Map();

	for (const section of POSTMORTEM_SECTIONS) {
		const body = getSectionBody(content, section.title);
		bodies.set(section.title, body);
		if (body === null || body.trim() === "") {
			errors.push(`Post-mortem must include a non-empty ${section.title} section.`);
		}
	}

	let primary = null;
	let secondary = null;
	let mechanism = null;
	let surface = null;
	let testAnchor = null;

	for (const section of POSTMORTEM_SECTIONS) {
		const body = bodies.get(section.title);
		if (body === null || body.trim() === "") continue;

		if (PLACEHOLDER_PATTERN.test(body)) {
			errors.push(
				`Section ${section.title} still contains unfilled placeholder markers — replace every \`<fill: ...>\`.`,
			);
			continue;
		}

		if (section.title === "Root-cause classification") {
			const primaryValue = readBulletField(body, "Primary");
			if (primaryValue === null) {
				errors.push(
					`Root-cause classification must name exactly one primary category (Primary: <id>); ` +
						`valid ids: ${CATEGORY_IDS.join(", ")}.`,
				);
			} else {
				const { named, count } = countValidIds(primaryValue, CATEGORY_IDS);
				if (count !== 1) {
					errors.push(
						`Root-cause Primary must name exactly one category id; valid ids: ${CATEGORY_IDS.join(", ")}.`,
					);
				} else {
					primary = named[0];
				}
			}
			const secondaryValue = readBulletField(body, "Secondary");
			if (secondaryValue !== null && secondaryValue !== "" && !/^none$/i.test(secondaryValue)) {
				const { named, count } = countValidIds(secondaryValue, CATEGORY_IDS);
				if (count > 1) {
					errors.push(
						`Root-cause Secondary may name at most one category id; valid ids: ${CATEGORY_IDS.join(", ")}.`,
					);
				} else if (count === 1) {
					secondary = named[0];
				} else {
					errors.push(
						`Root-cause Secondary must be a category id or none; valid ids: ${CATEGORY_IDS.join(", ")}.`,
					);
				}
			}
		}

		if (section.title === "Prevention mechanism") {
			const mechanismValue = readBulletField(body, "Mechanism");
			if (mechanismValue === null) {
				errors.push(
					`Prevention mechanism must name exactly one mechanism (Mechanism: <id>); ` +
						`valid ids: ${MECHANISM_IDS.join(", ")}.`,
				);
			} else {
				const { named, count } = countValidIds(mechanismValue, MECHANISM_IDS);
				if (count !== 1) {
					errors.push(
						`Prevention Mechanism must name exactly one mechanism id; valid ids: ${MECHANISM_IDS.join(", ")}.`,
					);
				} else {
					mechanism = named[0];
				}
			}
		}

		if (section.title === "Write-back record") {
			surface = readBulletField(body, "Surface");
			if (!surface) {
				errors.push("Write-back record must name a surface path (Surface: <path>).");
			} else if (VACUOUS_TOKEN.test(surface)) {
				errors.push("Surface must name a real path, not a placeholder word.");
			}
			testAnchor = readBulletField(body, "Test anchor");
			if (!testAnchor) {
				errors.push("Write-back record must name a test anchor (Test anchor: <file/case>).");
			} else if (VACUOUS_TOKEN.test(testAnchor)) {
				errors.push("Test anchor must name a real test file/case, not a placeholder word.");
			}
		}

		if (section.title === "Verification" && !hasRunnableCommand(body)) {
			errors.push(
				"Verification must include a runnable command line (e.g. `node --test tests/unit/...`).",
			);
		}
	}

	return { errors, warnings, primary, secondary, mechanism, surface, testAnchor };
}

/**
 * Validate a filled post-mortem: every section present, no `<fill: ...>`
 * marker anywhere, exactly one primary root-cause category id (secondary
 * optional), exactly one prevention mechanism id, a write-back record with a
 * surface path and a test anchor, and a runnable verification command. The
 * file must live inside the target root — no escaping. Read-only; the result
 * envelope follows the gate's plan-validation shape.
 */
function validatePostMortem(target, { file } = {}) {
	const targetRoot = resolveTarget(target);

	if (isMissingPath(file)) {
		return {
			target: targetRoot,
			file: null,
			valid: false,
			errors: ["break-loop validate requires --file <path>."],
			warnings: [],
		};
	}

	let filePath;
	try {
		filePath = resolvePathWithin(targetRoot, file, { label: "Post-mortem file" });
	} catch (error) {
		return {
			target: targetRoot,
			file,
			valid: false,
			errors: [error.message],
			warnings: [],
		};
	}

	if (!pathExists(filePath) || !fs.statSync(filePath).isFile()) {
		return {
			target: targetRoot,
			file,
			valid: false,
			errors: [`Post-mortem file is missing: ${file}`],
			warnings: [],
		};
	}

	const result = validatePostMortemContent(readText(filePath));
	if (result.errors.length > 0) {
		return {
			target: targetRoot,
			file,
			valid: false,
			errors: result.errors,
			warnings: result.warnings,
		};
	}

	return {
		target: targetRoot,
		file,
		valid: true,
		errors: [],
		warnings: result.warnings,
		primary: result.primary,
		secondary: result.secondary,
		mechanism: result.mechanism,
		surface: result.surface,
		testAnchor: result.testAnchor,
		text: [
			`Post-mortem passed validation: ${file}`,
			`  Primary category: ${result.primary}`,
			`  Prevention mechanism: ${result.mechanism}`,
			`  Write-back surface: ${result.surface}`,
			`  Test anchor: ${result.testAnchor}`,
		].join("\n"),
	};
}

module.exports = {
	BREAK_LOOP_DIR,
	PLACEHOLDER_PATTERN,
	ROOT_CAUSE_CATEGORIES,
	PREVENTION_MECHANISMS,
	POSTMORTEM_SECTIONS,
	renderTaxonomyLines,
	renderMenuLines,
	scaffoldPostMortem,
	validatePostMortem,
	validatePostMortemContent,
};
