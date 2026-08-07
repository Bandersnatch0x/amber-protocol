"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const SCHEMA_DIR = path.join(__dirname, "..", "schemas");
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

function loadSchema(name) {
	const raw = fs.readFileSync(path.join(SCHEMA_DIR, name), "utf8");
	return JSON.parse(raw);
}

// ---- (a) Legacy JSON (no new optional fields) passes each schema ----

function legacyLoopContract() {
	return {
		id: "test-loop",
		trigger: { type: "manual", enabled: false },
		stateSpine: ".amber/loops/test/state.json",
		hardStops: { maxIterations: 3 },
	};
}

function legacyRoute() {
	return {
		routeId: "test-route",
		schemaVersion: "1.0.0",
		stages: [{ name: "verify", type: "command", target: "node --version" }],
	};
}

function legacySessionManifest() {
	return {
		sessionId: "00000000-0000-4000-8000-000000000001",
		schemaVersion: "1.0.0-rc.1",
		createdAt: "2026-08-07T00:00:00Z",
		route: { id: "test-route", version: "1.0.0" },
		goal: "Test goal",
		status: "created",
	};
}

function legacyTimelineEvent() {
	return {
		timestamp: "2026-08-07T00:00:00Z",
		type: "session_created",
	};
}

function legacyKnowledgePlan() {
	return {
		schemaVersion: "1.0.0",
		knowledgePlan: {
			documents: [{ title: "Architecture", goal: "Document the architecture" }],
		},
	};
}

function legacyWorkflowAssessment() {
	return {
		schemaVersion: "1.0.0",
		target: ".",
		scope: { repository: true, sessions: "covered" },
		coverage: {
			repository: "covered",
			session: "covered",
			delivery: "covered",
			agentAssets: "covered",
		},
		dimensions: {
			contextAdequacy: { coverage: "covered", confidence: "high" },
			lifecycleDiscipline: { coverage: "covered", confidence: "high" },
			verificationCoverage: { coverage: "covered", confidence: "high" },
			deliveryIntegrity: { coverage: "covered", confidence: "high" },
			improvementLoop: { coverage: "covered", confidence: "high" },
		},
		findings: [
			{
				id: "f1",
				dimension: "contextAdequacy",
				severity: "info",
				confidence: "high",
				summary: "Test finding",
				evidenceRefs: ["e1"],
				owner: "dev",
				verifier: "check",
				actionKind: "none",
			},
		],
	};
}

function legacyContextPage() {
	return {
		schemaVersion: "1.0.0",
		pageId: "test-page",
		title: "Test Page",
		sources: {
			s1: {
				kind: "source",
				ref: "test.md",
				rawHash: `sha256:${"a".repeat(64)}`,
				normHash: `sha256:${"b".repeat(64)}`,
				mutable: true,
			},
		},
		blocks: [{ type: "prose", sources: ["s1"], text: "Test block." }],
	};
}

function legacyContextRequest() {
	return {
		schemaVersion: "1.0.0",
		requestId: "test-request",
		createdAt: "2026-08-07T00:00:00Z",
		target: { pageId: "test-page", title: "Test Page" },
		sources: [
			{
				kind: "source",
				ref: "test.md",
				rawHash: `sha256:${"a".repeat(64)}`,
				normHash: `sha256:${"b".repeat(64)}`,
				mutable: true,
			},
		],
		contract: {
			outputSchema: "schemas/context-page.schema.json",
			instructions: "Test",
			constraints: { maxWords: 100 },
		},
		acceptance: [{ check: "schema", code: "AMBER_E_TEST" }],
	};
}

const legacyPairs = [
	["loop-contract.schema.json", legacyLoopContract],
	["route.schema.json", legacyRoute],
	["session-manifest.schema.json", legacySessionManifest],
	["timeline-event.schema.json", legacyTimelineEvent],
	["knowledge-plan.schema.json", legacyKnowledgePlan],
	["workflow-assessment.schema.json", legacyWorkflowAssessment],
	["context-page.schema.json", legacyContextPage],
	["context-request.schema.json", legacyContextRequest],
];

describe("schema versioning — legacy JSON passes validation", () => {
	for (const [schemaFile, factory] of legacyPairs) {
		it(`accepts legacy ${schemaFile} without versioning fields`, () => {
			const schema = loadSchema(schemaFile);
			const validate = ajv.compile(schema);
			const data = factory();
			// Ensure none of the four optional versioning fields are present.
			assert.strictEqual(data.amber_protocol_version, undefined);
			assert.strictEqual(data.artifact_sequence, undefined);
			assert.strictEqual(data.created_at, undefined);
			assert.strictEqual(data.artifact_type, undefined);
			const ok = validate(data);
			assert.strictEqual(ok, true, JSON.stringify(validate.errors));
		});
	}
});

