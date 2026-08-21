"use strict";

// Data layer for the Governed Memory Layer (spec 2026-08-21-governed-memory-layer
// §4.2/§9/§10). This module owns the on-disk registry + request stores and the
// memory-* event append/read primitives. It reuses the context layer parts the
// spec forces (§4.3-B1): context-store.appendEvent/readEvents for the single
// events.jsonl ledger, context-hash.sha256 for entryId identity, and
// fs-utils.resolvePathWithin for path safety. It never writes human-curated
// surfaces (MEMORY.md is read-only here) and never physically deletes entries.
//
//   .amber/memory/registry/<entryId>.json   entry registry (rebuildable, §3.5)
//   .amber/memory/requests/<requestId>.json  nomination requests (never deleted, §10.4)
//   .amber/context/events.jsonl              shared append-only ledger (§9)

const fs = require("node:fs");
const path = require("node:path");
const { appendEvent, readEvents } = require("./context-store");
const { sha256 } = require("./context-hash");
const { resolvePathWithin } = require("./fs-utils");

// Event kind closed set (§2.2 / §9 — 5 values, never extended).
const MEMORY_EVENT_KINDS = Object.freeze([
	"memory-request-created",
	"memory-ingest",
	"memory-approval",
	"memory-book",
	"memory-abandon",
]);
const MEMORY_EVENT_KIND_SET = new Set(MEMORY_EVENT_KINDS);

const ENTRY_ID_RE = /^sha256:[0-9a-f]{64}$/;
const REQUEST_ID_RE = /^[a-z0-9-]+$/;

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function registryDir(targetRoot) {
	return resolvePathWithin(targetRoot, path.join(".amber", "memory", "registry"), {
		label: "Memory registry directory",
	});
}

function requestsDir(targetRoot) {
	return resolvePathWithin(targetRoot, path.join(".amber", "memory", "requests"), {
		label: "Memory requests directory",
	});
}

// entryId carries a "sha256:" prefix; the colon is not a portable filename
// character (Windows), so the on-disk name substitutes it with a hyphen while
// the authoritative id stays inside the file body.
function entryFileName(entryId) {
	if (typeof entryId !== "string" || !ENTRY_ID_RE.test(entryId)) {
		throw new Error(`Invalid memory entryId: ${entryId}. Expected sha256:<64 hex>.`);
	}
	return `${entryId.replace(":", "-")}.json`;
}

function entryPath(targetRoot, entryId) {
	registryDir(targetRoot);
	return resolvePathWithin(
		targetRoot,
		path.join(".amber", "memory", "registry", entryFileName(entryId)),
		{ label: "Memory entry file" },
	);
}

function requestPath(targetRoot, requestId) {
	if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
		throw new Error(`Invalid memory requestId: ${requestId}. Expected ^[a-z0-9-]+$.`);
	}
	requestsDir(targetRoot);
	return resolvePathWithin(
		targetRoot,
		path.join(".amber", "memory", "requests", `${requestId}.json`),
		{ label: "Memory request file" },
	);
}

// Atomic JSON write: write to a sibling .tmp then rename into place so a reader
// never observes a partial object (registry is a rebuildable catalog, §3.5).
function atomicWriteJson(file, data) {
	ensureDir(path.dirname(file));
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
	fs.renameSync(tmp, file);
	return file;
}

// ---- entry registry ------------------------------------------------------

// Persist a single registry entry object (registry holds one object per entry;
// arrays live only in request payloads / ingest input, §4.2-C1).
function writeEntry(targetRoot, entry) {
	if (!entry || typeof entry !== "object") {
		throw new Error("writeEntry requires an entry object.");
	}
	const file = entryPath(targetRoot, entry.entryId);
	return atomicWriteJson(file, entry);
}

