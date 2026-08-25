"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson, resolveTarget, writeJsonPrettier } = require("./core/fs-utils");
const { localIsoDate, splitCommaList } = require("./core/text-utils");
const { defineCommand } = require("./subcommand-dispatcher");

function getFeatureListPath(targetRoot) {
	return path.join(targetRoot, "feature_list.json");
}

function loadFeatures(targetRoot) {
	const filePath = getFeatureListPath(targetRoot);
	if (!fs.existsSync(filePath)) {
		return { features: [], _file: filePath };
	}
	try {
		const data = readJson(filePath);
		if (!data || !Array.isArray(data.features)) {
			return { features: [], _file: filePath, _corrupt: true };
		}
		return { ...data, _file: filePath };
	} catch {
		return { features: [], _file: filePath, _corrupt: true };
	}
}

function saveFeatures(data) {
	const { _file, _corrupt, ...rest } = data;
	// writeJsonPrettier emits the Prettier JSON format (tabs + fit-based
	// collapse), so a booking produces a one-field diff instead of a
	// whole-file reformat, and stays clean under format:check.
	writeJsonPrettier(_file, rest);
}

function addFeature(target, options) {
	const targetRoot = resolveTarget(target);
	const { id, title, priority, area, paths, behavior, verify } = options;

	if (!id) {
		return {
			target: targetRoot,
			errors: ["feature add requires --id <feature-id>."],
			warnings: [],
		};
	}
	if (!title) {
		return {
			target: targetRoot,
			errors: ["feature add requires --title <text>."],
			warnings: [],
		};
	}

	const data = loadFeatures(targetRoot);

	if (data._corrupt) {
		return {
			target: targetRoot,
			errors: ["feature_list.json is missing or corrupt. Run `amber init` first."],
			warnings: [],
		};
	}

	const existing = data.features.find((f) => f && f.id === id);
	if (existing) {
		return {
			target: targetRoot,
			errors: [`Feature ${id} already exists in feature_list.json.`],
			warnings: [],
		};
	}

	const behaviorText = typeof behavior === "string" ? behavior.trim() : "";
	const verifySteps = Array.isArray(verify)
		? verify.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
		: typeof verify === "string" && verify.trim() !== ""
			? verify
					.split(",")
					.map((v) => v.trim())
					.filter(Boolean)
			: [];

	const feature = {
		id,
		priority: priority ? parseInt(priority, 10) : data.features.length + 1,
		area: area || "",
		title,
		user_visible_behavior: behaviorText,
		status: "not_started",
		verification: verifySteps,
		evidence: [],
		notes: [],
	};
	// Accepts the single-string --paths value and the repeatable --path
	// accumulator alike (splitCommaList handles both shapes).
	const normalizedPaths = splitCommaList(paths);
	if (normalizedPaths.length > 0) feature.paths = normalizedPaths;

	data.features.push(feature);
	saveFeatures(data);

	const warnings = [];
	const missingHints = [];
	if (!feature.area) missingHints.push("--area <area>");
	if (!feature.user_visible_behavior) missingHints.push("--behavior <text>");
	if (feature.verification.length === 0) missingHints.push("--verify <step> (repeatable)");
	if (missingHints.length > 0) {
		warnings.push(
			`Feature ${id} is not doctor-valid yet. Run doctor with --target . once these fields are set via: ${missingHints.join(" ")}`,
		);
	}

	return {
		target: targetRoot,
		feature,
		errors: [],
		warnings,
	};
}

function listFeatures(target) {
	const targetRoot = resolveTarget(target);
	const data = loadFeatures(targetRoot);

	if (data._corrupt) {
		return {
			target: targetRoot,
			features: [],
			errors: ["feature_list.json is missing or corrupt. Run `amber init` first."],
			warnings: [],
		};
	}

	const features = data.features.filter(Boolean);
	return {
		target: targetRoot,
		features,
		errors: [],
		warnings: [],
	};
}

function removeFeature(target, options) {
	const targetRoot = resolveTarget(target);
	const { id } = options;

	if (!id) {
		return {
			target: targetRoot,
			errors: ["feature remove requires --id <feature-id>."],
			warnings: [],
		};
	}

	const data = loadFeatures(targetRoot);

	if (data._corrupt) {
		return {
			target: targetRoot,
			errors: ["feature_list.json is missing or corrupt. Run `amber init` first."],
			warnings: [],
		};
	}

	const idx = data.features.findIndex((f) => f && f.id === id);
	if (idx === -1) {
		return {
			target: targetRoot,
			errors: [`Feature ${id} was not found in feature_list.json.`],
			warnings: [],
		};
	}

	const removed = data.features[idx];
	data.features.splice(idx, 1);
	saveFeatures(data);

	return {
		target: targetRoot,
		removed,
		errors: [],
		warnings: [],
	};
}

