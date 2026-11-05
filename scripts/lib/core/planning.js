"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { REPO_ROOT } = require("./constants");

const {
	assertExclusiveLeaf,
	pathExists,
	readJson,
	readText,
	relativeSlash,
	resolvePathWithin,
	resolveTarget,
	walkFiles,
} = require("./fs-utils");

const { getSectionBody, hasSectionWithBody, slugify, localIsoDate } = require("./text-utils");

const EVIDENCE_SCHEMA_FIELDS = ["Command", "Result", "Date"];
const RESUME_CHECKPOINT_FIELDS = [
	"Resume Point",
	"Blockers",
	"Next Action",
	"Recovery Instructions",
];

const { findFeatureById } = require("./validators");
const { codedError } = require("./error-catalog");
const { patchObjectFields, detectIndent } = require("./json-text");

const { MESSAGES } = require("./terminology");

// ── Context manifests (F027) ─────────────────────────────────────────────────
//
// Plans carry role-scoped context lists: knowledge-surface paths the
// implementer and the reviewer each need (contract docs, wiki pages, ADRs,
// schema docs). Code paths never belong here — they ride the feature's booked
// paths — and both roles must be curated before implementation-ready.

const CONTEXT_MANIFEST_ROLES = ["implement", "review"];

// The one rule line the scaffold renders under `## Context manifests`.
const CONTEXT_MANIFEST_RULE_LINE =
	"Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.";

// Parse the `## Context manifests` section. Returns null when the section is
// absent; otherwise { implement: string|null, review: string|null } with each
// role bullet's raw text (null when that role bullet is missing). Prose lines
// around the bullets are ignored.
function parseContextManifests(content) {
	const body = getSectionBody(content, "Context manifests");
	if (body === null) return null;
	const roles = {};
	for (const role of CONTEXT_MANIFEST_ROLES) {
		const match = body.match(new RegExp(`^\\s*-\\s*${role}\\s*:\\s*(.*)$`, "im"));
		roles[role] = match ? match[1].trim() : null;
	}
	return roles;
}

// A role bullet still carrying scaffold placeholder text (`<fill: ...>`) is
// uncurated output, not a manifest entry.
function isUncuratedManifestValue(value) {
	return /<fill[:>]/i.test(value);
}

