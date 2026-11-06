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

// §6.5 γ 168h rolling window: count admitted memory-ingest entryIds in [T-168h, T].
function gammaWindow(targetRoot) {
	const now = Date.now();
	const since = now - GAMMA_WINDOW_MS;
	const windowAdmitted = store
		.readMemoryEvents(targetRoot, since)
		.filter((e) => e.kind === "memory-ingest" && e.outcome === "admitted")
		.reduce((sum, e) => sum + (Array.isArray(e.entryIds) ? e.entryIds.length : 0), 0);
	return {
		windowAdmitted,
		quotaRemaining: Math.max(0, GAMMA_QUOTA - windowAdmitted),
		windowStart: new Date(since).toISOString(),
		windowEnd: new Date(now).toISOString(),
	};
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
	SIGNAL_REQUIRED_CHANNELS,
	SIGNAL_CLOSED_SET,
	nowIso,
	readMemoryMd,
	surfaceUsage,
	gammaWindow,
	computeEntryIdFor,
	withEntryId,
	candidateK1,
	rankEntries,
	maybeResolveRequests,
};
