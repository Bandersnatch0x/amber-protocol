"use strict";

// Parity guard (#61): every finding id that collectFindings can emit must have
// an ACTION_LIBRARY entry, and readiness summaries must come from the same SSOT
// as governance-report structured actions.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	ACTION_LIBRARY,
	inspectGovernanceReadiness,
} = require("../../scripts/lib/core/governance-readiness");
const { buildGovernanceReport } = require("../../scripts/lib/core/governance-report");
const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Canonical finding ids emitted by collectFindings in governance-readiness.js.
// Keep in sync with the switch/if branches there — the parity test below will
// fail if a new finding id is added without an ACTION_LIBRARY entry.
const KNOWN_FINDING_IDS = [
	"policy-error",
	"unsafe-user-approval",
	"policy-warning",
	"route-error",
	"workflow-pack-read-error",
	"missing-governance-doc",
	"route-without-gates",
	"pack-missing-review-gates",
	"pack-missing-worktree-isolation",
	"missing-security-standard",
	"security-pack-not-linked",
	"no-audit-evidence",
	"missing-governance-rules",
	"unsafe-default-allow",
	"ledger-tampered",
];

test("ACTION_LIBRARY covers every known finding id (#61)", () => {
	for (const id of KNOWN_FINDING_IDS) {
		assert.ok(ACTION_LIBRARY[id], `missing ACTION_LIBRARY entry for ${id}`);
		assert.equal(typeof ACTION_LIBRARY[id].summary, "string");
		assert.equal(typeof ACTION_LIBRARY[id].why, "string");
		assert.equal(typeof ACTION_LIBRARY[id].command, "string");
		assert.equal(typeof ACTION_LIBRARY[id].expectedOutcome, "string");
		assert.ok(Array.isArray(ACTION_LIBRARY[id].blocks));
		assert.ok(["high", "medium", "low"].includes(ACTION_LIBRARY[id].severity));
	}
	// No orphan library entries outside the known set either.
	for (const id of Object.keys(ACTION_LIBRARY)) {
		assert.ok(KNOWN_FINDING_IDS.includes(id), `orphan ACTION_LIBRARY entry: ${id}`);
	}
});

test("readiness nextActions and report structured actions share the SSOT (#61)", () => {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-action-parity-"));
	scaffoldHarness(target);
	// Force a known finding so both surfaces produce a next-action for it.
	fs.rmSync(path.join(target, "standards", "security-governance.json"), { force: true });

	const readiness = inspectGovernanceReadiness(target);
	const report = buildGovernanceReport(target);

	const finding = readiness.findings.find((f) => f.id === "missing-security-standard");
	assert.ok(finding, "expected missing-security-standard finding");

	// readiness string comes from ACTION_LIBRARY.summary
	assert.ok(
		readiness.nextActions.includes(ACTION_LIBRARY["missing-security-standard"].summary),
		"readiness nextActions should use ACTION_LIBRARY.summary",
	);

	// report structured action comes from the same entry
	const action = report.nextActions.find((a) => a.id === "missing-security-standard");
	assert.ok(action);
	assert.equal(action.severity, ACTION_LIBRARY["missing-security-standard"].severity);
	assert.equal(action.why, ACTION_LIBRARY["missing-security-standard"].why);
	assert.match(action.command, /governance standards init/);
});