// ---- (b) execution_mode illegal values rejected ----

describe("execution_mode validation", () => {
	it("rejects invalid execution_mode on loop-contract", () => {
		const schema = loadSchema("loop-contract.schema.json");
		const validate = ajv.compile(schema);
		const data = { ...legacyLoopContract(), execution_mode: "invalid_mode" };
		assert.strictEqual(validate(data), false);
		assert.ok(
			validate.errors.some((e) => e.keyword === "enum" && e.instancePath.endsWith("/execution_mode")),
			`expected enum error for execution_mode: ${JSON.stringify(validate.errors)}`,
		);
	});

	it("accepts valid execution_mode on loop-contract", () => {
		const schema = loadSchema("loop-contract.schema.json");
		const validate = ajv.compile(schema);
		const data = { ...legacyLoopContract(), execution_mode: "dag" };
		assert.strictEqual(validate(data), true, JSON.stringify(validate.errors));
	});

	it("rejects invalid execution_mode on route", () => {
		const schema = loadSchema("route.schema.json");
		const validate = ajv.compile(schema);
		const data = { ...legacyRoute(), execution_mode: "bad" };
		assert.strictEqual(validate(data), false);
		assert.ok(
			validate.errors.some((e) => e.keyword === "enum" && e.instancePath.endsWith("/execution_mode")),
			`expected enum error for execution_mode: ${JSON.stringify(validate.errors)}`,
		);
	});

	it("accepts valid execution_mode on route", () => {
		const schema = loadSchema("route.schema.json");
		const validate = ajv.compile(schema);
		const data = { ...legacyRoute(), execution_mode: "bounded_loop" };
		assert.strictEqual(validate(data), true, JSON.stringify(validate.errors));
	});

	it("accepts route with objective field", () => {
		const schema = loadSchema("route.schema.json");
		const validate = ajv.compile(schema);
		const data = { ...legacyRoute(), objective: "verify-and-deploy" };
		assert.strictEqual(validate(data), true, JSON.stringify(validate.errors));
	});
});

// ---- (c) Doctor version drift ----

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-schema-versioning-${name}-`));
}

describe("doctor version drift", () => {
	const { doctor } = require("../scripts/lib/core/doctor");
	const { scaffoldHarness } = require("../scripts/lib/core/scaffold");
	const CLI_VERSION = require("../package.json").version;

	it("warns when artifact has mismatched amber_protocol_version", () => {
		const target = tempDir("drift-warn");
		scaffoldHarness(target);

		// Write a session manifest with a stale protocol version.
		const sessionsDir = path.join(target, ".amber", "sessions");
		const sessionDir = path.join(sessionsDir, "test-session");
		fs.mkdirSync(sessionDir, { recursive: true });
		const manifest = {
			sessionId: "11111111-1111-4111-8111-111111111111",
			schemaVersion: "1.0.0-rc.1",
			createdAt: "2026-08-07T00:00:00Z",
			route: { id: "test", version: "1.0.0" },
			goal: "Test",
			status: "created",
			amber_protocol_version: "1.0.0",
		};
		fs.writeFileSync(
			path.join(sessionDir, "manifest.json"),
			JSON.stringify(manifest, null, 2),
		);

		const result = doctor(target);
		assert.ok(
			result.warnings.some((w) => /protocol version/i.test(w) && /1\.0\.0/.test(w)),
			`expected version drift warning, got: ${JSON.stringify(result.warnings)}`,
		);
	});

	it("does not warn when artifact version matches installed version", () => {
		const target = tempDir("drift-ok");
		scaffoldHarness(target);

		const sessionsDir = path.join(target, ".amber", "sessions");
		const sessionDir = path.join(sessionsDir, "test-session");
		fs.mkdirSync(sessionDir, { recursive: true });
		const manifest = {
			sessionId: "22222222-2222-4222-8222-222222222222",
			schemaVersion: "1.0.0-rc.1",
			createdAt: "2026-08-07T00:00:00Z",
			route: { id: "test", version: "1.0.0" },
			goal: "Test",
			status: "created",
			amber_protocol_version: CLI_VERSION,
		};
		fs.writeFileSync(
			path.join(sessionDir, "manifest.json"),
			JSON.stringify(manifest, null, 2),
		);

		const result = doctor(target);
		assert.ok(
			!result.warnings.some((w) => /protocol version/i.test(w)),
			`expected no version drift warning, got: ${JSON.stringify(result.warnings)}`,
		);
	});
});
