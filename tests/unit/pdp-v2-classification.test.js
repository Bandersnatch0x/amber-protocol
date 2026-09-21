"use strict";

// Trusted-control governance contract §6.2 / C0 §3.3 — the PDP v2
// classification-ceiling face. Two directions, both fail-closed:
//   allow-family rules carry ADMISSION semantics (subject within the ceiling);
//   deny rules carry GUARD semantics (fires when the subject exceeds it, or
//   is unknown/undeclared). Unknown context classification never satisfies an
//   admission ceiling and always fires a guard — C0 §3.1: unknown is refused,
//   never silently passed.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");

const {
	evaluateGovernedPolicy,
	evaluateCommandPolicy,
} = require("../../scripts/lib/core/loop-policy");
const stageRunner = require("../../scripts/lib/session-stage-runner");
const { runSessionStage, grantSessionExecution } = stageRunner;
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const {
	registerRunner,
	registerRunnerCapability,
} = require("../../scripts/lib/core/runner-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");

const PIN = "runner/ci@1.0.0#diagnose.check@1";
const COMMAND_ID = "diagnose.check";
const TOKEN_HASH = crypto.createHash("sha256").update("opaque-token").digest("hex");

const ALLOW_RULE_ID = COMMAND_ID; // decision 1: the capability NAME is the policy rule id
const DENY_RULE_ID = "deny-over-internal";
const ALLOW_RULE = {
	id: ALLOW_RULE_ID,
	action: "allow",
	match: "exact",
	pattern: "node --version",
};
// The v2 ceiling-guard deny: fires when the consuming context exceeds internal.
const DENY_RULE = {
	id: DENY_RULE_ID,
	decision: "deny",
	match: { capability: COMMAND_ID, constraints: { maxClassification: "internal" } },
};

const rulesWith = (rules) => ({
	schemaVersion: 2,
	defaultAction: "deny",
	confidence_gating: {
		enabled: true,
		byRule: { [ALLOW_RULE_ID]: "high", [DENY_RULE_ID]: "high" },
		defaultConfidence: "low",
	},
	rules,
});

const SUBJECT = (classification) => ({
	capability: COMMAND_ID,
	contextClassification: classification,
});

describe("PDP v2 classification-ceiling face (§6.2/C0 §3.3)", () => {
	it("an allow-family rule matches only a subject within its ceiling", () => {
		const allow = {
			id: "allow-diagnose-v2",
			decision: "allow",
			match: { capability: COMMAND_ID, constraints: { maxClassification: "internal" } },
		};
		const within = evaluateCommandPolicy("node --version", rulesWith([allow]), SUBJECT("internal"));
		assert.equal(within.allowed, true);
		assert.equal(within.matchedRule, "allow-diagnose-v2");

		const over = evaluateCommandPolicy("node --version", rulesWith([allow]), SUBJECT("restricted"));
		assert.equal(over.allowed, false, "over the ceiling: the rule never matches → default deny");
		assert.equal(over.matchedRule, null);

		const unknown = evaluateCommandPolicy("node --version", rulesWith([allow]), SUBJECT(null));
		assert.equal(unknown.allowed, false, "unknown never satisfies an admission ceiling (C0 §3.1)");
	});

	it("a deny guard rule fires when the subject exceeds the ceiling or is undeclared", () => {
		const rules = rulesWith([ALLOW_RULE, DENY_RULE]);
		const over = evaluateGovernedPolicy("node --version", rules, SUBJECT("restricted"));
		assert.equal(over.allowed, false);
		assert.equal(over.matchedRule, DENY_RULE_ID, "the guard deny fires with its own rule id");

		const within = evaluateGovernedPolicy("node --version", rules, SUBJECT("internal"));
		assert.equal(within.allowed, true, "within the ceiling the guard never fires");

		const undeclared = evaluateGovernedPolicy("node --version", rules, SUBJECT(null));
		assert.equal(undeclared.allowed, false, "undeclared context classification fails closed");
		assert.equal(undeclared.matchedRule, DENY_RULE_ID);
	});
});

// ── governed integration: the attempt's frozen context ceiling feeds the PDP ──

