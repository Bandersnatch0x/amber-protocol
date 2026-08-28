"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { createRequest } = require("./context-request");
const { ingestPayload } = require("./context-ingest");
const { verifyPages } = require("./context-verify");
const { readPage } = require("./context-store");
const { hashFile, sha256 } = require("./context-hash");
const { projectionStatus, rebuildProjection, projectionsDir } = require("./projection-registry");
const { resolvePathWithin } = require("./fs-utils");
const { typedError } = require("./error-catalog");

const MANIFEST_SCHEMA_VERSION = "1.0.0";
const PROJECTION_RULE_VERSION = 1;
const EXPECTED_COUNTS = Object.freeze({ adr: 24, wiki: 10, architecture: 9, total: 43 });
const SAMPLE_LIMIT = 6;

const ERROR_CODES = Object.freeze({
	manifest: "AMBER_E_KNOWLEDGE_GRAPH_SOURCE",
	projection: "AMBER_E_PROJECTION_DRIFT",
});

function toPosix(value) {
	return String(value).replace(/\\/g, "/");
}

function firstHeading(text) {
	const match = /^#\s+(.+)$/m.exec(text);
	return match ? match[1].trim() : null;
}

function titleFromWiki(text, fallback) {
	const front = /^---\n([\s\S]*?)\n---/.exec(text);
	return (
		(front && (/^title:\s*"?([^"\n]+)"?\s*$/m.exec(front[1]) || [])[1]?.trim()) ||
		firstHeading(text) ||
		fallback
	);
}

function readSource(targetRoot, sourcePath) {
	const full = resolvePathWithin(targetRoot, sourcePath, { label: "Knowledge manifest source" });
	const text = fs.readFileSync(full, "utf8");
	const hashes = hashFile(full);
	return { text, hashes };
}

function listAdrRows(targetRoot) {
	const dir = path.join(targetRoot, "docs", "adr");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.sort()
		.filter((name) => /^(\d{4})-.+\.md$/.test(name))
		.map((name) => {
			const number = name.slice(0, 4);
			const sourcePath = `docs/adr/${name}`;
			const { text, hashes } = readSource(targetRoot, sourcePath);
			return {
				id: `knowledge:adr:${number}`,
				category: "adr",
				sourceNodeId: `adr:${number}`,
				pageId: `knowledge-adr-${number}`,
				sourcePath,
				title: (firstHeading(text) || name).replace(/^ADR-\d+:\s*/, ""),
				source: { rawHash: hashes.rawHash, normHash: hashes.normHash },
			};
		});
}

function listWikiRows(targetRoot) {
	const dir = path.join(targetRoot, "docs", "wiki", "knowledge");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
		.filter((name) => fs.existsSync(path.join(dir, name, `${name}.md`)))
		.map((name) => {
			const sourcePath = `docs/wiki/knowledge/${name}/${name}.md`;
			const { text, hashes } = readSource(targetRoot, sourcePath);
			return {
				id: `knowledge:wiki:${name}`,
				category: "wiki",
				sourceNodeId: `wiki:${name}`,
				pageId: `knowledge-wiki-${name}`,
				sourcePath,
				title: titleFromWiki(text, name),
				source: { rawHash: hashes.rawHash, normHash: hashes.normHash },
			};
		});
}

function listArchitectureRows(targetRoot) {
	const dir = path.join(targetRoot, "docs", "architecture");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.sort()
		.filter((name) => name.endsWith(".md"))
		.map((name) => {
			const stem = name.slice(0, -3);
			const sourcePath = `docs/architecture/${name}`;
			const { text, hashes } = readSource(targetRoot, sourcePath);
			return {
				id: `knowledge:architecture:${stem}`,
				category: "architecture",
				sourceNodeId: `architecture:${stem}`,
				pageId: `knowledge-architecture-${stem}`,
				sourcePath,
				title: firstHeading(text) || stem,
				source: { rawHash: hashes.rawHash, normHash: hashes.normHash },
			};
		});
}

function censusErrors(rows) {
	const counts = {
		adr: rows.filter((row) => row.category === "adr").length,
		wiki: rows.filter((row) => row.category === "wiki").length,
		architecture: rows.filter((row) => row.category === "architecture").length,
	};
	counts.total = rows.length;
	const errors = [];
	for (const [kind, expected] of Object.entries(EXPECTED_COUNTS)) {
		if (counts[kind] !== expected)
			errors.push(`expected ${expected} ${kind} row(s), found ${counts[kind]}`);
	}
	for (const field of ["id", "sourceNodeId", "pageId", "sourcePath"]) {
		const values = rows.map((row) => row[field]);
		const duplicates = [
			...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
		];
		for (const value of duplicates) errors.push(`duplicate ${field}: ${value}`);
	}
	return { counts, errors };
}

