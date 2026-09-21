"use strict";

// Amber Evolution finding collectors (F014-M2 extraction; evolution Slice 2).
//
// Shared by the legacy Maintenance surface (core/maintenance.js) and the
// focused Maintenance evidence facade (maintenance/internal/evidence.js).
// Extracted so the facade can consume the same collectors without a circular
// require back into core/maintenance.js.
//
// Legacy semantics are unchanged for block-free logs: count "Finding: <text>"
// occurrences in harness-evolution.md, sorted by count (desc) then text
// (asc); a finding is "significant" once it recurs
// (EVOLUTION_FINDING_MIN_COUNT). Returns [] when the file is absent.
//
// Structured findings (trusted-control evolution contract §3/§5): an
// `amber-finding` fenced JSON block carries one attributed observation —
// the findingAttribution block plus its V1–V3 inputs (evidenceReferences,
// expectedEffect, operations). Block interiors are DATA, never prose: the
// legacy counter skips them, and a block only becomes a structured finding
// when its shape validates (closed field set, valid attribution) and it
// carries no credential material. Old free text never gains fields it did
// not declare — unstructured observations stay legacy, never silently
// promoted as validated findings.

const path = require("node:path");

const { pathExists, readText } = require("./fs-utils");
const { attributionProblem } = require("./finding-attribution");
const { credentialLeakProblem } = require("./registry-ledger");

const EVOLUTION_FINDING_MIN_COUNT = 2;

const STRUCTURED_FINDING_OPEN = /^```amber-finding\s*$/;
const STRUCTURED_FINDING_CLOSE = /^```\s*$/;
const STRUCTURED_BLOCK_FIELDS = Object.freeze([
	"findingAttribution",
	"evidenceReferences",
	"expectedEffect",
	"operations",
]);

function evolutionLogPath(targetRoot) {
	return path.join(targetRoot, "docs", "wiki", "engineering", "harness-evolution.md");
}

/**
 * Read the evolution log and split it into the block-free line stream plus
 * the structured blocks. Lines inside a block are removed from the outside
 * stream so the legacy free-text counter never counts JSON data as prose;
 * the block bodies are returned verbatim for structured extraction.
 * @returns {{ outsideLines: string[], blocks: Array<{ index: number, body: string }> } | null}
 *   null when the log is absent.
 */
function parseEvolutionLog(targetRoot) {
	const filePath = evolutionLogPath(targetRoot);
	if (!pathExists(filePath)) {
		return null;
	}
	const outsideLines = [];
	const blocks = [];
	let current = null;
	for (const line of readText(filePath).split(/\r?\n/)) {
		if (current === null) {
			if (STRUCTURED_FINDING_OPEN.test(line)) {
				current = { index: blocks.length + 1, body: [] };
			} else {
				outsideLines.push(line);
			}
		} else if (STRUCTURED_FINDING_CLOSE.test(line)) {
			blocks.push({ index: current.index, body: current.body.join("\n") });
			current = null;
		} else {
			current.body.push(line);
		}
	}
	if (current !== null) {
		// An unterminated block is carried as a block with its accumulated
		// body; its inevitable parse/shape failure is reported as a problem.
		blocks.push({ index: current.index, body: current.body.join("\n") });
	}
	return { outsideLines, blocks };
}

function countLegacyFindings(lines) {
	const counts = new Map();
	for (const line of lines) {
		const match = line.match(/Finding:\s*(.+?)\s*$/);
		if (match) {
			const finding = match[1].trim();
			counts.set(finding, (counts.get(finding) || 0) + 1);
		}
	}
	return counts;
}

function countEvolutionFindings(targetRoot) {
	const parsed = parseEvolutionLog(targetRoot);
	if (parsed === null) {
		return [];
	}
	const counts = countLegacyFindings(parsed.outsideLines);
	return [...counts.entries()]
		.map(([finding, count]) => ({ finding, count }))
		.sort((left, right) => right.count - left.count || left.finding.localeCompare(right.finding));
}

// Findings that recur at least minCount times. The single filtering point for
// both lineage adapters and the CLI rollup, so the cutoff lives in one place.
function significantEvolutionFindings(targetRoot, minCount) {
	return countEvolutionFindings(targetRoot).filter((item) => item.count >= minCount);
}

