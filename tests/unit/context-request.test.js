"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	createRequest,
	bundleSources,
	loadRequest,
	latestRequestForPage,
} = require("../../scripts/lib/core/context-request");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-req-"));
	fs.mkdirSync(path.join(root, "docs", "wiki"), { recursive: true });
	fs.mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
	fs.mkdirSync(path.join(root, "scripts", "lib", "core"), { recursive: true });
	fs.mkdirSync(path.join(root, ".amber", "sessions", "sess-1"), { recursive: true });
	return root;
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		/* noop */
	}
}

describe("bundleSources", () => {
	it("bundles an existing mutable source with raw+norm hashes", () => {
		const root = makeTarget();
		try {
			const p = path.join(root, "scripts", "lib", "core", "governed-runner.js");
			fs.writeFileSync(p, "const x = 1; // c\n", "utf8");
			const { sources } = bundleSources(root, [{ ref: "scripts/lib/core/governed-runner.js" }]);
			assert.equal(sources.length, 1);
			const s = sources[0];
			assert.equal(s.mutable, true);
			assert.match(s.rawHash, /^sha256:[0-9a-f]{64}$/);
			assert.match(s.normHash, /^sha256:[0-9a-f]{64}$/);
		} finally {
			cleanup(root);
		}
	});

	it("bundles an existing immutable source with an excerpt snapshot", () => {
		const root = makeTarget();
		try {
			const p = path.join(root, ".amber", "sessions", "sess-1", "ledger.jsonl");
			fs.writeFileSync(p, '{"action":"governed-command"}\n{"action":"approve"}\n', "utf8");
			const { sources } = bundleSources(root, [
				{ ref: ".amber/sessions/sess-1/ledger.jsonl#L1-L2" },
			]);
			assert.equal(sources.length, 1);
			const s = sources[0];
			assert.equal(s.mutable, false);
			assert.ok(s.excerpt.includes("governed-command"));
			assert.match(s.excerptHash, /^sha256:[0-9a-f]{64}$/);
		} finally {
			cleanup(root);
		}
	});

	it("returns an error finding for a missing source", () => {
		const root = makeTarget();
		try {
			const { sources } = bundleSources(root, [{ ref: "no/such/file.js" }]);
			assert.equal(sources.length, 0);
		} finally {
			cleanup(root);
		}
	});

	it("rejects a source path that lexically escapes the target", () => {
		const root = makeTarget();
		const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-req-outside-"));
		try {
			const outsideFile = path.join(outsideRoot, "secret.md");
			fs.writeFileSync(outsideFile, "outside\n", "utf8");
			const ref = path.relative(root, outsideFile).split(path.sep).join("/");
			const { sources, errors } = bundleSources(root, [{ ref }]);
			assert.deepEqual(sources, []);
			assert.match(errors.join("\n"), /outside the target/i);
		} finally {
			cleanup(root);
			cleanup(outsideRoot);
		}
	});

	it("rejects a source path whose symlink or junction escapes the target", () => {
		const root = makeTarget();
		const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-req-link-"));
		try {
			fs.writeFileSync(path.join(outsideRoot, "secret.md"), "outside\n", "utf8");
			fs.symlinkSync(
				outsideRoot,
				path.join(root, "linked"),
				process.platform === "win32" ? "junction" : "dir",
			);
			const { sources, errors } = bundleSources(root, [
				{ ref: "linked/secret.md" },
			]);
			assert.deepEqual(sources, []);
			assert.match(errors.join("\n"), /outside the target/i);
		} finally {
			cleanup(root);
			cleanup(outsideRoot);
		}
	});

	it("auto-bundles the most recent session ledger when no sources given", () => {
		const root = makeTarget();
		try {
			fs.writeFileSync(
				path.join(root, ".amber", "sessions", "sess-1", "ledger.jsonl"),
				'{"action":"a"}\n',
				"utf8",
			);
			const { sources } = bundleSources(root, []);
			assert.ok(sources.some((s) => s.ref.includes("sess-1")));
		} finally {
			cleanup(root);
		}
	});
});

function seedLedger(root) {
	fs.writeFileSync(
		path.join(root, ".amber", "sessions", "sess-1", "ledger.jsonl"),
		'{"action":"governed-command","result":"pass"}\n',
		"utf8",
	);
}

