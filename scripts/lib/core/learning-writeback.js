"use strict";

// Post-accept learning write-back checkpoint (F023).
//
// Deterministic, path-based classification of a feature's booked `paths` into
// mandatory knowledge write-back triggers (schema / contract / infra), plus
// the read-only inspection the `amber learnings` command renders and the
// booking writer that records `learningWriteBack` on the feature entry.
// Amber detects, reminds, and books — it never writes knowledge docs itself.

const { resolveTarget } = require("./fs-utils");
const { splitCommaList } = require("./text-utils");
const { localIsoDate } = require("./text-utils");
const {
	LEARNING_OWNER_ROUTES,
	getLearningOwner,
	learningOwnerIdsText,
	renderLearningOwnerLines,
} = require("./learning-owner-routing");

// ── Trigger classification (pure path matching — no globs, no judgment) ──────

// Normalize one candidate path: accept Windows separators, drop a leading "./",
// lowercase for case-insensitive matching. Returns null for non-strings/blank.
function normalizePathForMatch(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed === "") return null;
	return trimmed.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

// A path "contains a segment" when one of its slash-separated parts equals
// `segment` (e.g. "schemas", "k8s"); `sequence` matches consecutive segments
// (e.g. ["docs", "specs"], [".github", "workflows"]).
function segmentsOf(normalized) {
	return normalized.split("/").filter(Boolean);
}

function hasSegment(segments, segment) {
	return segments.includes(segment);
}

function hasSegmentSequence(segments, sequence) {
	if (sequence.length === 0 || segments.length < sequence.length) return false;
	for (let i = 0; i + sequence.length <= segments.length; i += 1) {
		let matched = true;
		for (let j = 0; j < sequence.length; j += 1) {
			if (segments[i + j] !== sequence[j]) {
				matched = false;
				break;
			}
		}
		if (matched) return true;
	}
	return false;
}

function basenameOf(normalized) {
	const segments = segmentsOf(normalized);
	return segments.length > 0 ? segments[segments.length - 1] : "";
}

const CONTRACT_DOC_SURFACE =
	"a contract doc under docs/specs/ (or an ADR under docs/adr/ when the learning is a design decision)";

// Each category is deterministic over the normalized path: suffix, segment, or
// segment-sequence containment plus basename prefixes — no glob dependency.
const TRIGGER_CATEGORIES = [
	{
		id: "schema",
		matchedBy: "paths ending .schema.json, or any schemas/ or migrations/ path segment",
		suggestedSurfaces: CONTRACT_DOC_SURFACE,
		matches: (normalized, segments) =>
			normalized.endsWith(".schema.json") ||
			hasSegment(segments, "schemas") ||
			hasSegment(segments, "migrations"),
	},
	{
		id: "contract",
		matchedBy:
			"paths containing a docs/specs/ or docs/contracts/ segment sequence, or a basename starting with openapi/swagger",
		suggestedSurfaces: CONTRACT_DOC_SURFACE,
		matches: (normalized, segments, basename) =>
			hasSegmentSequence(segments, ["docs", "specs"]) ||
			hasSegmentSequence(segments, ["docs", "contracts"]) ||
			basename.startsWith("openapi") ||
			basename.startsWith("swagger"),
	},
	{
		id: "infra",
		matchedBy:
			"paths containing .github/workflows/, k8s/, or infra/ segments, or a basename starting with Dockerfile/docker-compose",
		suggestedSurfaces: "a docs/specs/ contract doc or the wiki runbook under docs/wiki/",
		matches: (normalized, segments, basename) =>
			hasSegmentSequence(segments, [".github", "workflows"]) ||
			hasSegment(segments, "k8s") ||
			hasSegment(segments, "infra") ||
			basename.startsWith("dockerfile") ||
			basename.startsWith("docker-compose"),
	},
];

function categoryById(id) {
	return TRIGGER_CATEGORIES.find((c) => c.id === id) || null;
}

