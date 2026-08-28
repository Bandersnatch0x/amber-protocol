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
// Intentional deliberate gate, single-sourced: the committed manifest under
// docs/knowledge-corpus/ is the census's one source of truth. Adding or removing any
// document in docs/adr/, docs/wiki/knowledge/, or docs/architecture/ requires a fresh
// `amber knowledge context-sync` run and committing the regenerated corpus — the
// conscious-admission act is reviewing that manifest diff. Reads fail closed, with the
// offending paths named, whenever the tree and the committed census disagree in either
// direction. No hardcoded counts: issues/0007 (ruling C) removed EXPECTED_COUNTS.
const SAMPLE_LIMIT = 6;
const RESYNC_REMEDY = "run `amber knowledge context-sync` and commit the regenerated corpus";

const ERROR_CODES = Object.freeze({
	manifest: "AMBER_E_KNOWLEDGE_MANIFEST_INVALID",
	projection: "AMBER_E_PROJECTION_DRIFT",
	staleSource: "AMBER_E_KNOWLEDGE_SOURCE_STALE",
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

function countsOf(rows) {
	const counts = {
		adr: rows.filter((row) => row.category === "adr").length,
		wiki: rows.filter((row) => row.category === "wiki").length,
		architecture: rows.filter((row) => row.category === "architecture").length,
	};
	counts.total = rows.length;
	return counts;
}

function duplicateErrors(rows) {
	const errors = [];
	for (const field of ["id", "sourceNodeId", "pageId", "sourcePath"]) {
		const values = rows.map((row) => row[field]);
		const duplicates = [
			...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
		];
		for (const value of duplicates) errors.push(`duplicate ${field}: ${value}`);
	}
	return errors;
}

// Bidirectional membership gate between the tree-derived census and the committed
// manifest: every disagreement is named, never summarized away.
function membershipErrors(derivedRows, committedRows) {
	const errors = [];
	const derivedByPath = new Map(derivedRows.map((row) => [row.sourcePath, row]));
	const committedByPath = new Map(committedRows.map((row) => [row.sourcePath, row]));
	const notAdmitted = [...derivedByPath.keys()].filter((p) => !committedByPath.has(p)).sort();
	const missingFromTree = [...committedByPath.keys()].filter((p) => !derivedByPath.has(p)).sort();
	if (notAdmitted.length > 0) {
		errors.push(
			`${notAdmitted.length} document(s) in the tree are not in the committed census: ${notAdmitted.join(", ")} — ${RESYNC_REMEDY}`,
		);
	}
	if (missingFromTree.length > 0) {
		errors.push(
			`committed census lists ${missingFromTree.length} document(s) missing from the tree: ${missingFromTree.join(", ")} — restore the file(s) or ${RESYNC_REMEDY}`,
		);
	}
	const derivedCounts = countsOf(derivedRows);
	const committedCounts = countsOf(committedRows);
	for (const kind of ["adr", "wiki", "architecture", "total"]) {
		if (derivedCounts[kind] !== committedCounts[kind]) {
			errors.push(
				`census count mismatch for ${kind}: tree has ${derivedCounts[kind]}, committed manifest has ${committedCounts[kind]}`,
			);
		}
	}
	return errors;
}

function buildKnowledgeContextManifest(targetRoot) {
	const root = path.resolve(targetRoot || process.cwd());
	const rows = [...listAdrRows(root), ...listWikiRows(root), ...listArchitectureRows(root)].sort(
		(a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
	const counts = countsOf(rows);
	const errors = duplicateErrors(rows);
	const manifest = {
		schemaVersion: MANIFEST_SCHEMA_VERSION,
		manifestId: "f059-knowledge-context-pages",
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
	const { text: rawText } = readSource(targetRoot, row.sourcePath);
	const text = rawText.replace(/\r\n/g, "\n");
	const { source } = sourceObjectFromRequest(request);
	return {
		schemaVersion: "1.2.0",
		pageId: row.pageId,
		title: row.title,
		knowledgeKind: row.category === "adr" ? "decision" : "pattern",
		sourceNodeId: row.sourceNodeId,
		sourceCategory: row.category,
		artifact_type: "knowledge-context-page",
		generatedBy: "context-sync",
		manifestId: "f059-knowledge-context-pages",
		sources: { source },
		blocks: [{ type: "prose", sources: ["source"], text }],
		assurance: { confidence: "high", maturity: "provisional" },
	};
}

function generatedPageMatchesRow(page, row, currentText = null) {
	if (!page || page.pageId !== row.pageId || page.sourceNodeId !== row.sourceNodeId) return false;
	const source = page.sources && page.sources.source;
	if (!source || source.ref !== row.sourcePath) return false;
	// When explicit ownership markers are present they must match the context-sync identity.
	// Pages without markers are treated as manageable (migration path for pre-ownership-field pages).
	if (page.generatedBy !== undefined && page.generatedBy !== "context-sync") return false;
	if (page.artifact_type !== undefined && page.artifact_type !== "knowledge-context-page")
		return false;
	if (page.manifestId !== undefined && page.manifestId !== "f059-knowledge-context-pages")
		return false;
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
	// Write committed corpus to docs/knowledge-corpus/ (tracked in git) so clean-archive reads
	// work without prior mutation to .amber/. Written only on a clean projection rebuild.
	if (projected.ok) {
		const corpusDir = committedCorpusDir(root);
		fs.mkdirSync(corpusDir, { recursive: true });
		fs.writeFileSync(
			committedManifestPath(root),
			`${JSON.stringify(manifestResult.manifest, null, 2)}\n`,
			"utf8",
		);
		// Copy the projection output to the tracked corpus directory.
		const amberOutputPath = path.join(projectionsDir(root), "knowledge-base.output.json");
		fs.copyFileSync(amberOutputPath, committedProjectionOutputPath(root));
	}
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
		.map((block) => (block.text || "").replace(/\r\n/g, "\n"))
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

// Committed knowledge corpus path: tracked in git at docs/knowledge-corpus/ so a clean archive
// (or CI clone) can run `amber knowledge graph` without any prior mutation to .amber/.
// context-sync writes here in addition to .amber/; the production reader reads exclusively here.
const COMMITTED_CORPUS_DIR = "docs/knowledge-corpus";

function committedCorpusDir(targetRoot) {
	return path.join(path.resolve(targetRoot || process.cwd()), COMMITTED_CORPUS_DIR);
}

function committedManifestPath(targetRoot) {
	return path.join(committedCorpusDir(targetRoot), "knowledge-context-manifest.json");
}

function committedProjectionOutputPath(targetRoot) {
	return path.join(committedCorpusDir(targetRoot), "knowledge-base.output.json");
}

function readKnowledgeBaseProjection(targetRoot) {
	const root = path.resolve(targetRoot || process.cwd());

	// Load committed manifest from the tracked docs/knowledge-corpus/ path.
	// This file is written by context-sync and committed to git, so it is available
	// in a clean archive without any prior mutation to .amber/.
	let committedManifest;
	try {
		committedManifest = JSON.parse(fs.readFileSync(committedManifestPath(root), "utf8"));
	} catch (err) {
		throw typedError(
			"AMBER_E_PROJECTION_MISSING",
			`knowledge-base committed manifest unavailable at ${COMMITTED_CORPUS_DIR}: ${err.message} — run \`amber knowledge context-sync --target <repo>\` to build and commit the corpus`,
		);
	}
	const manifestRowsByPageId = new Map(
		(committedManifest.rows || []).map((row) => [row.pageId, row]),
	);

	// Load committed projection output from the tracked docs/knowledge-corpus/ path.
	let output;
	try {
		output = JSON.parse(fs.readFileSync(committedProjectionOutputPath(root), "utf8"));
	} catch (err) {
		throw typedError(
			"AMBER_E_PROJECTION_MISSING",
			`knowledge-base committed projection output unavailable at ${COMMITTED_CORPUS_DIR}: ${err.message} — run \`amber knowledge context-sync --target <repo>\``,
		);
	}
	const pages = Array.isArray(output.pages) ? output.pages : [];

	// Filter to exact manifest members only (excludes unrelated categorized pages).
	const rows = pages
		.map(pageRowFromProjectionPage)
		.filter(Boolean)
		.filter((row) => manifestRowsByPageId.has(row.pageId))
		.sort((a, b) =>
			a.sourceNodeId < b.sourceNodeId ? -1 : a.sourceNodeId > b.sourceNodeId ? 1 : 0,
		);

	// Validate the census against its single source of truth: the committed manifest.
	// (1) duplicates, (2) the manifest's declared counts must match its own rows —
	// a tampered manifest cannot both drop a row and fix the numbers — and (3) the
	// tree-derived census must equal the committed membership in both directions.
	const errors = duplicateErrors(rows);
	const committedRows = committedManifest.rows || [];
	const declaredCounts = committedManifest.counts || {};
	const actualCommittedCounts = countsOf(committedRows);
	for (const kind of ["adr", "wiki", "architecture", "total"]) {
		if (declaredCounts[kind] !== actualCommittedCounts[kind]) {
			errors.push(
				`committed manifest declares ${declaredCounts[kind]} ${kind} row(s) but contains ${actualCommittedCounts[kind]}`,
			);
		}
	}
	const missingProjection = committedRows
		.filter((row) => !rows.some((r) => r.pageId === row.pageId))
		.map((row) => row.pageId)
		.sort();
	if (missingProjection.length > 0) {
		errors.push(
			`committed projection output is missing page(s) for: ${missingProjection.join(", ")} — ${RESYNC_REMEDY}`,
		);
	}
	const derivedRows = [...listAdrRows(root), ...listWikiRows(root), ...listArchitectureRows(root)];
	errors.push(...membershipErrors(derivedRows, committedRows));
	if (errors.length > 0) {
		throw typedError(
			ERROR_CODES.projection,
			`knowledge-base projection manifest mismatch: ${errors.join("; ")}`,
		);
	}

	// Verify mutable source freshness: current source hashes must match the manifest snapshot.
	// This prevents serving a graph that silently diverges from the current repository state.
	// Use normHash (whitespace-normalized) so CRLF/LF line-ending differences on Windows
	// do not produce false-positive stale detections between checkout and clean archive.
	const stalePages = [];
	for (const row of rows) {
		const manifestRow = manifestRowsByPageId.get(row.pageId);
		let currentNormHash;
		try {
			const full = resolvePathWithin(root, row.sourcePath, { label: "Knowledge manifest source" });
			currentNormHash = hashFile(full).normHash;
		} catch {
			stalePages.push(`${row.pageId} (source missing: ${row.sourcePath})`);
			continue;
		}
		if (currentNormHash !== manifestRow.source.normHash) {
			stalePages.push(`${row.pageId} (${row.sourcePath})`);
		}
	}
	if (stalePages.length > 0) {
		throw typedError(
			ERROR_CODES.staleSource,
			`knowledge-base managed sources are stale: ${stalePages.join(", ")} — run \`amber knowledge context-sync --target <repo>\``,
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
	COMMITTED_CORPUS_DIR,
	ERROR_CODES,
	membershipErrors,
	buildKnowledgeContextManifest,
	syncKnowledgeContextPages,
	readKnowledgeBaseProjection,
	rebuildKnowledgeBaseProjection,
	buildHumanReviewSample,
	committedManifestPath,
	committedProjectionOutputPath,
};