function recordFeatureEvidence(target, options) {
	const targetRoot = resolveTarget(target);
	const { feature: featureId, command, result, notes, sessionId } = options;

	if (!featureId) {
		return {
			target: targetRoot,
			errors: ["feature verify requires --feature <feature-id>."],
			warnings: [],
		};
	}

	const data = loadFeatures(targetRoot);

	if (data._corrupt) {
		return {
			target: targetRoot,
			errors: ["feature_list.json is missing or corrupt. Run `amber init` first."],
			warnings: [],
		};
	}

	const feature = data.features.find((f) => f && f.id === featureId);
	if (!feature) {
		return {
			target: targetRoot,
			errors: [`Feature ${featureId} was not found in feature_list.json.`],
			warnings: [],
		};
	}

	const entry = {
		command: command || "",
		result: result || "",
		date: localIsoDate(),
		notes: notes || "",
		...(sessionId ? { sessionId } : {}),
	};

	if (!Array.isArray(feature.evidence)) {
		feature.evidence = [];
	}
	feature.evidence.push(entry);

	// Auto-transition to "passing" when evidence is recorded.
	if (feature.status === "not_started" || !feature.status) {
		feature.status = "passing";
	}

	saveFeatures(data);

	return {
		target: targetRoot,
		featureId,
		entry,
		errors: [],
		warnings: [],
	};
}

// Normalize --path values into a flat list: each value (repeatable flag or
// Comma-split and trim a string-or-string[] flag value (shared helper).
function normalizePaths(values) {
	return splitCommaList(values);
}

/**
 * Book paths onto a feature (F024, #121): append-only with exact-match dedupe,
 * so the F023 learnings trigger detection has its input without hand-edited
 * JSON. Without --path values this is a read-only inspection listing the
 * feature's current paths. Re-booking an already-present path is a visible
 * no-op, never an error.
 */
function recordFeaturePaths(target, options) {
	const targetRoot = resolveTarget(target);
	const { feature: featureId, paths } = options;

	if (!featureId) {
		return {
			target: targetRoot,
			errors: ["feature paths requires --feature <feature-id>."],
			warnings: [],
		};
	}

	const data = loadFeatures(targetRoot);

	if (data._corrupt) {
		return {
			target: targetRoot,
			errors: ["feature_list.json is missing or corrupt. Run `amber init` first."],
			warnings: [],
		};
	}

	const feature = data.features.find((f) => f && f.id === featureId);
	if (!feature) {
		return {
			target: targetRoot,
			errors: [`Feature ${featureId} was not found in feature_list.json.`],
			warnings: [],
		};
	}

	const requested = normalizePaths(paths);
	if (requested.length === 0) {
		return {
			target: targetRoot,
			featureId,
			inspection: true,
			added: [],
			duplicates: [],
			paths: Array.isArray(feature.paths) ? feature.paths.filter(Boolean) : [],
			errors: [],
			warnings: [],
		};
	}

	if (!Array.isArray(feature.paths)) {
		feature.paths = [];
	}
	const added = [];
	const duplicates = [];
	for (const p of requested) {
		if (feature.paths.includes(p)) {
			duplicates.push(p);
		} else {
			feature.paths.push(p);
			added.push(p);
		}
	}
	// Nothing new -> nothing written: an all-duplicates re-run leaves the file
	// byte-identical (idempotent by construction, not just by re-serialization).
	if (added.length > 0) {
		saveFeatures(data);
	}

	return {
		target: targetRoot,
		featureId,
		inspection: false,
		added,
		duplicates,
		paths: feature.paths,
		errors: [],
		warnings: [],
	};
}

function listFeatureEvidence(target, options) {
	const targetRoot = resolveTarget(target);
	const { feature: featureId } = options;

	if (!featureId) {
		return {
			target: targetRoot,
			errors: ["feature evidence requires --feature <feature-id>."],
			warnings: [],
		};
	}

	const data = loadFeatures(targetRoot);

	if (data._corrupt) {
		return {
			target: targetRoot,
			errors: ["feature_list.json is missing or corrupt. Run `amber init` first."],
			warnings: [],
		};
	}

	const feature = data.features.find((f) => f && f.id === featureId);
	if (!feature) {
		return {
			target: targetRoot,
			errors: [`Feature ${featureId} was not found in feature_list.json.`],
			warnings: [],
		};
	}

	return {
		target: targetRoot,
		featureId,
		feature,
		evidence: feature.evidence || [],
		errors: [],
		warnings: [],
	};
}