// Classify booked paths into trigger categories. Only categories with at least
// one match appear; non-string/blank entries are ignored, never thrown on.
function detectWriteBackTriggers(paths) {
	const candidates = (Array.isArray(paths) ? paths : [paths])
		.map((p) => (typeof p === "string" ? p.trim() : null))
		.filter((p) => p !== null && p !== "");
	const triggered = [];
	for (const category of TRIGGER_CATEGORIES) {
		const matches = candidates.filter((candidate) => {
			const normalized = normalizePathForMatch(candidate);
			if (!normalized) return false;
			return category.matches(normalized, segmentsOf(normalized), basenameOf(normalized));
		});
		if (matches.length > 0) {
			triggered.push({ category: category.id, matches });
		}
	}
	return { triggered, matchedCategories: triggered.map((t) => t.category) };
}

// The classification rule rendered as guidance: what kind of knowledge goes to
// which Amber surface. Wording is original (F023).
function learningWriteBackGuidance() {
	return [
		'Executable "how to write it" content — signatures, contracts, error behavior — belongs in a docs/specs/ contract doc.',
		'"What to consider" content — checklists, questions, conventions — belongs in docs/wiki/ notes.',
		"Design decisions with lasting trade-offs belong in docs/adr/.",
	];
}

// ── Inspection (strictly read-only) ─────────────────────────────────────────

function ownerFields(learningWriteBack) {
	const reviewed = learningWriteBack && learningWriteBack.reviewed === true;
	const hasOwner =
		learningWriteBack && Object.prototype.hasOwnProperty.call(learningWriteBack, "owner");
	const owner =
		hasOwner && typeof learningWriteBack.owner === "string" ? learningWriteBack.owner : null;
	const ownerRoute = owner ? getLearningOwner(owner) : null;
	const ownerStatus = !reviewed
		? "unbooked"
		: !hasOwner
			? "legacy"
			: ownerRoute
				? "assigned"
				: "invalid";
	return {
		ownerCatalog: LEARNING_OWNER_ROUTES,
		owner,
		ownerRoute,
		ownerStatus,
		ownerDecisionQuestion: ownerRoute ? ownerRoute.decisionQuestion : null,
		ownerResponsibility: ownerRoute ? ownerRoute.responsibility : null,
	};
}

function renderOwnerRouting(learningWriteBack) {
	const details = ownerFields(learningWriteBack);
	const lines = ["Durable owner catalog:", ...renderLearningOwnerLines("  ")];
	if (details.ownerStatus === "legacy") {
		lines.push(
			"Current owner: legacy ownerless booking (reviewed and complete; no migration required).",
		);
	} else if (details.owner) {
		lines.push(`Current owner: ${details.owner}`);
		if (details.ownerRoute) {
			lines.push(`  Decision question: ${details.ownerRoute.decisionQuestion}`);
			lines.push(`  Responsibility: ${details.ownerRoute.responsibility}`);
		} else {
			lines.push("  Owner is not a recognized canonical route.");
		}
	} else {
		lines.push("Current owner: (not assigned)");
	}
	return lines;
}

function renderInspectionText(featureId, accepted, triggered, guidance, learningWriteBack) {
	const lines = [];
	const details = ownerFields(learningWriteBack);
	const reviewBooked = learningWriteBack && learningWriteBack.reviewed === true;
	const hasMandatoryTriggers = triggered.length > 0;
	if (accepted) {
		let bookingState = "no mandatory review owed";
		if (hasMandatoryTriggers) {
			bookingState = reviewBooked ? "review booked" : "review NOT booked";
		} else if (reviewBooked) {
			bookingState = "no mandatory review owed; review booked";
		}
		lines.push(`Feature ${featureId} — accepted (${bookingState}).`);
	} else {
		lines.push(`Feature ${featureId} — not accepted yet (checkpoint applies after accept).`);
	}
	if (triggered.length === 0) {
		lines.push("No mandatory write-back triggers matched the feature's booked paths.");
	} else {
		for (const entry of triggered) {
			const category = categoryById(entry.category);
			lines.push(`Trigger ${entry.category} — matched path(s):`);
			for (const match of entry.matches) lines.push(`  - ${match}`);
			if (category) lines.push(`  Suggested surface: ${category.suggestedSurfaces}.`);
		}
	}
	lines.push("Guidance:");
	for (const line of guidance) lines.push(`  - ${line}`);
	lines.push(...renderOwnerRouting(learningWriteBack));
	if (reviewBooked) {
		const surfaces = Array.isArray(learningWriteBack.surfaces) ? learningWriteBack.surfaces : [];
		lines.push(
			`Review booked ${learningWriteBack.date || "(no date)"} (surfaces: ${surfaces.join(", ") || "none"})`,
		);
		if (details.ownerStatus === "legacy") {
			lines.push("Owner status: legacy ownerless booking; lifecycle completion remains unchanged.");
		} else if (details.ownerRoute) {
			lines.push(`Owner: ${details.ownerRoute.id}`);
			lines.push(`Owner decision question: ${details.ownerRoute.decisionQuestion}`);
			lines.push(`Owner responsibility: ${details.ownerRoute.responsibility}`);
		}
	}
	if (!hasMandatoryTriggers) {
		lines.push("No mandatory review is owed. Judgment-based write-back remains optional.");
	} else if (!reviewBooked) {
		lines.push(
			`Review NOT booked — run: amber learnings --feature ${featureId} --reviewed --owner <id> [--surface <path>]`,
		);
	}
	return lines.join("\n");
}

