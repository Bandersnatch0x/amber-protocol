"use strict";

// F059 T1 (#247): deterministic knowledge-graph parser.
//
// The repository's knowledge corpus as a schema-validated graph, shared by
// the CLI (`amber knowledge graph`) and — in T2 — the web server, loaded
// in-process by both so the two surfaces never diverge.
//
// Three-layer ontology (docs/specs/F059-knowledge-decision-map.md):
//   decision        adr:*        docs/adr/*.md
//                   artifact:*   committed Canonical Artifacts at identity
//                                granularity (.amber/artifacts/, F049 read seam)
//   knowledge       wiki:*       docs/wiki/knowledge/<page>/<page>.md
//                   memory:*     MEMORY.md `##` sections
//                   architecture:* docs/architecture/*.md
//   implementation  feature:*    feature_list.json
//
// Exactly four edge verbs, directed declarer -> declared. The deterministic
// discovery rules (this module's contract — a pure function of the tree):
//   supersedes  ADR `**Supersedes...:**` header blocks (ADR-#### and
//               docs/architecture/<page>.md targets); artifact `supersedes`
//               Traces.
//   builds-on   ADR `**Builds on:**` header blocks; artifact `refines` /
//               `realizes` Traces.
//   references  knowledge-layer bodies naming ADR-#### or another knowledge
//               page by path; feature entries naming ADR-####; artifact
//               `decides` Traces.
//   describes   decision/knowledge bodies naming a registered feature id.
// `anchors` (a feature's declared paths) is a node property, never an edge.
//
// Drift: a dead-anchor finding (declared path absent from the tree) attaches
// to the declaring node, carrying the detected actual path on a rename
// (same directory, same extension, prefix-related stems) or a directory
// collapsed to a file. F001 (scaffolding.js -> scaffold.js) and F007
// (loops/ -> loops.js) are the standing real findings.
//
// Determinism: nodes sort by id, edges by (src, verb, dst), drift by
// (nodeId, path) — plain byte comparison, no locale. No timestamps beyond
// content-recorded dates, no absolute paths, no randomness: recomputation
// over an unchanged tree is byte-identical. Every node and edge carries
// provenance ("deterministic" here; "inferred" is reserved for the
// read-time LLM layer, which never enters this stream).
//
// Read-only: no target writes of any kind. The built graph is validated
// against schemas/knowledge-graph.schema.json before it is returned; an
// invalid graph fails closed with the typed local error vocabulary below.

const fs = require("node:fs");
const path = require("node:path");

const { compileSchema, formatErrors } = require("./schema-contract");
const { typedError } = require("./error-catalog");
const { resolvePathWithin } = require("./fs-utils");
const { stripRange } = require("./context-sources");

const SCHEMA_VERSION = "1";
const PROVENANCE = "deterministic";
const EDGE_VERBS = Object.freeze(["supersedes", "builds-on", "references", "describes"]);

// This surface's error vocabulary (registered in error-catalog.js).
const ERROR_CODES = Object.freeze({
	invalid: "AMBER_E_KNOWLEDGE_GRAPH_INVALID",
	source: "AMBER_E_KNOWLEDGE_GRAPH_SOURCE",
	sourceInvalid: "AMBER_E_KNOWLEDGE_SOURCE_INVALID",
});

function readTextIfPresent(file) {
	try {
		return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw typedError(ERROR_CODES.source, `could not read ${file}: ${err.message}`);
	}
}

function toPosix(p) {
	return String(p).replace(/\\/g, "/");
}

function slugify(text) {
	return String(text)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}

/** 1-based line number of the first occurrence of `needle` in `text`, or null. */
function lineOf(text, needle) {
	const index = text.indexOf(needle);
	if (index === -1) return null;
	return text.slice(0, index).split("\n").length;
}

// ── node builders ─────────────────────────────────────────────────────

const BODY_MAX = 2000;

