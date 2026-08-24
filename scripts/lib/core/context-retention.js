"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { resolvePathWithin } = require("./fs-utils");
const { projectionManifestPath, projectionStatus } = require("./context-projection");
const { statePath } = require("../state-dir-resolver");

const DEFAULT_OLDER_THAN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const CATEGORIES = ["requests", "payloads", "pages", "verification", "loadouts", "projections"];

function listFiles(root) {
	if (!fs.existsSync(root)) return [];
	const files = [];
	const walk = (dir) => {
		for (const name of fs.readdirSync(dir).sort()) {
			const fullPath = path.join(dir, name);
			const stat = fs.lstatSync(fullPath);
			if (stat.isSymbolicLink()) continue;
			if (stat.isDirectory()) walk(fullPath);
			else if (stat.isFile()) files.push(fullPath);
		}
	};
	walk(root);
	return files;
}

function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

function pageIdOf(category, value) {
	if (!value || typeof value !== "object") return null;
	if (category === "requests") return value.target && value.target.pageId;
	return value.pageId || null;
}

function supersedesOf(category, value) {
	if (!value || typeof value !== "object") return [];
	const supersedes =
		category === "requests" ? value.target && value.target.supersedes : value.supersedes;
	return Array.isArray(supersedes) ? supersedes : [];
}

function loadoutPageIds(value) {
	if (!value || !Array.isArray(value.references)) return [];
	return value.references.map((reference) => reference && reference.pageId).filter(Boolean);
}

function relativeArtifactPath(targetRoot, filePath) {
	return path.relative(targetRoot, filePath).split(path.sep).join("/");
}

function protectionFor(category, pageId, lineagePageIds) {
	if (category === "pages") return "accepted-page";
	if (["requests", "payloads", "verification"].includes(category) && lineagePageIds.has(pageId)) {
		return "lineage-evidence";
	}
	return null;
}

function reachableFor(category, value, pageId, acceptedPageIds, filePath, currentProjectionPath) {
	if (category === "pages") return true;
	if (["requests", "payloads", "verification"].includes(category)) {
		return Boolean(pageId && acceptedPageIds.has(pageId));
	}
	if (category === "loadouts") {
		return loadoutPageIds(value).some((id) => acceptedPageIds.has(id));
	}
	if (category === "projections") return filePath === currentProjectionPath;
	return false;
}

function retentionFailure(detail) {
	return { ok: false, code: "AMBER_E_CONTEXT_RETENTION_INVALID", detail };
}

function retentionReport(targetRoot, options = {}) {
	const olderThanDays = options.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
	if (!Number.isInteger(olderThanDays) || olderThanDays < 0) {
		return retentionFailure("olderThanDays must be a non-negative integer");
	}

	try {
		const contextRoot = resolvePathWithin(targetRoot, statePath(targetRoot, "context"), {
			label: "Context retention root",
		});
		const entries = CATEGORIES.flatMap((category) => {
			const categoryRoot = resolvePathWithin(contextRoot, category, {
				label: `Context retention ${category} root`,
			});
			return listFiles(categoryRoot).map((filePath) => ({
				category,
				filePath,
				value: readJson(filePath),
			}));
		});
		const acceptedPageIds = new Set(
			entries
				.filter((entry) => entry.category === "pages")
				.map((entry) => pageIdOf(entry.category, entry.value))
				.filter(Boolean),
		);
		const lineagePageIds = new Set();
		for (const entry of entries.filter((item) => ["pages", "requests"].includes(item.category))) {
			const pageId = pageIdOf(entry.category, entry.value);
			const supersedes = supersedesOf(entry.category, entry.value);
			if (supersedes.length > 0 && pageId) lineagePageIds.add(pageId);
			for (const supersededId of supersedes) lineagePageIds.add(supersededId);
		}
		let currentProjectionPath = null;
		try {
			if (projectionStatus(targetRoot).ok)
				currentProjectionPath = projectionManifestPath(targetRoot);
		} catch {
			currentProjectionPath = null;
		}

		const nowMs = options.now instanceof Date ? options.now.getTime() : Date.now();
		const artifacts = entries.map((entry) => {
			const stat = fs.statSync(entry.filePath);
			const ageDays = Math.max(0, Math.floor((nowMs - stat.mtimeMs) / DAY_MS));
			const pageId = pageIdOf(entry.category, entry.value);
			const lineageParticipation = Boolean(pageId && lineagePageIds.has(pageId));
			const protection = protectionFor(entry.category, pageId, lineagePageIds);
			const reachable = reachableFor(
				entry.category,
				entry.value,
				pageId,
				acceptedPageIds,
				entry.filePath,
				currentProjectionPath,
			);
			return {
				category: entry.category,
				path: relativeArtifactPath(targetRoot, entry.filePath),
				ageDays,
				reachable,
				lineageParticipation,
				eligible: ageDays >= olderThanDays && !reachable && !protection,
				protection,
			};
		});
		return {
			ok: true,
			report: {
				schemaVersion: "1.0.0",
				reportOnly: true,
				olderThanDays,
				artifacts,
				summary: {
					total: artifacts.length,
					eligible: artifacts.filter((artifact) => artifact.eligible).length,
					protected: artifacts.filter((artifact) => artifact.protection).length,
				},
			},
		};
	} catch (error) {
		return retentionFailure(error.message || String(error));
	}
}

module.exports = { CATEGORIES, DEFAULT_OLDER_THAN_DAYS, retentionReport };
