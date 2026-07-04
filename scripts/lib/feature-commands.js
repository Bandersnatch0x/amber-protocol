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
	const { feature: featureId, command, result, notes } = options;

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

module.exports = {
	addFeature,
	listFeatures,
	removeFeature,
	recordFeatureEvidence,
	listFeatureEvidence,
	loadFeatures,
};
