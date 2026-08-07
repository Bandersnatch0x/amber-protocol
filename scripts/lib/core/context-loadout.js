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

const { verifyPages } = require("./context-verify");
const { listPages, readPage, readEvents, appendEvent } = require("./context-store");
const { sha256, canonicalJson } = require("./context-hash");

const SCHEMA_VERSION = "1.0.0";
const ROUTE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/; // kebab-case, matching pageId
const EPOCH = "1970-01-01T00:00:00.000Z";

/** Loadouts directory: .amber/context/loadouts/ */
function loadoutsDir(targetRoot) {
	return path.join(targetRoot, ".amber", "context", "loadouts");
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
	const errors = [];
	const warnings = [];

	const route = opts.route;
	if (!route || typeof route !== "string" || !ROUTE_RE.test(route)) {
		errors.push({
			code: "AMBER_E_CONTEXT_LOADOUT_ROUTE",
			detail: `route must be kebab-case (got ${JSON.stringify(route)})`,
		});
		return { loadout: null, loadoutPath: null, errors, warnings };
	}
	// D1: the route must actually exist in routes/*.route.json (mechanical
	// validation — the catalog remedy points the user at the route registry).
	const routesDir = path.join(targetRoot, "routes");
	let routeExists = false;
	if (fs.existsSync(routesDir)) {
		for (const f of fs.readdirSync(routesDir)) {
			if (!f.endsWith(".route.json")) continue;
			try {
				const r = JSON.parse(fs.readFileSync(path.join(routesDir, f), "utf8"));
				if (r.routeId === route) {
					routeExists = true;
					break;
				}
			} catch {
				/* unreadable route file: skip */
			}
		}
	}
	if (!routeExists) {
		errors.push({
			code: "AMBER_E_CONTEXT_LOADOUT_ROUTE",
			detail: `route "${route}" not found in routes/*.route.json`,
		});
		return { loadout: null, loadoutPath: null, errors, warnings };
	}

	const feature = opts.feature || null;
	const budget = Number.isInteger(opts.budget) && opts.budget > 0 ? opts.budget : 4000;
	const since = opts.since || null;
	const requiredPins = Array.isArray(opts.required) ? opts.required.slice() : [];

	// 1. Freshness gate — verify ONCE, derive status map locally (D4).
	const verifyResult = verifyPages(targetRoot);
	const statusById = {};
	for (const p of verifyResult.pages) statusById[p.pageId] = p.status;

	// 2. Read events: recency per pageId + delta-since filter.
	const events = readEvents(targetRoot);
	const latestAtByPage = {};
	let generatedAt = EPOCH;
	for (const e of events) {
		if (!e || !e.at) continue;
		// `generatedAt` tracks the latest NON-loadout-written activity so that
		// appending a `loadout-written` event after the write does not change
		// the next build's `generatedAt` (determinism).
		if (e.kind !== "loadout-written" && e.at > generatedAt) generatedAt = e.at;
		if (!e.pageId) continue;
		if (!latestAtByPage[e.pageId] || e.at > latestAtByPage[e.pageId]) {
			latestAtByPage[e.pageId] = e.at;
		}
	}

	// 3. Load all pages; classify scope-match (D5 pre-retrofit compat).
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
			latestAt: latestAtByPage[pageId] || "",
			scope,
		});
	}
	for (const entry of pageEntries) {
		let matchesScope = false;
		if (!anyScope) {
			matchesScope = true; // pre-retrofit: no page has scope -> all match
		} else if (entry.scope && entry.scope.length > 0) {
			if (feature && entry.scope.includes(feature)) matchesScope = true;
			if (route && entry.scope.includes(route)) matchesScope = true;
		}
		entry.matchesScope = matchesScope;
	}

	// 4. Required tier (pinned). D4: tampered/obsolete excluded; stale included
	//    with status "stale"; ok included with status "ok".
	const excluded = [];
	const pagesMap = {};
	const seen = new Set();
	const requiredPageIds = [];
	for (const pin of requiredPins) {
		if (seen.has(pin)) continue;
		seen.add(pin);
		const entry = pageEntries.find((e) => e.pageId === pin);
		if (!entry) {
			excluded.push({
				pageId: pin,
				reason: "obsolete",
				detail: "required-tier pin has no page on disk",
			});
			continue;
		}
		const reason = reasonForStatus(entry.status);
		if (reason === "tampered" || reason === "obsolete") {
			excluded.push({
				pageId: pin,
				reason,
				detail: `${entry.status} required-tier pin excluded (D4)`,
			});
			continue;
		}
		requiredPageIds.push(pin);
		pagesMap[pin] = {
			title: entry.page.title || "",
			words: entry.words,
			rawHash: entry.rawHash,
			status: entry.status === "stale" ? "stale" : "ok",
			scope: entry.scope || [],
		};
	}

	// 5. Fail-fast (D3): required-tier words must fit the budget.
	let requiredWords = 0;
	for (const id of requiredPageIds) requiredWords += pagesMap[id].words;
	if (requiredWords > budget) {
		errors.push({
			code: "AMBER_E_CONTEXT_LOADOUT_REQUIRED_OVERFLOW",
			detail: `required-tier words ${requiredWords} exceed budget ${budget}`,
		});
		return { loadout: null, loadoutPath: null, errors, warnings };
	}

	// 6. Priority tier (D3, budget-gated): fresh (ok) + scope-matched + not
	//    already required, in stable order (recency desc, pageId asc). The
	//    budget spans priority AND optional (shared budgetedAdd filler).
	const priorityCandidates = pageEntries
		.filter((e) => e.status === "ok" && e.matchesScope && !seen.has(e.pageId))
		.sort(comparePriority);
	const priorityPageIds = [];
	let remaining = budgetedAdd(priorityCandidates, priorityPageIds, pagesMap, seen, excluded, budget - requiredWords);

	// 7. Optional tier (fill remaining budget): remaining fresh (ok) pages,
	//    ordered by pageId asc (per PRD loadout shape — pageId, not recency).
	const optionalCandidates = pageEntries
		.filter((e) => e.status === "ok" && !seen.has(e.pageId))
		.sort(comparePageIdAsc);
	const optionalPageIds = [];
	budgetedAdd(optionalCandidates, optionalPageIds, pagesMap, seen, excluded, remaining);

	// 8. Record remaining stale/tampered/obsolete pages that didn't make any
	//    tier (so the audit shows why each non-selected page was dropped).
	const included = new Set([...requiredPageIds, ...priorityPageIds, ...optionalPageIds]);
	for (const e of pageEntries) {
		if (included.has(e.pageId)) continue;
		const reason = reasonForStatus(e.status);
		if (!reason) continue; // fresh off-scope pages are simply not selected
		excluded.push({
			pageId: e.pageId,
			reason,
			detail:
				reason === "stale"
					? "stale page excluded from priority/optional (D4)"
					: `${e.status} page excluded at every tier (D4)`,
		});
	}

	// 9. Delta-since semantics (D6): emit only pages added/re-hashed after `since`.
	let tierRequired = requiredPageIds;
	let tierPriority = priorityPageIds;
	let tierOptional = optionalPageIds;
	let deltaPagesMap = pagesMap;
	let deltaSince = null;
	if (since) {
		deltaSince = since;
		const inDelta = (pageId) => {
			const at = latestAtByPage[pageId] || "";
			return !!at && at >= since;
		};
		tierRequired = requiredPageIds.filter(inDelta);
		tierPriority = priorityPageIds.filter(inDelta);
		tierOptional = optionalPageIds.filter(inDelta);
		deltaPagesMap = {};
		for (const id of [...tierRequired, ...tierPriority, ...tierOptional]) {
			if (pagesMap[id]) deltaPagesMap[id] = pagesMap[id];
		}
	}

	// 10. References: every page the loadout references, sorted by pageId.
	const references = [...tierRequired, ...tierPriority, ...tierOptional]
		.sort(comparePageIdAsc)
		.map((pageId) => ({
			pageId,
			rawHash: (deltaPagesMap[pageId] || pagesMap[pageId]).rawHash,
		}));

	// 11. Assemble the loadout object (deterministic key order via JSON.stringify
	//     of a literal — the canonical-JSON helper is for hashing, not writing).
	const loadout = {
		schemaVersion: SCHEMA_VERSION,
		route,
		feature,
		generatedAt,
		budgetWords: budget,
		tiers: {
			required: tierRequired,
			priority: tierPriority,
			optional: tierOptional,
		},
		pages: deltaPagesMap,
		references,
		excluded: excluded.slice().sort(comparePageIdAsc),
		deltaSince,
	};

	// 12. Write to disk (deterministic 2-space JSON + trailing newline).
	//     D2 cacheability: an unchanged signal produces byte-identical output,
	//     so skip the rewrite AND the event when the file already matches.
	const loadoutPath = loadoutPathFor(targetRoot, route, feature);
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
		// 13. Append ONE loadout-written event (D6 accounting; appendEvent
		//     stamps `at`). Skipped on a cache hit — no regeneration happened.
		appendEvent(targetRoot, {
			kind: "loadout-written",
			route,
			feature,
			pageCount: references.length,
			words: references.reduce(
				(acc, r) => acc + (deltaPagesMap[r.pageId] ? deltaPagesMap[r.pageId].words : 0),
				0,
			),
		});
	}

	return { loadout, loadoutPath, errors, warnings };
}