// Split a role bullet into individual entries (comma- or space-separated
// BARE paths). Markdown wrappers (backticks/asterisks/quotes) are stripped
// the same way scopeMentionTokens strips them, so `docs/a.md` parses.
//
// Callers that validate path safety pass `preserveTrailingColon`: a bare drive
// designator (`C:`) is a path fact the validator must see, not sentence
// punctuation, so it may not be shortened to a harmless-looking `C`.
function splitManifestEntries(value, { preserveTrailingColon = false } = {}) {
	const trailing = preserveTrailingColon ? /["'`)\]}>.,;*_~]+$/ : /["'`)\]}>.,;:*_~]+$/;
	return value
		.split(/[,\s]+/)
		.map((entry) =>
			entry
				.replace(/^["'`([{<*_~]+/, "")
				.replace(trailing, "")
				.trim(),
		)
		.filter(Boolean);
}

// Knowledge-surface rule: `.md` files and `.schema.json` files anywhere, plus
// any file living under docs/, schemas/, or standards/. Everything else —
// code extensions included — is rejected by the gate. Case-insensitive so a
// root-level README.MD is still a knowledge surface.
function isKnowledgeSurfacePath(entry) {
	const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
	if (normalized.endsWith(".md") || normalized.endsWith(".schema.json")) return true;
	return ["docs/", "schemas/", "standards/"].some((prefix) => normalized.startsWith(prefix));
}

// Curated per-role entry arrays for the review echo. Null when the section is
// absent; an uncurated (placeholder) or missing role echoes as an empty array.
function extractContextManifests(content) {
	const parsed = parseContextManifests(content);
	if (!parsed) return null;
	const block = {};
	for (const role of CONTEXT_MANIFEST_ROLES) {
		block[role] =
			parsed[role] === null || isUncuratedManifestValue(parsed[role])
				? []
				: splitManifestEntries(parsed[role]);
	}
	return block;
}

// ── Vertical-slice contract (F084) ──────────────────────────────────────────
//
// A plan's slices are executable units, not prose headings. Each slice
// declares the paths it touches, the earlier slices it depends on, and the one
// command that proves it. The gate enforces the declaration deterministically:
// no model, no scoring, no hidden weights.

const SLICE_MAX_PATHS = 5;
const SLICE_MAX_SUBSYSTEMS = 2;

// `1. text`, `1) text`, `- [ ] Slice 1: text`, and `Slice 1: text` are all
// accepted so existing plans stay readable; the number is the slice identity.
const SLICE_HEADER_RE = /^\s*(?:[-*+]\s*\[[ xX]\]\s*)?(?:Slice\s+)?(\d+)\s*[:.)-]\s*(.*)$/;
// The unambiguous forms: a checkbox bullet or the literal `Slice` prefix. A
// bare numbered line ("2. of these is optional") stays prose until its block
// carries metadata.
const SLICE_EXPLICIT_HEADER_RE =
	/^\s*(?:[-*+]\s*\[[ xX]\]\s*(?:Slice\s+)?|[-*+]\s*Slice\s+|Slice\s+)\d+/i;
const SLICE_METADATA_RE = /^\s*[-*+]\s*(paths|depends-on|verify)\s*:\s*(.*)$/i;

// A bare numbered line ("2. of these is optional") is prose unless the block
// under it is slice metadata. This is the one ambiguous shape, so it needs the
// structural evidence rather than the number alone. The whole block is scanned,
// not just its first line: a slice may open with a prose sentence before its
// metadata bullets.
function hasIndentedMetadata(lines, startIndex, headerIndent) {
	for (let index = startIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (line.trim() === "") continue;
		const indent = line.match(/^(\s*)/)[1].length;
		if (indent <= headerIndent) return false;
		if (SLICE_METADATA_RE.test(line)) return true;
	}
	return false;
}

// Parse the `## Vertical Slices` section. Returns null when the section is
// absent, otherwise one entry per slice in document order.
//
// Every slice header in the section is recognised, wherever it sits: an
// explicit `- [ ]` / `Slice N:` header always counts, and a bare numbered line
// counts when its block carries metadata. A non-slice line ends the CURRENT
// slice's metadata block but never the section, so prose between slices cannot
// hide the slices after it.
//
// Numbering is checked against the order slices were read: a gap, a duplicate,
// or a header that does not start at 1 is recorded in `rejected` and reported
// by the validator. Slices are read in document order and never renumbered.
function parseVerticalSlicesDetailed(content) {
	const body = getSectionBody(content, "Vertical Slices");
	if (body === null) return { slices: null, rejected: [], misplaced: [] };
	const lines = body.split(/\r?\n/);
	const slices = [];
	const rejected = [];
	const misplaced = [];
	let current = null;
	let currentIndent = null;
	const recordMisplaced = (line) => {
		const metadata = line.match(SLICE_METADATA_RE);
		if (metadata) misplaced.push(metadata[1].toLowerCase());
	};
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const indent = line.match(/^(\s*)/)[1].length;
		const header = line.match(SLICE_HEADER_RE);
		// A header indented deeper than the running slice is that slice's body
		// (a nested bullet), not a new slice.
		const isHeader = header && (currentIndent === null || indent <= currentIndent);
		if (isHeader) {
			const explicit = SLICE_EXPLICIT_HEADER_RE.test(line);
			if (!explicit && !hasIndentedMetadata(lines, index, indent)) {
				current = null;
				continue;
			}
			const number = Number(header[1]);
			const expected = slices.length + 1;
			if (number !== expected) rejected.push(number);
			current = {
				number,
				title: header[2].trim(),
				paths: null,
				dependsOn: null,
				verify: null,
			};
			currentIndent = indent;
			slices.push(current);
			continue;
		}
		if (line.trim() === "") continue;
		// A metadata bullet with no slice to belong to is a declaration the author
		// wrote, not prose. Record it so the validator refuses the mis-indented
		// form instead of treating the plan as pre-contract.
		if (!current) {
			recordMisplaced(line);
			continue;
		}
		// Outdented or sibling content ends this slice's metadata block; the
		// section keeps scanning so a later slice header is still found.
		if (indent <= currentIndent) {
			current = null;
			recordMisplaced(line);
			continue;
		}
		const metadata = line.match(SLICE_METADATA_RE);
		if (!metadata) continue;
		const key = metadata[1].toLowerCase();
		const value = metadata[2].trim();
		if (key === "paths") current.paths = value;
		else if (key === "depends-on") current.dependsOn = value;
		else current.verify = value;
	}
	return { slices, rejected, misplaced };
}

function parseVerticalSlices(content) {
	return parseVerticalSlicesDetailed(content).slices;
}

// The deterministic subsystem key used by the slice budget: a module under
// scripts/lib/<name>/ counts as its own subsystem; every other path uses its
// first segment. The entry is normalized first so equivalent spellings of one
// repository-relative path (`scripts/./lib/x/a.js`, backslashes) cannot land in
// different subsystems. Callers run slicePathProblem BEFORE this, so
// normalization never hides a rejected `..` segment or drive qualifier.
function sliceSubsystemOf(entry) {
	const segments = path.posix.normalize(entry.replace(/\\/g, "/")).split("/").filter(Boolean);
	if (segments[0] === "scripts" && segments[1] === "lib" && segments[2]) {
		return `scripts/lib/${segments[2]}`;
	}
	return segments[0] || "";
}

function slicePathProblem(entry) {
	const normalized = entry.replace(/\\/g, "/").replace(/^\.\//, "");
	// `C:outside/a.js` is drive-relative: not absolute by path.isAbsolute, but
	// still anchored outside the target once the OS resolves it. Reject every
	// drive-qualified form, not just `C:/`.
	if (path.isAbsolute(entry) || /^[A-Za-z]:/.test(normalized)) {
		return "must be relative to the target repository";
	}
	if (normalized.split("/").includes("..")) return "must not escape the target repository";
	return null;
}

// The slice contract binds plans that are still moving. Only a TERMINAL
// lifecycle is frozen history: the work is over and the plan can no longer
// change, so re-validating it enforces nothing. Everything else — including
// proposed, draft, blocked, paused, and any settled word carrying a qualifier
// ("implemented-pending-verification") — still has work left and is gated.
const SLICE_CONTRACT_EXEMPT_STATUS_RE =
	/^(accepted|complete|completed|done|implemented|superseded|retired|obsolete|abandoned|rejected)$/i;

function sliceContractApplies(content) {
	const status = readPlanField(content, "Status");
	if (!status) return true; // an unlabelled plan is not exempt
	// A date annotation is the only qualifier that does not change the status:
	// "accepted (2026-09-24)" and "accepted — 2026-09-24" are both accepted.
	// Strip it, then require the remainder to be EXACTLY a terminal word. Any
	// other trailing prose ("accepted — pending re-review",
	// "implemented (verification pending)") names work that remains, so it
	// stays gated. Exact matching keeps that rule honest without a word list
	// that would rot.
	const token = status
		.trim()
		.replace(/\*\*/g, "")
		.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "")
		.replace(/\s+[—–-]\s+\d{4}-\d{2}-\d{2}\s*$/, "")
		.trim();
	return !SLICE_CONTRACT_EXEMPT_STATUS_RE.test(token);
}

function validateVerticalSlices(content) {
	const { slices, rejected, misplaced } = parseVerticalSlicesDetailed(content);
	if (slices === null) return [];
	// A header that does not continue the sequence is a numbering defect, and it
	// is reported for a terminal plan too: the exemption covers the contract, not
	// a section that cannot be read. The message names what the author wrote.
	if (rejected.length > 0) {
		return [
			`Vertical Slices must be numbered 1..N with no gaps (found slice ${rejected[0]} out of sequence). → fix: renumber the slices in document order.`,
		];
	}
	const errors = [];
	// Declaring metadata anywhere in the section opts the plan into the contract,
	// even when the bullet is badly indented or has no slice to belong to. The
	// misplacement is itself an error — a terminal status cannot freeze a
	// declaration the author never properly made.
	if (misplaced.length > 0) {
		const keys = [...new Set(misplaced)].sort().join(", ");
		errors.push(
			`Vertical slice metadata (${keys}) must be indented under its slice header. → fix: indent each paths:/depends-on:/verify: bullet under the slice it belongs to.`,
		);
	}
	// Compatible extension: a section with no declared metadata is a pre-contract
	// plan. It is grandfathered so accepted history stays readable; a curated
	// plan that declares any metadata is held to the whole contract.
	const curated =
		misplaced.length > 0 ||
		slices.some(
			(slice) => slice.paths !== null || slice.dependsOn !== null || slice.verify !== null,
		);
	if (!curated) {
		return sliceContractApplies(content)
			? [
					"Vertical Slices must declare paths:, depends-on:, and verify: for each slice. → fix: add `- paths: <repo-relative paths>` (at most 5), `- depends-on: <earlier slice numbers | none>`, and `- verify: <one command>` under each slice.",
				]
			: [];
	}
	if (slices.length === 0) {
		errors.push(
			"Vertical Slices must define at least one slice. → fix: add a `- [ ] Slice 1: <outcome>` bullet with `paths:`, `depends-on:`, and `verify:` metadata.",
		);
		return errors;
	}
	slices.forEach((slice, index) => {
		const position = index + 1;
		// A slice number that does not match its position is a duplicate or a
		// gap; either way two declarations collide, so it always fails.
		if (slice.number !== position) {
			errors.push(
				`Vertical slice ${slice.number} appears in position ${position}; slices are numbered 1..N in document order. → fix: renumber the slices.`,
			);
		}
		if (slice.paths === null) {
			errors.push(
				`Vertical slice ${position} must declare a paths: bullet. → fix: add \`- paths: <repo-relative paths, at most ${SLICE_MAX_PATHS}>\` under the slice.`,
			);
		} else if (isUncuratedManifestValue(slice.paths)) {
			errors.push(
				`Vertical slice ${position} still carries scaffold placeholders in paths:. → fix: replace them with the paths this slice touches.`,
			);
		} else {
			const entries = splitManifestEntries(slice.paths, { preserveTrailingColon: true });
			if (entries.length === 0) {
				errors.push(
					`Vertical slice ${position} lists no paths. → fix: name at least one repo-relative path.`,
				);
			} else {
				if (entries.length > SLICE_MAX_PATHS) {
					errors.push(
						`Vertical slice ${position} declares ${entries.length} paths; the limit is ${SLICE_MAX_PATHS}. → fix: split the slice or drop unrelated paths.`,
					);
				}
				const subsystems = new Set();
				for (const entry of entries) {
					const problem = slicePathProblem(entry);
					if (problem) {
						errors.push(`Vertical slice ${position} path ${entry} ${problem}.`);
						continue;
					}
					subsystems.add(sliceSubsystemOf(entry));
				}
				if (subsystems.size > SLICE_MAX_SUBSYSTEMS) {
					errors.push(
						`Vertical slice ${position} spans ${subsystems.size} subsystems (${[...subsystems].sort().join(", ")}); the limit is ${SLICE_MAX_SUBSYSTEMS}. → fix: split the slice by subsystem.`,
					);
				}
			}
		}
		if (slice.verify === null) {
			errors.push(
				`Vertical slice ${position} must name a verify: command. → fix: add \`- verify: <one command that proves this slice>\` under the slice.`,
			);
		} else if (slice.verify === "" || isUncuratedManifestValue(slice.verify)) {
			errors.push(
				`Vertical slice ${position} has an empty or placeholder verify: value. → fix: name the one command that proves this slice.`,
			);
		}
		// depends-on is a declared edge, required as part of the contract: a
		// curated slice states "none" explicitly rather than staying silent, so
		// a missing bullet is indistinguishable from an omitted dependency.
		if (slice.dependsOn === null) {
			errors.push(
				`Vertical slice ${position} must declare a depends-on: bullet. → fix: add \`- depends-on: none\` (or the earlier slice numbers this one needs).`,
			);
		} else {
			const value = slice.dependsOn.trim();
			// The token list, not the raw string, is the declaration: a value made
			// only of separators (",", " , ") declares no dependency at all and
			// must read as empty rather than as a valid zero-dependency slice.
			const tokens = value.split(/[,\s]+/).filter(Boolean);
			if (tokens.length === 0) {
				errors.push(
					`Vertical slice ${position} has an empty depends-on: value. → fix: name earlier slice numbers, or "none".`,
				);
			} else if (!/^none$/i.test(value)) {
				for (const token of tokens) {
					if (!/^\d+$/.test(token)) {
						errors.push(
							`Vertical slice ${position} depends-on value ${token} is not a slice number. → fix: name earlier slice numbers, or "none".`,
						);
						continue;
					}
					const target = Number(token);
					if (target < 1 || target >= position) {
						errors.push(
							`Vertical slice ${position} depends-on slice ${target}, which is not an earlier slice. → fix: dependencies must name a slice that appears before this one.`,
						);
					}
				}
			}
		}
	});
	return errors;
}

function resolveRelativePlanPath(targetRoot, planRelativePath) {
	if (path.isAbsolute(planRelativePath)) {
		return {
			canonicalTarget: null,
			planPath: null,
			error: "Plan path must be relative to the target repository.",
		};
	}
	try {
		const canonicalTarget = resolvePathWithin(targetRoot, ".", {
			label: "Target repository",
			allowRoot: true,
			canonicalExisting: true,
		});
		let planPath;
		try {
			planPath = resolvePathWithin(canonicalTarget, planRelativePath, {
				label: "Plan path",
				canonicalExisting: true,
			});
			// Both callers of this resolver write the plan back in place, so the shared-inode
			// check belongs here rather than at each sink: a plan that shares its bytes with
			// another name would have those names' content replaced by the confirmation edit.
			assertExclusiveLeaf("Plan path", planPath);
		} catch (error) {
			return { canonicalTarget: null, planPath: null, error: error.message };
		}
		return { canonicalTarget, planPath, error: null };
	} catch (error) {
		return { canonicalTarget: null, planPath: null, error: error.message };
	}
}

function buildPlanContent(feature, title, options = {}) {
	const planReference = options.planPath || "this plan file";
	return [
		`# Plan: ${title}`,
		"",
		`Feature: ${feature.id}`,
		"Status: implementation-ready",
		"User Confirmation: pending",
		"",
		"## Goal",
		"",
		feature.user_visible_behavior || "Describe the user-visible outcome.",
		"",
		"## High Level Design",
		"",
		"- Context:",
		"- Proposed approach:",
		"- Risks:",
		"",
		"## Context manifests",
		"",
		CONTEXT_MANIFEST_RULE_LINE,
		"- implement: <fill: knowledge-surface paths the implementer needs>",
		"- review: <fill: knowledge-surface paths the reviewer needs>",
		"",
		"## Vertical Slices",
		"",
		"Each slice names the paths it touches, the earlier slices it depends on, and the one command that proves it.",
		`A slice carries at most ${SLICE_MAX_PATHS} paths and ${SLICE_MAX_SUBSYSTEMS} subsystems (a scripts/lib/<name> module or a first path segment).`,
		"",
		"- [ ] Slice 1: make the smallest safe change that advances the feature.",
		"  - paths: <fill: repo-relative paths this slice touches>",
		"  - depends-on: none",
		"  - verify: <fill: one command that proves this slice>",
		"",
		"## Resume Checkpoint",
		"",
		"- Resume Point: plan scaffolded; implementation has not started.",
		"- Blockers: user confirmation is pending.",
		`- Next Action: review ${planReference}, then confirm it before implementation.`,
		"- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.",
		"",
		"## Acceptance Criteria",
		"",
		"- The user-visible behavior is demonstrably satisfied.",
		MESSAGES.planGuardrailsCheck,
		"",
		"## Verification",
		"",
		...feature.verification.map((step) => `- ${step}`),
		"",
		"## Evidence Schema",
		"",
		"- Command:",
		"- Result:",
		"- Date:",
		"- Notes:",
		"",
	].join("\n");
}

function scaffoldPlan(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const errors = [];
	const warnings = [];
	const created = [];
	const skipped = [];
	const featureId = options.feature;

	if (!featureId) {
		errors.push("Plan requires --feature <feature-id>.");
		return { target: targetRoot, created, skipped, errors, warnings };
	}

	let feature;
	try {
		feature = findFeatureById(targetRoot, featureId);
	} catch (error) {
		errors.push(`Cannot read feature_list.json: ${error.message}`);
		return { target: targetRoot, created, skipped, errors, warnings };
	}

	if (!feature) {
		errors.push(
			`Feature ${featureId} was not found in feature_list.json. ` +
				`→ fix: amber feature add --id ${featureId} --title "..."`,
		);
		return { target: targetRoot, created, skipped, errors, warnings };
	}

	// buildPlanContent maps feature.verification unconditionally (its pinned
	// contract assumes a valid feature). feature_list.json is untrusted target
	// input, so a feature missing its verification array would crash the pure
	// builder here at the command boundary. Surface a clean error via the
	// envelope instead of letting the TypeError escape to the top-level catch.
	if (!Array.isArray(feature.verification)) {
		errors.push(
			`Feature ${featureId} has no verification array in feature_list.json; run validate-feature-list to fix it.`,
		);
		return { target: targetRoot, created, skipped, errors, warnings };
	}

	if (
		options.title !== undefined &&
		(typeof options.title !== "string" || options.title.trim() === "")
	) {
		errors.push("--title must be a non-empty string when provided.");
		return { target: targetRoot, created, skipped, errors, warnings };
	}

	let title;
	if (options.title === undefined) {
		if (typeof feature.title !== "string" || feature.title.trim() === "") {
			errors.push(
				`Feature ${featureId} has no non-empty title in feature_list.json; run validate-feature-list to fix it.`,
			);
			return { target: targetRoot, created, skipped, errors, warnings };
		}
		title = feature.title.trim();
	} else {
		title = options.title;
	}
	const relativePath = path.join("docs", "plans", `${feature.id}-${slugify(title)}.md`);
	let destination;
	try {
		destination = resolvePathWithin(targetRoot, relativePath, {
			label: "Plan destination",
			canonicalExisting: true,
		});
	} catch (error) {
		errors.push(error.message || String(error));
		return { target: targetRoot, created, skipped, errors, warnings };
	}

	if (pathExists(destination)) {
		skipped.push(relativePath);
	} else {
		created.push(relativePath);
		if (!options.dryRun) {
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.writeFileSync(
				destination,
				buildPlanContent(feature, title, {
					planPath: relativeSlash(targetRoot, destination),
				}),
			);
		}
	}

	return {
		target: targetRoot,
		plan: relativePath,
		created,
		skipped,
		errors,
		warnings,
	};
}

// Plan headers are recorded in two styles: the current plain `Status: …` and the older
// bold `**Status:** …`. Both are read, so a plan written before the style changed stays
// governable instead of silently failing every gate that looks for a field.
const PLAN_FIELD_MARKER = "\\*{0,2}";

function readPlanField(content, field) {
	const pattern = new RegExp(
		`^${PLAN_FIELD_MARKER}${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:${PLAN_FIELD_MARKER}\\s*(.+)$`,
		"im",
	);
	const match = content.match(pattern);
	return match ? match[1].trim() : "";
}

// Pure core of validatePlanGate: given the plan content and an injected feature
// resolver, produce the gate errors/warnings without touching the filesystem.
// resolveFeature(featureId) => { found: boolean, error: string|null } where a
// non-null error means feature_list.json could not be read. resolveExists(entry)
// => boolean optionally checks that a Context manifests entry exists in the
// target repo; when omitted, existence checks are skipped (pure/test callers).
// Extracted so the validation branching (feature field, feature lookup,
// required sections, context manifests, user confirmation) is unit-testable.
function validatePlanContent({ content, resolveFeature, resolveExists }) {
	const errors = [];
	const warnings = [];
	const featureId = readPlanField(content, "Feature");
	const userConfirmation = readPlanField(content, "User Confirmation");

	if (!featureId) {
		errors.push("Plan must include a Feature field.");
	} else {
		const { found, error } = resolveFeature(featureId);
		if (error) {
			errors.push(`Cannot read feature_list.json: ${error}`);
		} else if (!found) {
			errors.push(`Plan feature ${featureId} was not found in feature_list.json.`);
		}
	}

	for (const section of [
		"High Level Design",
		"Context manifests",
		"Vertical Slices",
		"Resume Checkpoint",
		"Acceptance Criteria",
		"Verification",
		"Evidence Schema",
	]) {
		if (!hasSectionWithBody(content, section)) {
			errors.push(`Plan must include a non-empty ${section} section.`);
		}
	}

	// Context manifests (F027): both roles curated, knowledge surfaces only,
	// every entry present in the target repo. The section itself is already
	// covered by the required-sections rule above; this block only runs when
	// the section exists, so a missing section reports exactly once.
	const manifests = parseContextManifests(content);
	if (manifests !== null) {
		for (const role of CONTEXT_MANIFEST_ROLES) {
			const value = manifests[role];
			if (value === null) {
				errors.push(
					`Context manifests must define an ${role} role. → fix: add a "- ${role}: <knowledge-surface paths>" bullet.`,
				);
				continue;
			}
			if (isUncuratedManifestValue(value)) {
				errors.push(
					`Context manifests must be curated before implementation-ready: the ${role} role still carries scaffold placeholders. → fix: replace them with the knowledge-surface paths that role needs.`,
				);
				continue;
			}
			const entries = splitManifestEntries(value);
			if (entries.length === 0) {
				errors.push(
					`Context manifests must be curated before implementation-ready: the ${role} role lists no entries. → fix: name at least one knowledge-surface path.`,
				);
				continue;
			}
			for (const entry of entries) {
				if (!isKnowledgeSurfacePath(entry)) {
					errors.push(
						`Context manifest entry ${entry} (${role}) is a code path — context lists carry knowledge surfaces, not code. → fix: move code paths to the feature's booked paths.`,
					);
					continue;
				}
				if (resolveExists && !resolveExists(entry)) {
					errors.push(
						`Context manifest entry ${entry} (${role}) does not exist in the target repository (or escapes its root). → fix: point the entry at a knowledge surface inside the repository.`,
					);
				}
			}
		}
	}

	// Vertical slices (F084): every slice declares its paths, dependencies, and
	// verification command. Runs only when the section exists; the required-
	// sections rule above already reports a missing section exactly once.
	errors.push(...validateVerticalSlices(content));

	const checkpointBody = getSectionBody(content, "Resume Checkpoint");
	if (checkpointBody !== null) {
		const missingFields = RESUME_CHECKPOINT_FIELDS.filter(
			(field) => !new RegExp(`^\\s*-\\s*${field}:`, "im").test(checkpointBody),
		);
		if (missingFields.length > 0) {
			errors.push(`Resume Checkpoint must define ${missingFields.join(", ")} fields.`);
		}
	}

	if (!/^confirmed$/i.test(userConfirmation)) {
		errors.push("User confirmation is required before implementation-ready status.");
	}

	return { feature: featureId || null, errors, warnings };
}

function validatePlanGate(target, planRelativePath) {
	const targetRoot = resolveTarget(target);

	if (!planRelativePath) {
		return {
			target: targetRoot,
			plan: null,
			errors: ["Gate requires --plan <relative-plan-path>."],
			warnings: [],
		};
	}

	const resolvedPlan = resolveRelativePlanPath(targetRoot, planRelativePath);
	if (resolvedPlan.error) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			errors: [resolvedPlan.error],
			warnings: [],
		};
	}
	const planPath = resolvedPlan.planPath;
	if (!pathExists(planPath)) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			errors: [`Plan file is missing: ${planRelativePath}`],
			warnings: [],
		};
	}

	const content = readText(planPath);
	const result = validatePlanContent({
		content,
		resolveFeature: (featureId) => {
			try {
				const feature = findFeatureById(targetRoot, featureId);
				return { found: Boolean(feature), error: null };
			} catch (error) {
				return { found: false, error: error.message };
			}
		},
		// Context-manifest entries are repo-relative paths; existence is checked
		// against the target root so the pure core stays disk-free, and the
		// resolved path must stay INSIDE the root — an entry that escapes via
		// ../ or an absolute path is not a repo knowledge surface.
		resolveExists: (entry) => {
			const root = path.resolve(targetRoot);
			const resolved = path.resolve(root, entry.replace(/\\/g, "/"));
			const rel = path.relative(root, resolved);
			if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
			return pathExists(resolved);
		},
	});

	return {
		target: targetRoot,
		plan: planRelativePath,
		...result,
	};
}

