"use strict";

// File layout for the amber context layer (ADR-0009 D3).
//
//   .amber/context/pages/<pageId>.json    accepted pages (dir scan = manifest)
//   .amber/context/requests/<id>.json     distillation contracts (requests)
//   .amber/context/events.jsonl           append-only operational events (D9)
//   docs/wiki/context-index.md            the one generated wiki file (D3)

const fs = require("node:fs");
const path = require("node:path");
const { readJson, resolvePathWithin } = require("./fs-utils");

const SCHEMA_VERSION = "1.0.0";
const INDEX_REL = path.join("docs", "wiki", "context-index.md");
const PAGE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function pagesDir(targetRoot) {
	return resolvePathWithin(targetRoot, path.join(".amber", "context", "pages"), {
		label: "Context Pages directory",
	});
}

function requestsDir(targetRoot) {
	return resolvePathWithin(targetRoot, path.join(".amber", "context", "requests"), {
		label: "Context requests directory",
	});
}

function eventsPath(targetRoot) {
	return resolvePathWithin(targetRoot, path.join(".amber", "context", "events.jsonl"), {
		label: "Context events file",
	});
}

function indexPath(targetRoot) {
	return resolvePathWithin(targetRoot, INDEX_REL, { label: "Context index file" });
}

function pagePath(targetRoot, pageId) {
	if (typeof pageId !== "string" || !PAGE_ID_RE.test(pageId)) {
		throw new Error(`Invalid Context Page id: ${pageId}. Expected kebab-case.`);
	}
	pagesDir(targetRoot);
	return resolvePathWithin(targetRoot, path.join(".amber", "context", "pages", `${pageId}.json`), {
		label: "Context Page file",
	});
}

/** List accepted pages as [{ pageId, filePath }] via directory scan. */
function listPages(targetRoot) {
	const dir = pagesDir(targetRoot);
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isFile() && d.name.endsWith(".json"))
		.map((d) => ({ pageId: d.name.replace(/\.json$/, ""), filePath: path.join(dir, d.name) }))
		.sort((a, b) => a.pageId.localeCompare(b.pageId));
}

/** Read a page object, or null when missing. Malformed persisted pages are errors. */
function readPage(targetRoot, pageId) {
	const file = pagePath(targetRoot, pageId);
	if (!fs.existsSync(file)) return null;
	return readJson(file);
}

/**
 * Read every accepted page as an object, skipping unreadable files.
 *
 * The canonical-evidence reader for projections (Governance Graph,
 * Visualization Workbench): unreadable pages are NOT canonical evidence and
 * are dropped, never fatal. Sorted by pageId for determinism.
 */
function readCanonicalPages(targetRoot) {
	return listPages(targetRoot)
		.map(({ filePath }) => {
			try {
				return JSON.parse(fs.readFileSync(filePath, "utf8"));
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

/** Persist a page, synchronize the generated index, and emit a page-write event. */
function writePage(targetRoot, page, event = {}) {
	const dir = pagesDir(targetRoot);
	ensureDir(dir);
	const file = pagePath(targetRoot, page.pageId);
	fs.writeFileSync(file, JSON.stringify(page, null, 2) + "\n", "utf8");
	regenerateIndex(targetRoot);
	appendEvent(targetRoot, {
		kind: "page-written",
		pageId: page.pageId,
		...event,
	});
	return file;
}

/** Remove a page file, returning true when it existed. */
function deletePage(targetRoot, pageId) {
	const file = pagePath(targetRoot, pageId);
	if (!fs.existsSync(file)) return false;
	fs.rmSync(file, { force: true });
	regenerateIndex(targetRoot);
	appendEvent(targetRoot, { kind: "page-deleted", pageId });
	return true;
}

/** Compatibility entry point; the projection service is the only index writer. */
function regenerateIndex(targetRoot) {
	return require("./context-projection").rebuildProjection(targetRoot).outputPath;
}

/** Append one JSON line to the append-only event log. */
function appendEvent(targetRoot, event) {
	const file = eventsPath(targetRoot);
	ensureDir(path.dirname(file));
	const recorded = { ...event, at: new Date().toISOString() };
	fs.appendFileSync(file, JSON.stringify(recorded) + "\n", "utf8");
	return recorded;
}

/** Read all events as objects. */
function readEvents(targetRoot) {
	const file = eventsPath(targetRoot);
	if (!fs.existsSync(file)) return [];
	return fs
		.readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

module.exports = {
	SCHEMA_VERSION,
	INDEX_REL,
	pagesDir,
	requestsDir,
	eventsPath,
	indexPath,
	pagePath,
	listPages,
	readPage,
	readCanonicalPages,
	writePage,
	deletePage,
	regenerateIndex,
	appendEvent,
	readEvents,
};
