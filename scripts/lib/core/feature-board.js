"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolvePathWithin } = require("./fs-utils");
const { VALID_STATUSES } = require("./constants");
const { validateFeatureListData } = require("./validators");
const { validateManifest } = require("../session-manifest");

function readJsonWithin(root, relative) {
	const file = resolvePathWithin(root, relative, { canonicalExisting: true });
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}

function recordLines(values) {
	return values.map((value) => (typeof value === "string" ? value : JSON.stringify(value)));
}

function readFeatures(root) {
	try {
		const data = readJsonWithin(root, "feature_list.json");
		const validation = validateFeatureListData(data);
		if (validation.errors.length) throw new Error(validation.errors.join("; "));
		return {
			state: "ok",
			items: data.features.map(({ id, title, status, priority, notes, evidence }) => ({
				id,
				title,
				status,
				priority,
				notes: recordLines(notes),
				evidence: recordLines(evidence),
			})),
			errors: [],
		};
	} catch (error) {
		return { state: "error", items: [], errors: [errorText(error)] };
	}
}

function readBoardSession(sessionsDir, entry) {
	const manifest = readJsonWithin(sessionsDir, path.join(entry.name, "manifest.json"));
	const validation = validateManifest(manifest);
	if (!validation.valid) throw new Error(validation.errors.join("; "));
	if (manifest.sessionId !== entry.name)
		throw new Error("Session identity does not match directory");
	return {
		sessionId: manifest.sessionId,
		feature: manifest.feature ?? null,
		goal: manifest.goal,
		status: manifest.status,
		currentStage: manifest.currentStage ?? null,
	};
}

function readSessions(root) {
	let sessionsDir;
	let entries;
	try {
		sessionsDir = resolvePathWithin(root, ".amber/sessions", { canonicalExisting: true });
		entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
	} catch (error) {
		return { state: "error", items: [], errors: [errorText(error)] };
	}
	const items = [];
	const errors = [];
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		try {
			items.push(readBoardSession(sessionsDir, entry));
		} catch (error) {
			errors.push(`${entry.name}: ${errorText(error)}`);
		}
	}
	return { state: errors.length ? "partial" : "ok", items, errors };
}

/** 只读取固定来源，不创建目录、修复状态或推断执行结果。 */
function getFeatureBoard(targetRoot) {
	const root = path.resolve(targetRoot);
	return {
		generatedAt: new Date().toISOString(),
		statuses: Array.from(VALID_STATUSES),
		features: readFeatures(root),
		sessions: readSessions(root),
	};
}

module.exports = { getFeatureBoard };
