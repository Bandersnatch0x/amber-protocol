"use strict";

/**
 * Governed Memory Layer policy (ADR-0018) — architecture review #5.
 *
 * The policy surface (ranking math, resolution rules, surface usage) used to
 * live inside the memory command module, far from the store it tunes.
 * This module owns the policy: gamma state, candidate ranking (K1/K2/K3),
 * request resolution, and entry identity. The command
 * module (memory-commands.js) is a thin adapter over the pipeline
 * request → ingest → approve → book (unchanged, ADR-0018).
 *
 * F087: gamma counts *charged* admissions only. A provenance-only refresh of
 * an existing entry (same claim / knowledge kind / target surface, new source
 * bindings, real eligible predecessor) is admitted without consuming quota.
 * The predicate below is the single definition every consumer imports.
 */

const fs = require("node:fs");
const path = require("node:path");
const store = require("./memory-store");
const { canonicalJson } = require("./context-hash");

// ── Constants (spec §6 budgets, §10 schema version) ──────────────────────────
const SCHEMA_VERSION = "1.0.0";
const GAMMA_QUOTA = 5; // §6.5 168h 滚动窗口配额
const GAMMA_WINDOW_MS = 168 * 3600 * 1000; // §6.5 168h
const AUTO_ABANDON_THRESHOLD = 3; // §5.6-F1(i) ingest 拒绝累计 3 次
const MEMORY_MD = "MEMORY.md";

// F087 §2: a refresh may only replace a predecessor the approval pipeline
// could itself supersede (§5.4 approveSupersedePair accepts these two states).
const REFRESH_ELIGIBLE_STATUSES = new Set(["active", "needs-re-review"]);
// The registry rejects a malformed id by throwing; the predicate must answer
// "not exempt" instead, because supersedeTarget is caller-supplied text.
const ENTRY_ID_RE = /^sha256:[0-9a-f]{64}$/;

// §5.3 signal-required channels: conversion + dreaming carry a closed-set
// signal id; T1/T2 and escape-hatch are exempt (absorption / sovereignty).
const SIGNAL_REQUIRED_CHANNELS = new Set([
	"dreaming-maintenance",
	"distill-conversion",
	"maintenance-conversion",
	"evolution-conversion",
	"regression-conversion",
]);
const SIGNAL_CLOSED_SET = new Set([
	"break-loop-recurrence",
	"distill-count",
	"executed-evidence",
	"f023-category-hit",
	"evolution-recurrence",
	"t1t2-trigger",
]);

/** Deterministic ISO timestamp. */
function nowIso() {
	return new Date().toISOString();
}

