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
// skips regeneration. `generatedAt` is sourced from the latest
// NON-`loadout-written` event `at` (or the Unix epoch when none exists), so
// appending a `loadout-written` event after the write does not change the
// next build's `generatedAt`. Recency ordering for the priority tier comes
// from `events.jsonl` `at` per pageId (NOT file mtime — `refresh`/`no-change`
// rewrite page files and would churn mtime).
//
// F071 H3b determinism note: with the firewall ON (a declared subject), the
// TTL verdict is evaluated against the REAL wall clock — that is the §11
// formula's Time input — and the artifact embeds `firewall.checkedAt`. Two
// firewall builds of the same state therefore produce different bytes even
// when every verdict is unchanged: the byte-dedupe is defeated by design
// (the file rewrites and one `loadout-written` event re-appends per build),
// while the per-page denial events only appear when a page is actually
// denied. Firewall-off builds keep full byte-identity.
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
const { statePathForCreate } = require("../state-dir-resolver");
const { relativeSlash, resolvePathWithin } = require("./fs-utils");
const {
	CLASSIFICATIONS,
	effectiveClassificationOf,
	admittedUnderCeiling,
	expiresAtFromTtl,
} = require("./classification");
const {
	KNOWLEDGE_KINDS,
	normalizeKnowledgeKind,
	readKnowledgeGraph,
} = require("./context-knowledge");
const { compileSchema } = require("./schema-contract");
// F071 H3b: the ONE firewall verdict — the build never re-implements it.
const { checkContextAccess } = require("../harness/context-core");

const SCHEMA_VERSION = "1.0.0";
const ROUTE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/; // kebab-case, matching pageId
const FEATURE_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const EPOCH = "1970-01-01T00:00:00.000Z";
const OPERATING_MANUAL_PATH = "docs/wiki/agent/amber.md";
const LOADOUT_DEFINITION_PATH = "docs/wiki/agent/context-loadout.md";

function validateLoadoutShape(loadout) {
	const loadoutValidate = compileSchema("context-loadout");
	if (loadoutValidate(loadout)) return [];
	return loadoutValidate.errors
		.slice(0, 5)
		.map((error) => `${error.instancePath || "/"} ${error.message}`);
}

/** Loadouts directory: .amber/context/loadouts/ (post-rename state kind — see
 * the note in context-store.js; reads and creates both target the canonical dir). */
function loadoutsDir(targetRoot) {
	return resolvePathWithin(targetRoot, statePathForCreate(targetRoot, "context", "loadouts"), {
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
			// §3.1: Required Artifacts carry the fixed internal classification;
			// not caller-settable.
			classification: "internal",
		});
	}
	return { artifacts, errors };
}

