"use strict";

// Context loadout — read path (ADR-0010 D1–D7).
//
// Reuses write-path primitives, never duplicates:
//   context-verify.verifyPages -> freshness gate (D4), called ONCE per build
//   context-store.{listPages, readPage, readEvents, appendEvent, pagesDir}
//   context-hash.{sha256, canonicalJson} -> rawHash embedding
//
// Determinism: same signal (route/feature/budget/since) + same disk state ->
// byte-identical loadout file. Cacheability (D2): when the freshly computed
// loadout serializes to the exact bytes already on disk, the file is NOT
// rewritten and no `loadout-written` event is appended — an unchanged signal
// skips regeneration. The only clock-derived field, `generatedAt`, is sourced
// from the latest NON-`loadout-written` event `at` (or the Unix epoch when
// none exists), so appending a `loadout-written` event after the write does
// not change the next build's `generatedAt`. Recency ordering for the
// priority tier comes from `events.jsonl` `at` per pageId (NOT file mtime —
// `refresh`/`no-change` rewrite page files and would churn mtime).
//
// `rawHash` per page: the write path has no page-level hash, so the loadout
// embeds `sha256(canonicalJson(JSON.stringify(page)))` — a stable, deterministic identity hash
// over the page's full JSON structure (key-sorted, no insignificant
// whitespace). This is what `verifyLoadoutFile` recomputes from disk for the
// required-tier re-check (D7).
//
// Scope handling (D5): pages may carry an optional `scope: string[]`. The
// allocator matches a page when the route id OR the feature id appears in
// `page.scope`. If NO page on disk carries a non-empty `scope`, every fresh
// page is considered scope-matched (pre-retrofit compatibility — the feature
// works before the write-path scope stamping lands).

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const { verifyPages } = require("./context-verify");
const { listPages, readPage, readEvents, appendEvent } = require("./context-store");
const { sha256, canonicalJson } = require("./context-hash");
const { relativeSlash, resolvePathWithin } = require("./fs-utils");

const SCHEMA_VERSION = "1.0.0";
const ROUTE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/; // kebab-case, matching pageId
const FEATURE_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const EPOCH = "1970-01-01T00:00:00.000Z";
const OPERATING_MANUAL_PATH = "docs/wiki/agent/amber.md";
const LOADOUT_DEFINITION_PATH = "docs/wiki/agent/context-loadout.md";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
let loadoutValidate = null;

function validateLoadoutShape(loadout) {
	if (!loadoutValidate) {
		const schemaPath = path.join(
			__dirname,
			"..",
			"..",
			"..",
			"schemas",
			"context-loadout.schema.json",
		);
		loadoutValidate = ajv.compile(
			JSON.parse(fs.readFileSync(schemaPath, "utf8")),
		);
	}
	if (loadoutValidate(loadout)) return [];
	return loadoutValidate.errors
		.slice(0, 5)
		.map((error) => `${error.instancePath || "/"} ${error.message}`);
}

/** Loadouts directory: .amber/context/loadouts/ */
function loadoutsDir(targetRoot) {
	return resolvePathWithin(targetRoot, path.join(".amber", "context", "loadouts"), {
		label: "Context Loadouts directory",
	});
}

function loadoutPathFor(targetRoot, route, feature) {
	const name = feature ? `${route}-${feature}.json` : `${route}.json`;
	return path.join(loadoutsDir(targetRoot), name);
}

// Word estimate: text.length / 5, rounded. Amber has no tokenizer.
function estimateWords(text) {
	if (!text) return 0;
	return Math.round(text.length / 5);
}

function requiredArtifactSpecs(route) {
	return [
		{ kind: "operating-manual", path: OPERATING_MANUAL_PATH },
		{ kind: "route-manifest", path: `routes/${route}.route.json` },
		{ kind: "loadout-definition", path: LOADOUT_DEFINITION_PATH },
	];
}

