"use strict";

// Unit coverage for the Action contract / runtime module
// (scripts/lib/mcp-action-contracts.js). Exercises the contract parity,
// read-only classification, and governed-execution invariants from F018
// Slices 3-4.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
	COMMAND_CAPABILITIES,
	capabilityKey,
	bindsWriteFlag,
	isReadOnlyExecutable,
	validateActionContract,
	validateWhitelist,
} = require("../../scripts/lib/mcp-action-contracts");
const { KNOWN_UNTYPED_SUBCOMMANDS } = require("../../scripts/lib/command-registry");

const ACTION_TYPES_DIR = path.resolve(__dirname, "../../action-types");

function loadRealActions() {
	return fs
		.readdirSync(ACTION_TYPES_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => JSON.parse(fs.readFileSync(path.join(ACTION_TYPES_DIR, f), "utf8")));
}

// Registry is the single source of truth for the mapped CLI surface.
test("COMMAND_CAPABILITIES covers every command the eight Action Types map to", () => {
	const required = [
		"session/start",
		"session/verify",
		"session/approve",
		"session/status",
		"route/list",
		"route/test",
		"context/ingest",
		"context/preview",
		"governance/report",
		"ledger/export",
		"loop/recommend",
		"eval/run",
	];
	for (const key of required) {
		assert.ok(COMMAND_CAPABILITIES[key], `registry missing ${key}`);
	}
});

test("context/load is untyped (§15.1 open point (c) cleanup)", () => {
	assert.equal(COMMAND_CAPABILITIES["context/load"], undefined);
	assert.equal(KNOWN_UNTYPED_SUBCOMMANDS.has("context/load"), true);
});

test("every real action type passes semantic parity validation", () => {
	const actions = loadRealActions();
	assert.ok(actions.length >= 8, "expected at least eight action types");
	const { valid, findings } = validateWhitelist(actions);
	assert.equal(valid, true, `action contract findings:\n${findings.join("\n")}`);
});

test("a deliberately mismatched fixture is refused at registration", () => {
	// approver mismatch: governance/report needs "system" but we declare "human".
	const approverMismatch = {
		actionTypeId: "amber.test.bad",
		version: 1,
		goal: "x",
		mode: "dry-run",
		parameters: {},
		effects: { edits: [], sideEffects: [], rollback: false },
		evidenceRequired: [],
		governance: { policy: "p", approver: ["human"], evidence: [] },
		execution: { command: "governance", subcommand: "report", args: [] },
	};
	assert.ok(
		validateActionContract(approverMismatch).some((f) => /approver mismatch/.test(f)),
		"approver mismatch must be reported",
	);

	// evidence mismatch: session/verify persists timeline-event but we require verify-result.
	const evidenceMismatch = {
		actionTypeId: "amber.test.verify",
		version: 1,
		goal: "x",
		mode: "interactive",
		parameters: { sessionId: { type: "string", required: true } },
		effects: {
			edits: [".amber/sessions/<id>/timeline.jsonl"],
			sideEffects: ["timeline-event"],
			rollback: true,
		},
		evidenceRequired: ["verify-result"],
		governance: { policy: "p", approver: ["system"], evidence: ["timeline-event"] },
		execution: {
			command: "session",
			subcommand: "verify",
			args: [{ flag: "--session", source: "parameters.sessionId" }],
		},
	};
	assert.ok(
		validateActionContract(evidenceMismatch).some((f) => /evidence mismatch/.test(f)),
		"evidence mismatch must be reported",
	);

	const governanceEvidenceMismatch = {
		...evidenceMismatch,
		actionTypeId: "amber.test.governance-evidence",
		evidenceRequired: ["timeline-event"],
		governance: { policy: "p", approver: ["system"], evidence: ["verify-result"] },
	};
	assert.ok(
		validateActionContract(governanceEvidenceMismatch).some((f) =>
			/governance evidence mismatch/.test(f),
		),
		"governance evidence mismatch must be reported",
	);

	const extraEvidence = {
		...evidenceMismatch,
		actionTypeId: "amber.test.extra-evidence",
		evidenceRequired: ["timeline-event", "verify-result"],
		governance: {
			policy: "p",
			approver: ["system"],
			evidence: ["timeline-event", "verify-result"],
		},
	};
	assert.ok(
		validateActionContract(extraEvidence).some((finding) => /evidence mismatch/.test(finding)),
		"undeclared command evidence must not be invented by the Action",
	);

	// effect mismatch: write command with no edits.
	const effectMismatch = {
		actionTypeId: "amber.test.start",
		version: 1,
		goal: "x",
		mode: "interactive",
		parameters: { goal: { type: "string", required: true } },
		effects: { edits: [], sideEffects: [], rollback: false },
		evidenceRequired: ["timeline-event"],
		governance: { policy: "p", approver: ["system"], evidence: ["timeline-event"] },
		execution: {
			command: "session",
			subcommand: "start",
			args: [{ flag: "--goal", source: "parameters.goal" }],
		},
	};
	assert.ok(
		validateActionContract(effectMismatch).some((f) => /effect mismatch/.test(f)),
		"write-without-edits must be reported",
	);

	// unknown command mapping.
	const unknownMapping = {
		actionTypeId: "amber.test.unknown",
		version: 1,
		goal: "x",
		mode: "dry-run",
		parameters: {},
		effects: { edits: [], sideEffects: [], rollback: false },
		evidenceRequired: [],
		governance: { policy: "p", approver: ["system"], evidence: [] },
		execution: { command: "nuke", subcommand: "everything", args: [] },
	};
	assert.ok(
		validateActionContract(unknownMapping).some((f) => /unknown command mapping/.test(f)),
		"unknown mapping must be reported",
	);
});