function pageText(page) {
	const blocks = Array.isArray(page.blocks) ? page.blocks : [];
	return blocks.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n");
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
				classification: e.classification,
				classificationSource: e.classificationSource,
				purpose: e.purpose,
				expiresAt: e.expiresAt,
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
		return {
			errors: [
				{
					code: "AMBER_E_CONTEXT_LOADOUT_ROUTE",
					detail: `route must be kebab-case (got ${JSON.stringify(route)})`,
				},
			],
		};
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
		return {
			errors: [
				{
					code: "AMBER_E_CONTEXT_LOADOUT_ROUTE",
					detail: `route "${route}" not found in routes/*.route.json`,
				},
			],
		};
	}
	const feature = opts.feature || null;
	if (feature && (typeof feature !== "string" || !FEATURE_RE.test(feature))) {
		return {
			errors: [
				{
					code: "AMBER_E_CONTEXT_SCHEMA_INVALID",
					detail: `feature must be a safe identifier (got ${JSON.stringify(feature)})`,
				},
			],
		};
	}
	const requiredArtifacts = collectRequiredArtifacts(targetRoot, route);
	if (requiredArtifacts.errors.length > 0) return { errors: requiredArtifacts.errors };
	const knowledgeKinds = Array.isArray(opts.knowledgeKinds)
		? opts.knowledgeKinds
		: opts.knowledgeKinds
			? [opts.knowledgeKinds]
			: [];
	const invalidKind = knowledgeKinds.find((kind) => !KNOWLEDGE_KINDS.includes(kind));
	if (invalidKind) {
		return {
			errors: [
				{
					code: "AMBER_E_CONTEXT_SCHEMA_INVALID",
					detail: `invalid Knowledge Kind: ${invalidKind}`,
				},
			],
		};
	}
	// §3.3: the classification ceiling is a build option (the PDP context face
	// or caller constraint supplies it); absent means no classification
	// constraint exists — nothing is classification-denied.
	const maxClassification =
		opts.maxClassification === undefined || opts.maxClassification === null
			? null
			: opts.maxClassification;
	if (maxClassification !== null && CLASSIFICATIONS.includes(maxClassification) === false) {
		return {
			errors: [
				{
					code: "AMBER_E_CONTEXT_SCHEMA_INVALID",
					detail: `invalid maxClassification: ${JSON.stringify(maxClassification)}`,
				},
			],
		};
	}
	// F071 H3b: the firewall is on only when a governing subject is declared —
	// and the verdict is not meaningful without a purpose (the check requires
	// both), so subject-without-purpose refuses here, before any selection. A
	// DECLARED-but-malformed subject (garbage type, whitespace) also refuses:
	// silently degrading to firewall-off would hand back an ungoverned load.
	const subjectDeclared = opts.subject !== undefined && opts.subject !== null;
	const subject =
		subjectDeclared && typeof opts.subject === "string" && opts.subject.trim().length > 0
			? opts.subject
			: null;
	if (subjectDeclared && !subject) {
		return {
			errors: [
				{
					code: "AMBER_E_CONTEXT_LOADOUT_FIREWALL",
					detail: `subject must be a non-empty string (got ${JSON.stringify(opts.subject)})`,
				},
			],
		};
	}
	if (subject && (typeof opts.purpose !== "string" || opts.purpose.trim().length === 0)) {
		return {
			errors: [
				{
					code: "AMBER_E_CONTEXT_LOADOUT_FIREWALL",
					detail:
						"subject requires purpose: the firewall verdict (context-grant check) is not meaningful without both",
				},
			],
		};
	}
	return {
		errors: [],
		route,
		feature,
		budget: Number.isInteger(opts.budget) && opts.budget > 0 ? opts.budget : 4000,
		since: opts.since || null,
		requiredPins: Array.isArray(opts.required) ? opts.required.slice() : [],
		knowledgeKinds: [...new Set(knowledgeKinds)].sort(),
		requiredArtifacts,
		maxClassification,
		firewall: subject
			? {
					subject,
					purpose: opts.purpose,
					runId: typeof opts.runId === "string" && opts.runId.trim().length > 0 ? opts.runId : null,
				}
			: null,
		targetRoot,
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
	const acceptedPages = listPages(targetRoot);
	const activity = summarizeEvents(readEvents(targetRoot));
	if (acceptedPages.length === 0) return { ...activity, pageEntries: [] };
	const verified = verifyPages(targetRoot);
	if (!verified.ok) {
		return {
			...activity,
			pageEntries: [],
			error: { code: verified.code, detail: verified.detail },
		};
	}
	const statusById = {};
	for (const page of verified.pages) statusById[page.pageId] = page.status;
	const pageEntries = [];
	const knowledgeGraph = readKnowledgeGraph(targetRoot);
	let anyScope = false;
	for (const { pageId } of acceptedPages) {
		const page = readPage(targetRoot, pageId);
		if (!page) continue;
		const scope = Array.isArray(page.scope) ? page.scope.slice() : null;
		if (scope && scope.length > 0) anyScope = true;
		// §3.1 metadata projection: the stored label wins; governed-ingest pages
		// without a stored label project effective `internal` (recorded via
		// classificationSource, never written back onto the page); the hard
		// expiry derives from the page ttl at its ingest/refresh instant.
		const effective = effectiveClassificationOf({ stored: page.classification, governed: true });
		const baseInstant = page.created_at || activity.latestAtByPage[pageId] || null;
		pageEntries.push({
			pageId,
			page,
			status: statusById[pageId] || "ok",
			words: estimateWords(pageText(page)),
			rawHash: sha256(canonicalJson(JSON.stringify(page))),
			latestAt: activity.latestAtByPage[pageId] || "",
			scope,
			knowledgeKind: normalizeKnowledgeKind(page.knowledgeKind),
			supersededBy: knowledgeGraph.successorsByPage.get(pageId) || [],
			classification: effective.classification,
			classificationSource: effective.classificationSource,
			purpose: typeof page.purpose === "string" ? page.purpose : null,
			expiresAt: expiresAtFromTtl(page, baseInstant),
		});
	}
	for (const entry of pageEntries) {
		entry.matchesScope =
			!anyScope ||
			Boolean(
				entry.scope &&
				entry.scope.length > 0 &&
				((feature && entry.scope.includes(feature)) || (route && entry.scope.includes(route))),
			);
	}
	return { ...activity, pageEntries };
}

