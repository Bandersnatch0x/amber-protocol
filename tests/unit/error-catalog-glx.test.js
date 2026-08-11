"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getEntry } = require("../../scripts/lib/core/error-catalog");

test("GLX error codes exist with layer + cause + remedy", () => {
	for (const code of [
		"AMBER_E_POLICY_DENY",
		"AMBER_E_CONFIDENCE_GATE",
		"AMBER_E_LOOP_NOT_APPROVED",
		"AMBER_E_LEDGER_TAMPERED",
	]) {
		const e = getEntry(code);
		assert.ok(e, `${code} present`);
		assert.ok(e.title && e.cause && e.remedy && e.layer, `${code} fully described`);
	}
	assert.equal(getEntry("AMBER_E_LEDGER_TAMPERED").layer, "Observability");
	assert.equal(getEntry("AMBER_E_POLICY_DENY").layer, "Governance");
	assert.equal(getEntry("AMBER_E_CONFIDENCE_GATE").layer, "Governance");
	assert.equal(getEntry("AMBER_E_LOOP_NOT_APPROVED").layer, "Governance");
});