function collectRequiredArtifacts(targetRoot, route) {
	const artifacts = [];
	const errors = [];
	for (const spec of requiredArtifactSpecs(route)) {
		let filePath;
		try {
			filePath = resolvePathWithin(targetRoot, spec.path, {
				label: `Required ${spec.kind}`,
			});
		} catch (error) {
			errors.push({
				code: "AMBER_E_CONTEXT_LOADOUT_REQUIRED",
				detail: error.message || String(error),
			});
			continue;
		}
		if (!fs.existsSync(filePath)) {
			errors.push({
				code: "AMBER_E_CONTEXT_LOADOUT_REQUIRED",
				detail: `required ${spec.kind} is missing: ${spec.path}`,
			});
			continue;
		}
		let content;
		try {
			if (!fs.statSync(filePath).isFile()) throw new Error("path is not a file");
			content = fs.readFileSync(filePath, "utf8");
		} catch (error) {
			errors.push({
				code: "AMBER_E_CONTEXT_LOADOUT_REQUIRED",
				detail: `required ${spec.kind} is not a readable file: ${spec.path} (${error.message})`,
			});
			continue;
		}
		artifacts.push({
			kind: spec.kind,
			path: relativeSlash(targetRoot, filePath),
			rawHash: sha256(content),
			words: estimateWords(content),
		});
	}
	return { artifacts, errors };
}

function pageText(page) {
	const blocks = Array.isArray(page.blocks) ? page.blocks : [];
	return blocks
		.map((b) => (b && typeof b.text === "string" ? b.text : ""))
		.join("\n");
}

// Stable comparator: recency desc (latestAt), then pageId asc.
function comparePriority(a, b) {
	const atA = a.latestAt || "";
	const atB = b.latestAt || "";
	if (atA !== atB) return atA < atB ? 1 : -1; // desc
	return a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0;
}

function comparePageIdAsc(a, b) {
	const pa = typeof a === "string" ? a : a.pageId;
	const pb = typeof b === "string" ? b : b.pageId;
	return pa < pb ? -1 : pa > pb ? 1 : 0;
}

// D4 status -> exclusion reason (shared by required-tier exclusion and the
// step-8 audit so the mapping cannot drift between the two sites).
function reasonForStatus(status) {
	if (status === "tampered") return "tampered";
	if (status === "obsolete" || status === "orphaned") return "obsolete";
	if (status === "stale") return "stale";
	return null;
}

// Budget-gated tier filler (D3): walks candidates in their stable order,
// includes each that fits the remaining budget, records over-budget
// exclusions with reasons. Shared by the priority and optional tiers.
function budgetedAdd(candidates, pageIds, pagesMap, seen, excluded, remaining) {
	for (const e of candidates) {
		if (e.words <= remaining) {
			pageIds.push(e.pageId);
			seen.add(e.pageId);
			pagesMap[e.pageId] = {
				title: e.page.title || "",
				words: e.words,
				rawHash: e.rawHash,
				status: "ok",
				scope: e.scope || [],
			};
			remaining -= e.words;
		} else {
			excluded.push({
				pageId: e.pageId,
				reason: "over-budget",
				detail: `words ${e.words} exceed remaining budget ${remaining}`,
			});
		}
	}
	return remaining;
}