// §3.3 ingress exclusions: classification-ceiling denials and hard expiry are
// authority facts that apply to EVERY tier (a required pin cannot pull a page
// past its ceiling or past its expiry). Runs before tier selection; marks the
// page seen so no tier adds it. The record states the fact and the reason —
// never more (spec §8 case 2/3 load-build half).
function applyAuthorityExclusions(pageEntries, state, config, now = new Date()) {
	for (const entry of pageEntries) {
		if (state.seen.has(entry.pageId)) continue;
		if (entry.expiresAt !== null && Date.parse(entry.expiresAt) <= now.getTime()) {
			state.seen.add(entry.pageId);
			state.excluded.push({
				pageId: entry.pageId,
				reason: "expired",
				detail: `hard expiry ${entry.expiresAt} has passed (ttl)`,
			});
			continue;
		}
		const verdict = admittedUnderCeiling(entry.classification, config.maxClassification);
		if (!verdict.ok) {
			state.seen.add(entry.pageId);
			state.excluded.push({
				pageId: entry.pageId,
				reason: "classification",
				detail:
					verdict.refusal === "classification-unknown"
						? "classification-unknown never satisfies any ceiling (§3.1)"
						: `classification ${entry.classification} exceeds the load ceiling ${config.maxClassification}`,
			});
		}
	}
}

function selectRequiredPages(pageEntries, requiredPins, state) {
	for (const pin of requiredPins) {
		if (state.seen.has(pin)) continue;
		state.seen.add(pin);
		const entry = pageEntries.find((candidate) => candidate.pageId === pin);
		if (!entry) {
			state.excluded.push({
				pageId: pin,
				reason: "obsolete",
				detail: "required-tier pin has no page on disk",
			});
			continue;
		}
		if (entry.supersededBy.length > 0) {
			state.excluded.push({
				pageId: pin,
				reason: "superseded",
				detail: `superseded by ${entry.supersededBy.join(", ")}`,
			});
			continue;
		}
		const reason = reasonForStatus(entry.status);
		if (reason === "tampered" || reason === "obsolete") {
			state.excluded.push({
				pageId: pin,
				reason,
				detail: `${entry.status} required-tier pin excluded (D4)`,
			});
			continue;
		}
		state.requiredPageIds.push(pin);
		state.pagesMap[pin] = {
			title: entry.page.title || "",
			words: entry.words,
			rawHash: entry.rawHash,
			status: entry.status === "stale" ? "stale" : "ok",
			scope: entry.scope || [],
			classification: entry.classification,
			classificationSource: entry.classificationSource,
			purpose: entry.purpose,
			expiresAt: entry.expiresAt,
		};
	}
	return state;
}

function addBudgetedTiers(pageEntries, state, budget, requiredWords) {
	const priorityCandidates = pageEntries
		.filter(
			(entry) =>
				entry.status === "ok" &&
				entry.supersededBy.length === 0 &&
				entry.matchesScope &&
				!state.seen.has(entry.pageId),
		)
		.sort(comparePriority);
	state.priorityPageIds = [];
	const remaining = budgetedAdd(
		priorityCandidates,
		state.priorityPageIds,
		state.pagesMap,
		state.seen,
		state.excluded,
		budget - requiredWords,
	);
	const optionalCandidates = pageEntries
		.filter(
			(entry) =>
				entry.status === "ok" && entry.supersededBy.length === 0 && !state.seen.has(entry.pageId),
		)
		.sort(comparePageIdAsc);
	state.optionalPageIds = [];
	budgetedAdd(
		optionalCandidates,
		state.optionalPageIds,
		state.pagesMap,
		state.seen,
		state.excluded,
		remaining,
	);
}

function appendStatusExclusions(pageEntries, state) {
	const included = new Set([
		...state.requiredPageIds,
		...state.priorityPageIds,
		...state.optionalPageIds,
	]);
	for (const entry of pageEntries) {
		if (included.has(entry.pageId)) continue;
		if (entry.supersededBy.length > 0) {
			state.excluded.push({
				pageId: entry.pageId,
				reason: "superseded",
				detail: `superseded by ${entry.supersededBy.join(", ")}`,
			});
			continue;
		}
		const reason = reasonForStatus(entry.status);
		if (!reason) continue;
		state.excluded.push({
			pageId: entry.pageId,
			reason,
			detail:
				reason === "stale"
					? "stale page excluded from priority/optional (D4)"
					: `${entry.status} page excluded at every tier (D4)`,
		});
	}
}

