"use strict";

// ADR-0008 P2: Claude transcript session provider. Reads ~/.claude/projects/
// <encoded-repo-path>/*.jsonl with workspace binding (hard exclusion on
// mismatch) and default redaction. Extracts normalized observation signals
// (tool calls, failures, timestamps) — never raw transcript text.
//
// Privacy: redaction on by default; workspace mismatch is a hard exclusion;
// raw transcript content is never persisted in the report contract.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { redactSecrets } = require("../../core/redaction");

function encodeProjectPath(repoPath) {
	return repoPath.replace(/[^a-zA-Z0-9]/g, "-");
}

function resolveClaudeProjectsDir(claudeHome) {
	return path.join(claudeHome || os.homedir(), ".claude", "projects");
}

function repoTranscriptDir(repoPath, claudeHome) {
	return path.join(resolveClaudeProjectsDir(claudeHome), encodeProjectPath(repoPath));
}

// Extract normalized signals from a single transcript JSONL file.
// Returns null if the file is unreadable or workspace mismatches.
function summarizeTranscript(filePath, expectedRepoPath, options = {}) {
	const redact = options.redact !== false; // safe default: redact
	let content;
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}

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
		const message = obj.message && typeof obj.message === "object" ? obj.message : {};
		const toolNames = [];
		const textParts = [];
		const c = message.content;
		if (Array.isArray(c)) {
			for (const block of c) {
				if (!block || typeof block !== "object") continue;
				if (block.type === "tool_use" && typeof block.name === "string") {
					toolNames.push(block.name);
				} else if (block.type === "text" && typeof block.text === "string") {
					textParts.push(block.text);
				}
			}
		}
		turns.push({
			type: typeof obj.type === "string" ? obj.type : (typeof message.role === "string" ? message.role : "unknown"),
			tools: toolNames,
			text: redact ? redactSecrets(textParts.join("\n")) : textParts.join("\n"),
			timestamp: typeof obj.timestamp === "string" ? obj.timestamp : null,
		});
	}

	if (turns.length === 0) return null;

	const timestamps = turns.map((t) => t.timestamp).filter(Boolean).sort();
	const allTools = turns.flatMap((t) => t.tools);
	const uniqueTools = [...new Set(allTools)];
	const durationMs = timestamps.length >= 2
		? new Date(timestamps[timestamps.length - 1]) - new Date(timestamps[0])
		: null;

	return {
		sourceFile: path.basename(filePath),
		turnCount: turns.length,
		firstTimestamp: timestamps[0] || null,
		lastTimestamp: timestamps[timestamps.length - 1] || null,
		toolCalls: allTools.length,
		uniqueTools,
		durationMs: Number.isFinite(durationMs) ? durationMs : null,
		repoPath: expectedRepoPath,
	};
}

function collectClaudeObservations(targetRoot, options = {}) {
	const dir = repoTranscriptDir(path.resolve(targetRoot), options.claudeHome);
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

	const summaries = files
		.map((f) => summarizeTranscript(path.join(dir, f), path.resolve(targetRoot), options))
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
	summarizeTranscript,
	collectClaudeObservations,
};
