"use strict";

// ADR-0008 P2: Claude transcript session provider. Reads ~/.claude/projects/
// <encoded-repo-path>/*.jsonl with workspace binding:
//   1. Directory-level: only files under the encoded path for the target repo
//      (lossy: non-alnum → "-" can collide distinct paths — not sufficient alone).
//   2. Per-record binding: any line with a `cwd` that does not match
//      expectedRepoPath drops the whole transcript, AND at least one line must
//      positively match — a transcript with no cwd evidence at all is excluded
//      rather than trusted on the lossy directory name (fail-closed).
// Extracts normalized observation signals (tool calls, failures, timestamps)
// — never raw transcript text. Privacy by construction: text is not collected.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { redactDeep } = require("../../../core/redaction");

function encodeProjectPath(repoPath) {
	return repoPath.replace(/[^a-zA-Z0-9]/g, "-");
}

function resolveClaudeProjectsDir(claudeHome) {
	return path.join(claudeHome || os.homedir(), ".claude", "projects");
}

function repoTranscriptDir(repoPath, claudeHome) {
	return path.join(resolveClaudeProjectsDir(claudeHome), encodeProjectPath(repoPath));
}

/** Path equality for workspace binding (case-insensitive on Windows). */
function pathsEqual(a, b) {
	const na = path.resolve(a);
	const nb = path.resolve(b);
	if (process.platform === "win32") {
		return na.toLowerCase() === nb.toLowerCase();
	}
	return na === nb;
}

// Extract normalized signals from a single transcript JSONL file.
// Returns null if the file is unreadable, empty, or workspace-mismatched.
// Text blocks are never collected; string fields still pass through redactDeep
// so tool names / basenames cannot smuggle secret-shaped tokens.
function summarizeTranscript(filePath, expectedRepoPath, options = {}) {
	const redact = options.redact !== false;
	let content;
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}

	const expected = path.resolve(expectedRepoPath);
	let cwdBound = false;
	const turns = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let obj;
		try {
			obj = JSON.parse(trimmed);
		} catch {
			continue;
		}

		// Hard exclusion: any cwd that does not match the assessed target.
		if (typeof obj.cwd === "string" && obj.cwd.length > 0) {
			if (!pathsEqual(obj.cwd, expected)) {
				return null;
			}
			cwdBound = true;
		}

		const message = obj.message && typeof obj.message === "object" ? obj.message : {};
		const toolNames = [];
		const c = message.content;
		if (Array.isArray(c)) {
			for (const block of c) {
				if (!block || typeof block !== "object") continue;
				if (block.type === "tool_use" && typeof block.name === "string") {
					toolNames.push(block.name);
				}
				// Intentionally ignore text blocks — raw transcript never enters summary.
			}
		}
		turns.push({
			type:
				typeof obj.type === "string"
					? obj.type
					: typeof message.role === "string"
						? message.role
						: "unknown",
			tools: toolNames,
			timestamp: typeof obj.timestamp === "string" ? obj.timestamp : null,
		});
	}

	// Positive binding required: no line proved this transcript belongs to the
	// target — the lossy directory name alone is not sufficient evidence.
	if (turns.length === 0 || !cwdBound) return null;

	const timestamps = turns
		.map((t) => t.timestamp)
		.filter(Boolean)
		.sort();
	const allTools = turns.flatMap((t) => t.tools);
	const uniqueTools = [...new Set(allTools)];
	const durationMs =
		timestamps.length >= 2
			? new Date(timestamps[timestamps.length - 1]) - new Date(timestamps[0])
			: null;

	const summary = {
		// SessionObservation-compatible core + host transcript extras
		sessionId: path.basename(filePath, path.extname(filePath)),
		status: "claude-session",
		provider: "claude",
		goal: null,
		routeId: null,
		feature: null,
		stageTransitions: 0,
		validationFailures: 0,
		failures: 0,
		retries: 0,
		approvals: 0,
		denials: 0,
		durationMs: Number.isFinite(durationMs) ? durationMs : null,
		sourceFile: path.basename(filePath),
		turnCount: turns.length,
		firstTimestamp: timestamps[0] || null,
		lastTimestamp: timestamps[timestamps.length - 1] || null,
		toolCalls: allTools.length,
		uniqueTools,
		repoPath: expected,
	};
	return redact ? redactDeep(summary) : summary;
}

// ponytail: hard cap — newest N transcripts by mtime. A full-history scan grows
// unbounded with the developer's local ~/.claude cache (100MB+ observed); raise
// or make configurable only if longitudinal depth is ever needed.
const MAX_TRANSCRIPT_FILES = 20;

function collectClaudeObservations(targetRoot, options = {}) {
	const resolved = path.resolve(targetRoot);
	const dir = repoTranscriptDir(resolved, options.claudeHome);
	if (!fs.existsSync(dir)) {
		return { present: false, sessions: [], coverage: "unavailable" };
	}

	let files;
	try {
		files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".jsonl"));
	} catch {
		return { present: false, sessions: [], coverage: "unavailable" };
	}

	if (files.length === 0) {
		return { present: false, sessions: [], coverage: "unavailable" };
	}

	// Cap read volume BEFORE parsing: newest files by mtime. statSync failures
	// (dangling symlinks, races) skip the entry rather than crashing the pass.
	const withMtime = [];
	for (const f of files) {
		const full = path.join(dir, f);
		try {
			withMtime.push({ full, mtimeMs: fs.statSync(full).mtimeMs });
		} catch {
			continue;
		}
	}
	withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);

	const summaries = withMtime
		.slice(0, MAX_TRANSCRIPT_FILES)
		.map((e) => summarizeTranscript(e.full, resolved, options))
		.filter(Boolean)
		.sort((a, b) => (b.lastTimestamp || "").localeCompare(a.lastTimestamp || ""));

	if (summaries.length === 0) {
		return { present: false, sessions: [], coverage: "unavailable" };
	}

	return {
		present: true,
		sessions: summaries,
		coverage: "covered",
	};
}

module.exports = {
	encodeProjectPath,
	resolveClaudeProjectsDir,
	repoTranscriptDir,
	pathsEqual,
	summarizeTranscript,
	collectClaudeObservations,
	MAX_TRANSCRIPT_FILES,
};