function discoverStandards() {
	const standardsRoot = path.join(REPO_ROOT, "standards");
	return walkFiles(standardsRoot)
		.filter((filePath) => filePath.endsWith(".json"))
		.map((filePath) => {
			try {
				const data = readJson(filePath);
				return {
					id:
						typeof data.id === "string" && data.id.trim()
							? data.id.trim()
							: path.basename(filePath, ".json"),
					title: data.title,
					checks: Array.isArray(data.checks) ? data.checks : [],
					file: relativeSlash(REPO_ROOT, filePath),
				};
			} catch (error) {
				return {
					id: relativeSlash(REPO_ROOT, filePath),
					title: "Invalid standard",
					checks: [],
					file: relativeSlash(REPO_ROOT, filePath),
					error: error.message,
				};
			}
		});
}

function evaluateStandardCheck(content, checkId) {
	switch (checkId) {
		case "user-confirmation":
			if (!/^confirmed$/i.test(readPlanField(content, "User Confirmation"))) {
				return {
					pass: false,
					message: "Implementation-ready plans require explicit user confirmation.",
				};
			}
			return { pass: true };
		case "verification-evidence": {
			if (!hasSectionWithBody(content, "Verification")) {
				return {
					pass: false,
					message: "Plans must define a non-empty Verification section before acceptance.",
				};
			}
			const evidenceBody = getSectionBody(content, "Evidence Schema");
			if (!evidenceBody || !evidenceBody.trim()) {
				return {
					pass: false,
					message: "Plans must define an Evidence Schema section before acceptance.",
				};
			}
			const missingFields = EVIDENCE_SCHEMA_FIELDS.filter(
				(field) => !new RegExp(`^\\s*-\\s*${field}:`, "im").test(evidenceBody),
			);
			if (missingFields.length > 0) {
				return {
					pass: false,
					message: `Evidence Schema must define ${missingFields.join(", ")} fields before acceptance.`,
				};
			}
			return { pass: true };
		}
		case "scope-boundary": {
			const acceptanceBody = getSectionBody(content, "Acceptance Criteria");
			if (!acceptanceBody || !acceptanceBody.trim()) {
				return {
					pass: false,
					message:
						"Plans must acknowledge scope boundaries in Acceptance Criteria before acceptance.",
				};
			}
			const acknowledgesBoundary =
				/guardrails/i.test(acceptanceBody) || /phase boundary/i.test(acceptanceBody);
			if (!acknowledgesBoundary) {
				return {
					pass: false,
					message:
						"Acceptance Criteria must preserve the current phase boundary (include guardrails or phase-boundary acknowledgment).",
				};
			}
			return { pass: true };
		}
		default:
			return { pass: true };
	}
}