// Read one entry object, or null when the file is absent.
function readEntry(targetRoot, entryId) {
	const file = entryPath(targetRoot, entryId);
	if (!fs.existsSync(file)) return null;
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

// List every persisted entry object via a directory scan (dir scan = manifest).
function listEntries(targetRoot) {
	const dir = registryDir(targetRoot);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
		.sort((a, b) => String(a.entryId || "").localeCompare(String(b.entryId || "")));
}

// ---- request store -------------------------------------------------------

// Persist a request artifact (requests are never deleted, §10.4).
function writeRequest(targetRoot, request) {
	if (!request || typeof request !== "object") {
		throw new Error("writeRequest requires a request object.");
	}
	const file = requestPath(targetRoot, request.requestId);
	return atomicWriteJson(file, request);
}

// Read every request artifact via a directory scan.
function readRequests(targetRoot) {
	const dir = requestsDir(targetRoot);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
		.sort((a, b) => String(a.requestId || "").localeCompare(String(b.requestId || "")));
}

// ---- event ledger (memory-* subset) --------------------------------------

// Append one memory-* event through the shared context-store ledger (§9: no
// private event files; every trigger source reuses appendEvent). The kind is
// validated against the 5-value closed set (§2.2) fail-closed.
function appendMemoryEvent(targetRoot, event) {
	if (!event || typeof event !== "object" || !MEMORY_EVENT_KIND_SET.has(event.kind)) {
		throw new Error(
			`Invalid memory event kind: ${event && event.kind}. ` +
				`Expected one of [${MEMORY_EVENT_KINDS.join(", ")}].`,
		);
	}
	return appendEvent(targetRoot, event);
}

// Read memory-* events from the shared ledger. When sinceMs is provided, only
// events whose recorded `at` timestamp is at or after that epoch millisecond
// cutoff are returned (used by the γ 168h rolling window, §6.5).
function readMemoryEvents(targetRoot, sinceMs) {
	const events = readEvents(targetRoot).filter(
		(event) => event && typeof event.kind === "string" && event.kind.startsWith("memory-"),
	);
	if (sinceMs === undefined || sinceMs === null) return events;
	return events.filter((event) => {
		const at = Date.parse(event.at);
		return Number.isFinite(at) && at >= sinceMs;
	});
}

// ---- identity + MEMORY.md surface parsing --------------------------------

// entryId identity = sha256 of the canonicalized entry JSON (§10.2). The caller
// supplies the canonical JSON string; identity reuses the context-hash digest.
function computeEntryId(canonicalJson) {
	return sha256(canonicalJson);
}

// Registered surface hash = sha256 of the normalized MEMORY.md (§5.5/§11-4).
function computeSurfaceHash(content) {
	return sha256(normalizeMemoryMd(content));
}

// Normalize MEMORY.md for the α byte dimension (§10.3): strip BOM, CRLF→LF,
// strip trailing whitespace per line.
function normalizeMemoryMd(content) {
	return String(content)
		.replace(/^\uFEFF/, "")
		.replace(/\r\n/g, "\n")
		.replace(/[ \t]+$/gm, "");
}

// Parse MEMORY.md into the α counts (§10.3, deterministic, zero semantic
// judgment): entryCount = number of `^### ` lines inside the `## Entries`
// region; bytes = normalized UTF-8 byte length of the whole file.
function parseMEMORYMd(content) {
	const normalized = normalizeMemoryMd(content);
	const bytes = Buffer.byteLength(normalized, "utf8");
	const lines = normalized.split("\n");
	let inEntries = false;
	let entries = 0;
	for (const line of lines) {
		if (/^## Entries\s*$/.test(line)) {
			inEntries = true;
			continue;
		}
		if (inEntries && /^## (?!Entries\s*$)/.test(line)) {
			inEntries = false;
			continue;
		}
		if (inEntries && /^### /.test(line)) entries += 1;
	}
	return { entries, bytes };
}

module.exports = {
	MEMORY_EVENT_KINDS,
	registryDir,
	requestsDir,
	entryPath,
	requestPath,
	writeEntry,
	readEntry,
	listEntries,
	writeRequest,
	readRequests,
	appendMemoryEvent,
	readMemoryEvents,
	computeEntryId,
	computeSurfaceHash,
	normalizeMemoryMd,
	parseMEMORYMd,
};
