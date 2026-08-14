"use strict";

// Integration coverage for the Action Type contract introduced with the
// operational-ontology positioning (docs/wiki/amber-ontology-mcp.md):
//
// 1. schemas/action.type.schema.json is a valid draft-07 schema and compiles.
// 2. Representative valid action type definitions validate against it.
// 3. Malformed definitions are rejected (bad id, missing governance, bad enum).
// 4. The mapped amber CLI surface (amber session start / verify / approve /
//    governance report) still works, matching the P1 whitelist draft.
//
// Schema-only tests are pure; the CLI smoke test uses the isolated harness
// pattern from session-commands.test.js.

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const Ajv = require("ajv");
const { installTargetRoutes } = require("../helpers/target-routes");

const ROOT = path.resolve(__dirname, "../..");
const SCHEMA_PATH = path.join(ROOT, "schemas", "action.type.schema.json");
const SESSION_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "amber-action-int-"));
installTargetRoutes(SESSION_ROOT);

test.after(() => {
	fs.rmSync(SESSION_ROOT, { recursive: true, force: true });
});

function runHarness(args) {
	return spawnSync(
		process.execPath,
		[path.join(ROOT, "scripts", "harness.js"), ...args, "--target", SESSION_ROOT],
		{ cwd: ROOT, encoding: "utf8" },
	);
}

function loadActionTypeSchema() {
	assert.ok(fs.existsSync(SCHEMA_PATH), "schemas/action.type.schema.json must exist");
	const raw = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
	assert.equal(raw.$schema, "http://json-schema.org/draft-07/schema#");
	return raw;
}

function compileSchema(schema) {
	const ajv = new Ajv({ allErrors: true });
	return ajv.compile(schema);
}

const validActionType = {
	actionTypeId: "amber.session.start",
	version: 1,
	title: "Start session",
	goal: "Create a new governed session for an agent task.",
	mode: "interactive",
	parameters: {
		goal: { type: "string", required: true, description: "Task goal statement." },
		route: { type: "string", description: "Route id to bind." },
		worktree: { type: "boolean", default: false },
	},
	submissionCriteria: ["no active session exists for this goal"],
	effects: {
		edits: [".amber/sessions/<id>/manifest.json"],
		sideEffects: ["timeline-event"],
		rollback: true,
	},
	evidenceRequired: ["timeline-event"],
	timeout: 300,
	governance: {
		policy: "governance/policy.md#session-lifecycle",
		approver: ["system"],
		evidence: [],
		circuitBreaker: true,
		worktreeIsolation: true,
	},
};

test("action.type.schema.json exists and compiles as draft-07", () => {
	const schema = loadActionTypeSchema();
	const validate = compileSchema(schema);
	assert.equal(typeof validate, "function");
});

test("valid action type definition validates", () => {
	const validate = compileSchema(loadActionTypeSchema());
	assert.equal(validate(validActionType), true, JSON.stringify(validate.errors));
});

test("dry-run and autonomous modes are allowed; unknown mode rejected", () => {
	const validate = compileSchema(loadActionTypeSchema());
	const dryRun = { ...validActionType, actionTypeId: "amber.route.test", mode: "dry-run" };
	const autonomous = { ...validActionType, actionTypeId: "amber.route.test", mode: "autonomous" };
	assert.equal(validate(dryRun), true, JSON.stringify(validate.errors));
	assert.equal(validate(autonomous), true, JSON.stringify(validate.errors));

	const badMode = { ...validActionType, mode: "reckless" };
	assert.equal(validate(badMode), false);
	assert.ok(
		validate.errors.some((e) => e.instancePath.endsWith("/mode")),
		"error must point at mode",
	);
});

test("actionTypeId must match the amber.* namespace pattern", () => {
	const validate = compileSchema(loadActionTypeSchema());
	const badId = { ...validActionType, actionTypeId: "session.start" };
	assert.equal(validate(badId), false);
	const noLeadingAmber = { ...validActionType, actionTypeId: "other.session.start" };
	assert.equal(validate(noLeadingAmber), false);
});

test("missing governance block is rejected", () => {
	const validate = compileSchema(loadActionTypeSchema());
	const withoutGovernance = { ...validActionType };
	delete withoutGovernance.governance;
	assert.equal(validate(withoutGovernance), false);
	assert.ok(
		validate.errors.some((e) => e.params && e.params.missingProperty === "governance"),
		"error must report missing governance",
	);
});

test("unknown approver enum value is rejected", () => {
	const validate = compileSchema(loadActionTypeSchema());
	const badApprover = {
		...validActionType,
		governance: { ...validActionType.governance, approver: ["hacker"] },
	};
	assert.equal(validate(badApprover), false);
});

test("top-level unknown properties are rejected (closed contract)", () => {
	const validate = compileSchema(loadActionTypeSchema());
	const withExtra = { ...validActionType, surpriseField: true };
	assert.equal(validate(withExtra), false);
});

test("variant-based execution mapping validates and rejects unknown variants", () => {
	const validate = compileSchema(loadActionTypeSchema());

	const variantAction = {
		...validActionType,
		actionTypeId: "amber.object.query",
		mode: "dry-run",
		execution: {
			variantParam: "objectType",
			variants: {
				session: {
					command: "session",
					subcommand: "status",
					args: [{ position: 0, source: "parameters.id", optional: true }],
				},
				ledger: { command: "ledger", subcommand: "export" },
			},
		},
	};
	assert.equal(validate(variantAction), true, JSON.stringify(validate.errors));

	// Mixing both forms (command + variants) must fail the oneOf: both
	// branches match, so exactly-one is violated.
	const mixed = {
		...variantAction,
		execution: {
			command: "session",
			subcommand: "status",
			variantParam: "objectType",
			variants: variantAction.execution.variants,
		},
	};
	assert.equal(validate(mixed), false);

	// Variant missing the required command/subcommand must fail.
	const brokenVariant = {
		...variantAction,
		execution: {
			variantParam: "objectType",
			variants: { session: { args: [] } },
		},
	};
	assert.equal(validate(brokenVariant), false);
});

test("mapped CLI surface still works (P1 whitelist smoke)", () => {
	// amber.session.start
	const start = runHarness([
		"session",
		"start",
		"--goal",
		"action type smoke",
		"--route",
		"feature-standard",
		"--confirm",
	]);
	assert.equal(start.status, 0, start.stderr);
	const match = start.stdout.match(/Session created: ([a-f0-9-]+)/);
	assert.ok(match, start.stdout);
	const sessionId = match[1];

	// amber.session.verify
	const verify = runHarness([
		"session",
		"verify",
		"--session",
		sessionId,
		"--stage",
		"smoke",
		"--result",
		"ok",
		"--confirm",
	]);
	assert.equal(verify.status, 0, verify.stderr);

	// amber.session.approve
	const approve = runHarness([
		"session",
		"approve",
		"--session",
		sessionId,
		"--gate",
		"user-approval-plan",
		"--yes",
	]);
	assert.equal(approve.status, 0, approve.stderr);

	// amber.governance.report (read-only object query analogue)
	const report = runHarness(["governance", "report"]);
	assert.equal(report.status, 0, report.stderr);
});