function loadBuildConfig(targetRoot, opts) {
	const route = opts.route;
	if (!route || typeof route !== "string" || !ROUTE_RE.test(route)) {
		return { errors: [{ code: "AMBER_E_CONTEXT_LOADOUT_ROUTE", detail: `route must be kebab-case (got ${JSON.stringify(route)})` }] };
	}
	let routeManifest;
	try {
		const routePath = resolvePathWithin(targetRoot, `routes/${route}.route.json`, {
			label: "Route manifest",
		});
		routeManifest = JSON.parse(fs.readFileSync(routePath, "utf8"));
	} catch {
		routeManifest = null;
	}
	if (!routeManifest || routeManifest.routeId !== route) {
		return { errors: [{ code: "AMBER_E_CONTEXT_LOADOUT_ROUTE", detail: `route "${route}" not found in routes/*.route.json` }] };
	}
	const feature = opts.feature || null;
	if (feature && (typeof feature !== "string" || !FEATURE_RE.test(feature))) {
		return { errors: [{ code: "AMBER_E_CONTEXT_SCHEMA_INVALID", detail: `feature must be a safe identifier (got ${JSON.stringify(feature)})` }] };
	}
	const requiredArtifacts = collectRequiredArtifacts(targetRoot, route);
	if (requiredArtifacts.errors.length > 0) return { errors: requiredArtifacts.errors };
	return {
		errors: [],
		route,
		feature,
		budget: Number.isInteger(opts.budget) && opts.budget > 0 ? opts.budget : 4000,
		since: opts.since || null,
		requiredPins: Array.isArray(opts.required) ? opts.required.slice() : [],
		requiredArtifacts,
	};
}

function summarizeEvents(events) {
	const latestAtByPage = {};
	let generatedAt = EPOCH;
	for (const event of events) {
		if (!event || !event.at) continue;
		if (event.kind !== "loadout-written" && event.at > generatedAt) {
			generatedAt = event.at;
		}
		if (event.kind !== "page-written" || !event.pageId) continue;
		if (!latestAtByPage[event.pageId] || event.at > latestAtByPage[event.pageId]) {
			latestAtByPage[event.pageId] = event.at;
		}
	}
	return { latestAtByPage, generatedAt };
}

function collectPageEntries(targetRoot, route, feature) {
	const statusById = {};
	for (const page of verifyPages(targetRoot).pages) statusById[page.pageId] = page.status;
	const activity = summarizeEvents(readEvents(targetRoot));
	const pageEntries = [];
	let anyScope = false;
	for (const { pageId } of listPages(targetRoot)) {
		const page = readPage(targetRoot, pageId);
		if (!page) continue;
		const scope = Array.isArray(page.scope) ? page.scope.slice() : null;
		if (scope && scope.length > 0) anyScope = true;
		pageEntries.push({
			pageId,
			page,
			status: statusById[pageId] || "ok",
			words: estimateWords(pageText(page)),
			rawHash: sha256(canonicalJson(JSON.stringify(page))),
			latestAt: activity.latestAtByPage[pageId] || "",
			scope,
		});
	}
	for (const entry of pageEntries) {
		entry.matchesScope = !anyScope || Boolean(
			entry.scope && entry.scope.length > 0 &&
			((feature && entry.scope.includes(feature)) || (route && entry.scope.includes(route))),
		);
	}
	return { ...activity, pageEntries };
}

function selectRequiredPages(pageEntries, requiredPins) {
	const state = { excluded: [], pagesMap: {}, seen: new Set(), requiredPageIds: [] };
	for (const pin of requiredPins) {
		if (state.seen.has(pin)) continue;
		state.seen.add(pin);
		const entry = pageEntries.find((candidate) => candidate.pageId === pin);
		if (!entry) {
			state.excluded.push({ pageId: pin, reason: "obsolete", detail: "required-tier pin has no page on disk" });
			continue;
		}
		const reason = reasonForStatus(entry.status);
		if (reason === "tampered" || reason === "obsolete") {
			state.excluded.push({ pageId: pin, reason, detail: `${entry.status} required-tier pin excluded (D4)` });
			continue;
		}
		state.requiredPageIds.push(pin);
		state.pagesMap[pin] = {
			title: entry.page.title || "",
			words: entry.words,
			rawHash: entry.rawHash,
			status: entry.status === "stale" ? "stale" : "ok",
			scope: entry.scope || [],
		};
	}
	return state;
}