function buildKnowledgeContextManifest(targetRoot) {
	const root = path.resolve(targetRoot || process.cwd());
	const rows = [...listAdrRows(root), ...listWikiRows(root), ...listArchitectureRows(root)].sort(
		(a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
	const { counts, errors } = censusErrors(rows);
	const manifest = {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		manifestId: "f059-knowledge-context-pages",
		expectedCounts: EXPECTED_COUNTS,
		counts,
		rows,
	};
	manifest.manifestHash = sha256(JSON.stringify(manifest));
	return { ok: errors.length === 0, manifest, errors };
}

function sourceObjectFromRequest(request) {
	const source = request.sources && request.sources[0];
	if (!source) throw new Error(`request ${request.requestId} has no source`);
	return { source };
}

function pagePayloadForRow(targetRoot, row, request) {
	const { text } = readSource(targetRoot, row.sourcePath);
	const { source } = sourceObjectFromRequest(request);
	return {
		schemaVersion: "1.2.0",
		pageId: row.pageId,
		title: row.title,
		knowledgeKind: row.category === "adr" ? "decision" : "pattern",
		sourceNodeId: row.sourceNodeId,
		sourceCategory: row.category,
		sources: { source },
		blocks: [{ type: "prose", sources: ["source"], text }],
		assurance: { confidence: "high", maturity: "reviewed" },
	};
}

function generatedPageMatchesRow(page, row, currentText = null) {
	if (!page || page.pageId !== row.pageId || page.sourceNodeId !== row.sourceNodeId) return false;
	const source = page.sources && page.sources.source;
	if (!source || source.ref !== row.sourcePath) return false;
	if (currentText === null) return true;
	return page.blocks && page.blocks.length === 1 && page.blocks[0].text === currentText;
}

function syncKnowledgeContextPages(targetRoot, { refresh = false } = {}) {
	const root = path.resolve(targetRoot || process.cwd());
	const manifestResult = buildKnowledgeContextManifest(root);
	if (!manifestResult.ok) {
		return {
			ok: false,
			code: ERROR_CODES.manifest,
			errors: manifestResult.errors,
			manifest: manifestResult.manifest,
		};
	}
	const actions = [];
	for (const row of manifestResult.manifest.rows) {
		const { text } = readSource(root, row.sourcePath);
		const existing = readPage(root, row.pageId);
		if (existing) {
			if (!generatedPageMatchesRow(existing, row)) {
				actions.push({
					rowId: row.id,
					pageId: row.pageId,
					outcome: "blocked",
					errors: [`existing page ${row.pageId} is not managed by ${row.sourceNodeId}`],
				});
				continue;
			}
			if (!refresh && generatedPageMatchesRow(existing, row, text)) {
				actions.push({ rowId: row.id, pageId: row.pageId, outcome: "unchanged" });
				continue;
			}
		}
		const requestResult = createRequest(root, {
			pageId: row.pageId,
			title: row.title,
			reason: "projection-unification",
			sources: [row.sourcePath],
			force: true,
			knowledgeKind: row.category === "adr" ? "decision" : "pattern",
		});
		if (requestResult.errors.length > 0) {
			actions.push({
				rowId: row.id,
				pageId: row.pageId,
				outcome: "request-rejected",
				errors: requestResult.errors,
			});
			continue;
		}
		const payload = pagePayloadForRow(root, row, requestResult.request);
		const ingest = ingestPayload(root, { requestId: requestResult.requestId, payload });
		actions.push({
			rowId: row.id,
			pageId: row.pageId,
			requestId: requestResult.requestId,
			outcome: ingest.accepted ? ingest.outcome : "ingest-rejected",
			errors: ingest.errors || [],
			findings: ingest.findings || [],
		});
	}
	const blocked = actions.filter((action) => action.errors && action.errors.length > 0);
	const verification = verifyPages(root);
	const projected = rebuildKnowledgeBaseProjection(root);
	return {
		ok: blocked.length === 0 && verification.ok && projected.ok,
		code: blocked.length > 0 ? ERROR_CODES.manifest : verification.code || projected.code || null,
		errors: [
			...blocked.flatMap((action) => action.errors),
			...(verification.ok ? [] : [`${verification.code}: ${verification.detail}`]),
			...projected.errors,
		],
		manifest: manifestResult.manifest,
		actions,
		verification,
		projection: projected.manifest,
	};
}

function contextPageText(page) {
	return (page.blocks || [])
		.filter((block) => block && block.type === "prose" && Array.isArray(block.sources))
		.map((block) => block.text || "")
		.join("\n\n");
}

function pageRowFromProjectionPage(page) {
	const source = page.sources && page.sources.source;
	if (!source || typeof source.ref !== "string") return null;
	if (typeof page.sourceNodeId !== "string") return null;
	const sourcePath = toPosix(source.ref).replace(/#L\d+(?:-L\d+)?$/, "");
	const category =
		page.sourceCategory ||
		(page.sourceNodeId.split(":")[0] === "adr" ? "adr" : page.sourceNodeId.split(":")[0]);
	return {
		id: `knowledge:${category}:${page.sourceNodeId.split(":").slice(1).join(":")}`,
		category,
		sourceNodeId: page.sourceNodeId,
		pageId: page.pageId,
		sourcePath,
		title: page.title,
		text: contextPageText(page),
	};
}

function knowledgeBaseProjectionOutputPath(targetRoot) {
	return path.join(projectionsDir(targetRoot), "knowledge-base.output.json");
}

function readKnowledgeBaseProjection(targetRoot) {
	const root = path.resolve(targetRoot || process.cwd());
	const status = projectionStatus(root, "knowledge-base");
	if (!status.ok) {
		throw typedError(
			status.code || ERROR_CODES.projection,
			`knowledge-base projection unavailable: ${status.detail}`,
		);
	}
	const outputPath = knowledgeBaseProjectionOutputPath(root);
	let output;
	try {
		output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
	} catch (error) {
		throw typedError(
			ERROR_CODES.projection,
			`knowledge-base projection output unreadable: ${error.message}`,
		);
	}
	const pages = Array.isArray(output.pages) ? output.pages : [];
	const rows = pages
		.map(pageRowFromProjectionPage)
		.filter(Boolean)
		.filter((row) => ["adr", "wiki", "architecture"].includes(row.category))
		.sort((a, b) =>
			a.sourceNodeId < b.sourceNodeId ? -1 : a.sourceNodeId > b.sourceNodeId ? 1 : 0,
		);
	const { errors } = censusErrors(rows);
	if (errors.length > 0) {
		throw typedError(
			ERROR_CODES.projection,
			`knowledge-base projection manifest mismatch: ${errors.join("; ")}`,
		);
	}
	return rows;
}

function rebuildKnowledgeBaseProjection(targetRoot) {
	return rebuildProjection(
		path.resolve(targetRoot || process.cwd()),
		"knowledge-base",
		(state) => ({
			projection: "knowledge-base",
			ruleVersion: PROJECTION_RULE_VERSION,
			canonicalPageCount: state.artifacts.length,
			pages: state.artifacts
				.map((page) => ({
					pageId: page.pageId,
					title: page.title || "",
					knowledgeKind: page.knowledgeKind || "unspecified",
					sourceNodeId: page.sourceNodeId || null,
					sourceCategory: page.sourceCategory || null,
					sources: page.sources || {},
					blocks: page.blocks || [],
				}))
				.sort((a, b) => (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0)),
		}),
		{ manifestFields: { projection_rule_versions: { knowledgeBase: PROJECTION_RULE_VERSION } } },
	);
}

function buildHumanReviewSample(targetRoot, { limit = SAMPLE_LIMIT } = {}) {
	const root = path.resolve(targetRoot || process.cwd());
	const manifestResult = buildKnowledgeContextManifest(root);
	if (!manifestResult.ok) return { ok: false, errors: manifestResult.errors, sample: null };
	const verification = verifyPages(root);
	const byPageId = new Map((verification.pages || []).map((page) => [page.pageId, page]));
	const rows = manifestResult.manifest.rows;
	const picks = [];
	for (const category of ["adr", "wiki", "architecture"]) {
		const categoryRows = rows.filter((row) => row.category === category);
		if (categoryRows.length > 0) picks.push(categoryRows[0]);
		if (categoryRows.length > 1) picks.push(categoryRows[categoryRows.length - 1]);
	}
	const selected = picks.slice(0, Math.max(0, limit));
	const sample = {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		manifestId: manifestResult.manifest.manifestId,
		manifestHash: manifestResult.manifest.manifestHash,
		counts: manifestResult.manifest.counts,
		verification: {
			ok: verification.ok,
			code: verification.code || null,
			detail: verification.detail,
			summary: verification.summary,
		},
		rows: selected.map((row) => {
			const { text } = readSource(root, row.sourcePath);
			const verdict = byPageId.get(row.pageId) || null;
			return {
				id: row.id,
				category: row.category,
				sourceNodeId: row.sourceNodeId,
				pageId: row.pageId,
				sourcePath: row.sourcePath,
				sourceHash: row.source.rawHash,
				verificationStatus: verdict ? verdict.status : "missing",
				verificationFindings: verdict ? verdict.findings : [],
				excerpt: text.trim().slice(0, 700),
			};
		}),
	};
	return {
		ok: verification.ok,
		errors: verification.ok ? [] : [`${verification.code}: ${verification.detail}`],
		sample,
	};
}

module.exports = {
	MANIFEST_SCHEMA_VERSION,
	PROJECTION_RULE_VERSION,
	EXPECTED_COUNTS,
	ERROR_CODES,
	buildKnowledgeContextManifest,
	syncKnowledgeContextPages,
	readKnowledgeBaseProjection,
	rebuildKnowledgeBaseProjection,
	buildHumanReviewSample,
};