// Pure evaluator for loaded standards against plan content. Each check returns
// a finding when it fails; unknown check ids are treated as passing so future
// standards can be added without breaking review.
function evaluateStandardChecks({ content, standards }) {
	const findings = [];
	for (const standard of standards) {
		for (const check of standard.checks) {
			const result = evaluateStandardCheck(content, check.id);
			if (!result.pass) {
				findings.push({
					severity: "error",
					checkId: check.id,
					standard: standard.id,
					message: result.message,
				});
			}
		}
	}
	return findings;
}

// ── Scope-discipline advisories (F026) ───────────────────────────────────────
//
// Booked feature paths the plan's declared Scope never mentioned are classic
// scope creep. The diff rides the NON-blocking warnings channel plus a
// structured `scopeDiscipline` block — every entry in `findings` blocks, so
// advisories never go there; the blocking computation stays untouched.

// Four self-review questions, rendered as advisory lines in review output.
const SCOPE_DISCIPLINE_CHECKLIST = [
	"Uninvited tidying outside the task's stated work?",
	"Abstraction added beyond what this change needed?",
	"Files the acceptance criteria never named?",
	"A fix patched at the caller instead of the cause?",
];

// The `- Scope:` bullet under High Level Design (the F024/F025 plan shape)
// declares the surfaces a feature intends to touch. Extract the bullet text
// plus its deeper-indented continuation/nested lines; "" when absent.
function extractScopeBullet(content) {
	const body = getSectionBody(content, "High Level Design");
	if (!body) return "";
	const lines = body.split(/\r?\n/);
	let bulletIndent = -1;
	const captured = [];
	for (const line of lines) {
		const indent = line.match(/^(\s*)/)[1].length;
		if (bulletIndent === -1) {
			const scopeMatch = line.match(/^\s*-\s*Scope:\s*(.*)$/);
			if (scopeMatch) {
				bulletIndent = indent;
				captured.push(scopeMatch[1]);
			}
			continue;
		}
		// A sibling/outer bullet or any dedented non-empty line ends the block;
		// blank lines and deeper-indented continuations belong to it.
		if (line.trim() !== "" && indent <= bulletIndent) break;
		captured.push(line);
	}
	return captured.join("\n").trim();
}