test("autonomous mode Action is refused (no governed adapter exists)", () => {
	const autonomous = {
		actionTypeId: "amber.test.auto",
		version: 1,
		goal: "x",
		mode: "autonomous",
		parameters: { goal: { type: "string", required: true } },
		effects: { edits: [".amber/x"], sideEffects: ["timeline-event"], rollback: true },
		evidenceRequired: ["timeline-event"],
		governance: { policy: "p", approver: ["system"], evidence: ["timeline-event"] },
		execution: {
			command: "session",
			subcommand: "start",
			args: [{ flag: "--goal", source: "parameters.goal" }],
		},
	};
	assert.ok(
		validateActionContract(autonomous).some((f) => /autonomous mode is not permitted/.test(f)),
		"autonomous mode must be refused",
	);
});

test("write-capable flag behind a read-only declaration is caught", () => {
	const hiddenWrite = {
		actionTypeId: "amber.test.hiddenwrite",
		version: 1,
		goal: "x",
		mode: "dry-run",
		parameters: { output: { type: "string" } },
		effects: { edits: [], sideEffects: [], rollback: false },
		evidenceRequired: [],
		governance: { policy: "p", approver: ["system"], evidence: [] },
		execution: {
			command: "governance",
			subcommand: "report",
			args: [{ flag: "--output", source: "parameters.output", optional: true }],
		},
	};
	assert.ok(
		validateActionContract(hiddenWrite).some((f) => /write-capable flag/.test(f)),
		"hidden write flag must be reported",
	);
	assert.equal(
		isReadOnlyExecutable(hiddenWrite),
		false,
		"read-only exec must reject hidden write flag",
	);
});

test("semantic parity rejects mode and durable-evidence claims that disagree with the command", () => {
	const readClaimingEvidence = {
		actionTypeId: "amber.test.read-evidence",
		version: 1,
		goal: "x",
		mode: "dry-run",
		parameters: {},
		effects: { edits: [], sideEffects: ["timeline-event"], rollback: false },
		evidenceRequired: ["timeline-event"],
		governance: { policy: "p", approver: ["system"], evidence: ["timeline-event"] },
		execution: { command: "session", subcommand: "status", args: [] },
	};
	const readFindings = validateActionContract(readClaimingEvidence);
	assert.ok(
		readFindings.some((finding) => /evidence mismatch/.test(finding)),
		readFindings.join("\n"),
	);
	assert.ok(
		readFindings.some((finding) => /side-effect mismatch/.test(finding)),
		readFindings.join("\n"),
	);

	const writeClaimingDryRun = {
		actionTypeId: "amber.test.write-mode",
		version: 1,
		goal: "x",
		mode: "dry-run",
		parameters: { goal: { type: "string", required: true } },
		effects: {
			edits: [".amber/sessions/<id>/manifest.json"],
			sideEffects: ["timeline-event"],
			rollback: true,
		},
		evidenceRequired: ["timeline-event"],
		governance: { policy: "p", approver: ["system"], evidence: ["timeline-event"] },
		execution: { command: "session", subcommand: "start", args: [] },
	};
	const writeFindings = validateActionContract(writeClaimingDryRun);
	assert.ok(
		writeFindings.some((finding) => /mode mismatch/.test(finding)),
		writeFindings.join("\n"),
	);
});

