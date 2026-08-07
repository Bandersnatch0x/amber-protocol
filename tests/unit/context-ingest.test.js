"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createRequest } = require("../../scripts/lib/core/context-request");
const { ingestPayload } = require("../../scripts/lib/core/context-ingest");
const { readPage, indexPath, readEvents } = require("../../scripts/lib/core/context-store");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ing-"));
	fs.mkdirSync(path.join(root, "docs", "wiki"), { recursive: true });
	fs.mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
	fs.mkdirSync(path.join(root, ".amber", "sessions", "s1"), { recursive: true });
	return root;
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		/* noop */
	}
}

function seedSources(root) {
	fs.writeFileSync(
		path.join(root, ".amber", "sessions", "s1", "ledger.jsonl"),
		'{"action":"governed-command","result":"pass"}\n{"action":"approve"}\n',
		"utf8",
	);
	fs.writeFileSync(
		path.join(root, "docs", "adr", "0003-governance-gated-execution.md"),
		"# ADR-0003\n\nFive preconditions gate execution.\n",
		"utf8",
	);
}

function makeRequest(root, sourceRef) {
	const r = createRequest(root, {
		pageId: "governed-execution",
		title: "Governed execution",
		reason: "explicit",
		sources: sourceRef ? [{ ref: sourceRef }] : [{ ref: "docs/adr/0003-governance-gated-execution.md" }],
	});
	assert.equal(r.errors.length, 0, r.errors.join(", "));
	return r;
}

function validPayload(req) {
	const s1 = req.request.sources[0];
	return {
		schemaVersion: "1.0.0",
		pageId: req.request.target.pageId,
		title: req.request.target.title,
		sources: { s1 },
		blocks: [{ type: "prose", sources: ["s1"], text: "Five preconditions gate execution (ADR-0003)." }],
	};
}

describe("ingestPayload", () => {
	it("accepts a valid payload, persists the page, regenerates the index, emits events", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req = makeRequest(root);
			const payload = validPayload(req);
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, true, JSON.stringify(result.findings));
			assert.equal(result.outcome, "accepted");
			assert.equal(result.errors.length, 0);
			assert.ok(readPage(root, "governed-execution"));
			assert.ok(fs.existsSync(indexPath(root)));
			const events = readEvents(root);
			assert.ok(events.some((e) => e.kind === "ingest" && e.outcome === "accepted"));
		} finally {
			cleanup(root);
		}
	});

	it("rejects a payload whose block cites a nonexistent source id", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req = makeRequest(root);
			const payload = validPayload(req);
			payload.blocks[0].sources = ["s9"];
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, false);
			assert.equal(result.code, "AMBER_E_CONTEXT_CLAIM_UNCITED");
		} finally {
			cleanup(root);
		}
	});

	it("rejects a payload failing the page schema", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req = makeRequest(root);
			const payload = validPayload(req);
			payload.blocks[0].type = "claim";
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, false);
			assert.equal(result.code, "AMBER_E_CONTEXT_SCHEMA_INVALID");
		} finally {
			cleanup(root);
		}
	});

	it("rejects when a mutable source changed since the request", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			fs.mkdirSync(path.join(root, "scripts", "lib", "core"), { recursive: true });
			const code = path.join(root, "scripts", "lib", "core", "governed-runner.js");
			fs.writeFileSync(code, "const gates = 5;\n", "utf8");
			const req = makeRequest(root, "scripts/lib/core/governed-runner.js");
			// mutate the mutable source after the request was created
			fs.appendFileSync(code, "const shared = true;\n", "utf8");
			const payload = validPayload(req);
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, false);
			assert.equal(result.code, "AMBER_E_CONTEXT_SOURCE_STALE");
		} finally {
			cleanup(root);
		}
	});

	it("rejects when an immutable source changed since the request (tamper)", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			// Make an immutable-only request against the ledger
			const req2 = createRequest(root, {
				pageId: "session-evid",
				title: "Session evidence",
				sources: [{ ref: ".amber/sessions/s1/ledger.jsonl#L1-L2" }],
			});
			assert.equal(req2.errors.length, 0);
			// tamper: rewrite the ledger
			fs.writeFileSync(
				path.join(root, ".amber", "sessions", "s1", "ledger.jsonl"),
				'{"action":"tampered"}\n',
				"utf8",
			);
			const payload = validPayload(req2);
			const result = ingestPayload(root, { requestId: req2.requestId, payload });
			assert.equal(result.accepted, false);
			assert.equal(result.code, "AMBER_E_CONTEXT_SOURCE_TAMPERED");
		} finally {
			cleanup(root);
		}
	});

	it("accepts a no-change outcome and rebases hashes without touching content", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			// First, accept a page
			const req = makeRequest(root);
			let result = ingestPayload(root, { requestId: req.requestId, payload: validPayload(req) });
			assert.equal(result.accepted, true);
			const before = readPage(root, "governed-execution");

			// Simulate a real (non-cosmetic) change to the source
			fs.writeFileSync(
				path.join(root, "docs", "adr", "0003-governance-gated-execution.md"),
				"# ADR-0003\n\nFive preconditions gate execution.\n\nAmended: gates are shared.\n",
				"utf8",
			);

			// Agent judges it doesn't affect the page claims -> no-change
			const req2 = createRequest(root, {
				pageId: "governed-execution",
				title: "Governed execution",
				reason: "refresh",
				sources: [{ ref: "docs/adr/0003-governance-gated-execution.md" }],
				force: true,
			});
			assert.equal(req2.errors.length, 0);
			result = ingestPayload(root, {
				requestId: req2.requestId,
				payload: { outcome: "no-change", pageId: "governed-execution" },
			});
			assert.equal(result.accepted, true);
			assert.equal(result.outcome, "no-change");
			const after = readPage(root, "governed-execution");
			assert.equal(after.title, before.title);
			assert.equal(after.blocks.length, before.blocks.length);
		} finally {
			cleanup(root);
		}
	});

	it("refuses no-change when no existing page exists", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req = makeRequest(root);
			const result = ingestPayload(root, {
				requestId: req.requestId,
				payload: { outcome: "no-change", pageId: "governed-execution" },
			});
			assert.equal(result.accepted, false);
		} finally {
			cleanup(root);
		}
	});

	it("rejects a payload whose pageId does not match the request target", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req = makeRequest(root);
			const payload = validPayload(req);
			payload.pageId = "some-other-page";
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, false);
			assert.equal(result.code, "AMBER_E_CONTEXT_SCHEMA_INVALID");
		} finally {
			cleanup(root);
		}
	});

	it("rejects a payload that re-bundles a source with fresh hashes (self-blessing)", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			fs.mkdirSync(path.join(root, "scripts", "lib", "core"), { recursive: true });
			const code = path.join(root, "scripts", "lib", "core", "governed-runner.js");
			fs.writeFileSync(code, "const gates = 5;\n", "utf8");
			const req = makeRequest(root, "scripts/lib/core/governed-runner.js");
			const payload = validPayload(req);
			// source changes AFTER the request; the agent re-hashes the NEW
			// content and stamps it, pretending the page is fresh
			fs.appendFileSync(code, "const shared = true;\n", "utf8");
			const { hashFile } = require("../../scripts/lib/core/context-hash");
			const h = hashFile(code);
			payload.sources.s1 = { ...payload.sources.s1, rawHash: h.rawHash, normHash: h.normHash };
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, false);
			assert.equal(result.code, "AMBER_E_CONTEXT_SOURCE_STALE");
		} finally {
			cleanup(root);
		}
	});

	it("accepts an immutable-source payload that copies the request bundle verbatim", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req2 = createRequest(root, {
				pageId: "session-evid",
				title: "Session evidence",
				sources: [{ ref: ".amber/sessions/s1/ledger.jsonl#L1-L2" }],
			});
			assert.equal(req2.errors.length, 0);
			const payload = validPayload(req2);
			const result = ingestPayload(root, { requestId: req2.requestId, payload });
			assert.equal(result.accepted, true, JSON.stringify(result.errors));
		} finally {
			cleanup(root);
		}
	});
});

