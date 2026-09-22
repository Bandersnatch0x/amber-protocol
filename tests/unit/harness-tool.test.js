"use strict";

// F067 — Tool / Capability / Effect / Credential boundary (Harness v2 §30):
// the tool registry composes the EXISTING governed registries (F052 runner
// registry, F056 external effects) and grants zero authority. Fixtures build
// a real runner capability through the F052 registration functions and a real
// human-Decision fixture (same pattern as tests/unit/runner-registry.test.js),
// so the capability pin resolves through the genuine seam.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dispatch } = require("../../scripts/lib/command-dispatcher");
const {
	inspectHarnessTool,
	listHarnessTools,
	toolsSnapshot,
	CODE_PIN_UNRESOLVED,
	CODE_IMMUTABLE,
	CODE_CORRUPT,
} = require("../../scripts/lib/harness/tool-core");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const {
	registerRunner,
	registerRunnerCapability,
} = require("../../scripts/lib/core/runner-registry");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-tool-"));
}

const DIGEST = `sha256:${"a".repeat(64)}`;

function f052Fixture(dir) {
	assert.equal(
		registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/runner", body: "# Runner\n" }).ok,
		true,
	);
	// Registration Decisions are single-use: the runner and its capability each
	// consume their own committed human Decision (F052 discipline).
	for (const [identity, intent] of [
		["decision/runner-1", "intent/runner"],
		["decision/cap-1", "intent/runner"],
	]) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# Decision ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: intent } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
	assert.equal(
		registerRunner(dir, {
			id: "runner/ci",
			version: "1.0.0",
			integrityDigest: DIGEST,
			owner: "platform-team",
			decision: { identity: "decision/runner-1", revision: 1 },
		}).ok,
		true,
	);
	assert.equal(
		registerRunnerCapability(dir, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.staging-web",
			capabilityVersion: "1",
			effects: ["deploy"],
			pathPrefixes: ["deploy/staging"],
			timeoutMsMax: 30000,
			credentialRequirement: "scoped",
			rollback: "runbook/staging-rollback",
			decision: { identity: "decision/cap-1", revision: 1 },
		}).ok,
		true,
	);
}

function runnerPinnedTool(overrides = {}) {
	return {
		apiVersion: "amber.dev/v1",
		kind: "HarnessTool",
		metadata: { id: "deploy-web", version: "1" },
		capability: {
			kind: "runner",
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "deploy.staging-web",
			capabilityVersion: "1",
		},
		effect: "command_execution",
		credential: { ref: "staging-deploy-token" },
		input: { schema: "schemas/deploy-input.json" },
		output: { schema: "schemas/deploy-result.json" },
		limits: { timeout: "30s" },
		governance: { approval: "staging-safe" },
		...overrides,
	};
}

function writeTool(target, tool, name = "tool.json") {
	const file = path.join(target, name);
	fs.writeFileSync(file, JSON.stringify(tool, null, 2), "utf8");
	return file;
}

function admitViaCli(target, file) {
	return dispatch("harness", { target, file, json: true, _: ["tool", "admit"] });
}

