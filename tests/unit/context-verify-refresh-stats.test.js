"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { verifyPages } = require("../../scripts/lib/core/context-verify");
const { refreshPages } = require("../../scripts/lib/core/context-refresh");
const { writePage, regenerateIndex, requestsDir } = require("../../scripts/lib/core/context-store");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ver-"));
	fs.mkdirSync(path.join(root, "docs", "wiki"), { recursive: true });
	fs.mkdirSync(path.join(root, "scripts", "lib", "core"), { recursive: true });
	return root;
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		/* noop */
	}
}

function pageWithSource(ref, fileContent, overrides = {}) {
	return {
		schemaVersion: "1.0.0",
		pageId: "page-x",
		title: "Page X",
		sources: {
			s1: {
				kind: "code",
				ref,
				rawHash: "sha256:" + "a".repeat(64),
				normHash: "sha256:" + "b".repeat(64),
				mutable: true,
			},
		},
		blocks: [{ type: "prose", sources: ["s1"], text: "Claim." }],
		...overrides,
	};
}

function writeMutable(root, ref, content) {
	const full = path.join(root, ref);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content, "utf8");
}

describe("verifyPages", () => {
	it("reports ok for a page whose sources are fresh", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/governed-runner.js", "const gates = 5;\n");
			const page = pageWithSource("scripts/lib/core/governed-runner.js");
			// fix hashes to match disk
			const { hashFile } = require("../../scripts/lib/core/context-hash");
			const h = hashFile(path.join(root, "scripts/lib/core/governed-runner.js"));
			page.sources.s1.rawHash = h.rawHash;
			page.sources.s1.normHash = h.normHash;
			writePage(root, page);
			regenerateIndex(root);
			const result = verifyPages(root);
			assert.equal(result.pages.length, 1);
			assert.equal(result.pages[0].status, "ok");
			assert.equal(result.pages[0].findings.length, 0);
		} finally {
			cleanup(root);
		}
	});

	it("flags a stale page when a mutable source changed", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/governed-runner.js", "const gates = 5;\n");
			const page = pageWithSource("scripts/lib/core/governed-runner.js");
			writePage(root, page);
			regenerateIndex(root);
			// source changed
			writeMutable(root, "scripts/lib/core/governed-runner.js", "const gates = 7;\n");
			const result = verifyPages(root);
			assert.equal(result.pages[0].status, "stale");
			assert.ok(result.pages[0].findings.some((f) => f.code === "AMBER_E_CONTEXT_SOURCE_STALE"));
		} finally {
			cleanup(root);
		}
	});

	it("marks a page obsolete when every mutable source is gone", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/gone.js", "const x = 1;\n");
			const page = pageWithSource("scripts/lib/core/gone.js");
			writePage(root, page);
			regenerateIndex(root);
			fs.rmSync(path.join(root, "scripts", "lib", "core", "gone.js"), { force: true });
			const result = verifyPages(root);
			assert.equal(result.pages[0].status, "obsolete");
			assert.ok(result.pages[0].findings.some((f) => f.code === "AMBER_E_CONTEXT_PAGE_OBSOLETE"));
		} finally {
			cleanup(root);
		}
	});

	it("flags tampered immutable sources", () => {
		const root = makeTarget();
		try {
			const page = pageWithSource(".amber/sessions/s1/ledger.jsonl#L1-L1", null, {
				sources: {
					s1: {
						kind: "ledger",
						ref: ".amber/sessions/s1/ledger.jsonl#L1-L1",
						rawHash: "sha256:" + "c".repeat(64),
						mutable: false,
						excerpt: '{"action":"original"}',
						excerptHash: require("../../scripts/lib/core/context-hash").sha256(
							'{"action":"original"}',
						),
					},
				},
			});
			writePage(root, page);
			regenerateIndex(root);
			writeMutable(root, ".amber/sessions/s1/ledger.jsonl", '{"action":"tampered"}\n');
			const result = verifyPages(root);
			assert.ok(result.pages[0].findings.some((f) => f.code === "AMBER_E_CONTEXT_SOURCE_TAMPERED"));
		} finally {
			cleanup(root);
		}
	});

	it("reports orphaned pages missing from the index", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/governed-runner.js", "const gates = 5;\n");
			const page = pageWithSource("scripts/lib/core/governed-runner.js");
			writeMutable(
				root,
				path.join(".amber", "context", "pages", "page-x.json"),
				JSON.stringify(page, null, 2) + "\n",
			);
			const result = verifyPages(root);
			assert.ok(result.pages[0].findings.some((f) => f.code === "AMBER_E_CONTEXT_PAGE_ORPHANED"));
		} finally {
			cleanup(root);
		}
	});

	it("fails closed when a persisted source ref escapes the target", () => {
		const root = makeTarget();
		const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ver-outside-"));
		try {
			const outsideFile = path.join(outsideRoot, "source.js");
			fs.writeFileSync(outsideFile, "const secret = true;\n", "utf8");
			const ref = path.relative(root, outsideFile).split(path.sep).join("/");
			writePage(root, pageWithSource(ref));
			regenerateIndex(root);
			const result = verifyPages(root);
			assert.ok(
				result.pages[0].findings.some(
					(f) =>
						f.code === "AMBER_E_CONTEXT_SOURCE_MISSING" && /outside the target/i.test(f.detail),
				),
				JSON.stringify(result.pages[0].findings),
			);
		} finally {
			cleanup(root);
			cleanup(outsideRoot);
		}
	});
});

