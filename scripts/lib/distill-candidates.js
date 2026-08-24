"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { statePath } = require("./state-dir-resolver");

const DEFAULT_THRESHOLD = 2;

const HEADING_PATTERN = /^#{1,3}\s+(.+)$/;
const LIST_ITEM_PATTERN = /^[-*]\s+(.+)$/;

// Marker words that flag a gate list item as a failure when a report has no
// explicit `## Findings` section to read from.
const SUSPECT_MARKERS = ["missing", "unconfirmed", "unknown", "risk", "FAIL"];

function extractMatches(content, pattern) {
	const matches = [];
	for (const line of content.split("\n")) {
		const match = line.match(pattern);
		if (match) {
			matches.push(match[1].trim());
		}
	}
	return matches;
}

const extractHeadings = (content) => extractMatches(content, HEADING_PATTERN);
const extractListItems = (content) => extractMatches(content, LIST_ITEM_PATTERN);

function isGateReport(content, filePath) {
	if (path.basename(filePath).toLowerCase().includes("gate")) {
		return true;
	}
	return content.includes("Gate decision");
}

function isNextActionsFile(_content, filePath) {
	return path.basename(filePath).toLowerCase().includes("next-actions");
}

// Findings listed under a `## Findings` section of a gate report.
function extractFindingsSection(content) {
	const findings = [];
	let inFindings = false;
	for (const line of content.split("\n")) {
		if (/^##\s+Findings/i.test(line)) {
			inFindings = true;
			continue;
		}
		if (inFindings && /^##\s+/.test(line)) {
			inFindings = false;
		}
		if (!inFindings) continue;
		const match = line.match(LIST_ITEM_PATTERN);
		if (match) {
			findings.push(match[1].trim());
		}
	}
	return findings;
}

// Fallback when there is no Findings section: list items mentioning a marker.
function extractSuspectListItems(content) {
	return extractListItems(content).filter((text) =>
		SUSPECT_MARKERS.some((marker) => text.includes(marker)),
	);
}

function extractGateFailures(content) {
	const fromSection = extractFindingsSection(content);
	return fromSection.length > 0 ? fromSection : extractSuspectListItems(content);
}

function walkMarkdownFiles(dirPath) {
	const files = [];
	if (!fs.existsSync(dirPath)) return files;

	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkMarkdownFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(entryPath);
		}
	}
	return files;
}

// Read each markdown file once, then run the filter and extractors against its
// content. Extractors and filters operate on the file content string so a file
// is never read more than once per source.
function collectFromDir(dirPath, extractors, filter = () => true) {
	const candidates = [];
	for (const filePath of walkMarkdownFiles(dirPath)) {
		const content = fs.readFileSync(filePath, "utf8");
		if (!filter(content, filePath)) continue;
		for (const extractor of extractors) {
			for (const text of extractor(content)) {
				candidates.push({ text, source: filePath });
			}
		}
	}
	return candidates;
}

function normalize(text) {
	return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function findDistillCandidates(projectRoot, options = {}) {
	const root = path.resolve(projectRoot || ".");
	const threshold = options.threshold || DEFAULT_THRESHOLD;

	const sources = [
		{
			dir: path.join(root, "docs", "superpowers", "plans"),
			extractors: [extractHeadings],
		},
		{
			dir: path.join(root, "docs", "reviews"),
			extractors: [extractHeadings, extractListItems],
		},
		{
			dir: path.join(root, "docs", "examples"),
			extractors: [extractListItems],
			filter: isNextActionsFile,
		},
		{
			dir: path.join(root, "docs", "examples"),
			extractors: [extractGateFailures],
			filter: isGateReport,
		},
		{
			// Read policy: maintenance proposals may predate the .harness→.amber
			// rename, so legacy .harness state must stay visible here.
			dir: statePath(root, "maintenance"),
			extractors: [extractHeadings, extractListItems],
		},
	];

	const candidates = [];
	for (const source of sources) {
		candidates.push(...collectFromDir(source.dir, source.extractors, source.filter));
	}

	const counts = new Map();
	const displayText = new Map();
	for (const candidate of candidates) {
		const key = normalize(candidate.text);
		counts.set(key, (counts.get(key) || 0) + 1);
		displayText.set(key, candidate.text);
	}

	const result = [];
	for (const [key, count] of counts) {
		if (count >= threshold) {
			result.push({
				text: displayText.get(key),
				count,
				normalized: key,
			});
		}
	}

	return result.sort((a, b) => b.count - a.count);
}

function writeDistillProposal(projectRoot, outputPath, options = {}) {
	const root = path.resolve(projectRoot || ".");
	const resolvedOutput = path.resolve(outputPath);
	const candidates = findDistillCandidates(root, options);

	fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });

	const lines = [
		"# Distill Proposals",
		"",
		"Repeated findings from plans, reviews, gate reports, adoption next-actions, and maintenance proposals.",
		"",
		"| Finding | Occurrences |",
		"| --- | --- |",
	];

	for (const candidate of candidates) {
		lines.push(`| ${candidate.text} | ${candidate.count} |`);
	}

	if (candidates.length === 0) {
		lines.push("| _No repeated findings above threshold_ | - |");
	}

	lines.push("");
	lines.push(
		"These candidates are review-only proposals. Promote a candidate to a workflow pack, standard, or wiki update through the normal review and acceptance flow.",
	);
	lines.push("");

	fs.writeFileSync(resolvedOutput, lines.join("\n"));

	return {
		outputPath: resolvedOutput,
		candidateCount: candidates.length,
		target: root,
	};
}

module.exports = { findDistillCandidates, writeDistillProposal };
