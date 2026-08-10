"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { contextDispatch } = require("../../scripts/lib/context/adapters/command");
const { rebuildProjection, sourceTargetBinding } = require("../../scripts/lib/context");

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

function hashTree(root) {
	const entries = [];
	const walk = (dir) => {
		if (!fs.existsSync(dir)) return;
		for (const name of fs.readdirSync(dir).sort()) {
			const full = path.join(dir, name);
			const stat = fs.statSync(full);
			if (stat.isDirectory()) walk(full);
			else entries.push(`${path.relative(root, full)}\0${fs.readFileSync(full, "utf8")}`);
		}
	};
	walk(root);
	return crypto.createHash("sha256").update(entries.join("\0"), "utf8").digest("hex");
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

	it("derives assurance verification time from hash-bound accepted evidence", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });
			const requested = contextDispatch("request", args({
				_: ["context", "request"],
				page: "assured-rule",
				title: "Assured rule",
				source: "scripts/lib/core/governed-runner.js",
			}));
			const requestId = requested.result.text.match(/Request (\S+)/)[1];
			const request = JSON.parse(
				fs.readFileSync(
					path.join(root, ".amber", "context", "requests", `${requestId}.json`),
					"utf8",
				),
			);
			const payload = {
				schemaVersion: "1.2.0",
				pageId: "assured-rule",
				title: "Assured rule",
				assurance: { confidence: "high", maturity: "validated" },
				sources: { s1: request.sources[0] },
				blocks: [{ type: "prose", sources: ["s1"], text: "Five gates are required." }],
			};
			const payloadPath = path.join(root, "assured-rule.json");
			fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf8");

			const ingested = contextDispatch("ingest", args({
				_: ["context", "ingest"],
				request: requestId,
				payload: payloadPath,
			}));
			assert.equal(ingested.exitCode, 0, JSON.stringify(ingested.result.errors));
			const evidence = JSON.parse(
				fs.readFileSync(
					path.join(root, ".amber", "context", "verification", "assured-rule.json"),
					"utf8",
				),
			);
			assert.equal(evidence.pageId, "assured-rule");
			assert.equal(evidence.outcome, "accepted");
			assert.match(evidence.pageHash, /^sha256:[0-9a-f]{64}$/);
			assert.match(evidence.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);

			const verified = contextDispatch("verify", args({ _: ["context", "verify"], json: true }));
			assert.deepEqual(verified.result.pages[0].assurance, {
				confidence: "high",
				maturity: "validated",
				verifiedAt: evidence.verifiedAt,
			});
			const listed = contextDispatch("list", args({ _: ["context", "list"] }));
			assert.match(listed.result.text, /high\/validated/);
			assert.match(listed.result.text, new RegExp(evidence.verifiedAt));
			const shown = contextDispatch("show", args({ _: ["context", "show"], page: "assured-rule" }));
			assert.match(shown.result.text, /assurance: high\/validated/);
			assert.match(shown.result.text, new RegExp(evidence.verifiedAt));
			const stats = contextDispatch("stats", args({ _: ["context", "stats"] }));
			assert.match(stats.result.text, /assurance verified: 1\/1/);
			assert.match(stats.result.text, /confidence: high 1/);

			const evidencePath = path.join(
				root,
				".amber",
				"context",
				"verification",
				"assured-rule.json",
			);
			const forgedEvidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
			forgedEvidence.verifiedAt = "2099-01-01T00:00:00.000Z";
			fs.writeFileSync(evidencePath, `${JSON.stringify(forgedEvidence, null, 2)}\n`, "utf8");
			const afterEvidenceForgery = contextDispatch(
				"verify",
				args({ _: ["context", "verify"], json: true }),
			);
			assert.equal(afterEvidenceForgery.result.pages[0].assurance.verifiedAt, null);
			fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

			const pageFile = path.join(root, ".amber", "context", "pages", "assured-rule.json");
			const tampered = JSON.parse(fs.readFileSync(pageFile, "utf8"));
			tampered.verifiedAt = "2099-01-01T00:00:00.000Z";
			fs.writeFileSync(pageFile, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
			const afterTamper = contextDispatch("verify", args({ _: ["context", "verify"], json: true }));
			assert.equal(afterTamper.exitCode, 1);
			assert.equal(afterTamper.result.code, "AMBER_E_CONTEXT_PROJECTION_DRIFT");
			assert.equal(afterTamper.result.pages[0].assurance.verifiedAt, null);
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

	it("binds Knowledge Kind and supersession through ingest, list, show, and Loadout assembly", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });
			const source = "scripts/lib/core/governed-runner.js";

			const createPage = ({ pageId, title, knowledgeKind, supersedes = [] }) => {
				const requested = contextDispatch(
					"request",
					args({
						_: ["context", "request"],
						page: pageId,
						title,
						source,
						knowledgeKind,
						supersedes,
					}),
				);
				assert.equal(requested.exitCode, 0, JSON.stringify(requested.result.errors));
				const requestId = requested.result.text.match(/Request (\S+)/)[1];
				const request = JSON.parse(
					fs.readFileSync(
						path.join(root, ".amber", "context", "requests", `${requestId}.json`),
						"utf8",
					),
				);
				assert.equal(request.target.knowledgeKind, knowledgeKind);
				assert.deepEqual(request.target.supersedes || [], supersedes);

				const payload = {
					schemaVersion: "1.2.0",
					pageId,
					title,
					knowledgeKind,
					supersedes,
					sources: { s1: request.sources[0] },
					blocks: [{ type: "prose", sources: ["s1"], text: `${title} is current.` }],
				};
				const payloadPath = path.join(root, `${pageId}.json`);
				fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2), "utf8");
				const ingested = contextDispatch(
					"ingest",
					args({ _: ["context", "ingest"], request: requestId, payload: payloadPath }),
				);
				assert.equal(ingested.exitCode, 0, JSON.stringify(ingested.result.errors));
			};

			createPage({
				pageId: "execution-rule",
				title: "Execution rule",
				knowledgeKind: "decision",
			});
			createPage({
				pageId: "execution-rule-v2",
				title: "Execution rule v2",
				knowledgeKind: "decision",
				supersedes: ["execution-rule"],
			});

			const listed = contextDispatch(
				"list",
				args({ _: ["context", "list"], knowledgeKind: "decision" }),
			);
			assert.equal(listed.exitCode, 0);
			assert.match(listed.result.text, /execution-rule\s+.*decision\s+superseded/);
			assert.match(listed.result.text, /execution-rule-v2\s+.*decision\s+current/);

			const shown = contextDispatch(
				"show",
				args({ _: ["context", "show"], page: "execution-rule" }),
			);
			assert.equal(shown.exitCode, 0);
			assert.match(shown.result.text, /knowledge kind: decision/);
			assert.match(shown.result.text, /superseded by: execution-rule-v2/);

			const loaded = contextDispatch(
				"load",
				args({ _: ["context", "load"], route: "feature-standard" }),
			);
			assert.equal(loaded.exitCode, 0, JSON.stringify(loaded.result.errors));
			const loadout = JSON.parse(fs.readFileSync(loaded.result.loadoutPath, "utf8"));
			assert.ok(loadout.pages["execution-rule-v2"]);
			assert.equal(loadout.pages["execution-rule"], undefined);
			assert.ok(
				loadout.excluded.some(
					(entry) => entry.pageId === "execution-rule" && entry.reason === "superseded",
				),
				JSON.stringify(loadout.excluded),
			);
		} finally {
			cleanup(root);
		}
	});

	it("fails closed for unauthorized or invalid lineage and protects historical pages", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });
			const requestFor = (page, extra = {}) => {
				const result = contextDispatch(
					"request",
					args({
						_: ["context", "request"],
						page,
						source: "scripts/lib/core/governed-runner.js",
						...extra,
					}),
				);
				assert.equal(result.exitCode, 0, JSON.stringify(result.result.errors));
				const requestId = result.result.text.match(/Request (\S+)/)[1];
				const request = JSON.parse(
					fs.readFileSync(
						path.join(root, ".amber", "context", "requests", `${requestId}.json`),
						"utf8",
					),
				);
				return { requestId, request };
			};
			const ingest = ({ requestId, request, pageId, knowledgeKind, supersedes = [] }) => {
				const payloadPath = path.join(root, `${pageId}-${requestId}.json`);
				fs.writeFileSync(
					payloadPath,
					JSON.stringify({
						schemaVersion: "1.2.0",
						pageId,
						title: pageId,
						knowledgeKind,
						supersedes,
						sources: { s1: request.sources[0] },
						blocks: [{ type: "prose", sources: ["s1"], text: `${pageId} content` }],
					}),
					"utf8",
				);
				return contextDispatch(
					"ingest",
					args({ _: ["context", "ingest"], request: requestId, payload: payloadPath }),
				);
			};

			const original = requestFor("original-rule", { knowledgeKind: "decision" });
			assert.equal(
				ingest({ ...original, pageId: "original-rule", knowledgeKind: "decision" }).exitCode,
				0,
			);

			const unauthorized = requestFor("unauthorized-rule", { knowledgeKind: "decision" });
			const unauthorizedResult = ingest({
				...unauthorized,
				pageId: "unauthorized-rule",
				knowledgeKind: "pattern",
				supersedes: ["original-rule"],
			});
			assert.equal(unauthorizedResult.exitCode, 1);
			assert.equal(unauthorizedResult.result.code, "AMBER_E_CONTEXT_REQUEST_MISMATCH");

			const dangling = requestFor("dangling-rule", {
				knowledgeKind: "decision",
				supersedes: ["missing-rule"],
			});
			const danglingResult = ingest({
				...dangling,
				pageId: "dangling-rule",
				knowledgeKind: "decision",
				supersedes: ["missing-rule"],
			});
			assert.equal(danglingResult.exitCode, 1);
			assert.equal(danglingResult.result.code, "AMBER_E_CONTEXT_SCHEMA_INVALID");

			const successor = requestFor("current-rule", {
				knowledgeKind: "decision",
				supersedes: ["original-rule"],
			});
			assert.equal(
				ingest({
					...successor,
					pageId: "current-rule",
					knowledgeKind: "decision",
					supersedes: ["original-rule"],
				}).exitCode,
				0,
			);

			const deleteOriginal = contextDispatch(
				"delete",
				args({ _: ["context", "delete"], page: "original-rule" }),
			);
			assert.equal(deleteOriginal.exitCode, 1);
			assert.match(deleteOriginal.result.errors[0], /participates in supersession/);

			const pinHistorical = contextDispatch(
				"load",
				args({ _: ["context", "load"], route: "feature-standard", page: "original-rule" }),
			);
			assert.equal(pinHistorical.exitCode, 1);
			assert.equal(pinHistorical.result.code, "AMBER_E_CONTEXT_PAGE_SUPERSEDED");
			assert.match(pinHistorical.result.errors[0], /current-rule/);

			fs.appendFileSync(
				path.join(root, "scripts", "lib", "core", "governed-runner.js"),
				"\nconst changed = true;\n",
				"utf8",
			);
			const afterSourceChange = contextDispatch(
				"load",
				args({ _: ["context", "load"], route: "feature-standard" }),
			);
			assert.equal(afterSourceChange.exitCode, 0);
			const loadout = JSON.parse(
				fs.readFileSync(afterSourceChange.result.loadoutPath, "utf8"),
			);
			assert.equal(loadout.pages["original-rule"], undefined);
			assert.equal(loadout.pages["current-rule"], undefined);
			assert.ok(
				loadout.excluded.some(
					(entry) => entry.pageId === "original-rule" && entry.reason === "superseded",
				),
			);
		} finally {
			cleanup(root);
		}
	});

	it("filters Loadouts and statistics by Knowledge Kind and records the filter", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });
			for (const [pageId, knowledgeKind] of [
				["decision-page", "decision"],
				["failure-page", "failure"],
			]) {
				const requested = contextDispatch(
					"request",
					args({
						_: ["context", "request"],
						page: pageId,
						source: "scripts/lib/core/governed-runner.js",
						knowledgeKind,
					}),
				);
				assert.equal(requested.exitCode, 0);
				const requestId = requested.result.text.match(/Request (\S+)/)[1];
				const request = JSON.parse(
					fs.readFileSync(
						path.join(root, ".amber", "context", "requests", `${requestId}.json`),
						"utf8",
					),
				);
				const payloadPath = path.join(root, `${pageId}.json`);
				fs.writeFileSync(
					payloadPath,
					JSON.stringify({
						schemaVersion: "1.2.0",
						pageId,
						title: pageId,
						knowledgeKind,
						sources: { s1: request.sources[0] },
						blocks: [{ type: "prose", sources: ["s1"], text: pageId }],
					}),
					"utf8",
				);
				const ingested = contextDispatch(
					"ingest",
					args({ _: ["context", "ingest"], request: requestId, payload: payloadPath }),
				);
				assert.equal(ingested.exitCode, 0);
			}

			const loaded = contextDispatch(
				"load",
				args({
					_: ["context", "load"],
					route: "feature-standard",
					knowledgeKind: "decision",
				}),
			);
			assert.equal(loaded.exitCode, 0, JSON.stringify(loaded.result.errors));
			const loadout = JSON.parse(fs.readFileSync(loaded.result.loadoutPath, "utf8"));
			assert.deepEqual(loadout.knowledgeKinds, ["decision"]);
			assert.ok(loadout.pages["decision-page"]);
			assert.equal(loadout.pages["failure-page"], undefined);
			assert.ok(
				loadout.excluded.some(
					(entry) => entry.pageId === "failure-page" && entry.reason === "knowledge-kind",
				),
			);

			const stats = contextDispatch(
				"stats",
				args({ _: ["context", "stats"], knowledgeKind: "decision" }),
			);
			assert.equal(stats.exitCode, 0);
			assert.match(stats.result.text, /knowledge kind: decision/);
			assert.match(stats.result.text, /pages: 1/);
			assert.match(stats.result.text, /lineage: current 1, superseded 0/);
		} finally {
			cleanup(root);
		}
	});

	it("reports and rebuilds the Context index as a hash-bound projection", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });
			const before = contextDispatch(
				"projection",
				args({ _: ["context", "projection", "status"] }),
			);
			assert.equal(before.exitCode, 1);
			assert.equal(before.result.code, "AMBER_E_CONTEXT_PROJECTION_MISSING");

			const requested = contextDispatch(
				"request",
				args({
					_: ["context", "request"],
					page: "projection-page",
					source: "scripts/lib/core/governed-runner.js",
					knowledgeKind: "invariant",
				}),
			);
			const requestId = requested.result.text.match(/Request (\S+)/)[1];
			const request = JSON.parse(
				fs.readFileSync(
					path.join(root, ".amber", "context", "requests", `${requestId}.json`),
					"utf8",
				),
			);
			const payloadPath = path.join(root, "projection-page.json");
			fs.writeFileSync(
				payloadPath,
				JSON.stringify({
					schemaVersion: "1.2.0",
					pageId: "projection-page",
					title: "Projection page",
					knowledgeKind: "invariant",
					sources: { s1: request.sources[0] },
					blocks: [{ type: "prose", sources: ["s1"], text: "Projected content" }],
				}),
				"utf8",
			);
			assert.equal(
				contextDispatch(
					"ingest",
					args({ _: ["context", "ingest"], request: requestId, payload: payloadPath }),
				).exitCode,
				0,
			);

			const automaticallyCurrent = contextDispatch(
				"projection",
				args({ _: ["context", "projection", "status"] }),
			);
			assert.equal(automaticallyCurrent.exitCode, 0, JSON.stringify(automaticallyCurrent.result.errors));
			assert.match(automaticallyCurrent.result.text, /context-index: current/);

			const rebuilt = contextDispatch(
				"projection",
				args({ _: ["context", "projection", "rebuild"] }),
			);
			assert.equal(rebuilt.exitCode, 0, JSON.stringify(rebuilt.result.errors));
			assert.match(rebuilt.result.text, /rebuilt context-index/);
			const manifestPath = path.join(
				root,
				".amber",
				"context",
				"projections",
				"context-index.json",
			);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
			assert.equal(manifest.schemaVersion, "1.0.0");
			assert.equal(manifest.projectionId, "context-index");
			assert.match(manifest.outputHash, /^sha256:[0-9a-f]{64}$/);
			assert.match(manifest.sourceHash, /^sha256:[0-9a-f]{64}$/);
			assert.equal(manifest.pageCount, 1);

			const current = contextDispatch(
				"projection",
				args({ _: ["context", "projection", "status"] }),
			);
			assert.equal(current.exitCode, 0);
			assert.match(current.result.text, /context-index: current/);

			fs.appendFileSync(
				path.join(root, "docs", "wiki", "context-index.md"),
				"\ncorrupt\n",
				"utf8",
			);
			const corruptOutput = fs.readFileSync(
				path.join(root, "docs", "wiki", "context-index.md"),
				"utf8",
			);
			manifest.outputHash = `sha256:${crypto.createHash("sha256").update(corruptOutput).digest("hex")}`;
			fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
			const corrupt = contextDispatch(
				"projection",
				args({ _: ["context", "projection", "status"] }),
			);
			assert.equal(corrupt.exitCode, 1);
			assert.equal(corrupt.result.code, "AMBER_E_CONTEXT_PROJECTION_DRIFT");
			assert.match(corrupt.result.errors[0], /authoritative Context Pages/);

			const verifyCorrupt = contextDispatch(
				"verify",
				args({ _: ["context", "verify"], json: true }),
			);
			assert.equal(verifyCorrupt.exitCode, 1);
			assert.equal(verifyCorrupt.result.code, "AMBER_E_CONTEXT_PROJECTION_DRIFT");
			assert.equal(verifyCorrupt.result.pages.length, 1);

			const deleted = contextDispatch(
				"delete",
				args({ _: ["context", "delete"], page: "projection-page" }),
			);
			assert.equal(deleted.exitCode, 0, JSON.stringify(deleted.result.errors));
			const afterDelete = contextDispatch(
				"projection",
				args({ _: ["context", "projection", "status"] }),
			);
			assert.equal(afterDelete.exitCode, 0, JSON.stringify(afterDelete.result.errors));
			assert.equal(afterDelete.result.manifest.pageCount, 0);
		} finally {
			cleanup(root);
		}
	});

	it("runs a deterministic Loadout benchmark with independent fail-closed metrics", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });
			const requested = contextDispatch(
				"request",
				args({
					_: ["context", "request"],
					page: "benchmark-page",
					source: "scripts/lib/core/governed-runner.js",
					knowledgeKind: "pattern",
				}),
			);
			const requestId = requested.result.text.match(/Request (\S+)/)[1];
			const request = JSON.parse(
				fs.readFileSync(
					path.join(root, ".amber", "context", "requests", `${requestId}.json`),
					"utf8",
				),
			);
			const payloadPath = path.join(root, "benchmark-page.json");
			fs.writeFileSync(
				payloadPath,
				JSON.stringify({
					schemaVersion: "1.2.0",
					pageId: "benchmark-page",
					title: "Benchmark page",
					knowledgeKind: "pattern",
					sources: { s1: request.sources[0] },
					blocks: [{ type: "prose", sources: ["s1"], text: "Expected page" }],
				}),
				"utf8",
			);
			assert.equal(
				contextDispatch(
					"ingest",
					args({ _: ["context", "ingest"], request: requestId, payload: payloadPath }),
				).exitCode,
				0,
			);
			const baseline = contextDispatch(
				"load",
				args({
					_: ["context", "load"],
					route: "feature-standard",
					budget: 4000,
					knowledgeKind: ["pattern"],
					json: true,
				}),
			);
			assert.equal(baseline.exitCode, 0, JSON.stringify(baseline.result.errors));
			const baselineLoadout = baseline.result.loadout;
			const exactLoadout = {
				budgetWords: baselineLoadout.budgetWords,
				tiers: baselineLoadout.tiers,
				pages: Object.entries(baselineLoadout.pages)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([pageId, page]) => ({ pageId, ...page })),
				references: baselineLoadout.references,
				requiredArtifacts: baselineLoadout.artifacts.required,
				excluded: baselineLoadout.excluded,
				deltaSince: baselineLoadout.deltaSince,
			};
			assert.deepEqual(exactLoadout.tiers, {
				required: [],
				priority: ["benchmark-page"],
				optional: [],
			});
			assert.match(exactLoadout.pages[0].rawHash, /^sha256:[0-9a-f]{64}$/);
			assert.equal(exactLoadout.requiredArtifacts[0].path, "docs/wiki/agent/amber.md");
			assert.match(exactLoadout.requiredArtifacts[0].rawHash, /^sha256:[0-9a-f]{64}$/);

			const fixturePath = path.join(root, "benchmark.json");
			fs.writeFileSync(
				fixturePath,
				JSON.stringify({
					schemaVersion: "1.0.0",
					fixtureId: "smoke-pattern-loadout",
					fixtureRevision: "1",
					mode: "smoke",
					signal: {
						route: "feature-standard",
						budget: 4000,
						knowledgeKinds: ["pattern"],
					},
					expected: {
						eligiblePages: ["benchmark-page"],
						pages: ["benchmark-page"],
						excluded: [],
						requiredArtifacts: [
							"operating-manual",
							"route-manifest",
							"loadout-definition",
						],
						loadout: exactLoadout,
					},
				}),
				"utf8",
			);

			const benchmarked = contextDispatch(
				"benchmark",
				args({ _: ["context", "benchmark"], fixture: "benchmark.json", mode: "smoke" }),
			);
			assert.equal(benchmarked.exitCode, 0, JSON.stringify(benchmarked.result.errors));
			assert.equal(benchmarked.result.report.metrics.expectedPageRecall, 1);
			assert.equal(benchmarked.result.report.metrics.selectionPrecision, 1);
			assert.equal(benchmarked.result.report.metrics.freshnessExclusion, 1);
			assert.equal(benchmarked.result.report.metrics.requiredCoverage, 1);
			assert.equal(benchmarked.result.report.metrics.stability, 1);
			assert.equal(benchmarked.result.report.runs, 10);
			assert.match(benchmarked.result.report.resultHash, /^sha256:[0-9a-f]{64}$/);
			assert.match(benchmarked.result.report.fixtureHash, /^sha256:[0-9a-f]{64}$/);
			assert.equal(benchmarked.result.report.amberRevision, require("../../package.json").version);
			assert.deepEqual(benchmarked.result.report.commandOptions, {
				fixture: "benchmark.json",
				mode: "smoke",
			});
			assert.deepEqual(benchmarked.result.report.configuration.hardMetricThresholds, {
				expectedPageRecall: 1,
				selectionPrecision: 1,
				freshnessExclusion: 1,
				requiredCoverage: 1,
				stability: 1,
			});
			assert.equal(benchmarked.result.report.wordCounts.budget, 4000);
			assert.equal(typeof benchmarked.result.report.wordCounts.selected, "number");
			assert.equal(typeof benchmarked.result.report.wordCounts.requiredArtifacts, "number");
			assert.deepEqual(benchmarked.result.report.failureReasons, []);
			assert.equal(
				benchmarked.result.report.actualLoadoutHash,
				benchmarked.result.report.expectedLoadoutHash,
			);
			assert.match(benchmarked.result.text, /expected-page recall: 100.0%/);

			const wrongFixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
			wrongFixture.expected.pages = ["missing-page"];
			wrongFixture.expected.loadout.requiredArtifacts[0].path = "docs/wiki/agent/wrong.md";
			fs.writeFileSync(fixturePath, JSON.stringify(wrongFixture), "utf8");
			const failed = contextDispatch(
				"benchmark",
				args({ _: ["context", "benchmark"], fixture: "benchmark.json", mode: "smoke" }),
			);
			assert.equal(failed.exitCode, 1);
			assert.equal(failed.result.code, "AMBER_E_CONTEXT_BENCHMARK_FAILED");
			assert.equal(failed.result.report.metrics.expectedPageRecall, 0);
			assert.equal(failed.result.report.metrics.selectionPrecision, 0);
			assert.ok(
				failed.result.report.failureReasons.some(
					(reason) => reason.metric === "expectedPageRecall" && reason.actual === 0,
				),
			);
			assert.ok(
				failed.result.report.failureReasons.some(
					(reason) =>
						reason.metric === "exactLoadout" &&
						reason.field === "loadout.requiredArtifacts[0].path",
				),
			);
			assert.ok(Array.isArray(failed.result.report.exclusions));
		} finally {
			cleanup(root);
		}
	});

	it("imports untrusted Source Bundle candidates through an opt-in local fixture adapter", () => {
		const root = makeTarget();
		try {
			seed(root);
			const args = (extra = {}) => ({ target: root, ...extra });
			const target = sourceTargetBinding(root);
			const fixturePath = path.join(root, "source-adapter.json");
			fs.writeFileSync(
				fixturePath,
				JSON.stringify({
					schemaVersion: "1.0.0",
					adapterId: "local-fixture",
					sources: [
						{ ref: "scripts/lib/core/governed-runner.js", kind: "code" },
					],
				}),
				"utf8",
			);

			const disabled = contextDispatch(
				"source-adapter",
				args({ _: ["context", "source-adapter"], fixture: "source-adapter.json" }),
			);
			assert.equal(disabled.exitCode, 1);
			assert.equal(disabled.result.code, "AMBER_E_CONTEXT_ADAPTER_DISABLED");

			const imported = contextDispatch(
				"source-adapter",
				args({
					_: ["context", "source-adapter"],
					fixture: "source-adapter.json",
					enable: true,
				}),
			);
			assert.equal(imported.exitCode, 0, JSON.stringify(imported.result.errors));
			assert.equal(imported.result.bundle.adapterId, "local-fixture");
			assert.equal(imported.result.bundle.target, target);
			assert.equal(imported.result.bundle.sources.length, 1);
			assert.equal(imported.result.bundle.sources[0].mutable, true);
			assert.match(imported.result.bundle.sources[0].rawHash, /^sha256:[0-9a-f]{64}$/);
			assert.match(imported.result.bundle.sources[0].normHash, /^sha256:[0-9a-f]{64}$/);
			assert.equal(
				fs.existsSync(path.join(root, ".amber", "context", "pages")),
				false,
				"Source Adapter must not write accepted Context Pages",
			);
			assert.equal(
				fs.existsSync(path.join(root, ".amber", "context", "loadouts")),
				false,
				"Source Adapter must not write Loadouts",
			);

			const transcriptPath = path.join(root, "session-transcript.txt");
			fs.writeFileSync(
				transcriptPath,
				"API_TOKEN=sk-1234567890abcdefghijklmnop\n",
				"utf8",
			);
			fs.writeFileSync(
				fixturePath,
				JSON.stringify({
					schemaVersion: "1.0.0",
					adapterId: "local-fixture",
					target,
					sources: [{ ref: "session-transcript.txt", kind: "transcript" }],
				}),
				"utf8",
			);
			const transcriptDenied = contextDispatch(
				"source-adapter",
				args({
					_: ["context", "source-adapter"],
					fixture: "source-adapter.json",
					enable: true,
				}),
			);
			assert.equal(transcriptDenied.exitCode, 1);
			assert.equal(transcriptDenied.result.code, "AMBER_E_CONTEXT_TRANSCRIPT_OPT_IN");

			const transcriptAllowed = contextDispatch(
				"source-adapter",
				args({
					_: ["context", "source-adapter"],
					fixture: "source-adapter.json",
					enable: true,
					allowTranscript: true,
				}),
			);
			assert.equal(transcriptAllowed.exitCode, 0);
			assert.equal(transcriptAllowed.result.bundle.sources[0].excerpt, "API_TOKEN=[REDACTED]\n");
			assert.match(
				transcriptAllowed.result.bundle.sources[0].excerptHash,
				/^sha256:[0-9a-f]{64}$/,
			);

			fs.writeFileSync(
				fixturePath,
				JSON.stringify({
					schemaVersion: "1.0.0",
					adapterId: "local-fixture",
					target,
					sources: [{ ref: "docs/adr/0003-governance-gated-execution.md", kind: "adr" }],
				}),
				"utf8",
			);
			fs.mkdirSync(path.join(root, "docs", "decisions"), { recursive: true });
			fs.writeFileSync(path.join(root, "docs", "decisions", "decision.md"), "# Decision\n", "utf8");
			fs.writeFileSync(
				fixturePath,
				JSON.stringify({
					schemaVersion: "1.0.0",
					adapterId: "local-fixture",
					target,
					sources: [
						{ ref: ".amber/sessions/s1/ledger.jsonl", kind: "ledger" },
						{ ref: "docs/adr/0003-governance-gated-execution.md", kind: "adr" },
						{ ref: "docs/decisions/decision.md", kind: "document" },
					],
				}),
				"utf8",
			);
			const immutable = contextDispatch(
				"source-adapter",
				args({
					_: ["context", "source-adapter"],
					fixture: "source-adapter.json",
					enable: true,
				}),
			);
			assert.equal(immutable.exitCode, 0, JSON.stringify(immutable.result.errors));
			assert.equal(immutable.result.bundle.sources.every((source) => source.mutable === false), true);
			assert.deepEqual(
				immutable.result.bundle.sources.map((source) => source.ref),
				[".amber/sessions/s1/ledger.jsonl", "docs/adr/0003-governance-gated-execution.md", "docs/decisions/decision.md"],
			);
			for (const source of immutable.result.bundle.sources) {
				assert.match(source.excerptHash, /^sha256:[0-9a-f]{64}$/);
				assert.equal(source.normHash, undefined);
			}
			assert.equal(
				immutable.result.bundle.sources[1].excerpt,
				"# ADR-0003\n\nFive preconditions gate execution.\n",
			);
		} finally {
			cleanup(root);
		}
	});

	it("rejects malformed, hash-mismatched, missing, and cross-target Source Bundle candidates", () => {
		const root = makeTarget();
		const otherRoot = makeTarget();
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "amber-source-outside-"));
		try {
			seed(root);
			seed(otherRoot);
			const fixturePath = path.join(root, "source-adapter.json");
			const run = (fixture) => {
				fs.writeFileSync(fixturePath, JSON.stringify(fixture), "utf8");
				return contextDispatch("source-adapter", {
					target: root,
					_: ["context", "source-adapter"],
					fixture: "source-adapter.json",
					enable: true,
				});
			};
			const base = {
				schemaVersion: "1.0.0",
				adapterId: "local-fixture",
				target: sourceTargetBinding(root),
			};

			const malformed = run({ ...base, sources: [{ kind: "code" }] });
			assert.equal(malformed.result.code, "AMBER_E_CONTEXT_SOURCE_INVALID");

			const mismatched = run({
				...base,
				sources: [{
					kind: "code",
					ref: "scripts/lib/core/governed-runner.js",
					rawHash: "sha256:" + "f".repeat(64),
				}],
			});
			assert.equal(mismatched.result.code, "AMBER_E_CONTEXT_SOURCE_INVALID");
			assert.match(mismatched.result.errors[0], /hash mismatch/i);

			const missing = run({
				...base,
				sources: [{ kind: "document", ref: "missing.md" }],
			});
			assert.equal(missing.result.code, "AMBER_E_CONTEXT_SOURCE_MISSING");

			const outsideFile = path.join(outside, "outside.md");
			fs.writeFileSync(outsideFile, "outside target\n", "utf8");
			const escaped = run({
				...base,
				sources: [{
					kind: "document",
					ref: path.relative(root, outsideFile).split(path.sep).join("/"),
				}],
			});
			assert.equal(escaped.result.code, "AMBER_E_CONTEXT_SOURCE_INVALID");
			assert.match(escaped.result.errors[0], /outside the target/i);

			const otherFixturePath = path.join(otherRoot, "source-adapter.json");
			fs.writeFileSync(
				otherFixturePath,
				JSON.stringify({
					...base,
					sources: [{ kind: "code", ref: "scripts/lib/core/governed-runner.js" }],
				}),
				"utf8",
			);
			const crossTarget = contextDispatch("source-adapter", {
				target: otherRoot,
				_: ["context", "source-adapter"],
				fixture: "source-adapter.json",
				enable: true,
			});
			assert.equal(crossTarget.result.code, "AMBER_E_CONTEXT_SOURCE_INVALID");
			assert.match(crossTarget.result.errors[0], /target binding mismatch/i);
		} finally {
			cleanup(root);
			cleanup(otherRoot);
			cleanup(outside);
		}
	});

	it("reports retention candidates without rewriting accepted or lineage evidence", () => {
		const root = makeTarget();
		try {
			const contextRoot = path.join(root, ".amber", "context");
			const fixtures = {
				"requests/lineage.json": {
					requestId: "lineage",
					target: { pageId: "current-rule", supersedes: ["old-rule"] },
				},
				"payloads/orphan.json": { pageId: "draft-rule" },
				"pages/old-rule.json": { pageId: "old-rule", supersedes: [] },
				"pages/current-rule.json": { pageId: "current-rule", supersedes: ["old-rule"] },
				"verification/current-rule.json": {
					pageId: "current-rule",
					verifiedAt: "2025-01-01T00:00:00.000Z",
				},
				"loadouts/feature-standard.json": {
					references: [{ pageId: "current-rule" }],
				},
				"projections/orphan-index.json": { sourceHash: "sha256:" + "a".repeat(64) },
			};
			const oldTime = new Date("2025-01-01T00:00:00.000Z");
			for (const [relative, value] of Object.entries(fixtures)) {
				const full = path.join(contextRoot, relative);
				fs.mkdirSync(path.dirname(full), { recursive: true });
				fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, "utf8");
				fs.utimesSync(full, oldTime, oldTime);
			}
			const currentProjection = rebuildProjection(root);
			fs.utimesSync(currentProjection.manifestPath, oldTime, oldTime);

			const before = hashTree(contextRoot);
			const retained = contextDispatch("retention", {
				target: root,
				_: ["context", "retention"],
				olderThanDays: "30",
			});
			assert.equal(retained.exitCode, 0, JSON.stringify(retained.result.errors));
			assert.equal(retained.result.report.reportOnly, true);
			assert.deepEqual(
				[...new Set(retained.result.report.artifacts.map((item) => item.category))].sort(),
				["loadouts", "pages", "payloads", "projections", "requests", "verification"],
			);
			const pageArtifacts = retained.result.report.artifacts.filter(
				(item) => item.category === "pages",
			);
			assert.ok(pageArtifacts.every((item) => item.eligible === false));
			assert.ok(pageArtifacts.every((item) => item.protection === "accepted-page"));
			const lineageRequest = retained.result.report.artifacts.find(
				(item) => item.path === ".amber/context/requests/lineage.json",
			);
			assert.equal(lineageRequest.lineageParticipation, true);
			assert.equal(lineageRequest.eligible, false);
			assert.equal(lineageRequest.protection, "lineage-evidence");
			const orphanProjection = retained.result.report.artifacts.find(
				(item) => item.path === ".amber/context/projections/orphan-index.json",
			);
			assert.equal(orphanProjection.reachable, false);
			assert.equal(orphanProjection.eligible, true);
			const healthyProjection = retained.result.report.artifacts.find(
				(item) => item.path === ".amber/context/projections/context-index.json",
			);
			assert.equal(healthyProjection.reachable, true);
			assert.equal(healthyProjection.eligible, false);
			assert.equal(hashTree(contextRoot), before, "retention must not rewrite or delete artifacts");
		} finally {
			cleanup(root);
		}
	});
});