/**
 * Read-only inspection of one feature's post-accept learning write-back state.
 *
 * Resolves the feature the way `amber next` does: an explicit featureId wins;
 * otherwise the lifecycle focus is used (feature focus only). Returns a result
 * envelope whose `text` names the feature, its accept/booking state, every
 * triggered category with its matching paths and suggested surfaces, the
 * classification guidance, and the booking state. A missing feature is visible
 * text, not an error. Writes nothing.
 */
function inspectLearningWriteBack(targetRoot, { featureId } = {}) {
	const root = resolveTarget(targetRoot);
	const { buildContext, planFor, acceptLogged } = require("./lifecycle");
	const ctx = buildContext(root, featureId ? { feature: featureId } : {});
	const resolvedId = featureId || (ctx.focus.type === "feature" ? ctx.focus.id : null);

	if (!resolvedId) {
		return {
			target: root,
			featureId: null,
			featureFound: false,
			status: "no-focus",
			paths: [],
			triggered: [],
			matchedCategories: [],
			guidance: learningWriteBackGuidance(),
			learningWriteBack: null,
			...ownerFields(null),
			text: [
				"No feature in focus — pass --feature <id> to inspect a specific feature's learning write-back triggers.",
				...renderOwnerRouting(null),
			].join("\n"),
			errors: [],
			warnings: [],
		};
	}

	const feature = ctx.state.features.find((f) => f && f.id === resolvedId);
	if (!feature) {
		return {
			target: root,
			featureId: resolvedId,
			featureFound: false,
			status: "not-found",
			paths: [],
			triggered: [],
			matchedCategories: [],
			guidance: learningWriteBackGuidance(),
			learningWriteBack: null,
			...ownerFields(null),
			text: [
				`Feature ${resolvedId} was not found in feature_list.json — nothing to inspect.`,
				...renderOwnerRouting(null),
			].join("\n"),
			errors: [],
			warnings: [],
		};
	}

	const paths = Array.isArray(feature.paths) ? feature.paths.filter(Boolean) : [];
	const detection = detectWriteBackTriggers(paths);
	const guidance = learningWriteBackGuidance();
	const learningWriteBack =
		feature.learningWriteBack && typeof feature.learningWriteBack === "object"
			? feature.learningWriteBack
			: null;
	const plan = planFor(ctx);
	const accepted = Boolean(plan && acceptLogged(ctx));

	let status;
	if (!accepted) {
		status = "not-accepted";
	} else if (detection.matchedCategories.length === 0) {
		status = "no-triggers";
	} else if (learningWriteBack && learningWriteBack.reviewed === true) {
		status = "reviewed";
	} else {
		status = "unreviewed";
	}

	return {
		target: root,
		featureId: resolvedId,
		featureFound: true,
		status,
		paths,
		triggered: detection.triggered,
		matchedCategories: detection.matchedCategories,
		guidance,
		learningWriteBack,
		...ownerFields(learningWriteBack),
		text: renderInspectionText(
			resolvedId,
			accepted,
			detection.triggered,
			guidance,
			learningWriteBack,
		),
		errors: [],
		warnings: [],
	};
}

