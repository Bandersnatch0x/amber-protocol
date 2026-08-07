"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { contextDispatch } = require("../../scripts/lib/context/adapters/command");

function makeTarget() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ctx-e2e-"));
	fs.mkdirSync(path.join(root, "docs", "wiki"), { recursive: true });
	fs.mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
	fs.mkdirSync(path.join(root, ".amber", "sessions", "s1"), { recursive: true });
	// load validates --route against routes/*.route.json (D1)
	fs.mkdirSync(path.join(root, "routes"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "routes", "feature-standard.route.json"),
		JSON.stringify({ routeId: "feature-standard", schemaVersion: "1.0.0", stages: [] }),
		"utf8",
	);
	fs.mkdirSync(path.join(root, "docs", "wiki", "agent"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "docs", "wiki", "agent", "amber.md"),
		"# Amber Operating Manual\n",
		"utf8",
	);
	fs.writeFileSync(
		path.join(root, "docs", "wiki", "agent", "context-loadout.md"),
		"# Context Loadout Definition\n",
		"utf8",
	);
	return root;
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		/* noop */
	}
}

function seed(root) {
	fs.writeFileSync(
		path.join(root, ".amber", "sessions", "s1", "ledger.jsonl"),
		'{"action":"governed-command","result":"pass"}\n',
		"utf8",
	);
	fs.writeFileSync(
		path.join(root, "docs", "adr", "0003-governance-gated-execution.md"),
		"# ADR-0003\n\nFive preconditions gate execution.\n",
		"utf8",
	);
	fs.mkdirSync(path.join(root, "scripts", "lib", "core"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "scripts", "lib", "core", "governed-runner.js"),
		"const gates = 5;\n",
		"utf8",
	);
}

