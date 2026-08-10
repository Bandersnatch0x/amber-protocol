"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const { KNOWLEDGE_KINDS } = require("../../scripts/lib/core/context-knowledge");

const SCHEMA_DIR = path.join(__dirname, "..", "..", "schemas");
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

function loadSchema(name) {
	const raw = fs.readFileSync(path.join(SCHEMA_DIR, name), "utf8");
	return JSON.parse(raw);
}

function validPage(overrides = {}) {
	const { scope, ...rest } = overrides;
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
			s2: {
				kind: "ledger",
				ref: ".amber/sessions/4f2a/ledger.jsonl#L12-L48",
				rawHash: "sha256:" + "c".repeat(64),
				mutable: false,
				excerpt: "{\"action\":\"governed-command\",\"result\":\"pass\"}",
				excerptHash: "sha256:" + "d".repeat(64),
			},
		},
		blocks: [
			{ type: "prose", sources: ["s1"], text: "Execution is gated by five preconditions." },
			{ type: "unknown", sources: ["s1"], text: "Whether loop and route share one chain." },
		],
		...(Array.isArray(scope) ? { scope } : {}),
		...rest,
	};
}

function findProperty(node, propertyName) {
	if (!node || typeof node !== "object") return null;
	if (node.properties && node.properties[propertyName]) return node.properties[propertyName];
	for (const value of Object.values(node)) {
		const found = findProperty(value, propertyName);
		if (found) return found;
	}
	return null;
}

function validRequest(overrides = {}) {
	const { scope, ...rest } = overrides;
	const target = { pageId: "governed-execution", title: "Governed execution", reason: "wiki-drift" };
	if (Array.isArray(scope)) target.scope = scope;
	return {
		schemaVersion: "1.0.0",
		requestId: "kd-2026-08-07-a3f1",
		createdAt: "2026-08-07T01:20:00Z",
		target,
		sources: [
			{
				kind: "adr",
				ref: "docs/adr/0003-governance-gated-execution.md",
				rawHash: "sha256:" + "a".repeat(64),
				normHash: "sha256:" + "b".repeat(64),
				mutable: true,
			},
		],
		contract: {
			outputSchema: "schemas/context-page.schema.json",
			instructions: "Extract claims from sources; cite every block; mark uncertainty as unknown.",
			constraints: { maxWords: 800, requireCitationPerClaim: true, forbidNewFacts: true },
		},
		acceptance: [
			{ check: "schema", code: "AMBER_E_CONTEXT_SCHEMA_INVALID" },
			{ check: "citations", code: "AMBER_E_CONTEXT_CLAIM_UNCITED" },
		],
		...rest,
	};
}

function validLoadout(overrides = {}) {
	return {
		schemaVersion: "1.0.0",
		route: "bugfix-quick",
		feature: null,
		generatedAt: "2026-08-07T01:20:00Z",
		budgetWords: 4000,
		artifacts: {
			required: [
				{
					kind: "operating-manual",
					path: "docs/wiki/agent/amber.md",
					rawHash: "sha256:" + "a".repeat(64),
					words: 100,
				},
				{
					kind: "route-manifest",
					path: "routes/bugfix-quick.route.json",
					rawHash: "sha256:" + "b".repeat(64),
					words: 50,
				},
				{
					kind: "loadout-definition",
					path: "docs/wiki/agent/context-loadout.md",
					rawHash: "sha256:" + "c".repeat(64),
					words: 80,
				},
			],
		},
		tiers: { required: [], priority: [], optional: [] },
		pages: {},
		references: [],
		excluded: [],
		deltaSince: null,
		...overrides,
	};
}

describe("Context schema contracts", () => {
	it("keeps Knowledge Kind enums aligned across schemas and the core vocabulary", () => {
		for (const schemaName of [
			"context-page.schema.json",
			"context-request.schema.json",
			"context-loadout.schema.json",
			"context-benchmark.schema.json",
		]) {
			const schema = loadSchema(schemaName);
			const property = findProperty(schema, schemaName === "context-loadout.schema.json" || schemaName === "context-benchmark.schema.json" ? "knowledgeKinds" : "knowledgeKind");
			const enumValues = property?.enum || property?.items?.enum;
			assert.deepEqual(enumValues, KNOWLEDGE_KINDS, schemaName);
		}
	});
});