describe("createRequest", () => {
	it("writes a valid distillation contract and appends an event", () => {
		const root = makeTarget();
		try {
			seedLedger(root);
			fs.writeFileSync(
				path.join(root, "docs", "adr", "0003-governance-gated-execution.md"),
				"# ADR-0003\n\nFive preconditions.\n",
				"utf8",
			);
			const result = createRequest(root, {
				pageId: "governed-execution",
				title: "Governed execution",
				reason: "explicit",
				sources: [{ ref: "docs/adr/0003-governance-gated-execution.md" }],
			});
			assert.equal(result.errors.length, 0, result.errors.join(", "));
			assert.ok(result.requestPath.endsWith(".json"));
			assert.ok(fs.existsSync(result.requestPath));

			const req = loadRequest(root, result.requestId);
			assert.equal(req.target.pageId, "governed-execution");
			assert.equal(req.contract.outputSchema, "schemas/context-page.schema.json");
			assert.ok(req.acceptance.some((a) => a.code === "AMBER_E_CONTEXT_SCHEMA_INVALID"));
			assert.equal(req.sources[0].kind, "adr");
			assert.equal(req.sources[0].mutable, false);
			assert.ok(req.sources[0].excerpt.includes("ADR-0003"));

			const events = fs
				.readFileSync(path.join(root, ".amber", "context", "events.jsonl"), "utf8")
				.trim()
				.split("\n");
			assert.ok(events.some((e) => e.includes("request-created")));
		} finally {
			cleanup(root);
		}
	});

	it("refuses a pageId that already has an open request unless --force", () => {
		const root = makeTarget();
		try {
			seedLedger(root);
			const first = createRequest(root, { pageId: "p1", title: "P1" });
			assert.equal(first.errors.length, 0);
			const second = createRequest(root, { pageId: "p1", title: "P1 again" });
			assert.ok(second.errors.some((e) => e.includes("open request")));
			const forced = createRequest(root, { pageId: "p1", title: "P1 forced", force: true });
			assert.equal(forced.errors.length, 0);
		} finally {
			cleanup(root);
		}
	});
});

describe("latestRequestForPage", () => {
	it("finds the newest open request for a page", () => {
		const root = makeTarget();
		try {
			seedLedger(root);
			const a = createRequest(root, { pageId: "p1", title: "A" });
			const b = createRequest(root, { pageId: "p1", title: "B", force: true });
			const latest = latestRequestForPage(root, "p1");
			assert.equal(latest.requestId, b.requestId);
			assert.notEqual(a.requestId, b.requestId);
		} finally {
			cleanup(root);
		}
	});
});

describe("createRequest scope (ADR-0010 D5)", () => {
	it("stamps an array scope into target.scope", () => {
		const root = makeTarget();
		try {
			seedLedger(root);
			const result = createRequest(root, {
				pageId: "p1",
				title: "P1",
				sources: [{ ref: ".amber/sessions/sess-1/ledger.jsonl#L1-L1" }],
				scope: ["feature-standard", "bugfix-quick"],
			});
			assert.equal(result.errors.length, 0, result.errors.join(", "));
			assert.deepEqual(result.request.target.scope, ["feature-standard", "bugfix-quick"]);
		} finally {
			cleanup(root);
		}
	});

	it("normalizes a single-string scope into a one-element array", () => {
		const root = makeTarget();
		try {
			seedLedger(root);
			const result = createRequest(root, {
				pageId: "p1",
				title: "P1",
				sources: [{ ref: ".amber/sessions/sess-1/ledger.jsonl#L1-L1" }],
				scope: "feature-standard",
			});
			assert.equal(result.errors.length, 0, result.errors.join(", "));
			assert.deepEqual(result.request.target.scope, ["feature-standard"]);
		} finally {
			cleanup(root);
		}
	});

	it("dedupes and trims scope entries", () => {
		const root = makeTarget();
		try {
			seedLedger(root);
			const result = createRequest(root, {
				pageId: "p1",
				title: "P1",
				sources: [{ ref: ".amber/sessions/sess-1/ledger.jsonl#L1-L1" }],
				scope: ["feature-standard", " feature-standard ", "", "bugfix-quick"],
			});
			assert.equal(result.errors.length, 0, result.errors.join(", "));
			assert.deepEqual(result.request.target.scope, ["feature-standard", "bugfix-quick"]);
		} finally {
			cleanup(root);
		}
	});

	it("omits target.scope when no scope is given", () => {
		const root = makeTarget();
		try {
			seedLedger(root);
			const result = createRequest(root, {
				pageId: "p1",
				title: "P1",
				sources: [{ ref: ".amber/sessions/sess-1/ledger.jsonl#L1-L1" }],
			});
			assert.equal(result.errors.length, 0, result.errors.join(", "));
			assert.equal("scope" in result.request.target, false);
		} finally {
			cleanup(root);
		}
	});
});
