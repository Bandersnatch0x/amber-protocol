"use strict";

/**
 * Governed Memory Layer policy (ADR-0018) — architecture review #5.
 *
 * The policy surface (resolution rules, surface usage) used to
 * live inside the memory command module, far from the store it tunes.
 * This module owns the policy: request resolution, and entry identity. The command
 * module (memory-commands.js) is a thin adapter over the pipeline
 * request → ingest → approve → book (unchanged, ADR-0018).
 *
 * F089 retired the γ admission limit and its provenance-only exemption; the
 * module no longer carries a quota, ranking or partition predicate.
 */

const fs = require("node:fs");
const path = require("node:path");
const store = require("./memory-store");
const { canonicalJson } = require("./context-hash");

// ── Constants (spec §6 budgets, §10 schema version) ──────────────────────────
const SCHEMA_VERSION = "1.0.0";
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
	AUTO_ABANDON_THRESHOLD,
	MEMORY_MD,
	SIGNAL_REQUIRED_CHANNELS,
	SIGNAL_CLOSED_SET,
	nowIso,
	readMemoryMd,
	surfaceUsage,
	computeEntryIdFor,
	withEntryId,
	maybeResolveRequests,
};