// F071 H3b: the firewall verdict, wired. Runs after the §3.3 authority
// exclusions and before any tier selection (a required pin cannot pull a page
// past the firewall either — selectRequiredPages skips seen pages). The build
// adds ZERO verdict logic: every candidate page goes through
// checkContextAccess verbatim (the same function the point-check command
// uses), so each denial lands on the trail as context.denied from the check
// itself. Allowed pages cite their covering grant; denied pages are excluded
// with reason "firewall" and the closed deny reason in the detail.
function applyFirewallExclusions(pageEntries, state, config, now) {
	if (!config.firewall) return { grants: [], deniedCount: 0 };
	const { subject, purpose, runId } = config.firewall;
	const at = now instanceof Date ? now.toISOString() : String(now);
	const covering = new Map();
	let deniedCount = 0;
	for (const entry of pageEntries) {
		if (state.seen.has(entry.pageId)) continue;
		// The check fails closed (corrupt/locked harness ledger throws a typed
		// error); the build converts that into its structured {errors} shape
		// instead of letting it escape mid-preview — still fail-closed, but
		// with the caller's contract intact.
		let verdict;
		try {
			verdict = checkContextAccess(config.targetRoot, {
				subject,
				resource: entry.pageId,
				purpose,
				classification: entry.classification,
				now: at,
				...(runId ? { runId } : {}),
			});
		} catch (error) {
			state.firewall = null;
			return {
				firewallError: {
					code: error.amberCode || "AMBER_E_CONTEXT_LOADOUT_FIREWALL",
					detail: `firewall verdict unavailable for ${entry.pageId}: ${error.message}`,
				},
			};
		}
		if (verdict.verdict === "allow") {
			if (!covering.has(verdict.grant)) {
				// The check's pointer carries the snapshot hash:
				// context-grant:<id>#<snapshotHash>.
				const hash =
					typeof verdict.grantPointer === "string" ? verdict.grantPointer.split("#")[1] : null;
				covering.set(verdict.grant, {
					id: verdict.grant,
					...(hash ? { snapshotHash: hash } : {}),
					validUntil: verdict.validUntil,
				});
			}
		} else {
			state.seen.add(entry.pageId);
			deniedCount += 1;
			state.excluded.push({
				pageId: entry.pageId,
				reason: "firewall",
				detail: `firewall deny (${verdict.reason}): no qualifying grant for subject ${subject} at purpose ${purpose}`,
			});
		}
	}
	return { grants: [...covering.values()], deniedCount, checkedAt: at };
}

function selectPageTiers(pageEntries, config) {
	const state = { excluded: [], pagesMap: {}, seen: new Set(), requiredPageIds: [] };
	// One build, one instant: expiry, ceiling, and the firewall verdict all
	// read the same clock (TTL is a half-open window with no skew tolerance).
	const now = new Date();
	// §3.3 authority exclusions run FIRST: classification-denied and expired
	// pages never enter any tier, required pins included.
	applyAuthorityExclusions(pageEntries, state, config, now);
	// F071 H3b: the firewall verdict second — pages already excluded for
	// expiry/ceiling never query the grants, and the recorded reason is the
	// first authority fact that applied.
	const firewall = applyFirewallExclusions(pageEntries, state, config, now);
	if (firewall.firewallError) return { error: firewall.firewallError };
	state.firewall = firewall;
	const required = selectRequiredPages(pageEntries, config.requiredPins, state);
	state.requiredPageIds = required.requiredPageIds;
	const supersededPin = state.excluded.find((entry) => entry.reason === "superseded");
	if (supersededPin) {
		return {
			error: {
				code: "AMBER_E_CONTEXT_PAGE_SUPERSEDED",
				detail: `${supersededPin.pageId} is ${supersededPin.detail}`,
			},
		};
	}
	if (config.knowledgeKinds.length > 0) {
		for (const entry of pageEntries) {
			if (state.seen.has(entry.pageId) || config.knowledgeKinds.includes(entry.knowledgeKind))
				continue;
			state.seen.add(entry.pageId);
			state.excluded.push({
				pageId: entry.pageId,
				reason: "knowledge-kind",
				detail: `Knowledge Kind ${entry.knowledgeKind} not requested`,
			});
		}
	}
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
	const firewall = selection.firewall;
	return {
		schemaVersion: SCHEMA_VERSION,
		route: config.route,
		feature: config.feature,
		generatedAt: pageState.generatedAt,
		budgetWords: config.budget,
		knowledgeKinds: config.knowledgeKinds,
		artifacts: { required: config.requiredArtifacts.artifacts },
		tiers: delta.tiers,
		pages: delta.pages,
		references: delta.references,
		excluded: selection.excluded.slice().sort(comparePageIdAsc),
		// §3.2 redaction ledger: records THAT a field was omitted inside
		// admitted pages and why. The build omits nothing today — the bounded,
		// deterministic empty ledger keeps the snapshot shape closed.
		redactions: [],
		// F071 H3b: present only when a governing subject was declared. Its
		// absence is the visible statement that this load was not
		// grant-governed — the build never stays silent about the mode.
		...(config.firewall
			? {
					firewall: {
						mode: "on",
						subject: config.firewall.subject,
						purpose: config.firewall.purpose,
						checkedAt: firewall.checkedAt,
						...(config.firewall.runId ? { runId: config.firewall.runId } : {}),
						grants: firewall.grants,
						deniedCount: firewall.deniedCount,
					},
				}
			: {}),
		deltaSince: delta.deltaSince,
	};
}

