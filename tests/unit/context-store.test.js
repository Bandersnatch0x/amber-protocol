"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	pagesDir,
	requestsDir,
	eventsPath,
	indexPath,
	listPages,
	readPage,
	writePage,
	deletePage,
	regenerateIndex,
	appendEvent,
	readEvents,
} = require("../../scripts/lib/core/context-store");



function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ctx-"));
	fs.mkdirSync(path.join(root, "docs", "wiki"), { recursive: true });
	return root;
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		/* noop */
	}
}

function samplePage(overrides = {}) {
	return {
		schemaVersion: "1.0.0",
		pageId: "governed-execution",
		title: "Governed execution: the five gates",
		sources: {
			s1: {
				kind: "adr",
				ref: "docs/adr/0003-governance-gated-execution.md",
				rawHash: "sha256:" + "a".repeat(64),
				normHash: "sha256:" + "b".repeat(64),
				mutable: true,
			},
		},
		blocks: [{ type: "prose", sources: ["s1"], text: "Five preconditions gate execution." }],
		...overrides,
	};
}

describe("context-store paths", () => {
	it("resolves canonical paths under .amber/context and docs/wiki", () => {
		const root = makeTarget();
		try {
			assert.ok(pagesDir(root).endsWith(path.join(".amber", "context", "pages")));
			assert.ok(requestsDir(root).endsWith(path.join(".amber", "context", "requests")));
			assert.ok(eventsPath(root).endsWith(path.join(".amber", "context", "events.jsonl")));
			assert.ok(indexPath(root).endsWith(path.join("docs", "wiki", "context-index.md")));
		} finally {
			cleanup(root);
		}
	});
});

describe("writePage / listPages / readPage", () => {
	it("persists a page and lists it via directory scan", () => {
		const root = makeTarget();
		try {
			const page = samplePage();
			writePage(root, page);
			const listed = listPages(root);
			assert.equal(listed.length, 1);
			assert.equal(listed[0].pageId, "governed-execution");
			const loaded = readPage(root, "governed-execution");
			assert.equal(loaded.title, page.title);
			assert.equal(loaded.sources.s1.mutable, true);
		} finally {
			cleanup(root);
		}
	});

	it("returns null for a missing page", () => {
		const root = makeTarget();
		try {
			assert.equal(readPage(root, "nope"), null);
		} finally {
			cleanup(root);
		}
	});

	it("surfaces a malformed persisted page instead of hiding it as missing", () => {
		const root = makeTarget();
		try {
			fs.mkdirSync(pagesDir(root), { recursive: true });
			fs.writeFileSync(
				path.join(pagesDir(root), "broken-page.json"),
				"{not-json\n",
				"utf8",
			);
			assert.throws(
				() => readPage(root, "broken-page"),
				/failed to parse JSON file/i,
			);
		} finally {
			cleanup(root);
		}
	});

	it("overwrites an existing page id", () => {
		const root = makeTarget();
		try {
			writePage(root, samplePage({ title: "v1" }));
			writePage(root, samplePage({ title: "v2" }));
			const listed = listPages(root);
			assert.equal(listed.length, 1);
			assert.equal(readPage(root, "governed-execution").title, "v2");
		} finally {
			cleanup(root);
		}
	});

	it("rejects traversal page ids before read, write, or delete", () => {
		const root = makeTarget();
		try {
			const unsafeId = "../../../../outside";
			assert.throws(() => readPage(root, unsafeId), /invalid Context Page id/i);
			assert.throws(
				() => writePage(root, samplePage({ pageId: unsafeId })),
				/invalid Context Page id/i,
			);
			assert.throws(() => deletePage(root, unsafeId), /invalid Context Page id/i);
		} finally {
			cleanup(root);
		}
	});

	it("rejects a pages directory junction that escapes the target", () => {
		const root = makeTarget();
		const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ctx-link-"));
		try {
			const linkedPages = pagesDir(root);
			fs.mkdirSync(path.dirname(linkedPages), { recursive: true });
			fs.symlinkSync(
				outsideRoot,
				linkedPages,
				process.platform === "win32" ? "junction" : "dir",
			);
			assert.throws(
				() => writePage(root, samplePage()),
				/outside the target/i,
			);
			assert.equal(fs.existsSync(path.join(outsideRoot, "governed-execution.json")), false);
		} finally {
			cleanup(root);
			cleanup(outsideRoot);
		}
	});

	it("rejects a dangling page-file symlink that points outside the target", (t) => {
		const root = makeTarget();
		const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ctx-dangling-"));
		try {
			const linkedPages = pagesDir(root);
			fs.mkdirSync(linkedPages, { recursive: true });
			const outsideFile = path.join(outsideRoot, "missing-page.json");
			const linkedFile = path.join(linkedPages, "governed-execution.json");
			try {
				fs.symlinkSync(outsideFile, linkedFile, "file");
			} catch (error) {
				if (error && (error.code === "EPERM" || error.code === "EACCES")) {
					t.skip("file symlink creation is not permitted on this host");
					return;
				}
				throw error;
			}
			assert.throws(
				() => writePage(root, samplePage()),
				/outside the target/i,
			);
			assert.equal(fs.existsSync(outsideFile), false);
		} finally {
			cleanup(root);
			cleanup(outsideRoot);
		}
	});
});

describe("regenerateIndex", () => {
	it("writes a markdown table with one row per page and status", () => {
		const root = makeTarget();
		try {
			writePage(root, samplePage({ pageId: "page-a", title: "Page A" }));
			writePage(
				root,
				samplePage({ pageId: "page-b", title: "Page B", sources: {} }),
			);
			// page-b has no sources -> obsolete; page-a ok
			const index = regenerateIndex(root);
			const text = fs.readFileSync(index, "utf8");
			assert.ok(text.includes("| pageId | title | blocks | sources | status |"));
			assert.ok(text.includes("page-a"));
			assert.ok(text.includes("page-b"));
			assert.ok(text.includes("ok") || text.includes("stale"));
		} finally {
			cleanup(root);
		}
	});

	it("returns a path even with zero pages", () => {
		const root = makeTarget();
		try {
			const index = regenerateIndex(root);
			assert.ok(fs.existsSync(index));
			const text = fs.readFileSync(index, "utf8");
			assert.ok(text.includes("No context pages"));
		} finally {
			cleanup(root);
		}
	});
});

describe("events", () => {
	it("appends and reads events as JSON lines", () => {
		const root = makeTarget();
		try {
			appendEvent(root, { kind: "request-created", requestId: "r1" });
			appendEvent(root, { kind: "ingest", requestId: "r1", outcome: "accepted" });
			const events = readEvents(root);
			assert.equal(events.length, 2);
			assert.equal(events[0].kind, "request-created");
			assert.equal(events[1].outcome, "accepted");
		} finally {
			cleanup(root);
		}
	});

	it("returns an empty list when no events file exists", () => {
		const root = makeTarget();
		try {
			assert.deepEqual(readEvents(root), []);
		} finally {
			cleanup(root);
		}
	});
});