function readMemoryMd(targetRoot) {
	const file = path.join(targetRoot, MEMORY_MD);
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

// Physical MEMORY.md usage (never registry counts). F086 retired the budget
// that used to compare these numbers against a ceiling; they stay observable.
function surfaceUsage(targetRoot) {
	const { entries, bytes } = store.parseMEMORYMd(readMemoryMd(targetRoot));
	return { entries, bytes };
}

// F087 §3.3: the two fields that partition an admitted batch. Presence is
// decided by property ownership, not by shape: a record that carries either
// field must carry both, as entry-id arrays, or it is a corrupt ledger record
// and is never reinterpreted as legacy.
const GAMMA_PARTITION_FIELDS = Object.freeze(["gammaChargedEntryIds", "gammaExemptEntryIds"]);

function hasPartitionField(event, key) {
	return Object.prototype.hasOwnProperty.call(event, key);
}

function isEntryIdArray(value) {
	return Array.isArray(value) && value.every((id) => typeof id === "string" && id.length > 0);
}

// §6.5 γ 168h rolling window: count CHARGED admitted entries in [T-168h, T].
// F087 §3.1: an event that carries a partition is counted by its charged side;
// an event without one is legacy and keeps the pre-F087 accounting
// (entryIds.length), so historical windows are never reinterpreted. A record
// whose partition is present but malformed is excluded from both counts and
// reported in `problems` — corrupt state is never silently re-read as legacy.
function gammaWindow(targetRoot) {
	const now = Date.now();
	const since = now - GAMMA_WINDOW_MS;
	let charged = 0;
	let exempt = 0;
	const problems = [];
	for (const event of store.readMemoryEvents(targetRoot, since)) {
		if (event.kind !== "memory-ingest" || event.outcome !== "admitted") continue;
		const problem = gammaPartitionProblem(event);
		if (problem) {
			problems.push({ requestId: event.requestId || null, problem });
			continue;
		}
		if (hasPartitionField(event, "gammaChargedEntryIds")) {
			charged += event.gammaChargedEntryIds.length;
			exempt += event.gammaExemptEntryIds.length;
		} else {
			charged += Array.isArray(event.entryIds) ? event.entryIds.length : 0;
		}
	}
	return {
		windowAdmitted: charged,
		windowExempt: exempt,
		quotaRemaining: Math.max(0, GAMMA_QUOTA - charged),
		windowStart: new Date(since).toISOString(),
		windowEnd: new Date(now).toISOString(),
		problems,
	};
}

// F087 §2: the single provenance-only-refresh predicate. Returns the
// predecessor entryId when the entry is a genuine refresh, otherwise null.
//
// The decision is registry-backed: it reads the predecessor from the entry
// registry, compares the three core text fields byte-for-byte, and requires the
// source binding to have actually changed. A caller can pick supersedeTarget,
// but cannot assert exemption — a changed claim, a missing/retired predecessor,
// a self-pointer, an identical source binding or a byte-identical resubmission
// all fall through as ordinary (charged) admissions.
//
// Identity difference is NOT evidence of a refresh: `entryId` hashes
// `supersedeTarget` too, so adding the pointer changes the id even when the
// sources are untouched. That is why the binding comparison below is explicit.
const SOURCE_SIGNATURE_FIELDS = Object.freeze([
	"kind",
	"ref",
	"rawHash",
	"normHash",
	"excerptHash",
]);

// The source binding is compared as a SET of signature strings: order is not a
// change, and neither is repeating an identical source. (This is deliberately
// not the entryIds multiset rule: admission accounting keeps same-side
// duplicates, but provenance identity is a set.)
function sourceBindingSignatures(entry) {
	const sources =
		entry && entry.provenance && Array.isArray(entry.provenance.sources)
			? entry.provenance.sources
			: [];
	const signatures = sources.map((source) => {
		const signature = {};
		for (const field of SOURCE_SIGNATURE_FIELDS)
			signature[field] = source ? source[field] : undefined;
		return JSON.stringify(signature);
	});
	return [...new Set(signatures)].sort();
}

function sourceBindingsEqual(left, right) {
	const a = sourceBindingSignatures(left);
	const b = sourceBindingSignatures(right);
	return a.length === b.length && a.every((signature, index) => signature === b[index]);
}

function gammaExemptTarget(targetRoot, entry) {
	if (!entry || typeof entry !== "object") return null;
	const targetId = entry.supersedeTarget;
	if (typeof targetId !== "string" || !ENTRY_ID_RE.test(targetId)) return null;
	if (entry.entryId === targetId) return null;
	const prior = store.readEntry(targetRoot, targetId);
	if (!prior) return null;
	if (!REFRESH_ELIGIBLE_STATUSES.has(prior.status)) return null;
	if (entry.claim !== prior.claim) return null;
	if (entry.knowledgeKind !== prior.knowledgeKind) return null;
	if (entry.targetSurface !== prior.targetSurface) return null;
	// A refresh must carry new provenance; an identical binding is a no-op
	// resubmission, not maintenance, and stays charged.
	if (sourceBindingsEqual(entry, prior)) return null;
	return targetId;
}

// F087 §3.3: split admitted identities into the charged and exempt sides in
// entryIds order. The partition is total and multiset-faithful: concatenating
// both sides restores entryIds exactly (duplicates included).
function partitionGammaAdmission(entryIds, exemptTargetsByEntryId) {
	const chargedEntryIds = [];
	const exemptEntryIds = [];
	for (const id of entryIds) {
		if (exemptTargetsByEntryId.has(id)) exemptEntryIds.push(id);
		else chargedEntryIds.push(id);
	}
	return { chargedEntryIds, exemptEntryIds };
}

// F087 §3.5: validate a recorded partition against the identities the same
// event admitted. Returns a short problem description, or null when the event
// is consistent. Legacy events (neither partition property present) are
// consistent by definition; a record that carries ONE of the two properties is
// incomplete, and a property of the wrong type (string, null, mixed array) is
// corrupt — both are reported rather than silently treated as empty or legacy.
function gammaPartitionProblem(event) {
	if (!event || event.kind !== "memory-ingest" || event.outcome !== "admitted") return null;
	const present = GAMMA_PARTITION_FIELDS.filter((key) => hasPartitionField(event, key));
	if (present.length === 0) return null;
	if (present.length !== GAMMA_PARTITION_FIELDS.length) {
		const missing = GAMMA_PARTITION_FIELDS.filter((key) => !present.includes(key));
		return `${present.join(", ")} present without ${missing.join(", ")}; a partitioned event carries both arrays`;
	}
	for (const key of GAMMA_PARTITION_FIELDS) {
		if (!isEntryIdArray(event[key])) {
			return `${key} must be an array of non-empty entry ids (got ${JSON.stringify(event[key])})`;
		}
	}
	const admitted = event.entryIds;
	if (!isEntryIdArray(admitted)) {
		return `entryIds must be an array of non-empty entry ids (got ${JSON.stringify(admitted)})`;
	}
	const charged = event.gammaChargedEntryIds;
	const exempt = event.gammaExemptEntryIds;
	// The two sides are disjoint sets: one identity is either charged or
	// exempt, never both. Duplicates WITHIN a side stay legal (the admitted
	// batch may repeat an input; no global de-duplication rule is added), and
	// the multiset below must still reconstruct entryIds exactly.
	const chargedSet = new Set(charged);
	const shared = [...new Set(exempt)].filter((id) => chargedSet.has(id));
	if (shared.length > 0) {
		return `entry ids appear on both sides (${shared.slice(0, 3).join(", ")}); the charged and exempt sets must be disjoint`;
	}
	const counts = (ids) => {
		const map = new Map();
		for (const id of ids) map.set(id, (map.get(id) || 0) + 1);
		return map;
	};
	const expected = counts(admitted);
	const actual = counts([...charged, ...exempt]);
	let consistent = expected.size === actual.size;
	if (consistent) {
		for (const [id, count] of expected) {
			if (actual.get(id) !== count) {
				consistent = false;
				break;
			}
		}
	}
	if (consistent) return null;
	return `entryIds ${admitted.length} vs charged ${charged.length} + exempt ${exempt.length} (identities do not reconstruct)`;
}

// §10.2 entryId = sha256 of canonical JSON of the core fields — revised content
// is a new entryId. canonicalJson takes a JSON string and sorts keys recursively.
function computeEntryIdFor(entry) {
	const core = {
		claim: entry.claim,
		knowledgeKind: entry.knowledgeKind,
		targetSurface: entry.targetSurface,
		sources: entry.provenance && entry.provenance.sources,
	};
	if (entry.supersedeTarget) core.supersedeTarget = entry.supersedeTarget;
	return store.computeEntryId(canonicalJson(JSON.stringify(core)));
}

function withEntryId(entry) {
	const withVersion = { schemaVersion: SCHEMA_VERSION, ...entry };
	return { ...withVersion, entryId: computeEntryIdFor(withVersion) };
}

// §6.5 K1 (staleness ↓) / K2 (supersession pressure ↓) / K3 (entryId ↑).
// §6.5 K1 for a NEW candidate: days since the newest on-disk provenance
// artifact (source file mtime), falling back to the nominating request's
// createdAt (Spec-defined 补全: T1/T2 候选取触发工件时间戳).
function candidateK1(targetRoot, entry, createdAt) {
	let newest = 0;
	for (const source of (entry.provenance && entry.provenance.sources) || []) {
		const ref = String(source.ref || "");
		if (!ref || ref === "manual") continue;
		const resolved = path.resolve(targetRoot, ref);
		if (resolved !== targetRoot && !resolved.startsWith(targetRoot + path.sep)) continue;
		if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
			newest = Math.max(newest, fs.statSync(resolved).mtimeMs);
		}
	}
	if (newest === 0 && createdAt) newest = Date.parse(createdAt) || 0;
	if (newest === 0) return 0;
	return Math.max(0, Math.floor((Date.now() - newest) / 86400000));
}