test("isReadOnlyExecutable: read queries pass, mutations fail", () => {
	const actions = loadRealActions();
	const byId = new Map(actions.map((a) => [a.actionTypeId, a]));

	// Read-only queries are directly executable.
	assert.equal(isReadOnlyExecutable(byId.get("amber.object.query")), true);
	assert.equal(isReadOnlyExecutable(byId.get("amber.route.test")), true);
	assert.equal(isReadOnlyExecutable(byId.get("amber.session.status")), true);
	assert.equal(isReadOnlyExecutable(byId.get("amber.governance.report")), true);

	// Mutating actions are never directly executable.
	assert.equal(isReadOnlyExecutable(byId.get("amber.session.start")), false);
	assert.equal(isReadOnlyExecutable(byId.get("amber.session.verify")), false);
	assert.equal(isReadOnlyExecutable(byId.get("amber.session.approve")), false);
	assert.equal(isReadOnlyExecutable(byId.get("amber.context.ingest")), false);
});

test("COMMAND_CAPABILITIES covers the memory verb surface with exact parity (batch A)", () => {
	const required = ["memory/approve", "memory/abandon", "memory/status"];
	for (const key of required) {
		assert.ok(COMMAND_CAPABILITIES[key], `registry missing ${key}`);
	}
	assert.deepEqual(COMMAND_CAPABILITIES["memory/approve"], {
		effect: "write",
		approver: "human",
		evidence: "approval-record",
		directReadOnlyExec: false,
		edits: [".amber/memory/registry/", ".amber/context/events.jsonl"],
		sideEffects: ["ledger-append"],
	});
	assert.equal(COMMAND_CAPABILITIES["memory/abandon"].approver, "human");
	assert.equal(COMMAND_CAPABILITIES["memory/abandon"].evidence, "ingest-record");
	assert.ok(COMMAND_CAPABILITIES["memory/abandon"].edits.includes(".amber/memory/requests/"));
	assert.deepEqual(COMMAND_CAPABILITIES["memory/status"], {
		effect: "read",
		approver: "system",
		evidence: null,
		directReadOnlyExec: true,
		edits: [],
		sideEffects: [],
	});

	const actions = loadRealActions();
	const byId = new Map(actions.map((a) => [a.actionTypeId, a]));
	assert.ok(byId.get("amber.memory.approve"), "memory-approve.json must be registered");
	assert.ok(byId.get("amber.memory.abandon"), "memory-abandon.json must be registered");
	assert.ok(byId.get("amber.memory.status"), "memory-status.json must be registered");
	assert.equal(isReadOnlyExecutable(byId.get("amber.memory.status")), true);
	assert.equal(isReadOnlyExecutable(byId.get("amber.memory.approve")), false);
	assert.equal(isReadOnlyExecutable(byId.get("amber.memory.abandon")), false);
});

test("bindsWriteFlag detects --output on governance/report", () => {
	const resolved = {
		mapping: {
			command: "governance",
			subcommand: "report",
			args: [{ flag: "--output", source: "parameters.output", optional: true }],
		},
		capability: COMMAND_CAPABILITIES[capabilityKey("governance", "report")],
	};
	assert.equal(bindsWriteFlag(resolved), true);

	const clean = {
		mapping: { command: "governance", subcommand: "report", args: [] },
		capability: COMMAND_CAPABILITIES[capabilityKey("governance", "report")],
	};
	assert.equal(bindsWriteFlag(clean), false);
});