function makeTarget(contextScope) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-pdp-v2-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "T"], { cwd: root });
	fs.writeFileSync(path.join(root, ".gitignore"), ".amber/\n");
	fs.writeFileSync(path.join(root, "fixture.txt"), "fixture\n");
	execFileSync("git", ["add", "."], { cwd: root });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
	fs.mkdirSync(path.join(root, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".amber", "governance", "rules.json"),
		JSON.stringify(rulesWith([ALLOW_RULE, DENY_RULE])),
	);
	registerPrincipal(root, { id: "alice@example.com", principalKind: "human" });
	registerPrincipal(root, { id: "agent-a", principalKind: "service" });
	admitArtifact(root, { type: "intent", identity: "intent/runner", body: "# R\n" });
	const decide = (identity) =>
		admitArtifact(root, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
		});
	decide("decision/runner");
	registerRunner(root, {
		id: "runner/ci",
		version: "1.0.0",
		integrityDigest: `sha256:${"a".repeat(64)}`,
		owner: "platform-team",
		decision: { identity: "decision/runner", revision: 1 },
	});
	decide("decision/capability");
	registerRunnerCapability(root, {
		runnerId: "runner/ci",
		runnerVersion: "1.0.0",
		name: COMMAND_ID,
		capabilityVersion: "1",
		effects: ["diagnose"],
		pathPrefixes: null,
		timeoutMsMax: 1000,
		credentialRequirement: "none",
		rollback: "none",
		decision: { identity: "decision/capability", revision: 1 },
	});
	const routesDir = path.join(root, "routes");
	fs.mkdirSync(routesDir, { recursive: true });
	fs.writeFileSync(
		path.join(routesDir, "probe.route.json"),
		JSON.stringify({
			schemaVersion: "1.0.0",
			routeId: "probe",
			version: "1.0.0",
			description: "probe route",
			stages: [{ name: "check", type: "verb", target: PIN }],
		}),
	);
	const sessionDir = path.join(root, ".amber", "sessions", "s1");
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(
		path.join(sessionDir, "manifest.json"),
		JSON.stringify({
			sessionId: "s1",
			schemaVersion: "1.0.0-rc.1",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			route: { id: "probe", version: "1.0.0" },
			goal: "probe",
			status: "executing",
			completedStages: [],
			...(contextScope ? { context_scope: { constraints: contextScope } } : {}),
			lease: {
				ownerId: "agent-a",
				tokenHash: TOKEN_HASH,
				acquiredAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 120000).toISOString(),
				ttlMs: 120000,
				fence: 1,
			},
		}),
	);
	return root;
}

const CLAIM = { ownerId: "agent-a", tokenHash: TOKEN_HASH, leaseFence: 1 };
const BOUNDED = {
	capabilityPin: PIN,
	providerClass: "bounded-command",
	adapterId: "governed-runner",
	adapterVersion: "1",
};

describe("governed integration — the frozen context ceiling feeds the PDP face", () => {
	it("a capture over the v2 guard ceiling refuses with the guard rule matched", async () => {
		const root = makeTarget({
			maxClassification: "restricted",
			purpose: null,
			expiresAt: null,
			accessBoundaries: ["docs/"],
		});
		try {
			stageRunner._setAdapterTableForTest([BOUNDED]);
			const capture = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			grantSessionExecution(root, "s1", { attemptId: capture.request.attemptId });
			const executed = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.equal(executed.success, false);
			assert.match(executed.message || "", /denied by v2 rule deny-over-internal/);
			const { readLedger } = require("../../scripts/lib/core/loop-ledger");
			const denied = readLedger(path.join(root, ".amber", "sessions", "s1", "ledger.jsonl")).filter(
				(record) => record.kind === "denied",
			);
			assert.equal(denied.length, 1);
			assert.equal(denied[0].matchedRule, DENY_RULE_ID);
		} finally {
			stageRunner._restoreAdapterTableForTest();
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("a capture within the v2 guard ceiling executes", async () => {
		const root = makeTarget({
			maxClassification: "internal",
			purpose: null,
			expiresAt: null,
			accessBoundaries: ["docs/"],
		});
		try {
			stageRunner._setAdapterTableForTest([BOUNDED]);
			const capture = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			grantSessionExecution(root, "s1", { attemptId: capture.request.attemptId });
			const executed = await runSessionStage(root, "s1", { execute: true, ...CLAIM });
			assert.equal(executed.settlement.status, "succeeded", JSON.stringify(executed.message));
		} finally {
			stageRunner._restoreAdapterTableForTest();
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