// §6.5 K1 (staleness ↓) / K2 (supersession pressure ↓) / K3 (entryId ↑) over
// a mixed candidate pool (current batch + queued open-request candidates).
function rankEntries(targetRoot, candidates) {
	const existing = store.listEntries(targetRoot);
	const allEntries = candidates.map((c) => c.entry);
	const supersessionPressure = (id) =>
		existing.filter((e) => e.supersedeTarget === id).length +
		allEntries.filter((e) => e.supersedeTarget === id).length;
	const ranked = candidates.map(({ entry, createdAt, queued }) => {
		// K1: a candidate targeting an existing entry (supersedeTarget) measures
		// THAT entry's last registry update (§6.5 候选针对既有条目); a fresh
		// candidate measures its newest provenance artifact (Spec-defined 补全).
		const prior = entry.supersedeTarget ? store.readEntry(targetRoot, entry.supersedeTarget) : null;
		const k1 =
			prior && prior.updatedAt
				? Math.max(0, Math.floor((Date.now() - Date.parse(prior.updatedAt)) / 86400000))
				: candidateK1(targetRoot, entry, createdAt);
		return {
			entry,
			entryId: entry.entryId,
			k1,
			k2: supersessionPressure(entry.entryId),
			queued: Boolean(queued),
		};
	});
	ranked.sort(
		(a, b) =>
			b.k1 - a.k1 || b.k2 - a.k2 || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0),
	);
	return ranked;
}