function persistLoadout(targetRoot, loadout, route, feature) {
	let loadoutPath;
	try {
		loadoutPath = loadoutPathFor(targetRoot, route, feature);
	} catch (error) {
		return {
			error: { code: "AMBER_E_CONTEXT_LOADOUT_REQUIRED", detail: error.message || String(error) },
		};
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
 * Assemble a deterministic, freshness-gated, budgeted Context Loadout.
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
function previewLoadout(targetRoot, opts = {}) {
	const warnings = [];
	const config = loadBuildConfig(targetRoot, opts);
	if (config.errors.length > 0) {
		return { loadout: null, loadoutPath: null, errors: config.errors, warnings };
	}
	const errors = [];

	const pageState = collectPageEntries(targetRoot, config.route, config.feature);
	if (pageState.error) {
		errors.push(pageState.error);
		return { loadout: null, loadoutPath: null, errors, warnings };
	}

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

	return { loadout, errors, warnings };
}

/** Build and persist a deterministic Context Loadout file. */
function buildLoadout(targetRoot, opts = {}) {
	const preview = previewLoadout(targetRoot, opts);
	if (preview.errors.length > 0) {
		return { ...preview, loadoutPath: null };
	}
	const { loadout, errors, warnings } = preview;
	const persisted = persistLoadout(targetRoot, loadout, loadout.route, loadout.feature);
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
		return {
			finding: loadoutFinding("AMBER_E_CONTEXT_LOADOUT_MISSING", error.message || String(error)),
		};
	}
	if (!fs.existsSync(resolvedPath)) {
		return {
			finding: loadoutFinding(
				"AMBER_E_CONTEXT_LOADOUT_MISSING",
				`loadout file not found: ${resolvedPath}`,
			),
		};
	}
	let loadout;
	try {
		loadout = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
	} catch (error) {
		return {
			finding: loadoutFinding(
				"AMBER_E_CONTEXT_LOADOUT_CORRUPT",
				`loadout JSON parse failed: ${error.message}`,
			),
		};
	}
	const shapeErrors = validateLoadoutShape(loadout);
	if (shapeErrors.length > 0) {
		return {
			finding: loadoutFinding(
				"AMBER_E_CONTEXT_LOADOUT_CORRUPT",
				`loadout schema validation failed: ${shapeErrors.join("; ")}`,
			),
		};
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
		return loadoutFinding("AMBER_E_CONTEXT_LOADOUT_REQUIRED", error.message || String(error), {
			kind: expected.kind,
		});
	}
	if (relativeSlash(targetRoot, artifactPath) !== expected.path) {
		return loadoutFinding(
			"AMBER_E_CONTEXT_LOADOUT_REQUIRED",
			`required ${expected.kind} path must be ${expected.path}`,
			{ kind: expected.kind },
		);
	}
	if (!fs.existsSync(artifactPath)) {
		return loadoutFinding(
			"AMBER_E_CONTEXT_LOADOUT_REQUIRED",
			`required ${expected.kind} is missing: ${expected.path}`,
			{ kind: expected.kind },
		);
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
		: loadoutFinding(
				"AMBER_E_CONTEXT_LOADOUT_REQUIRED",
				`required ${expected.kind} changed since loadout generation`,
				{ kind: expected.kind },
			);
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
			findings.push({
				pageId,
				code: "AMBER_E_CONTEXT_SOURCE_STALE",
				detail: "required-tier page no longer on disk",
			});
			continue;
		}
		const currentHash = sha256(canonicalJson(JSON.stringify(page)));
		const recordedHash = loadout.pages?.[pageId]?.rawHash || null;
		if (currentHash !== recordedHash) {
			findings.push({
				pageId,
				code: "AMBER_E_CONTEXT_SOURCE_STALE",
				detail: "required-tier page changed since loadout generation",
			});
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

module.exports = {
	loadoutsDir,
	previewLoadout,
	buildLoadout,
	verifyLoadoutFile,
	requiredArtifactSpecs,
};