function addBudgetedTiers(pageEntries, state, budget, requiredWords) {
	const priorityCandidates = pageEntries
		.filter((entry) => entry.status === "ok" && entry.matchesScope && !state.seen.has(entry.pageId))
		.sort(comparePriority);
	state.priorityPageIds = [];
	const remaining = budgetedAdd(priorityCandidates, state.priorityPageIds, state.pagesMap, state.seen, state.excluded, budget - requiredWords);
	const optionalCandidates = pageEntries
		.filter((entry) => entry.status === "ok" && !state.seen.has(entry.pageId))
		.sort(comparePageIdAsc);
	state.optionalPageIds = [];
	budgetedAdd(optionalCandidates, state.optionalPageIds, state.pagesMap, state.seen, state.excluded, remaining);
}

function appendStatusExclusions(pageEntries, state) {
	const included = new Set([
		...state.requiredPageIds,
		...state.priorityPageIds,
		...state.optionalPageIds,
	]);
	for (const entry of pageEntries) {
		if (included.has(entry.pageId)) continue;
		const reason = reasonForStatus(entry.status);
		if (!reason) continue;
		state.excluded.push({
			pageId: entry.pageId,
			reason,
			detail: reason === "stale"
				? "stale page excluded from priority/optional (D4)"
				: `${entry.status} page excluded at every tier (D4)`,
		});
	}
}

function selectPageTiers(pageEntries, config) {
	const state = selectRequiredPages(pageEntries, config.requiredPins);
	const artifactWords = config.requiredArtifacts.artifacts.reduce(
		(total, artifact) => total + artifact.words,
		0,
	);
	const requiredWords = state.requiredPageIds.reduce(
		(total, pageId) => total + state.pagesMap[pageId].words,
		artifactWords,
	);
	if (requiredWords > config.budget) {
		return {
			error: {
				code: "AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW",
				detail: `required-tier words ${requiredWords} exceed budget ${config.budget}`,
			},
		};
	}
	addBudgetedTiers(pageEntries, state, config.budget, requiredWords);
	appendStatusExclusions(pageEntries, state);
	return state;
}

function applyDeltaSelection(selection, latestAtByPage, since) {
	let required = selection.requiredPageIds;
	let priority = selection.priorityPageIds;
	let optional = selection.optionalPageIds;
	let pages = selection.pagesMap;
	if (since) {
		const inDelta = (pageId) => Boolean(latestAtByPage[pageId] && latestAtByPage[pageId] >= since);
		required = required.filter(inDelta);
		priority = priority.filter(inDelta);
		optional = optional.filter(inDelta);
		pages = {};
		for (const pageId of [...required, ...priority, ...optional]) {
			if (selection.pagesMap[pageId]) pages[pageId] = selection.pagesMap[pageId];
		}
	}
	const references = [...required, ...priority, ...optional]
		.sort(comparePageIdAsc)
		.map((pageId) => ({
			pageId,
			rawHash: (pages[pageId] || selection.pagesMap[pageId]).rawHash,
		}));
	return { tiers: { required, priority, optional }, pages, references, deltaSince: since || null };
}

function assembleLoadout(config, pageState, selection, delta) {
	return {
		schemaVersion: SCHEMA_VERSION,
		route: config.route,
		feature: config.feature,
		generatedAt: pageState.generatedAt,
		budgetWords: config.budget,
		artifacts: { required: config.requiredArtifacts.artifacts },
		tiers: delta.tiers,
		pages: delta.pages,
		references: delta.references,
		excluded: selection.excluded.slice().sort(comparePageIdAsc),
		deltaSince: delta.deltaSince,
	};
}

function persistLoadout(targetRoot, loadout, route, feature) {
	let loadoutPath;
	try {
		loadoutPath = loadoutPathFor(targetRoot, route, feature);
	} catch (error) {
		return { error: { code: "AMBER_E_CONTEXT_LOADOUT_REQUIRED", detail: error.message || String(error) } };
	}
	const serialized = JSON.stringify(loadout, null, 2) + "\n";
	let cached = false;
	if (fs.existsSync(loadoutPath)) {
		try {
			cached = fs.readFileSync(loadoutPath, "utf8") === serialized;
		} catch {
			cached = false;
		}
	}
	if (!cached) {
		fs.mkdirSync(path.dirname(loadoutPath), { recursive: true });
		fs.writeFileSync(loadoutPath, serialized, "utf8");
		appendEvent(targetRoot, {
			kind: "loadout-written",
			route,
			feature,
			pageCount: loadout.references.length,
			words: loadout.references.reduce(
				(total, reference) => total + (loadout.pages[reference.pageId]?.words || 0),
				0,
			),
		});
	}
	return { loadoutPath };
}