describe("context-page schema", () => {
	const validate = ajv.compile(loadSchema("context-page.schema.json"));

	it("accepts a valid page", () => {
		assert.equal(validate(validPage()), true, JSON.stringify(validate.errors));
	});

	it("accepts observational assurance without an authored verification time", () => {
		const page = validPage({
			schemaVersion: "1.2.0",
			assurance: { confidence: "high", maturity: "validated" },
		});
		assert.equal(validate(page), true, JSON.stringify(validate.errors));
	});

	it("rejects a self-authored verification time in assurance", () => {
		const page = validPage({
			schemaVersion: "1.2.0",
			assurance: {
				confidence: "high",
				maturity: "validated",
				verifiedAt: "2026-08-10T00:00:00.000Z",
			},
		});
		assert.equal(validate(page), false);
	});

	it("accepts a valid page with scope", () => {
		assert.equal(validate(validPage({ scope: ["feature-standard", "bugfix-quick"] })), true, JSON.stringify(validate.errors));
	});

	it("accepts a valid 1.1.0 page without scope", () => {
		assert.equal(validate(validPage({ schemaVersion: "1.1.0" })), true, JSON.stringify(validate.errors));
	});

	it("accepts a page with scope but schemaVersion 1.0.0 (legacy compat via enum)", () => {
		assert.equal(validate(validPage({ schemaVersion: "1.0.0", scope: ["feature-standard"] })), true, JSON.stringify(validate.errors));
	});

	it("rejects a page with a non-string scope entry", () => {
		const page = validPage({ scope: ["feature-standard", 42] });
		assert.equal(validate(page), false);
	});

	it("rejects a page with duplicate scope entries (uniqueItems)", () => {
		const page = validPage({ scope: ["feature-standard", "feature-standard"] });
		assert.equal(validate(page), false);
	});

	it("rejects a page with an unknown schemaVersion", () => {
		const page = validPage({ schemaVersion: "2.0.0" });
		assert.equal(validate(page), false);
	});

	it("rejects a block without sources", () => {
		const page = validPage();
		page.blocks[0].sources = [];
		assert.equal(validate(page), false);
		assert.ok(validate.errors.some((e) => e.instancePath.includes("sources")));
	});

	it("rejects a block whose type is not prose/unknown", () => {
		const page = validPage();
		page.blocks[0].type = "claim";
		assert.equal(validate(page), false);
	});

	it("rejects a mutable source without normHash", () => {
		const page = validPage();
		delete page.sources.s1.normHash;
		assert.equal(validate(page), false);
	});

	it("rejects an immutable source without an excerpt snapshot", () => {
		const page = validPage();
		delete page.sources.s2.excerpt;
		assert.equal(validate(page), false);
	});

	it("rejects an empty sources map", () => {
		const page = validPage();
		page.sources = {};
		assert.equal(validate(page), false);
	});

	it("rejects a non-kebab-case pageId", () => {
		const page = validPage();
		page.pageId = "governed_execution";
		assert.equal(validate(page), false);
	});
});

describe("context-request schema", () => {
	const validate = ajv.compile(loadSchema("context-request.schema.json"));

	it("accepts a valid request", () => {
		assert.equal(validate(validRequest()), true, JSON.stringify(validate.errors));
	});

	it("accepts a valid request with target.scope", () => {
		assert.equal(validate(validRequest({ scope: ["feature-standard", "F015"] })), true, JSON.stringify(validate.errors));
	});

	it("accepts a 1.1.0 request with target.scope", () => {
		assert.equal(validate(validRequest({ schemaVersion: "1.1.0", scope: ["feature-standard"] })), true, JSON.stringify(validate.errors));
	});

	it("rejects a request with duplicate target.scope entries (uniqueItems)", () => {
		const req = validRequest({ scope: ["feature-standard", "feature-standard"] });
		assert.equal(validate(req), false);
	});

	it("rejects a request without acceptance codes", () => {
		const req = validRequest();
		req.acceptance = [];
		assert.equal(validate(req), false);
	});

	it("rejects a request whose target lacks pageId", () => {
		const req = validRequest();
		delete req.target.pageId;
		assert.equal(validate(req), false);
	});

	it("rejects a request with an invalid source hash format", () => {
		const req = validRequest();
		req.sources[0].rawHash = "md5:abc";
		assert.equal(validate(req), false);
	});
});

describe("context-loadout schema", () => {
	const validate = ajv.compile(loadSchema("context-loadout.schema.json"));

	it("accepts the final 1.0.0 shape with independent required artifacts", () => {
		assert.equal(validate(validLoadout()), true, JSON.stringify(validate.errors));
	});

	it("rejects the incorrect local compatibility version", () => {
		assert.equal(validate(validLoadout({ schemaVersion: "1.1.0" })), false);
	});

	it("rejects a loadout without artifacts.required", () => {
		const loadout = validLoadout();
		delete loadout.artifacts;
		assert.equal(validate(loadout), false);
	});
});

describe("context-verification schema", () => {
	const validate = ajv.compile(loadSchema("context-verification.schema.json"));

	it("accepts hash-bound verification evidence", () => {
		assert.equal(
			validate({
				schemaVersion: "1.0.0",
				pageId: "governed-execution",
				requestId: "kd-2026-08-10-a3f1",
				outcome: "accepted",
				pageHash: "sha256:" + "a".repeat(64),
				ingestEventHash: "sha256:" + "b".repeat(64),
				verifiedAt: "2026-08-10T00:00:00.000Z",
			}),
			true,
			JSON.stringify(validate.errors),
		);
	});

	it("rejects evidence without a valid page hash", () => {
		assert.equal(
			validate({
				schemaVersion: "1.0.0",
				pageId: "governed-execution",
				requestId: "kd-2026-08-10-a3f1",
				outcome: "accepted",
				pageHash: "sha256:invalid",
				ingestEventHash: "sha256:" + "b".repeat(64),
				verifiedAt: "2026-08-10T00:00:00.000Z",
			}),
			false,
		);
	});
});