describe("verifyPages excerpt integrity (D5a outcome 1)", () => {
	it("flags a page whose embedded excerpt fails its own hash (page corruption)", () => {
		const root = makeTarget();
		try {
			const page = pageWithSource(".amber/sessions/s1/ledger.jsonl#L1-L1", null, {
				sources: {
					s1: {
						kind: "ledger",
						ref: ".amber/sessions/s1/ledger.jsonl#L1-L1",
						rawHash: "sha256:" + "c".repeat(64),
						mutable: false,
						excerpt: '{"action":"original"}',
						excerptHash: require("../../scripts/lib/core/context-hash").sha256(
							'{"action":"original"}',
						),
					},
				},
			});
			writePage(root, page);
			regenerateIndex(root);
			// A human/agent edits the page file, changing the excerpt but not the hash
			const pagePath = path.join(root, ".amber", "context", "pages", "page-x.json");
			const raw = JSON.parse(fs.readFileSync(pagePath, "utf8"));
			raw.sources.s1.excerpt = '{"action":"edited-in-page"}';
			fs.writeFileSync(pagePath, JSON.stringify(raw, null, 2), "utf8");
			const result = verifyPages(root);
			assert.ok(
				result.pages[0].findings.some(
					(f) => f.code === "AMBER_E_CONTEXT_SOURCE_TAMPERED" && f.detail.includes("corrupted"),
				),
				JSON.stringify(result.pages[0].findings),
			);
		} finally {
			cleanup(root);
		}
	});
});

describe("refreshPages", () => {
	it("refuses to refresh a persisted source outside the target", () => {
		const root = makeTarget();
		const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-refresh-outside-"));
		try {
			const outsideFile = path.join(outsideRoot, "source.js");
			fs.writeFileSync(outsideFile, "const secret = true; // external\n", "utf8");
			const ref = path.relative(root, outsideFile).split(path.sep).join("/");
			const { hashFile } = require("../../scripts/lib/core/context-hash");
			const externalHash = hashFile(outsideFile);
			const page = pageWithSource(ref);
			page.sources.s1.normHash = externalHash.normHash;
			writePage(root, page);
			regenerateIndex(root);
			const result = refreshPages(root);
			assert.deepEqual(result.requests, []);
			assert.deepEqual(result.rawOnlyRebases, []);
			assert.match(result.errors.join("\n"), /outside the target/i);
		} finally {
			cleanup(root);
			cleanup(outsideRoot);
		}
	});

	it("creates refresh requests for stale pages and rebases raw-only changes silently", () => {
		const root = makeTarget();
		try {
			// seed a page with a code source
			writeMutable(root, "scripts/lib/core/governed-runner.js", "const gates = 5;\n");
			const page = pageWithSource("scripts/lib/core/governed-runner.js");
			writePage(root, page);
			regenerateIndex(root);

			// norm-level change -> refresh request
			writeMutable(root, "scripts/lib/core/governed-runner.js", "const gates = 7;\n// extra\n");
			const result = refreshPages(root);
			assert.ok(result.requests.length >= 1);
			const reqFiles = fs.readdirSync(requestsDir(root)).filter((f) => f.endsWith(".json"));
			assert.ok(reqFiles.length >= 1);
		} finally {
			cleanup(root);
		}
	});

	it("rebases raw-only changes without creating a request", () => {
		const root = makeTarget();
		try {
			writeMutable(root, "scripts/lib/core/governed-runner.js", "const gates = 5; // v1\n");
			const { hashFile } = require("../../scripts/lib/core/context-hash");
			const h = hashFile(path.join(root, "scripts/lib/core/governed-runner.js"));
			const page = pageWithSource("scripts/lib/core/governed-runner.js");
			page.sources.s1.rawHash = h.rawHash;
			page.sources.s1.normHash = h.normHash;
			writePage(root, page);
			regenerateIndex(root);

			// comment-only change -> raw changes, norm same
			writeMutable(root, "scripts/lib/core/governed-runner.js", "const gates = 5; // v2 comment\n");
			const result = refreshPages(root);
			assert.equal(result.requests.length, 0);
			assert.equal(result.rawOnlyRebases.length, 1);
			// page hash was rebased
			const after = JSON.parse(
				fs.readFileSync(path.join(root, ".amber", "context", "pages", "page-x.json"), "utf8"),
			);
			assert.notEqual(after.sources.s1.rawHash, h.rawHash);
		} finally {
			cleanup(root);
		}
	});
});

