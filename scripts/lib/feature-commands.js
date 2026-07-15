"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson, resolveTarget } = require("./core/fs-utils");

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
	fs.writeFileSync(_file, JSON.stringify(rest, null, 2) + "\n");
}

function addFeature(target, options) {
	const targetRoot = resolveTarget(target);
	const { id, title, priority, area, paths } = options;

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
			errors: [
				"feature_list.json is missing or corrupt. Run `amber init` first.",
			],
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

	const feature = {
		id,
		priority: priority ? parseInt(priority, 10) : data.features.length + 1,
		area: area || "",
		title,
		user_visible_behavior: "",
		status: "not_started",
		verification: [],
		evidence: [],
		notes: [],
	};
	if (typeof paths === "string" && paths.trim() !== "") {
		feature.paths = paths.split(",").map((p) => p.trim()).filter(Boolean);
	}

	data.features.push(feature);
	saveFeatures(data);

	return {
		target: targetRoot,
		feature,
		errors: [],
		warnings: [],
	};
}

function listFeatures(target) {
	const targetRoot = resolveTarget(target);
	const data = loadFeatures(targetRoot);

	if (data._corrupt) {
		return {
			target: targetRoot,
			features: [],
			errors: [
				"feature_list.json is missing or corrupt. Run `amber init` first.",
			],
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
			errors: [
				"feature_list.json is missing or corrupt. Run `amber init` first.",
			],
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
			errors: [
				"feature_list.json is missing or corrupt. Run `amber init` first.",
			],
			warnings: [],
		};
	}

	const feature = data.features.find((f) => f && f.id === featureId);
	if (!feature) {
		return {
			target: targetRoot,
			errors: [
				`Feature ${featureId} was not found in feature_list.json.`,
			],
			warnings: [],
		};
	}

	const entry = {
		command: command || "",
		result: result || "",
		date: new Date().toISOString().slice(0, 10),
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
			errors: [
				"feature_list.json is missing or corrupt. Run `amber init` first.",
			],
			warnings: [],
		};
	}

	const feature = data.features.find((f) => f && f.id === featureId);
	if (!feature) {
		return {
			target: targetRoot,
			errors: [
				`Feature ${featureId} was not found in feature_list.json.`,
			],
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

const FEATURE_ACTIONS = ["add", "list", "remove", "verify", "evidence"];

/**
 * Presentation entry for the feature command family.
 * Owns arg-shaping + text rendering; structured action fns stay exported for
 * lifecycle/session callers that need machine-readable results.
 * Auto-transition lives in recordFeatureEvidence, not here.
 *
 * @returns {{ text: string, errors: string[], warnings: string[] }}
 */
function runFeatureAction(action, target, options = {}) {
	const opts = options || {};
	let structured;

	if (action === "add") {
		structured = addFeature(target, {
			id: opts.id || opts._?.[1],
			title: opts.title || opts._?.[2],
			priority: opts.priority,
			area: opts.area,
			paths: opts.paths,
		});
	} else if (action === "list") {
		structured = listFeatures(target);
	} else if (action === "remove") {
		structured = removeFeature(target, {
			id: opts.id || opts._?.[1],
		});
	} else if (action === "verify") {
		structured = recordFeatureEvidence(target, {
			feature: opts.feature || opts._?.[1],
			command: opts.command,
			result: opts.result,
			notes: opts.notes,
			sessionId: opts.sessionId,
		});
	} else if (action === "evidence") {
		structured = listFeatureEvidence(target, {
			feature: opts.feature || opts._?.[1],
		});
	} else {
		const listed = FEATURE_ACTIONS.slice(0, -1).join(", ");
		const last = FEATURE_ACTIONS[FEATURE_ACTIONS.length - 1];
		return {
			text: "",
			errors: [`feature requires ${listed}, or ${last}.`],
			warnings: [],
		};
	}

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
				.map(
					(e, i) =>
						`  [${i + 1}] ${e.date} | ${e.command} → ${e.result}`,
				)
				.join("\n");
			text = `Evidence for ${structured.featureId}:\n${rows}`;
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
	loadFeatures,
	runFeatureAction,
};