function bodyExcerpt(text) {
	if (!text) return undefined;
	const trimmed = String(text).trim();
	if (!trimmed) return undefined;
	return trimmed.length > BODY_MAX ? trimmed.slice(0, BODY_MAX) : trimmed;
}

function makeNode({ id, kind, layer, title, sourcePath, status, updated, paths, revisions, body }) {
	const node = { id, kind, layer, title, sourcePath };
	if (status !== undefined && status !== null) node.status = status;
	if (updated !== undefined && updated !== null) node.updated = updated;
	if (Array.isArray(paths) && paths.length > 0) node.paths = paths;
	if (revisions !== undefined) node.revisions = revisions;
	if (body !== undefined && body !== null) node.body = body;
	node.provenance = PROVENANCE;
	return node;
}

function firstHeading(text) {
	const match = /^#\s+(.+)$/m.exec(text);
	return match ? match[1].trim() : null;
}

function parseAdrs(targetRoot) {
	const dir = path.join(targetRoot, "docs", "adr");
	if (!fs.existsSync(dir)) return [];
	const adrs = [];
	for (const name of fs.readdirSync(dir).sort()) {
		const match = /^(\d{4})-.+\.md$/.exec(name);
		if (!match) continue;
		const sourcePath = `docs/adr/${name}`;
		const text = readTextIfPresent(path.join(dir, name));
		if (text === null) continue;
		const heading = firstHeading(text) || name;
		const title = heading.replace(/^ADR-\d+:\s*/, "");
		const status = (/^\*\*Status:\*\*\s*(.+)$/m.exec(text) || [])[1]?.trim() || null;
		const updated = (/^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/m.exec(text) || [])[1] || null;
		adrs.push({
			id: `adr:${match[1]}`,
			number: match[1],
			sourcePath,
			text,
			title,
			status,
			updated,
		});
	}
	return adrs;
}

function parseWikiPages(targetRoot) {
	const dir = path.join(targetRoot, "docs", "wiki", "knowledge");
	if (!fs.existsSync(dir)) return [];
	const pages = [];
	for (const name of fs.readdirSync(dir).sort()) {
		const pageFile = path.join(dir, name, `${name}.md`);
		if (!fs.statSync(path.join(dir, name)).isDirectory()) continue;
		const text = readTextIfPresent(pageFile);
		if (text === null) continue;
		const front = /^---\n([\s\S]*?)\n---/.exec(text);
		const title =
			(front && (/^title:\s*"?([^"\n]+)"?\s*$/m.exec(front[1]) || [])[1]?.trim()) ||
			firstHeading(text) ||
			name;
		const updated = front ? (/^updated_at:\s*"?([^"\n]+)"?\s*$/m.exec(front[1]) || [])[1] : null;
		pages.push({
			id: `wiki:${name}`,
			sourcePath: `docs/wiki/knowledge/${name}/${name}.md`,
			text,
			title,
			updated: updated || null,
		});
	}
	return pages;
}

function parseArchitecturePages(targetRoot) {
	const dir = path.join(targetRoot, "docs", "architecture");
	if (!fs.existsSync(dir)) return [];
	const pages = [];
	for (const name of fs.readdirSync(dir).sort()) {
		if (!name.endsWith(".md")) continue;
		const stem = name.slice(0, -3);
		const text = readTextIfPresent(path.join(dir, name));
		if (text === null) continue;
		pages.push({
			id: `architecture:${stem}`,
			sourcePath: `docs/architecture/${name}`,
			text,
			title: firstHeading(text) || stem,
		});
	}
	return pages;
}

function parseMemorySections(targetRoot) {
	const text = readTextIfPresent(path.join(targetRoot, "MEMORY.md"));
	if (text === null) return [];
	const sections = [];
	const lines = text.split("\n");
	let current = null;
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^##\s+(.+)$/.exec(lines[index]);
		if (match) {
			if (current) sections.push(current);
			current = { title: match[1].trim(), line: index + 1, body: [] };
		} else if (current) {
			current.body.push(lines[index]);
		}
	}
	if (current) sections.push(current);
	return sections.map((section) => ({
		id: `memory:${slugify(section.title)}`,
		sourcePath: "MEMORY.md",
		text: section.body.join("\n"),
		line: section.line,
		title: section.title,
	}));
}