/**
 * Build a deterministic, freshness-gated, budgeted context loadout file.
 *
 * @param {string} targetRoot
 * @param {object} opts
 * @param {string} opts.route    Required, kebab-case.
 * @param {string} [opts.feature] Optional feature id; narrows scope.
 * @param {number} [opts.budget]  Positive integer word budget (default 4000).
 * @param {string} [opts.since]   ISO timestamp; emit delta only.
 * @param {string[]} [opts.required] Pinned pageIds for the required tier.
 * @returns {{loadout, loadoutPath, errors, warnings}}
 */
function buildLoadout(targetRoot, opts = {}) {
	const warnings = [];
	const config = loadBuildConfig(targetRoot, opts);
	if (config.errors.length > 0) {
		return { loadout: null, loadoutPath: null, errors: config.errors, warnings };
	}
	const errors = [];

	const pageState = collectPageEntries(targetRoot, config.route, config.feature);

	// 4. Required tier (pinned). D4: tampered/obsolete excluded; stale included
	//    with status "stale"; ok included with status "ok".
	const selection = selectPageTiers(pageState.pageEntries, config);
	if (selection.error) {
		errors.push(selection.error);
		return { loadout: null, loadoutPath: null, errors, warnings };
	}

	// 9. Delta-since semantics (D6): emit only pages added/re-hashed after `since`.
	const delta = applyDeltaSelection(selection, pageState.latestAtByPage, config.since);
	const loadout = assembleLoadout(config, pageState, selection, delta);
	const shapeErrors = validateLoadoutShape(loadout);
	if (shapeErrors.length > 0) {
		errors.push({
			code: "AMBER_E_CONTEXT_SCHEMA_INVALID",
			detail: `generated loadout fails schema: ${shapeErrors.join("; ")}`,
		});
		return { loadout: null, loadoutPath: null, errors, warnings };
	}

	const persisted = persistLoadout(targetRoot, loadout, config.route, config.feature);
	if (persisted.error) {
		errors.push(persisted.error);
		return { loadout: null, loadoutPath: null, errors, warnings };
	}
	return { loadout, loadoutPath: persisted.loadoutPath, errors, warnings };
}

function loadoutFinding(code, detail, extra = {}) {
	return { pageId: null, ...extra, code, detail };
}

function readLoadoutForVerify(targetRoot, loadoutPath) {
	let resolvedPath;
	try {
		resolvedPath = resolvePathWithin(targetRoot, loadoutPath, {
			label: "Context Loadout file",
		});
	} catch (error) {
		return { finding: loadoutFinding("AMBER_E_CONTEXT_LOADOUT_MISSING", error.message || String(error)) };
	}
	if (!fs.existsSync(resolvedPath)) {
		return { finding: loadoutFinding("AMBER_E_CONTEXT_LOADOUT_MISSING", `loadout file not found: ${resolvedPath}`) };
	}
	let loadout;
	try {
		loadout = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
	} catch (error) {
		return { finding: loadoutFinding("AMBER_E_CONTEXT_LOADOUT_CORRUPT", `loadout JSON parse failed: ${error.message}`) };
	}
	const shapeErrors = validateLoadoutShape(loadout);
	if (shapeErrors.length > 0) {
		return { finding: loadoutFinding("AMBER_E_CONTEXT_LOADOUT_CORRUPT", `loadout schema validation failed: ${shapeErrors.join("; ")}`) };
	}
	return { loadout };
}