/**
 * Verify a loadout file's required-tier pages against current disk state (D7).
 *
 * Re-checks ONLY required-tier pages (the irreplaceable bits): recomputes
 * `sha256(canonicalJson(JSON.stringify(page)))` from disk and compares to the loadout's
 * recorded `rawHash`. Mismatch -> finding with code
 * `AMBER_E_CONTEXT_SOURCE_STALE`. `ok` is true iff there are no findings.
 *
 * @param {string} targetRoot
 * @param {string} loadoutPath
 * @returns {{ok: boolean, findings: Array<{pageId, code, detail}>}}
 */
function verifyLoadoutFile(targetRoot, loadoutPath) {
	const findings = [];
	if (!fs.existsSync(loadoutPath)) {
		return {
			ok: false,
			findings: [
				{
					pageId: null,
					code: "AMBER_E_CONTEXT_LOADOUT_MISSING",
					detail: `loadout file not found: ${loadoutPath}`,
				},
			],
		};
	}
	let loadout;
	try {
		loadout = JSON.parse(fs.readFileSync(loadoutPath, "utf8"));
	} catch (err) {
		return {
			ok: false,
			findings: [
				{
					pageId: null,
					code: "AMBER_E_CONTEXT_LOADOUT_CORRUPT",
					detail: `loadout JSON parse failed: ${err.message}`,
				},
			],
		};
	}

	const required = Array.isArray(loadout.tiers && loadout.tiers.required)
		? loadout.tiers.required
		: [];
	for (const pageId of required) {
		const page = readPage(targetRoot, pageId);
		if (!page) {
			findings.push({
				pageId,
				code: "AMBER_E_CONTEXT_SOURCE_STALE",
				detail: "required-tier page no longer on disk",
			});
			continue;
		}
		const currentHash = sha256(canonicalJson(JSON.stringify(page)));
		const recorded = loadout.pages && loadout.pages[pageId] ? loadout.pages[pageId].rawHash : null;
		if (currentHash !== recorded) {
			findings.push({
				pageId,
				code: "AMBER_E_CONTEXT_SOURCE_STALE",
				detail: "required-tier page changed since loadout generation",
			});
		}
	}
	return { ok: findings.length === 0, findings };
}

module.exports = { loadoutsDir, buildLoadout, verifyLoadoutFile };