function parseFeatures(targetRoot) {
	const file = path.join(targetRoot, "feature_list.json");
	const raw = readTextIfPresent(file);
	if (raw === null) return [];
	let data;
	try {
		data = JSON.parse(raw);
	} catch (e) {
		throw typedError(ERROR_CODES.source, `feature_list.json is not valid JSON: ${e.message}`);
	}
	if (!data || !Array.isArray(data.features)) {
		throw typedError(
			ERROR_CODES.source,
			`feature_list.json has unexpected shape (expected { features: Array })`,
		);
	}
	return data.features
		.filter((feature) => feature && typeof feature.id === "string")
		.map((feature) => ({
			id: `feature:${feature.id}`,
			featureId: feature.id,
			title: feature.title || feature.id,
			status: feature.status || null,
			paths: Array.isArray(feature.paths) ? feature.paths.filter(Boolean).map(toPosix) : [],
			// The declaring text scanned for ADR references: the entry's own
			// human-authored fields, never evidence timestamps.
			text: [
				feature.title || "",
				feature.user_visible_behavior || "",
				...(Array.isArray(feature.verification) ? feature.verification : []),
				...(Array.isArray(feature.notes) ? feature.notes : []),
			].join("\n"),
		}));
}

function parseArtifacts(targetRoot) {
	const { listArtifactRevisions } = require("./canonical-artifacts");
	const { TYPE_REGISTRY } = require("./canonical-artifact-contracts");
	// The store's identity-to-directory slug rule (canonical-artifacts.js).
	const slugFor = (identity) => String(identity).replace(/[^a-zA-Z0-9._-]+/g, "_");
	// Fail closed on a corrupt store: the typed AMBER_E_ARTIFACT_* errors
	// propagate as-is (they already carry amberCode).
	const revisions = listArtifactRevisions(targetRoot);
	const byIdentity = new Map();
	for (const revision of revisions) {
		const key = `${revision.type}/${revision.identity}`;
		const entry = byIdentity.get(key) || {
			type: revision.type,
			identity: revision.identity,
			revisions: 0,
			head: null,
		};
		entry.revisions += 1;
		if (!entry.head || revision.revision > entry.head.revision) entry.head = revision;
		byIdentity.set(key, entry);
	}
	return [...byIdentity.values()].map((entry) => ({
		id: `artifact:${entry.type}/${entry.identity}`,
		type: entry.type,
		identity: entry.identity,
		title: entry.identity,
		status: entry.head.lifecycle || entry.head.status || "committed",
		sourcePath: `.amber/artifacts/${TYPE_REGISTRY[entry.type]?.dir || entry.type}/${slugFor(entry.identity)}`,
		revisions: entry.revisions,
		traces: entry.head.traces || [],
		text: entry.head.body,
	}));
}

// ── context page merge (ADR-0009) ─────────────────────────────────────

// A context page whose source ref names a node's sourcePath merges into the
// node as a property, never as a node of its own.
function contextPagesBySource(targetRoot) {
	const { statePath } = require("../state-dir-resolver");
	const pagesDir = statePath(targetRoot, "context", "pages");
	if (!fs.existsSync(pagesDir)) return new Map();
	// Matches .amber/artifacts/<dir>/<slug>/rev-N.md so we can map to the identity dir.
	const ARTIFACT_REV_RE = /^(\.amber\/artifacts\/[^/]+\/[^/]+)\/rev-\d+\.md$/;
	const bySource = new Map();
	for (const name of fs.readdirSync(pagesDir).sort()) {
		if (!name.endsWith(".json")) continue;
		const filePath = path.join(pagesDir, name);
		let text;
		try {
			text = fs.readFileSync(filePath, "utf8");
		} catch (err) {
			if (err.code === "ENOENT") continue;
			throw typedError(ERROR_CODES.source, `could not read context page ${name}: ${err.message}`);
		}
		let page;
		try {
			page = JSON.parse(text);
		} catch (e) {
			throw typedError(ERROR_CODES.source, `context page ${name} is not valid JSON: ${e.message}`);
		}
		if (!page || typeof page !== "object" || !page.pageId || !page.sources) {
			throw typedError(
				ERROR_CODES.source,
				`context page ${name} has unexpected shape (missing pageId or sources)`,
			);
		}
		for (const source of Object.values(page.sources)) {
			if (!source || typeof source.ref !== "string") continue;
			// Strip #Lx-Ly fragment so the ref matches a node's sourcePath.
			let ref = toPosix(stripRange(source.ref));
			// Map artifact body file refs to their identity directory.
			const artifactMatch = ARTIFACT_REV_RE.exec(ref);
			if (artifactMatch) ref = artifactMatch[1];
			if (ref && !bySource.has(ref)) bySource.set(ref, page.pageId);
		}
	}
	return bySource;
}