function verifyRequiredArtifact(targetRoot, artifact, expected) {
	if (!artifact) {
		return loadoutFinding(
			"AMBER_E_CONTEXT_LOADOUT_REQUIRED",
			`required ${expected.kind} is absent from artifacts.required`,
			{ kind: expected.kind },
		);
	}
	let artifactPath;
	try {
		artifactPath = resolvePathWithin(targetRoot, artifact.path, {
			label: `Required ${expected.kind}`,
		});
	} catch (error) {
		return loadoutFinding("AMBER_E_CONTEXT_LOADOUT_REQUIRED", error.message || String(error), { kind: expected.kind });
	}
	if (relativeSlash(targetRoot, artifactPath) !== expected.path) {
		return loadoutFinding("AMBER_E_CONTEXT_LOADOUT_REQUIRED", `required ${expected.kind} path must be ${expected.path}`, { kind: expected.kind });
	}
	if (!fs.existsSync(artifactPath)) {
		return loadoutFinding("AMBER_E_CONTEXT_LOADOUT_REQUIRED", `required ${expected.kind} is missing: ${expected.path}`, { kind: expected.kind });
	}
	let currentHash;
	try {
		if (!fs.statSync(artifactPath).isFile()) throw new Error("path is not a file");
		currentHash = sha256(fs.readFileSync(artifactPath, "utf8"));
	} catch (error) {
		return loadoutFinding(
			"AMBER_E_CONTEXT_LOADOUT_REQUIRED",
			`required ${expected.kind} is not a readable file: ${expected.path} (${error.message})`,
			{ kind: expected.kind },
		);
	}
	return currentHash === artifact.rawHash
		? null
		: loadoutFinding("AMBER_E_CONTEXT_LOADOUT_REQUIRED", `required ${expected.kind} changed since loadout generation`, { kind: expected.kind });
}

function verifyRequiredArtifacts(targetRoot, loadout) {
	const recorded = Array.isArray(loadout.artifacts?.required) ? loadout.artifacts.required : [];
	const findings = [];
	for (const expected of requiredArtifactSpecs(loadout.route)) {
		const artifact = recorded.find((candidate) => candidate && candidate.kind === expected.kind);
		const artifactFinding = verifyRequiredArtifact(targetRoot, artifact, expected);
		if (artifactFinding) findings.push(artifactFinding);
	}
	return findings;
}

function verifyRequiredPages(targetRoot, loadout) {
	const required = Array.isArray(loadout.tiers?.required) ? loadout.tiers.required : [];
	const findings = [];
	for (const pageId of required) {
		const page = readPage(targetRoot, pageId);
		if (!page) {
			findings.push({ pageId, code: "AMBER_E_CONTEXT_SOURCE_STALE", detail: "required-tier page no longer on disk" });
			continue;
		}
		const currentHash = sha256(canonicalJson(JSON.stringify(page)));
		const recordedHash = loadout.pages?.[pageId]?.rawHash || null;
		if (currentHash !== recordedHash) {
			findings.push({ pageId, code: "AMBER_E_CONTEXT_SOURCE_STALE", detail: "required-tier page changed since loadout generation" });
		}
	}
	return findings;
}

/**
 * Verify a Loadout's Required Artifacts and required-tier Pages against disk.
 *
 * Required Artifacts must retain their canonical target-local paths and raw
 * hashes. Required-tier Pages are re-read and compared by canonical JSON hash.
 * `ok` is true iff there are no findings.
 *
 * @param {string} targetRoot
 * @param {string} loadoutPath
 * @returns {{ok: boolean, findings: Array<{pageId, code, detail}>}}
 */
function verifyLoadoutFile(targetRoot, loadoutPath) {
	const loaded = readLoadoutForVerify(targetRoot, loadoutPath);
	if (loaded.finding) return { ok: false, findings: [loaded.finding] };
	const { loadout } = loaded;
	const findings = [];

	findings.push(...verifyRequiredArtifacts(targetRoot, loadout));

	findings.push(...verifyRequiredPages(targetRoot, loadout));
	return { ok: findings.length === 0, findings };
}

module.exports = { loadoutsDir, buildLoadout, verifyLoadoutFile };