const FEATURE_ACTIONS = ["add", "list", "remove", "verify", "evidence", "paths"];

// Routing + unknown-action guidance live in the shared dispatcher; handlers
// map each action onto its structured fn. The structured fns stay exported for
// lifecycle/session callers that need machine-readable results.
const dispatch = defineCommand({
	command: "feature",
	actions: FEATURE_ACTIONS,
	handlers: {
		add: (args) =>
			addFeature(args.target, {
				id: args.id || args._?.[1],
				title: args.title || args._?.[2],
				priority: args.priority,
				area: args.area,
				paths: args.paths,
				behavior: args.behavior,
				verify: args.verify,
			}),
		list: (args) => listFeatures(args.target),
		remove: (args) => removeFeature(args.target, { id: args.id || args._?.[1] }),
		verify: (args) =>
			recordFeatureEvidence(args.target, {
				feature: args.feature || args._?.[1],
				command: args.command,
				result: args.result,
				notes: args.notes,
				sessionId: args.sessionId,
			}),
		evidence: (args) => listFeatureEvidence(args.target, { feature: args.feature || args._?.[1] }),
		paths: (args) =>
			recordFeaturePaths(args.target, {
				feature: args.feature || args._?.[1],
				paths: args.paths,
			}),
	},
});

/**
 * Presentation entry for the feature command family.
 * Owns arg-shaping + text rendering on top of the dispatcher's structured
 * results. Auto-transition lives in recordFeatureEvidence, not here.
 *
 * @returns {{ text: string, errors: string[], warnings: string[] }}
 */
function runFeatureAction(action, target, options = {}) {
	const opts = options || {};
	const structured = dispatch(action, { ...opts, target }).result;

	const errors = structured.errors || [];
	const warnings = structured.warnings || [];
	let text = "";

	if (action === "list") {
		const features = structured.features || [];
		if (features.length === 0) {
			text = "No features registered.";
		} else {
			const rows = features
				.map(
					(f) =>
						`  ${f.id} [${f.status || "not_started"}] ${f.title}${f.priority ? ` (P${f.priority})` : ""}`,
				)
				.join("\n");
			text = `Features:\n${rows}`;
		}
	} else if (action === "add") {
		if (structured.feature) {
			text = `Feature added: ${structured.feature.id} — ${structured.feature.title}`;
		}
	} else if (action === "remove") {
		if (structured.removed) {
			text = `Feature removed: ${structured.removed.id} — ${structured.removed.title}`;
		}
	} else if (action === "verify") {
		if (structured.entry) {
			text = [
				`Evidence recorded for feature: ${structured.featureId}`,
				`  Command: ${structured.entry.command}`,
				`  Result: ${structured.entry.result}`,
				`  Date: ${structured.entry.date}`,
			].join("\n");
		}
	} else if (action === "evidence") {
		const evidence = structured.evidence || [];
		if (evidence.length === 0) {
			text = `No evidence recorded for feature: ${structured.featureId}`;
		} else {
			const rows = evidence
				.map((e, i) => `  [${i + 1}] ${e.date} | ${e.command} → ${e.result}`)
				.join("\n");
			text = `Evidence for ${structured.featureId}:\n${rows}`;
		}
	} else if (action === "paths" && typeof structured.inspection === "boolean") {
		const paths = structured.paths || [];
		if (structured.inspection) {
			if (paths.length === 0) {
				text = `No paths booked for feature: ${structured.featureId}`;
			} else {
				const rows = paths.map((p) => `  - ${p}`).join("\n");
				text = `Paths for ${structured.featureId} (${paths.length}):\n${rows}`;
			}
		} else {
			const added = structured.added || [];
			const duplicates = structured.duplicates || [];
			const addedText =
				added.length > 0
					? `${added.join(", ")} (${added.length})`
					: "none — every requested path is already booked";
			text = [
				`Paths booked for feature: ${structured.featureId}`,
				`  Added: ${addedText}`,
				`  Skipped as duplicates: ${duplicates.length}`,
				`  Total booked paths: ${paths.length}`,
			].join("\n");
		}
	}

	return { text, errors, warnings };
}

module.exports = {
	addFeature,
	listFeatures,
	removeFeature,
	recordFeatureEvidence,
	listFeatureEvidence,
	recordFeaturePaths,
	loadFeatures,
	saveFeatures,
	runFeatureAction,
};
