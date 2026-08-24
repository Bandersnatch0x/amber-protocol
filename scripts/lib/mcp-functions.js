"use strict";

// Deep, fixed Function runtime. Function files are declarative metadata only;
// executable handlers live here and can read solely through guarded helpers.

const fs = require("node:fs");
const path = require("node:path");
const { resolveConfiguredRepoPath } = require("./mcp-targets");
const { readSessionSummary } = require("./session-manifest");
const { statePath } = require("./state-dir-resolver");

// Repo-relative state-dir path for a configured target. The Function runtime
// speaks repository-relative paths (the reader confines them to the target),
// so the read policy is projected back to relative form: legacy .harness state
// stays visible to MCP reads.
function stateDirRelative(target, ...segments) {
	return path.relative(target, statePath(target, ...segments));
}

function createReader(configured, primary) {
	const resolve = (relativePath, target = primary, mustExist = true) =>
		resolveConfiguredRepoPath({ configured, target, relativePath, mustExist });
	return {
		targets: [primary, ...configured.targets.filter((target) => target !== primary)],
		exists(relativePath, target) {
			try {
				resolve(relativePath, target);
				return true;
			} catch (error) {
				if (error.code === "ENOENT") return false;
				throw error;
			}
		},
		list(relativePath, target) {
			return fs.readdirSync(resolve(relativePath, target));
		},
		isDirectory(relativePath, target) {
			return fs.statSync(resolve(relativePath, target)).isDirectory();
		},
		mtime(relativePath, target) {
			return fs.statSync(resolve(relativePath, target)).mtimeMs;
		},
		readJson(relativePath, target) {
			return JSON.parse(fs.readFileSync(resolve(relativePath, target), "utf8"));
		},
		countNonEmptyLines(relativePath, target) {
			try {
				return fs
					.readFileSync(resolve(relativePath, target), "utf8")
					.split("\n")
					.filter((line) => line.trim()).length;
			} catch (error) {
				if (error.code === "ENOENT") return 0;
				throw error;
			}
		},
	};
}

function sessionSummary(reader, sessionId) {
	const base = path.join(stateDirRelative(reader.targets[0], "sessions"), sessionId);
	const manifest = reader.readJson(path.join(base, "manifest.json"));
	const projected = readSessionSummary(manifest, sessionId);
	return {
		...projected,
		timelineEvents: reader.countNonEmptyLines(path.join(base, "timeline.jsonl")),
		ledgerLines: reader.countNonEmptyLines(path.join(base, "ledger.jsonl")),
	};
}

function sessionEvidence(params, reader) {
	const sessions = stateDirRelative(reader.targets[0], "sessions");
	if (!reader.exists(sessions)) return { sessions: [] };
	let ids = reader.list(sessions).filter((id) => reader.isDirectory(path.join(sessions, id)));
	if (params.sessionId) {
		if (!ids.includes(params.sessionId)) throw new Error(`session not found: ${params.sessionId}`);
		ids = [params.sessionId];
	} else {
		// ponytail: only the newest session is returned, so take the max in one
		// pass. sort() asks for mtime O(n log n) times and every call is a fresh
		// resolve + statSync; at 10k sessions that dominated the whole request.
		let newest = null;
		let newestMtime = -Infinity;
		for (const id of ids) {
			const mtime = reader.mtime(path.join(sessions, id));
			// deterministic tiebreak on equal mtimes: lexicographically smaller id
			// wins, so the same-ms class cannot flip the newest session between runs
			if (mtime > newestMtime || (mtime === newestMtime && newest !== null && id < newest)) {
				newestMtime = mtime;
				newest = id;
			}
		}
		ids = newest === null ? [] : [newest];
	}
	return { sessions: ids.map((id) => sessionSummary(reader, id)) };
}

function repoSnapshot(reader, target) {
	const sessionsPath = stateDirRelative(target, "sessions");
	let sessions = [];
	if (reader.exists(sessionsPath, target)) {
		sessions = reader
			.list(sessionsPath, target)
			.filter((id) => reader.isDirectory(path.join(sessionsPath, id), target))
			.map((id) => {
				const manifest = reader.readJson(path.join(sessionsPath, id, "manifest.json"), target);
				return readSessionSummary(manifest, id);
			});
	}
	const routesPath = "routes";
	const routes = reader.exists(routesPath, target)
		? reader
				.list(routesPath, target)
				.filter((file) => file.endsWith(".route.json"))
				.map((file) => file.replace(/\.route\.json$/, ""))
		: [];
	return {
		target,
		hasAmberState: reader.exists(stateDirRelative(target), target),
		sessionCount: sessions.length,
		activeSessions: sessions.filter((session) => session.active),
		routes,
	};
}

function repoOverview(_params, reader) {
	const repos = reader.targets.map((target) => repoSnapshot(reader, target));
	return {
		repoCount: repos.length,
		repos,
		totalSessions: repos.reduce((sum, repo) => sum + repo.sessionCount, 0),
		totalActive: repos.reduce((sum, repo) => sum + repo.activeSessions.length, 0),
	};
}

const HANDLERS = new Map([
	["amber.fn.repoOverview", repoOverview],
	["amber.fn.sessionEvidence", sessionEvidence],
]);

function createFunctionRuntime({ configured, definitions }) {
	const names = new Set(definitions.map((definition) => definition.name));
	const missing = [...names].filter((name) => !HANDLERS.has(name));
	const orphaned = [...HANDLERS.keys()].filter((name) => !names.has(name));
	if (missing.length || orphaned.length) {
		throw new Error(
			`function implementation parity failed: missing=[${missing.join(", ")}], orphaned=[${orphaned.join(", ")}]`,
		);
	}
	return {
		invoke(name, parameters, targetOverride) {
			const handler = HANDLERS.get(name);
			if (!handler || !names.has(name)) throw new Error(`unknown Function: ${name}`);
			const primary = targetOverride || configured.primary;
			return handler(parameters, createReader(configured, primary));
		},
	};
}

module.exports = { createFunctionRuntime };