// ── edge discovery ────────────────────────────────────────────────────

const ADR_REF = /ADR-(\d{1,4})/g;
const FEATURE_REF = /\bF(\d{3})\b/g;
const ARCHITECTURE_REF = /docs\/architecture\/([a-z0-9-]+)\.md/g;
const WIKI_REF = /docs\/wiki\/knowledge\/([a-z0-9-]+)/g;

/** Collect `**Supersedes...:**` / `**Builds on:**` header blocks with their start line. */
function adrHeaderBlocks(text) {
	const lines = text.split("\n");
	const blocks = [];
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^\*\*(Supersedes[^:]*|Builds on[^:]*):\*\*/.exec(lines[index]);
		if (!match) continue;
		const verb = match[1].startsWith("Supersedes") ? "supersedes" : "builds-on";
		const collected = [lines[index]];
		let next = index + 1;
		for (; next < lines.length; next += 1) {
			const line = lines[next];
			if (line.trim() === "" || /^(\*\*|#|---)/.test(line)) break;
			collected.push(line);
		}
		blocks.push({ verb, text: collected.join("\n"), line: index + 1 });
		index = next - 1;
	}
	return blocks;
}

function matchTargets(text, pattern, toId) {
	const targets = new Map();
	for (const match of text.matchAll(pattern)) {
		const id = toId(match);
		if (id && !targets.has(id)) targets.set(id, match[0]);
	}
	return targets;
}

function buildEdges({
	adrs,
	wikiPages,
	architecturePages,
	memorySections,
	features,
	artifacts,
	nodeIds,
}) {
	const edges = [];
	const byKey = new Map();
	const addEdge = (src, dst, verb, evidence) => {
		if (src === dst || !nodeIds.has(src) || !nodeIds.has(dst)) return;
		const key = `${src}\u0000${verb}\u0000${dst}`;
		const existing = byKey.get(key);
		if (existing) {
			if (!evidence) return;
			if (!existing.evidence) existing.evidence = [];
			const duplicate = existing.evidence.some(
				(item) => item.path === evidence.path && item.line === evidence.line,
			);
			if (!duplicate) existing.evidence.push(evidence);
			return;
		}
		const edge = { src, dst, verb, provenance: PROVENANCE };
		if (evidence) edge.evidence = [evidence];
		byKey.set(key, edge);
		edges.push(edge);
	};
	const padAdr = (match) => `adr:${match[1].padStart(4, "0")}`;

	// decision layer: ADR header lineage + body -> feature describes.
	for (const adr of adrs) {
		for (const block of adrHeaderBlocks(adr.text)) {
			// A header block spans several lines; evidence must point at the line
			// that names this target, not at the block's first line.
			const lineIn = (token) => {
				const within = lineOf(block.text, token);
				return within === null ? block.line : block.line + within - 1;
			};
			for (const [dst, token] of matchTargets(block.text, ADR_REF, padAdr)) {
				addEdge(adr.id, dst, block.verb, { path: adr.sourcePath, line: lineIn(token) });
			}
			for (const [dst, token] of matchTargets(
				block.text,
				ARCHITECTURE_REF,
				(m) => `architecture:${m[1]}`,
			)) {
				addEdge(adr.id, dst, block.verb, { path: adr.sourcePath, line: lineIn(token) });
			}
		}
		for (const [dst, token] of matchTargets(adr.text, FEATURE_REF, (m) => `feature:F${m[1]}`)) {
			addEdge(adr.id, dst, "describes", { path: adr.sourcePath, line: lineOf(adr.text, token) });
		}
	}

	// knowledge layer: references to decisions and sibling knowledge pages,
	// describes to features.
	const knowledgeDocs = [
		...wikiPages.map((page) => ({ ...page, baseLine: 0 })),
		...architecturePages.map((page) => ({ ...page, baseLine: 0 })),
		...memorySections.map((section) => ({ ...section, baseLine: section.line })),
	];
	for (const doc of knowledgeDocs) {
		const evidenceAt = (token) => {
			const line = lineOf(doc.text, token);
			return { path: doc.sourcePath, ...(line ? { line: doc.baseLine + line } : {}) };
		};
		for (const [dst, token] of matchTargets(doc.text, ADR_REF, padAdr)) {
			addEdge(doc.id, dst, "references", evidenceAt(token));
		}
		for (const [dst, token] of matchTargets(
			doc.text,
			ARCHITECTURE_REF,
			(m) => `architecture:${m[1]}`,
		)) {
			addEdge(doc.id, dst, "references", evidenceAt(token));
		}
		for (const [dst, token] of matchTargets(doc.text, WIKI_REF, (m) => `wiki:${m[1]}`)) {
			addEdge(doc.id, dst, "references", evidenceAt(token));
		}
		for (const [dst, token] of matchTargets(doc.text, FEATURE_REF, (m) => `feature:F${m[1]}`)) {
			addEdge(doc.id, dst, "describes", evidenceAt(token));
		}
	}

	// implementation layer: feature entries naming decisions.
	for (const feature of features) {
		for (const [dst] of matchTargets(feature.text, ADR_REF, padAdr)) {
			addEdge(feature.id, dst, "references", { path: "feature_list.json" });
		}
	}

	// artifact traces: the registered Trace types map onto the four verbs.
	const traceVerb = {
		supersedes: "supersedes",
		refines: "builds-on",
		realizes: "builds-on",
		decides: "references",
	};
	for (const artifact of artifacts) {
		for (const trace of artifact.traces) {
			const verb = traceVerb[trace?.type];
			const target = trace?.to;
			if (!verb || !target || !target.type || !target.identity) continue;
			addEdge(artifact.id, `artifact:${target.type}/${target.identity}`, verb, null);
		}
	}

	edges.sort((a, b) => {
		if (a.src !== b.src) return a.src < b.src ? -1 : 1;
		if (a.verb !== b.verb) return a.verb < b.verb ? -1 : 1;
		return a.dst < b.dst ? -1 : 1;
	});
	return edges;
}

// ── dead-anchor drift ─────────────────────────────────────────────────

function stemOf(name) {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

function extOf(name) {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot) : "";
}

/**
 * Detect the actual path behind a dead anchor.
 * - Directory collapse: `x/loops/` is gone but `x/loops.<ext>` exists.
 * - Rename: a sibling with the same extension whose stem is a prefix of the
 *   declared stem (or vice versa; stems >= 4 chars). Longest common prefix
 *   wins, ties break lexicographically.
 * @returns {{actualPath: string, reason: "collapsed"|"renamed"}|null}
 */
function detectActualPath(targetRoot, declared) {
	const trimmed = declared.replace(/\/+$/, "");
	let parentAbs;
	try {
		parentAbs = resolvePathWithin(targetRoot, path.dirname(trimmed) || ".");
	} catch {
		return null; // escaping anchor: dead anchor, no probe outside
	}
	if (!fs.existsSync(parentAbs)) return null;
	const base = path.basename(trimmed);
	const siblings = fs.readdirSync(parentAbs).sort();
	const parentRel = toPosix(path.dirname(trimmed));
	const relOf = (name) => (parentRel === "." ? name : `${parentRel}/${name}`);

	if (declared.endsWith("/")) {
		const collapsed = siblings.find(
			(name) => stemOf(name) === base && fs.statSync(path.join(parentAbs, name)).isFile(),
		);
		return collapsed ? { actualPath: relOf(collapsed), reason: "collapsed" } : null;
	}

	const declaredStem = stemOf(base);
	const declaredExt = extOf(base);
	let best = null;
	for (const name of siblings) {
		if (name === base || extOf(name) !== declaredExt) continue;
		const stem = stemOf(name);
		if (stem.length < 4 || declaredStem.length < 4) continue;
		if (!declaredStem.startsWith(stem) && !stem.startsWith(declaredStem)) continue;
		const common = Math.min(stem.length, declaredStem.length);
		if (!best || common > best.common || (common === best.common && name < best.name)) {
			best = { name, common };
		}
	}
	return best ? { actualPath: relOf(best.name), reason: "renamed" } : null;
}

/** Convert a glob segment (*, ?, [...]) to a RegExp anchored to full basename. */
function globSegmentToRegex(segment) {
	let result = "^";
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i];
		if (ch === "*") {
			result += ".*";
		} else if (ch === "?") {
			result += ".";
		} else if (ch === "[") {
			const close = segment.indexOf("]", i + 1);
			if (close === -1) {
				result += "\\[";
			} else {
				result += segment.slice(i, close + 1);
				i = close;
			}
		} else {
			result += ch.replace(/[.+^${}()|\\]/g, "\\$&");
		}
	}
	result += "$";
	return new RegExp(result);
}