// §5.2-C5: a request resolves when every one of its original entryIds reaches
// a terminal disposition (active / superseded / rejected-draft / abandoned).
function maybeResolveRequests(targetRoot, entryIds) {
	const requests = store.readRequests(targetRoot);
	for (const id of entryIds) {
		const request = requests.find(
			(r) =>
				r.status !== "resolved" &&
				Array.isArray(r.entries) &&
				r.entries.some((e) => e.entryId === id),
		);
		if (!request) continue;
		const terminal = request.entries.every((e) => {
			const entry = store.readEntry(targetRoot, e.entryId);
			if (!entry) return false;
			if (["active", "superseded", "abandoned"].includes(entry.status)) return true;
			return entry.status === "draft" && Boolean(entry.lastRejection);
		});
		if (terminal) {
			request.status = "resolved";
			request.resolvedAt = nowIso();
			store.writeRequest(targetRoot, request);
		}
	}
}

module.exports = {
	SCHEMA_VERSION,
	GAMMA_QUOTA,
	GAMMA_WINDOW_MS,
	AUTO_ABANDON_THRESHOLD,
	MEMORY_MD,
	REFRESH_ELIGIBLE_STATUSES,
	SIGNAL_REQUIRED_CHANNELS,
	SIGNAL_CLOSED_SET,
	nowIso,
	readMemoryMd,
	surfaceUsage,
	gammaWindow,
	gammaExemptTarget,
	partitionGammaAdmission,
	gammaPartitionProblem,
	computeEntryIdFor,
	withEntryId,
	candidateK1,
	rankEntries,
	maybeResolveRequests,
};