function extractEvolutionFindings(targetRoot) {
	return significantEvolutionFindings(targetRoot, EVOLUTION_FINDING_MIN_COUNT);
}

// Deep credential scan over the whole block: any string anywhere in a
// structured block (failureMode, effect axes, reference paths) is external
// input and must never ride a record or an error.
function credentialProblemIn(value) {
	if (typeof value === "string") {
		return credentialLeakProblem(value, "structured finding block");
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			const problem = credentialProblemIn(item);
			if (problem !== null) return problem;
		}
		return null;
	}
	if (value !== null && typeof value === "object") {
		for (const key of Object.keys(value)) {
			const problem = credentialProblemIn(value[key]);
			if (problem !== null) return problem;
		}
		return null;
	}
	return null;
}

// Shape-validate one block body. The attribution block must validate here —
// a block without a valid attribution is not a structured finding. The
// V1–V3 inputs (evidenceReferences/expectedEffect/operations) ride as-is:
// their shapes are owned by the admission invariant (evolution-validity.js),
// so their absence or malformation becomes a governed validity rejection,
// never a parse error.
function structuredBlockProblem(body, index) {
	const label = `structured finding block #${index}`;
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		return `${label} is not valid JSON (parse failed)`;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return `${label} must be a JSON object carrying findingAttribution (plus evidenceReferences, expectedEffect, operations as needed)`;
	}
	const keys = Object.keys(parsed);
	if (keys.some((key) => !STRUCTURED_BLOCK_FIELDS.includes(key))) {
		return `${label} carries fields beyond the closed set (${STRUCTURED_BLOCK_FIELDS.join(", ")})`;
	}
	if (!Object.hasOwn(parsed, "findingAttribution")) {
		return `${label} is missing findingAttribution`;
	}
	const attribution = attributionProblem(parsed.findingAttribution);
	if (attribution !== null) {
		return `${label} is invalid: ${attribution}`;
	}
	const leak = credentialProblemIn(parsed);
	if (leak !== null) {
		return `${label} is refused: ${leak}`;
	}
	return null;
}

/**
 * Extract structured evolution findings from `amber-finding` blocks in the
 * evolution log. One entry per valid block; an entry's `count` is the total
 * recurrence of its failure-mode text (structured blocks plus legacy
 * "Finding:" lines outside blocks), so significance keeps the same threshold
 * and ordering discipline as the legacy lens.
 *
 * @param {string} targetRoot
 * @returns {{
 *   findings: Array<{
 *     finding: string,
 *     count: number,
 *     findingAttribution: object,
 *     evidenceReferences?: unknown,
 *     expectedEffect?: unknown,
 *     operations?: unknown,
 *   }>,
 *   problems: string[],
 * }}
 *   Problems are type-only (never echo rejected content) and are surfaced by
 *   the producer as inspection errors — a malformed or secret-bearing block
 *   is refused at the pre-admission boundary, never laundered as legacy.
 */
function extractStructuredFindings(targetRoot) {
	const parsed = parseEvolutionLog(targetRoot);
	if (parsed === null) {
		return { findings: [], problems: [] };
	}

	const legacyCounts = countLegacyFindings(parsed.outsideLines);
	const structuredTextCounts = new Map();
	const rawBlocks = [];
	const problems = [];
	for (const block of parsed.blocks) {
		const problem = structuredBlockProblem(block.body, block.index);
		if (problem !== null) {
			problems.push(problem);
			continue;
		}
		const parsedBody = JSON.parse(block.body);
		const text = parsedBody.findingAttribution.failureMode.trim();
		structuredTextCounts.set(text, (structuredTextCounts.get(text) || 0) + 1);
		rawBlocks.push(parsedBody);
	}

	const findings = rawBlocks.map((body) => {
		const text = body.findingAttribution.failureMode.trim();
		return {
			finding: body.findingAttribution.failureMode,
			count: (legacyCounts.get(text) || 0) + (structuredTextCounts.get(text) || 0),
			findingAttribution: body.findingAttribution,
			evidenceReferences: body.evidenceReferences,
			expectedEffect: body.expectedEffect,
			operations: body.operations,
		};
	});

	return { findings, problems };
}

module.exports = {
	EVOLUTION_FINDING_MIN_COUNT,
	countEvolutionFindings,
	extractEvolutionFindings,
	extractStructuredFindings,
	parseEvolutionLog,
	significantEvolutionFindings,
};