// A glob anchor (git-pathspec style) is alive when at least one path in the
// target tree matches the full declared pattern. Supports *, ?, and [...] in
// any segment. Every resolved path is confined to the target root; an escaping
// declaration returns false (dead anchor) without any probe outside.
function globAnchorIsAlive(targetRoot, declared) {
	const root = path.resolve(targetRoot);
	const isWithin = (absPath) => {
		const rel = path.relative(root, path.resolve(absPath));
		return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
	};

	const segments = declared.split("/").filter(Boolean);
	let candidates = [root];

	for (let si = 0; si < segments.length; si++) {
		const seg = segments[si];
		const isLast = si === segments.length - 1;
		const hasWild = /[*?[]/.test(seg);
		const next = [];

		for (const cur of candidates) {
			if (!isWithin(cur) && cur !== root) continue;
			if (!fs.existsSync(cur)) continue;

			if (hasWild) {
				const re = globSegmentToRegex(seg);
				let entries;
				try {
					entries = fs.readdirSync(cur);
				} catch {
					continue;
				}
				for (const entry of entries) {
					if (!re.test(entry)) continue;
					const full = path.join(cur, entry);
					if (!isWithin(full)) continue;
					if (isLast) {
						next.push(full);
					} else {
						try {
							if (fs.statSync(full).isDirectory()) next.push(full);
						} catch {
							/* skip unreadable entries */
						}
					}
				}
			} else {
				const full = path.join(cur, seg);
				if (!isWithin(full) || !fs.existsSync(full)) continue;
				if (isLast) {
					next.push(full);
				} else {
					try {
						if (fs.statSync(full).isDirectory()) next.push(full);
					} catch {
						/* skip */
					}
				}
			}
		}

		candidates = next;
		if (candidates.length === 0) return false;
	}

	return candidates.length > 0;
}

function buildDrift(targetRoot, features) {
	const findings = [];
	for (const feature of features) {
		for (const declared of feature.paths) {
			if (/[*?[]/.test(declared)) {
				if (globAnchorIsAlive(targetRoot, declared)) continue;
			} else {
				let alive = false;
				try {
					const abs = resolvePathWithin(targetRoot, declared.replace(/\/+$/, "") || ".");
					alive = fs.existsSync(abs);
				} catch {
					// Escaping anchor: dead anchor without probing outside
				}
				if (alive) continue;
			}
			const detected = detectActualPath(targetRoot, declared);
			const finding = { nodeId: feature.id, kind: "dead-anchor", path: declared };
			if (detected) {
				finding.actualPath = detected.actualPath;
				finding.detail =
					detected.reason === "collapsed"
						? `Anchored directory does not exist — actual is ${detected.actualPath} (directory collapsed to file).`
						: `Anchored file does not exist — actual file is ${detected.actualPath} (rename drift).`;
			} else {
				finding.detail = "Anchored path does not exist.";
			}
			findings.push(finding);
		}
	}
	findings.sort((a, b) => {
		if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1;
		return a.path < b.path ? -1 : 1;
	});
	return findings;
}

// Build the sourcePath→pageId map from the committed F059 manifest at
// docs/knowledge-corpus/knowledge-context-manifest.json.  The tree parity seam
// uses this so contextPage assignments are identical to the projection path on a
// clean archive where .amber/ is absent.
function committedContextPagesBySource(targetRoot) {
	const { committedManifestPath } = require("./knowledge-projection");
	const manifestPath = committedManifestPath(targetRoot);
	if (!fs.existsSync(manifestPath)) return new Map();
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch {
		return new Map();
	}
	const bySource = new Map();
	for (const row of manifest.rows || []) {
		if (row.sourcePath && row.pageId) bySource.set(toPosix(row.sourcePath), row.pageId);
	}
	return bySource;
}

function readDocumentsFromTree(targetRoot) {
	return {
		adrs: parseAdrs(targetRoot),
		wikiPages: parseWikiPages(targetRoot),
		architecturePages: parseArchitecturePages(targetRoot),
		pagesBySource: committedContextPagesBySource(targetRoot),
	};
}

function readDocumentsFromProjection(targetRoot) {
	const { readKnowledgeBaseProjection } = require("./knowledge-projection");
	const rows = readKnowledgeBaseProjection(targetRoot);
	const adrs = [];
	const wikiPages = [];
	const architecturePages = [];
	const pagesBySource = new Map();
	for (const row of rows) {
		pagesBySource.set(row.sourcePath, row.pageId);
		if (row.category === "adr") {
			const number = row.sourceNodeId.replace(/^adr:/, "");
			const status = (/^\*\*Status:\*\*\s*(.+)$/m.exec(row.text) || [])[1]?.trim() || null;
			const updated = (/^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/m.exec(row.text) || [])[1] || null;
			adrs.push({
				id: row.sourceNodeId,
				number,
				sourcePath: row.sourcePath,
				text: row.text,
				title: row.title,
				status,
				updated,
			});
		} else if (row.category === "wiki") {
			const front = /^---\n([\s\S]*?)\n---/.exec(row.text);
			wikiPages.push({
				id: row.sourceNodeId,
				sourcePath: row.sourcePath,
				text: row.text,
				title: row.title,
				updated: front ? (/^updated_at:\s*"?([^"\n]+)"?\s*$/m.exec(front[1]) || [])[1] : null,
			});
		} else if (row.category === "architecture") {
			architecturePages.push({
				id: row.sourceNodeId,
				sourcePath: row.sourcePath,
				text: row.text,
				title: row.title,
			});
		}
	}
	return { adrs, wikiPages, architecturePages, pagesBySource };
}

function buildKnowledgeGraphFromSources(targetRoot, documents) {
	const { adrs, wikiPages, architecturePages, pagesBySource } = documents;
	const memorySections = parseMemorySections(targetRoot);
	const features = parseFeatures(targetRoot);
	const artifacts = parseArtifacts(targetRoot);

	const nodes = [
		...adrs.map((adr) =>
			makeNode({
				id: adr.id,
				kind: "adr",
				layer: "decision",
				title: adr.title,
				sourcePath: adr.sourcePath,
				status: adr.status,
				updated: adr.updated,
				body: bodyExcerpt(adr.text),
			}),
		),
		...artifacts.map((artifact) =>
			makeNode({
				id: artifact.id,
				kind: "artifact",
				layer: "decision",
				title: artifact.title,
				sourcePath: artifact.sourcePath,
				status: artifact.status,
				revisions: artifact.revisions,
				body: bodyExcerpt(artifact.text),
			}),
		),
		...wikiPages.map((page) =>
			makeNode({
				id: page.id,
				kind: "wiki",
				layer: "knowledge",
				title: page.title,
				sourcePath: page.sourcePath,
				updated: page.updated,
				body: bodyExcerpt(page.text),
			}),
		),
		...memorySections.map((section) =>
			makeNode({
				id: section.id,
				kind: "memory",
				layer: "knowledge",
				title: section.title,
				sourcePath: section.sourcePath,
				body: bodyExcerpt(section.text),
			}),
		),
		...architecturePages.map((page) =>
			makeNode({
				id: page.id,
				kind: "architecture",
				layer: "knowledge",
				title: page.title,
				sourcePath: page.sourcePath,
				body: bodyExcerpt(page.text),
			}),
		),
		...features.map((feature) =>
			makeNode({
				id: feature.id,
				kind: "feature",
				layer: "implementation",
				title: feature.title,
				sourcePath: "feature_list.json",
				status: feature.status,
				paths: feature.paths,
				body: bodyExcerpt(feature.text),
			}),
		),
	];
	nodes.sort((a, b) => (a.id < b.id ? -1 : 1));

	if (pagesBySource.size > 0) {
		for (const node of nodes) {
			const pageId = pagesBySource.get(node.sourcePath);
			if (pageId) node.contextPage = pageId;
		}
	}

	const nodeIds = new Set(nodes.map((node) => node.id));
	const edges = buildEdges({
		adrs,
		wikiPages,
		architecturePages,
		memorySections,
		features,
		artifacts,
		nodeIds,
	});
	const drift = buildDrift(targetRoot, features);

	return { schemaVersion: SCHEMA_VERSION, nodes, edges, drift };
}

function validateGraph(graph) {
	const validate = compileSchema("knowledge-graph");
	if (!validate(graph)) {
		throw typedError(
			ERROR_CODES.invalid,
			`built graph violates knowledge-graph.schema.json: ${formatErrors(validate.errors, "graph").join("; ")}`,
		);
	}
	return graph;
}

function buildKnowledgeGraphFromTree(target) {
	const targetRoot = path.resolve(target || process.cwd());
	return validateGraph(
		buildKnowledgeGraphFromSources(targetRoot, readDocumentsFromTree(targetRoot)),
	);
}

/**
 * Build the deterministic knowledge graph for a target repository.
 * Production reads the knowledge-base projection; use {source: "tree"} or
 * buildKnowledgeGraphFromTree() only for explicit parity verification.
 * @param {string} target - Target repository root.
 * @param {{source?: "projection"|"tree"}} [options]
 * @returns {{schemaVersion: string, nodes: object[], edges: object[], drift: object[]}}
 */
function buildKnowledgeGraph(target, options = {}) {
	const targetRoot = path.resolve(target || process.cwd());
	const source = options.source || "projection";
	if (source === "tree") return buildKnowledgeGraphFromTree(targetRoot);
	if (source !== "projection") {
		throw typedError(ERROR_CODES.sourceInvalid, `unknown knowledge graph source: ${source}`);
	}
	return validateGraph(
		buildKnowledgeGraphFromSources(targetRoot, readDocumentsFromProjection(targetRoot)),
	);
}

/** Canonical serialization: the byte-stable form both surfaces emit. */
function serializeKnowledgeGraph(graph) {
	return JSON.stringify(graph, null, 2);
}

module.exports = {
	SCHEMA_VERSION,
	EDGE_VERBS,
	ERROR_CODES,
	buildKnowledgeGraph,
	buildKnowledgeGraphFromTree,
	serializeKnowledgeGraph,
};
