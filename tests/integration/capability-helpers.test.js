"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
	deriveCapabilityFromAction,
	COMMAND_CAPABILITIES,
} = require("../../scripts/lib/mcp-action-contracts");
const { toCapability } = require("../../scripts/lib/context/action-registry");

test("deriveCapabilityFromAction projects write action with edits", () => {
	const action = {
		actionTypeId: "amber.session.start",
		mode: "interactive",
		effects: {
			edits: [".amber/sessions/<id>/manifest.json"],
			sideEffects: ["timeline-event"],
		},
		evidenceRequired: ["timeline-event"],
		governance: { approver: ["system"], evidence: ["timeline-event"] },
	};
	const derived = deriveCapabilityFromAction(action);
	assert.equal(derived.effect, "write");
	assert.deepEqual(derived.declaredEdits, [".amber/sessions/<id>/manifest.json"]);
	assert.deepEqual(derived.declaredSideEffects, ["timeline-event"]);
	assert.deepEqual(derived.approvers, ["system"]);
	assert.deepEqual(derived.evidenceRequired, ["timeline-event"]);
	assert.deepEqual(derived.governanceEvidence, ["timeline-event"]);
});

test("deriveCapabilityFromAction projects read action without edits", () => {
	const action = {
		actionTypeId: "amber.governance.report",
		mode: "dry-run",
		effects: { edits: [], sideEffects: [] },
		evidenceRequired: [],
		governance: { approver: ["system"], evidence: [] },
	};
	const derived = deriveCapabilityFromAction(action);
	assert.equal(derived.effect, "read");
	assert.equal(derived.declaredEdits.length, 0);
	assert.equal(derived.declaredSideEffects.length, 0);
});

test("deriveCapabilityFromAction handles missing effects gracefully", () => {
	const derived = deriveCapabilityFromAction({ actionTypeId: "x" });
	assert.equal(derived.effect, "read");
	assert.deepEqual(derived.declaredEdits, []);
	assert.deepEqual(derived.approvers, []);
});

test("toCapability produces unified shape for read-only context action", () => {
	const contract = {
		name: "verify",
		effect: "read",
		evidence: ["context-verification"],
		approvalRequired: false,
	};
	const cap = toCapability(contract);
	assert.equal(cap.key, "context/verify");
	assert.equal(cap.effect, "read");
	assert.equal(cap.approver, "system");
	assert.equal(cap.directReadOnlyExec, true);
	assert.deepEqual(cap.writeFlags, []);
	assert.deepEqual(cap.evidence, ["context-verification"]);
});

test("toCapability produces unified shape for mutating context action", () => {
	const contract = {
		name: "ingest",
		effect: "write",
		evidence: ["context-page"],
		approvalRequired: true,
	};
	const cap = toCapability(contract);
	assert.equal(cap.key, "context/ingest");
	assert.equal(cap.effect, "write");
	assert.equal(cap.approver, "human");
	assert.equal(cap.directReadOnlyExec, false);
	assert.deepEqual(cap.writeFlags, []);
});

test("toCapability shape matches COMMAND_CAPABILITIES field set", () => {
	const contract = {
		name: "list",
		effect: "read",
		evidence: [],
		approvalRequired: false,
	};
	const cap = toCapability(contract);
	// Both shapes carry the keys classifyCliInvocation reads
	for (const key of ["effect", "approver", "directReadOnlyExec"]) {
		assert.equal(key in cap, true, `toCapability missing ${key}`);
		assert.equal(key in COMMAND_CAPABILITIES["session/status"], true, `registry missing ${key}`);
	}
	// writeFlags is optional on registry entries but always present on toCapability
	assert.deepEqual(cap.writeFlags, []);
});