describe("amber context end-to-end through the adapter", () => {
	it("request -> ingest -> verify -> list -> refresh -> stats round trip", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });

			// 1. request
			const r1 = contextDispatch("request", args({
				_: ["context", "request"],
				page: "governed-execution",
				title: "Governed execution",
				source: "scripts/lib/core/governed-runner.js",
			}));
			assert.equal(r1.exitCode, 0, JSON.stringify(r1.result.errors));
			const requestId = r1.result.text.match(/Request (\S+)/)[1];
			assert.ok(requestId.startsWith("kd-"));

			// 2. ingest — agent produces a valid page
			const req = JSON.parse(
				fs.readFileSync(path.join(root, ".amber", "context", "requests", `${requestId}.json`), "utf8"),
			);
			const s1 = req.sources[0];
			const payload = {
				schemaVersion: "1.0.0",
				pageId: "governed-execution",
				title: "Governed execution",
				sources: { s1 },
				blocks: [{ type: "prose", sources: ["s1"], text: "Five gates are declared in governed-runner.js." }],
			};
			const payloadPath = path.join(root, ".amber", "context", "payload.json");
			fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf8");
			const r2 = contextDispatch("ingest", args({
				_: ["context", "ingest"],
				request: requestId,
				payload: payloadPath,
			}));
			assert.equal(r2.exitCode, 0, JSON.stringify(r2.result.errors));
			assert.equal(r2.result.outcome, "accepted");

			// 3. verify — healthy
			const r3 = contextDispatch("verify", args({ _: ["context", "verify"] }));
			assert.equal(r3.exitCode, 0);
			assert.ok(r3.result.text.includes("1 (ok 1"));

			// 4. list
			const r4 = contextDispatch("list", args({ _: ["context", "list"] }));
			assert.ok(r4.result.text.includes("governed-execution"));

			// 5. refresh — mutable source changed (norm) -> refresh request
			fs.appendFileSync(
				path.join(root, "scripts", "lib", "core", "governed-runner.js"),
				"\nconst shared = true;\n",
				"utf8",
			);
			const r5 = contextDispatch("refresh", args({ _: ["context", "refresh"] }));
			assert.equal(r5.exitCode, 0);
			assert.match(r5.result.text, /refresh request\(s\) generated/, r5.result.text);

			// 6. verify now shows stale
			const r6 = contextDispatch("verify", args({ _: ["context", "verify"] }));
			assert.ok(r6.result.text.includes("stale 1"), r6.result.text);

			// 7. stats — events recorded
			const r7 = contextDispatch("stats", args({ _: ["context", "stats"] }));
			assert.equal(r7.exitCode, 0);
			assert.ok(r7.result.text.includes("requests:"));
			assert.ok(r7.result.text.includes("ingests:"));
		} finally {
			cleanup(root);
		}
	});

	it("rejects bad output at the ingest gate with an error code", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });
			const r1 = contextDispatch("request", args({
				_: ["context", "request"],
				page: "p1",
				source: "docs/adr/0003-governance-gated-execution.md",
			}));
			const requestId = r1.result.text.match(/Request (\S+)/)[1];
			const payloadPath = path.join(root, "bad.json");
			fs.writeFileSync(payloadPath, JSON.stringify({ not: "a page" }), "utf8");
			const r2 = contextDispatch("ingest", args({
				_: ["context", "ingest"],
				request: requestId,
				payload: payloadPath,
			}));
			assert.equal(r2.exitCode, 1);
			assert.equal(r2.result.code, "AMBER_E_CONTEXT_SCHEMA_INVALID");
		} finally {
			cleanup(root);
		}
	});

	it("load round trip: scope request -> ingest -> load -> verify --loadout (ADR-0010)", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });

			// request with scope
			const r1 = contextDispatch("request", args({
				_: ["context", "request"],
				page: "governed-execution",
				title: "Governed execution",
				source: "scripts/lib/core/governed-runner.js",
				scope: ["feature-standard", "F015"],
			}));
			assert.equal(r1.exitCode, 0, JSON.stringify(r1.result.errors));
			const requestId = r1.result.text.match(/Request (\S+)/)[1];
			// request file carries target.scope
			const req = JSON.parse(
				fs.readFileSync(path.join(root, ".amber", "context", "requests", `${requestId}.json`), "utf8"),
			);
			assert.deepEqual(req.target.scope, ["feature-standard", "F015"]);

			// ingest with scope in payload
			const payload = {
				schemaVersion: "1.0.0",
				pageId: "governed-execution",
				title: "Governed execution",
				scope: ["feature-standard", "F015"],
				sources: { s1: req.sources[0] },
				blocks: [{ type: "prose", sources: ["s1"], text: "Five gates are declared in governed-runner.js." }],
			};
			const payloadPath = path.join(root, "payload2.json");
			fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf8");
			const r2 = contextDispatch("ingest", args({
				_: ["context", "ingest"],
				request: requestId,
				payload: payloadPath,
			}));
			assert.equal(r2.exitCode, 0, JSON.stringify(r2.result.errors));

			// load with the matching route
			const r3 = contextDispatch("load", args({
				_: ["context", "load"],
				route: "feature-standard",
			}));
			assert.equal(r3.exitCode, 0, JSON.stringify(r3.result.errors));
			assert.ok(r3.result.loadoutPath.includes("feature-standard.json"), r3.result.loadoutPath);
			assert.match(r3.result.text, /required artifacts: 3/);
			assert.match(r3.result.text, /docs\/wiki\/agent\/amber\.md/);
			assert.match(r3.result.text, /routes\/feature-standard\.route\.json/);
			assert.match(r3.result.text, /docs\/wiki\/agent\/context-loadout\.md/);
			const loadout = JSON.parse(fs.readFileSync(r3.result.loadoutPath, "utf8"));
			assert.ok(loadout.pages["governed-execution"], "page should be in the loadout");
			assert.ok(loadout.references.some((ref) => ref.pageId === "governed-execution"));
			assert.ok(loadout.excluded.length === 0, JSON.stringify(loadout.excluded));

			// verify --loadout passes for Required Artifacts and required-tier Pages.
			const r4 = contextDispatch("verify", args({
				_: ["context", "verify"],
				loadout: r3.result.loadoutPath,
			}));
			assert.equal(r4.exitCode, 0, r4.result.text);
			assert.match(r4.result.text, /required artifacts and required-tier pages fresh/);

			// stale detection: mutate the source, rebuild, page now excluded as stale
			fs.appendFileSync(
				path.join(root, "scripts", "lib", "core", "governed-runner.js"),
				"\nconst shared = true;\n",
				"utf8",
			);
			const r5 = contextDispatch("load", args({
				_: ["context", "load"],
				route: "feature-standard",
			}));
			assert.equal(r5.exitCode, 0, JSON.stringify(r5.result.errors));
			const loadout2 = JSON.parse(fs.readFileSync(r5.result.loadoutPath, "utf8"));
			assert.ok(loadout2.excluded.some((e) => e.pageId === "governed-execution" && e.reason === "stale"));
		} finally {
			cleanup(root);
		}
	});
});