test("a tool admits only when its capability pin resolves through the real F052 registry", () => {
	const target = tmpTarget();
	try {
		// Without the registered capability the pin refuses — a tool names
		// governed authority, never invents it.
		const unresolvedFile = writeTool(target, runnerPinnedTool(), "unresolved.json");
		const unresolved = admitViaCli(target, unresolvedFile);
		assert.equal(unresolved.exitCode, 1);
		assert.equal(unresolved.result.code, CODE_PIN_UNRESOLVED);

		f052Fixture(target);
		const file = writeTool(target, runnerPinnedTool());
		const { result, exitCode } = admitViaCli(target, file);
		assert.equal(exitCode, 0);
		assert.match(result.snapshotHash, /^sha256:[0-9a-f]{64}$/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("an external pin must resolve through the F056 registry", () => {
	const target = tmpTarget();
	try {
		const file = writeTool(
			target,
			runnerPinnedTool({
				metadata: { id: "external-post", version: "1" },
				capability: { kind: "external", id: "effect/ticket-comment", version: "1" },
				effect: "external_write",
			}),
			"external.json",
		);
		const { result, exitCode } = admitViaCli(target, file);
		assert.equal(exitCode, 1);
		assert.equal(result.code, CODE_PIN_UNRESOLVED);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("tool declarations are immutable; byte-identical re-admission is idempotent", () => {
	const target = tmpTarget();
	try {
		f052Fixture(target);
		const file = writeTool(target, runnerPinnedTool());
		const first = admitViaCli(target, file);
		const second = admitViaCli(target, file);
		assert.equal(second.exitCode, 0);
		assert.equal(second.result.idempotent, true);
		assert.equal(second.result.admittedAt, first.result.admittedAt);

		fs.writeFileSync(
			file,
			JSON.stringify(runnerPinnedTool({ metadata: { id: "deploy-web", version: "2" } }), null, 2),
			"utf8",
		);
		const changed = admitViaCli(target, file);
		assert.equal(changed.exitCode, 1);
		assert.equal(changed.result.code, CODE_IMMUTABLE);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the check is report-only and mirrors the real policy surface", () => {
	const target = tmpTarget();
	try {
		f052Fixture(target);
		admitViaCli(target, writeTool(target, runnerPinnedTool()));

		// No rules.json: the existing surface's own default applies (deny) —
		// the check never invents an allow.
		const baseline = dispatch("harness", {
			target,
			json: true,
			tool: "deploy-web",
			_: ["tool", "check"],
		});
		assert.equal(baseline.exitCode, 0);
		assert.equal(baseline.result.verdict, "deny");
		assert.equal(baseline.result.reportOnly, true);
		assert.equal(baseline.result.effectDefaultPosture, "policy");

		// A capability rule that matches the tool's capability string decides.
		fs.mkdirSync(path.join(target, ".amber", "governance"), { recursive: true });
		fs.writeFileSync(
			path.join(target, ".amber", "governance", "rules.json"),
			JSON.stringify({
				schemaVersion: 2,
				defaultAction: "deny",
				rules: [
					{
						id: "allow-deploy-tool",
						decision: "allow",
						match: {
							capability: "runner:runner/ci/deploy.staging-web@1",
							target: "deploy/staging",
							effect: "deploy",
							constraints: null,
						},
					},
				],
			}),
			"utf8",
		);
		const decided = dispatch("harness", {
			target,
			json: true,
			tool: "deploy-web",
			_: ["tool", "check"],
		});
		assert.equal(decided.result.verdict, "allow");
		assert.equal(decided.result.source, "capability rule");
		assert.equal(decided.result.basis[0].rule, "allow-deploy-tool");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("runs record the tool-registry snapshot; tool drift changes the snapshot", () => {
	const target = tmpTarget();
	try {
		assert.equal(toolsSnapshot(target), null, "an empty registry carries no snapshot");
		// A run started before any tool admission has no tools section.
		f052Fixture(target);
		const contractFile = path.join(target, "contract.json");
		fs.writeFileSync(
			contractFile,
			JSON.stringify({
				apiVersion: "amber.dev/v1",
				kind: "HarnessContract",
				metadata: { id: "tool-task", version: "1" },
				agent: { id: "worker", role: "implementation" },
				governance: { policy: "default-safe" },
			}),
			"utf8",
		);
		dispatch("harness", { target, file: contractFile, json: true, _: ["admit"] });
		const bareRun = dispatch("harness", {
			target,
			json: true,
			contract: "tool-task",
			agent: "worker",
			run: "run-tools-0",
			_: ["start"],
		});
		assert.equal(bareRun.result.run.tools, undefined);

		admitViaCli(target, writeTool(target, runnerPinnedTool()));
		const snap1 = toolsSnapshot(target);
		assert.ok(snap1.snapshotHash);
		assert.deepEqual(snap1.ids, ["deploy-web"]);

		const withTool = dispatch("harness", {
			target,
			json: true,
			contract: "tool-task",
			agent: "worker",
			run: "run-tools-1",
			_: ["start"],
		});
		assert.equal(withTool.result.run.tools.snapshotHash, snap1.snapshotHash);
		assert.deepEqual(withTool.result.run.tools.ids, ["deploy-web"]);

		// Tool drift: admitting another tool changes the snapshot hash.
		assert.equal(
			admitViaCli(
				target,
				writeTool(
					target,
					runnerPinnedTool({ metadata: { id: "deploy-web-2", version: "1" } }),
					"tool-2.json",
				),
			).exitCode,
			0,
		);
		const snap2 = toolsSnapshot(target);
		assert.notEqual(snap2.snapshotHash, snap1.snapshotHash);
		const driftedRun = dispatch("harness", {
			target,
			json: true,
			contract: "tool-task",
			agent: "worker",
			run: "run-tools-2",
			_: ["start"],
		});
		assert.equal(driftedRun.result.run.tools.snapshotHash, snap2.snapshotHash);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a tampered tool record fails its single read closed and shows as a tombstone in the list", () => {
	const target = tmpTarget();
	try {
		f052Fixture(target);
		const file = writeTool(target, runnerPinnedTool());
		const admitted = admitViaCli(target, file);
		const stored = JSON.parse(fs.readFileSync(admitted.result.toolFile, "utf8"));
		stored.tool.effect = "irreversible";
		fs.writeFileSync(admitted.result.toolFile, JSON.stringify(stored, null, "\t"), "utf8");

		assert.throws(
			() => inspectHarnessTool(target, { toolId: "deploy-web" }),
			(err) => err.amberCode === CODE_CORRUPT,
		);
		const listed = listHarnessTools(target);
		assert.equal(listed[0].corrupt, true);
		assert.equal(listed[0].snapshotHash, null);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