describe("computeStats", () => {
	const { computeStats } = require("../../scripts/lib/core/context-stats");
	const { appendEvent } = require("../../scripts/lib/core/context-store");

	it("reports request/ingest counts, error distribution and unknown share", () => {
		const root = makeTarget();
		try {
			appendEvent(root, { kind: "request-created", requestId: "r1", trigger: "explicit" });
			appendEvent(root, {
				kind: "ingest",
				requestId: "r1",
				outcome: "accepted",
				blockCount: 3,
				unknownCount: 1,
				sourceCount: 2,
			});
			appendEvent(root, {
				kind: "ingest",
				requestId: "r2",
				outcome: "rejected",
				code: "AMBER_E_CONTEXT_CLAIM_UNCITED",
			});
			appendEvent(root, { kind: "ingest", requestId: "r3", outcome: "no-change" });
			appendEvent(root, { kind: "source-raw-only-change" });
			appendEvent(root, { kind: "request-created", requestId: "r4", trigger: "source-change" });

			const stats = computeStats(root);
			assert.equal(stats.requests.total, 2);
			assert.equal(stats.requests.byTrigger.explicit, 1);
			assert.equal(stats.requests.byTrigger["source-change"], 1);
			assert.equal(stats.ingests.accepted, 1);
			assert.equal(stats.ingests.rejected, 1);
			assert.equal(stats.ingests.noChange, 1);
			assert.equal(stats.errorCodes.AMBER_E_CONTEXT_CLAIM_UNCITED, 1);
			assert.equal(stats.rawOnlyChanges, 1);
			assert.equal(stats.ingests.noChangeRate, 0.333); // 1 of 3 ingests
			assert.equal(stats.window, null);
		} finally {
			cleanup(root);
		}
	});

	it("windows stats to the most recent N events", () => {
		const root = makeTarget();
		try {
			appendEvent(root, { kind: "request-created", requestId: "r1", trigger: "explicit" });
			appendEvent(root, { kind: "ingest", requestId: "r1", outcome: "accepted" });
			appendEvent(root, { kind: "request-created", requestId: "r2", trigger: "source-change" });
			appendEvent(root, { kind: "source-raw-only-change" });
			appendEvent(root, { kind: "source-raw-only-change" });

			const lifetime = computeStats(root);
			assert.equal(lifetime.requests.total, 2);
			assert.equal(lifetime.rawOnlyChanges, 2);

			// Last 3 events: r2 request + 2 raw-only changes -> 1 request, 2 filtered
			const windowed = computeStats(root, { window: 3 });
			assert.equal(windowed.window, 3);
			assert.equal(windowed.requests.total, 1);
			assert.equal(windowed.requests.byTrigger["source-change"], 1);
			assert.equal(windowed.rawOnlyChanges, 2);
			assert.equal(windowed.ingests.total, 0);
		} finally {
			cleanup(root);
		}
	});
});