// ── Booking (the only write; touches feature_list.json alone) ───────────────

function normalizeSurfaces(surfaces) {
	return splitCommaList(surfaces);
}

/**
 * Book the learning review on a named feature: sets
 * `learningWriteBack = { reviewed: true, date, surfaces }` via the shared
 * loadFeatures/saveFeatures path. featureId is REQUIRED — an auto-resolved
 * feature is never booked, so the wrong entry cannot be written. Re-booking
 * overwrites date/surfaces and still succeeds.
 */
function validateBookingOwner(owner, owners) {
	const occurrences =
		Array.isArray(owners) && owners.length > 0 ? owners : owner === undefined ? [] : [owner];
	if (occurrences.length !== 1) {
		return {
			error: `learnings --reviewed requires exactly one explicit --owner <id>; repeated --owner flags are not allowed. Valid ids: ${learningOwnerIdsText()}.`,
		};
	}

	const selected = occurrences[0];
	if (typeof selected !== "string" || selected.trim() === "") {
		return {
			error: `learnings --reviewed requires exactly one explicit --owner <id>. Valid ids: ${learningOwnerIdsText()}.`,
		};
	}
	const normalized = selected.trim();
	if (normalized.includes(",")) {
		return {
			error: `comma-separated values are not allowed for learning owners; pass exactly one --owner <id>. Valid ids: ${learningOwnerIdsText()}.`,
		};
	}
	if (!getLearningOwner(normalized)) {
		return {
			error: `Unknown learning owner '${normalized}'. Valid owner ids: ${learningOwnerIdsText()}.`,
		};
	}
	return { owner: normalized };
}

function bookLearningWriteBack(target, { featureId, surfaces, owner, owners } = {}) {
	const targetRoot = resolveTarget(target);
	if (!featureId) {
		return {
			target: targetRoot,
			text: "",
			errors: [
				"learnings --reviewed requires --feature <feature-id> — Amber never books an auto-resolved feature.",
			],
			warnings: [],
		};
	}

	// Validate all booking-shaped input before loading feature state. A bad
	// owner must be a visible no-write error, even when the target is malformed.
	const ownerResult = validateBookingOwner(owner, owners);
	if (ownerResult.error) {
		return {
			target: targetRoot,
			text: "",
			errors: [ownerResult.error],
			warnings: [],
		};
	}

	const { loadFeatures, saveFeatures } = require("../feature-commands");
	const data = loadFeatures(targetRoot);
	if (data._corrupt) {
		return {
			target: targetRoot,
			text: "",
			errors: ["feature_list.json is missing or corrupt. Run `amber init` first."],
			warnings: [],
		};
	}

	const feature = data.features.find((f) => f && f.id === featureId);
	if (!feature) {
		return {
			target: targetRoot,
			text: "",
			errors: [`Feature ${featureId} was not found in feature_list.json.`],
			warnings: [],
		};
	}

	const previouslyReviewed = Boolean(
		feature.learningWriteBack && feature.learningWriteBack.reviewed === true,
	);
	const bookedSurfaces = normalizeSurfaces(surfaces);
	feature.learningWriteBack = {
		reviewed: true,
		date: localIsoDate(),
		surfaces: bookedSurfaces,
		owner: ownerResult.owner,
	};
	saveFeatures(data);

	const surfaceText = bookedSurfaces.length > 0 ? bookedSurfaces.join(", ") : "none named";
	return {
		target: targetRoot,
		text: [
			`Learning review booked for feature: ${featureId}`,
			`  Date: ${feature.learningWriteBack.date}`,
			`  Owner: ${feature.learningWriteBack.owner}`,
			`  Surfaces: ${surfaceText}`,
			previouslyReviewed ? "  (previous booking overwritten)" : "",
		]
			.filter((line) => line !== "")
			.join("\n"),
		errors: [],
		warnings: [],
	};
}

module.exports = {
	TRIGGER_CATEGORIES,
	detectWriteBackTriggers,
	learningWriteBackGuidance,
	inspectLearningWriteBack,
	bookLearningWriteBack,
	validateBookingOwner,
};