// Candidate path tokens from Scope prose: whitespace-separated runs with
// surrounding markdown/punctuation trimmed and trailing slashes dropped
// (a trailing "/" and the bare directory are equivalent mentions).
function scopeMentionTokens(scopeText) {
	const tokens = new Set();
	for (const raw of scopeText.split(/\s+/)) {
		const token = raw
			.replace(/^["'`([{<*_~]+/, "")
			.replace(/["'`)\]}>.,;:!?:*_~]+$/, "")
			.replace(/^\.\//, "")
			.toLowerCase();
		if (token === "") continue;
		tokens.add(token);
		if (token.endsWith("/")) tokens.add(token.slice(0, -1));
	}
	return tokens;
}

// A booked path is mentioned when the Scope text names it exactly or names one
// of its ancestor directories (whole segments — "src/a.js" is covered by a
// "src/" or "src" mention, not by "sr"). Conservative: any plausible mention
// suppresses the advisory.
function isPathMentionedInScope(bookedPath, tokens) {
	const normalized = bookedPath.toLowerCase();
	if (tokens.has(normalized)) return true;
	const segments = normalized.split("/").filter(Boolean);
	for (let k = 1; k < segments.length; k += 1) {
		if (tokens.has(segments.slice(0, k).join("/"))) return true;
	}
	return false;
}

// Pure booked-paths-vs-Scope diff. Returns null when there is nothing to
// compare against (no booked paths or no declared Scope — stay quiet);
// otherwise { unmentionedPaths, checklist }. No disk access.
function buildScopeDiscipline({ bookedPaths, scopeText }) {
	const paths = (Array.isArray(bookedPaths) ? bookedPaths : [])
		.map((p) => (typeof p === "string" ? p.trim().replace(/\\/g, "/").replace(/^\.\//, "") : ""))
		.filter(Boolean);
	const text = typeof scopeText === "string" ? scopeText : "";
	if (paths.length === 0 || text.trim() === "") return null;
	const tokens = scopeMentionTokens(text);
	return {
		unmentionedPaths: paths.filter((p) => !isPathMentionedInScope(p, tokens)),
		checklist: [...SCOPE_DISCIPLINE_CHECKLIST],
	};
}

// Pure core of reviewPlan: given a gate result and the loaded standards, build
// the review object — classify gate errors into findings (user-confirmation vs
// plan-gate), evaluate standards against plan content, expand standards into
// applicable checks, and compute the required user action and release readiness.
// Extracted so the review assembly is unit-testable without discoverStandards/
// validatePlanGate hitting disk.
function buildReviewResult({
	targetRoot,
	planRelativePath,
	gateResult,
	standards,
	content = "",
	scopeDisciplineInput = null,
}) {
	const gateFindings = gateResult.errors.map((message) => {
		const checkId = /User confirmation/.test(message) ? "user-confirmation" : "plan-gate";
		const finding = { severity: "error", checkId, message };
		if (checkId === "user-confirmation") {
			finding.remedy = `amber gate --confirm --target . --plan ${planRelativePath}`;
		}
		return finding;
	});
	const gateCheckIds = new Set(gateFindings.map((finding) => finding.checkId));
	const standardFindings = content
		? evaluateStandardChecks({ content, standards }).filter(
				(finding) => !gateCheckIds.has(finding.checkId),
			)
		: [];
	const findings = [...gateFindings, ...standardFindings];

	const applicableChecks = standards.flatMap((standard) =>
		standard.checks.map((check) => ({
			standard: standard.id,
			id: check.id,
			description: check.description,
		})),
	);

	const requiredUserAction =
		findings.length > 0 ? ["Confirm the plan and resolve review findings before acceptance."] : [];

	// Scope-discipline diff (F026): advisories ride the warnings channel and a
	// structured block. They never enter findings, so requiredUserAction and
	// releaseReadiness below are computed exactly as before.
	const scopeDiscipline = scopeDisciplineInput ? buildScopeDiscipline(scopeDisciplineInput) : null;
	const scopeWarnings =
		scopeDiscipline && scopeDiscipline.unmentionedPaths.length > 0
			? scopeDiscipline.unmentionedPaths.map(
					(p) =>
						`Booked path ${p} is not mentioned in the plan's declared Scope — advisory only; confirm it belongs to this feature.`,
				)
			: [];

	// Context manifests (F027): the plan's curated per-role knowledge-surface
	// lists, echoed for display only — never a blocking finding of their own.
	const contextManifests = content ? extractContextManifests(content) : null;

	return {
		target: targetRoot,
		plan: planRelativePath,
		loadedStandards: standards.map((standard) => standard.id),
		applicableChecks,
		nonApplicableChecks: [],
		findings,
		requiredUserAction,
		releaseReadiness: { status: findings.length > 0 ? "blocked" : "ready" },
		errors: findings.map((finding) => finding.message),
		warnings: [...gateResult.warnings, ...scopeWarnings],
		scopeDiscipline,
		contextManifests,
	};
}

function reviewPlan(target, planRelativePath) {
	const targetRoot = resolveTarget(target);
	const standards = discoverStandards();
	const gateResult = validatePlanGate(targetRoot, planRelativePath);
	let content = "";
	if (gateResult.plan) {
		const resolvedPlan = resolveRelativePlanPath(targetRoot, gateResult.plan);
		if (!resolvedPlan.error && pathExists(resolvedPlan.planPath)) {
			content = readText(resolvedPlan.planPath);
		}
	}
	// Scope-discipline inputs: the plan's feature id resolves to its booked
	// paths; the declared Scope bullet comes from the plan content. A missing
	// feature, unreadable feature_list, or absent bullet stays quiet.
	let scopeDisciplineInput = null;
	if (content) {
		const featureId = readPlanField(content, "Feature");
		if (featureId) {
			try {
				const feature = findFeatureById(targetRoot, featureId);
				if (feature && Array.isArray(feature.paths) && feature.paths.length > 0) {
					scopeDisciplineInput = {
						bookedPaths: feature.paths,
						scopeText: extractScopeBullet(content),
					};
				}
			} catch {
				scopeDisciplineInput = null;
			}
		}
	}
	return buildReviewResult({
		targetRoot,
		planRelativePath,
		gateResult,
		standards,
		content,
		scopeDisciplineInput,
	});
}

function confirmPlanGate(target, planRelativePath) {
	const targetRoot = resolveTarget(target);

	if (!planRelativePath) {
		return {
			target: targetRoot,
			plan: null,
			confirmed: false,
			errors: ["confirm requires --plan <relative-plan-path>."],
			warnings: [],
		};
	}

	const resolvedPlan = resolveRelativePlanPath(targetRoot, planRelativePath);
	if (resolvedPlan.error) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			confirmed: false,
			errors: [resolvedPlan.error],
			warnings: [],
		};
	}
	const planPath = resolvedPlan.planPath;
	if (!pathExists(planPath)) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			confirmed: false,
			errors: [`Plan file is missing: ${planRelativePath}`],
			warnings: [],
		};
	}

	let content = readText(planPath);
	const updated = content.replace(
		/^User\s*Confirmation\s*:\s*.+$/m,
		"User Confirmation: confirmed",
	);

	if (updated === content) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			confirmed: false,
			errors: ["Plan does not contain a 'User Confirmation:' field to confirm."],
			warnings: [],
		};
	}

	fs.writeFileSync(planPath, updated);

	return {
		target: targetRoot,
		plan: planRelativePath,
		confirmed: true,
		errors: [],
		warnings: [],
	};
}

function acceptPlan(target, planRelativePath, options = {}) {
	const targetRoot = resolveTarget(target);
	const review = reviewPlan(targetRoot, planRelativePath);
	if (review.errors.length > 0) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			accepted: false,
			errors: review.errors,
			warnings: review.warnings,
			review,
		};
	}

	const resolvedPlan = resolveRelativePlanPath(targetRoot, planRelativePath);
	if (resolvedPlan.error || !pathExists(resolvedPlan.planPath)) {
		return {
			target: targetRoot,
			plan: planRelativePath,
			accepted: false,
			errors: [resolvedPlan.error || `Plan file is missing: ${planRelativePath}`],
			warnings: review.warnings,
			review,
		};
	}
	const planPath = resolvedPlan.planPath;
	const planContent = readText(planPath);
	const featureId = readPlanField(planContent, "Feature");
	let featureUpdated = false;

	// Governance gate: a feature cannot be accepted without verification
	// evidence. Evidence is produced by `session verify --execute` (which
	// refluxes into feature_list.json) or `feature verify`. --force bypasses
	// with a recorded warning.
	if (featureId) {
		const feature = findFeatureById(targetRoot, featureId);
		const hasEvidence = feature && Array.isArray(feature.evidence) && feature.evidence.length > 0;
		if (feature && !hasEvidence) {
			if (!options.force) {
				return {
					target: targetRoot,
					plan: planRelativePath,
					accepted: false,
					featureId,
					errors: [
						codedError(
							"AMBER_E_FEATURE_NO_EVIDENCE",
							`Cannot accept ${featureId}: no verification evidence is recorded.`,
						),
					],
					warnings: review.warnings,
					review,
				};
			}
			review.warnings.push(`Accepted ${featureId} with --force despite no verification evidence.`);
		}
	}

	// Update feature_list.json with immutable pattern.
	if (featureId) {
		try {
			const feature = findFeatureById(targetRoot, featureId);
			if (feature) {
				const featureListPath = path.join(targetRoot, "feature_list.json");
				const data = readJson(featureListPath);
				const idx = data.features.findIndex((f) => f && f.id === featureId);
				if (idx !== -1 && data.features[idx].status !== "accepted") {
					const acceptedAt = localIsoDate();
					const updatedFeatures = data.features.map((f, i) =>
						i === idx ? { ...f, status: "accepted", updated: acceptedAt } : f,
					);
					const intended = { ...data, features: updatedFeatures };
					// Patch the one entry in the bytes that are already there. Serializing
					// the whole document instead expands every array and uses 2-space
					// indentation in a tab-indented file, turning a one-status acceptance
					// into a 3,200-line diff and failing `npm run format:check`. The
					// helper returns null when it cannot prove the edit is faithful.
					const raw = fs.readFileSync(featureListPath, "utf8");
					const patched = patchObjectFields(raw, {
						identityKey: "id",
						identityValue: featureId,
						fields: { status: "accepted", updated: acceptedAt },
						expected: intended,
					});
					fs.writeFileSync(
						featureListPath,
						`${patched ?? `${JSON.stringify(intended, null, detectIndent(raw))}\n`}`,
					);
					featureUpdated = true;
				}
			}
		} catch (err) {
			// If feature_list.json is missing or corrupt, accept still succeeds
			// — the evolution log is the durable record.
		}
	}

	// Update the plan's own Status field to reflect acceptance, preserving the
	// header's own markers (`Status:` stays plain, `**Status:**` stays bold).
	try {
		const updatedPlan = planContent.replace(/^(\*{0,2}Status:\*{0,2}\s*).+$/m, "$1accepted");
		if (updatedPlan !== planContent) {
			fs.writeFileSync(planPath, updatedPlan);
		}
	} catch (err) {
		// Non-critical — the plan update is cosmetic.
	}

	const evolutionRelativePath = path.join("docs", "wiki", "engineering", "harness-evolution.md");
	const evolutionPath = path.join(targetRoot, evolutionRelativePath);
	const portablePlanPath = relativeSlash(resolvedPlan.canonicalTarget, resolvedPlan.planPath);
	const date = localIsoDate();
	const entry = [
		"",
		`## ${date} ${portablePlanPath}`,
		"",
		`- Plan: \`${portablePlanPath}\``,
		"- Review status: ready",
		featureUpdated
			? `- Feature: ${featureId} status → accepted in feature_list.json`
			: "- Required user action: none",
		"",
	].join("\n");

	fs.mkdirSync(path.dirname(evolutionPath), { recursive: true });
	// A fixed in-target name this writer overwrites or appends to, so a planted
	// shared-inode link here needs no caller-supplied path to escape the target.
	assertExclusiveLeaf("Evolution log", evolutionPath);
	if (!pathExists(evolutionPath)) {
		fs.writeFileSync(
			evolutionPath,
			`${MESSAGES.evolutionLogHeading}\n\nLast Reviewed: ${date}\n${entry}`,
		);
	} else {
		fs.appendFileSync(evolutionPath, entry);
	}

	// T2 memory write-back trigger (ADR-0018 spec §5.1): at the feature-accept
	// write-back site — the same deterministic detectWriteBackTriggers criteria
	// F023 uses — a path-category hit nominates a memory write-back contract
	// (channel t2-writeback). Ledger-visible nomination only (M3); never blocks
	// acceptance; failures surface as a warning.
	let t2Warning = null;
	if (featureId) {
		const feature = findFeatureById(targetRoot, featureId);
		const { featureWriteBackCategories } = require("./learning-writeback");
		if (featureWriteBackCategories(feature).length > 0) {
			const { mountWriteBackTrigger } = require("./memory-trigger");
			t2Warning = mountWriteBackTrigger(targetRoot, {
				channel: "t2-writeback",
				triggerRef: featureId,
				label: "T2",
			});
		}
	}

	return {
		target: targetRoot,
		plan: planRelativePath,
		accepted: true,
		featureId: featureId || null,
		featureUpdated,
		evolutionLog: evolutionRelativePath,
		errors: [],
		warnings: t2Warning ? [...review.warnings, t2Warning] : review.warnings,
		review,
	};
}

module.exports = {
	buildPlanContent,
	scaffoldPlan,
	readPlanField,
	validatePlanContent,
	validatePlanGate,
	confirmPlanGate,
	discoverStandards,
	evaluateStandardChecks,
	buildReviewResult,
	reviewPlan,
	acceptPlan,
	SCOPE_DISCIPLINE_CHECKLIST,
	extractScopeBullet,
	buildScopeDiscipline,
	CONTEXT_MANIFEST_ROLES,
	CONTEXT_MANIFEST_RULE_LINE,
	parseContextManifests,
	extractContextManifests,
	isKnowledgeSurfacePath,
	parseVerticalSlices,
	parseVerticalSlicesDetailed,
	validateVerticalSlices,
	sliceSubsystemOf,
	sliceContractApplies,
	SLICE_MAX_PATHS,
	SLICE_MAX_SUBSYSTEMS,
};