describe("ingestPayload scope binding (ADR-0010 D5)", () => {
	it("round-trips scope: request --scope → payload scope → page persists scope", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req = createRequest(root, {
				pageId: "governed-execution",
				title: "Governed execution",
				reason: "explicit",
				sources: [{ ref: "docs/adr/0003-governance-gated-execution.md" }],
				scope: ["feature-standard", "bugfix-quick"],
			});
			assert.equal(req.errors.length, 0, req.errors.join(", "));
			assert.deepEqual(req.request.target.scope, ["feature-standard", "bugfix-quick"]);
			const payload = validPayload(req);
			payload.scope = ["feature-standard"];
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, true, JSON.stringify(result.findings));
			const page = readPage(root, "governed-execution");
			assert.deepEqual(page.scope, ["feature-standard"]);
		} finally {
			cleanup(root);
		}
	});

	it("rejects a payload whose scope is not a subset of request target.scope", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req = createRequest(root, {
				pageId: "governed-execution",
				title: "Governed execution",
				reason: "explicit",
				sources: [{ ref: "docs/adr/0003-governance-gated-execution.md" }],
				scope: ["feature-standard"],
			});
			assert.equal(req.errors.length, 0);
			const payload = validPayload(req);
			payload.scope = ["feature-standard", "undeclared-scope"];
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, false);
			assert.equal(result.code, "AMBER_E_CONTEXT_SCHEMA_INVALID");
			assert.ok(result.findings.some((f) => f.code === "AMBER_E_CONTEXT_SCHEMA_INVALID" && f.detail.includes("undeclared-scope")));
		} finally {
			cleanup(root);
		}
	});

	it("accepts a payload without scope when the request declares target.scope", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req = createRequest(root, {
				pageId: "governed-execution",
				title: "Governed execution",
				reason: "explicit",
				sources: [{ ref: "docs/adr/0003-governance-gated-execution.md" }],
				scope: ["feature-standard"],
			});
			assert.equal(req.errors.length, 0);
			const payload = validPayload(req); // no scope on the payload
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, true, JSON.stringify(result.findings));
			const page = readPage(root, "governed-execution");
			assert.equal(page.scope, undefined);
		} finally {
			cleanup(root);
		}
	});

	it("accepts a payload with scope when the request declares no target.scope", () => {
		const root = makeTarget();
		try {
			seedSources(root);
			const req = makeRequest(root); // no scope on the request
			assert.equal(req.request.target.scope, undefined);
			const payload = validPayload(req);
			payload.scope = ["feature-standard"];
			const result = ingestPayload(root, { requestId: req.requestId, payload });
			assert.equal(result.accepted, true, JSON.stringify(result.findings));
			const page = readPage(root, "governed-execution");
			assert.deepEqual(page.scope, ["feature-standard"]);
		} finally {
			cleanup(root);
		}
	});
});
