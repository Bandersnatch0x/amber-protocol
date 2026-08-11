"use strict";

// RED contract for scripts/lib/web-adapter.js (architecture deepening T5 / #4).
// The web console must call a deep adapter surface — not recompose
// buildContext → inferNextStep → evaluateLifecycle across the createRequire seam.
//
// Compile-time contract note (scripts/lib/web-adapter.d.ts — expected SSOT):
//   export function evaluateLifecycleNext(
//     targetRoot: string,
//     options?: { feature?: string; session?: string; strict?: boolean; target?: string },
//   ): {
//     focus: { type: string; id: string | null; autoSelected: boolean; othersPending: number };
//     nextStep: { id: string; label: string; why?: string; remedy?: string } | null;
//     lifecycle: Array<{ id: string; label: string; done: boolean }>;
//     completion?: { status: "pass" | "fail"; reasons: string[]; missing: string[] };
//   };
//   export function getCompletionStatus(
//     sessionId: string,
//     options?: { strict?: boolean; target?: string },
//   ): {
//     status: "pass" | "fail";
//     reasons: string[];
//     missing: string[];
//     text: string;
//     strict: boolean;
//   };
//   // Or, target-first form preferred by CLI-side callers:
//   // getCompletionStatus(targetRoot, sessionId, { strict })
//   export function runEvidenceCommand(input: {
//     target: string;
//     command: string;
//     ledgerPath: string;
//     budgetMinutes?: number;
//     subject?: Record<string, unknown>;
//   }): {
//     target: string;
//     executed: boolean;
//     denied: boolean;
//     reason?: string;
//     exitCode?: number;
//     stdoutTail?: string;
//     stderrTail?: string;
//     durationMs?: number;
//     ledgerRecord: Record<string, unknown>;
//   };
//   // Depth pin: do NOT re-export LifecycleContext, buildContext, inferNextStep,
//   // or evaluateLifecycle — the web must not recompose those primitives.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ADAPTER_PATH = path.join(__dirname, "../../scripts/lib/web-adapter.js");

// Forbidden public ops — if these leak, the web can still recompose LifecycleContext
// and the adapter is a shallow re-export, not a deep module.
const FORBIDDEN_EXPORTS = [
	"LifecycleContext",
	"buildContext",
	"inferNextStep",
	"evaluateLifecycle",
];

function loadAdapter() {
	// Fresh require each time so RED→GREEN edits are visible without process restart.
	const resolved = require.resolve(ADAPTER_PATH);
	delete require.cache[resolved];
	return require(ADAPTER_PATH);
}

function tmpRepo() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-web-adapter-"));
}

function seedMinimalProject(dir) {
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({
			name: "web-adapter-fixture",
			scripts: { test: 'node -e "process.exit(0)"' },
		}) + "\n",
	);
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({ features: [] }, null, 2) + "\n",
	);
}

describe("web-adapter module surface", () => {
	it("exists and loads from scripts/lib/web-adapter.js", () => {
		assert.ok(fs.existsSync(ADAPTER_PATH), `expected adapter module at ${ADAPTER_PATH}`);
		const adapter = loadAdapter();
		assert.equal(typeof adapter, "object");
		assert.ok(adapter !== null);
	});

	it("exports evaluateLifecycleNext, getCompletionStatus, and runEvidenceCommand", () => {
		const adapter = loadAdapter();
		assert.equal(typeof adapter.evaluateLifecycleNext, "function");
		assert.equal(typeof adapter.getCompletionStatus, "function");
		assert.equal(typeof adapter.runEvidenceCommand, "function");
	});

	it("depth pin: does NOT export LifecycleContext / buildContext / inferNextStep / evaluateLifecycle", () => {
		const adapter = loadAdapter();
		const leaked = FORBIDDEN_EXPORTS.filter((name) => name in adapter && adapter[name] != null);
		assert.deepEqual(
			leaked,
			[],
			`adapter must not re-export lifecycle primitives the web would recompose: ${leaked.join(", ")}`,
		);
	});
});

describe("evaluateLifecycleNext", () => {
	it("returns {focus, nextStep, lifecycle, completion?} — not a raw LifecycleContext handle", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);

		const result = adapter.evaluateLifecycleNext(dir, {});

		assert.equal(typeof result, "object");
		assert.ok(result !== null);

		// Public DTO keys — web router lifecycle.next currently assembles these.
		assert.ok("focus" in result, "result must include focus");
		assert.ok("nextStep" in result, "result must include nextStep");
		assert.ok("lifecycle" in result, "result must include lifecycle");

		// Must NOT be a raw LifecycleContext (which carries state/sessionStatus/liveHandoff/...).
		assert.equal(
			Object.prototype.hasOwnProperty.call(result, "state"),
			false,
			"must not leak raw context.state",
		);
		assert.equal(
			Object.prototype.hasOwnProperty.call(result, "sessionStatus"),
			false,
			"must not leak raw context.sessionStatus",
		);
		assert.equal(
			Object.prototype.hasOwnProperty.call(result, "liveHandoff"),
			false,
			"must not leak raw context.liveHandoff",
		);
		assert.equal(
			Object.prototype.hasOwnProperty.call(result, "targetDisplay"),
			false,
			"must not leak raw context.targetDisplay",
		);

		// Shape pins
		assert.equal(typeof result.focus, "object");
		assert.ok(result.focus !== null);
		assert.equal(typeof result.focus.type, "string");
		assert.ok(
			result.nextStep === null ||
				(typeof result.nextStep === "object" && typeof result.nextStep.id === "string"),
			"nextStep must be null or a step with id",
		);
		assert.ok(Array.isArray(result.lifecycle), "lifecycle must be an array of steps");
		for (const step of result.lifecycle) {
			assert.equal(typeof step.id, "string");
			assert.equal(typeof step.label, "string");
			assert.equal(typeof step.done, "boolean");
		}
		if ("completion" in result && result.completion != null) {
			assert.ok(["pass", "fail"].includes(result.completion.status));
			assert.ok(Array.isArray(result.completion.reasons));
			assert.ok(Array.isArray(result.completion.missing));
		}

		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("getCompletionStatus", () => {
	it("returns flat {status, reasons, missing, text, strict}", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);

		const sessionId = "sess-web-adapter-1";
		const sessDir = path.join(dir, ".amber", "sessions", sessionId);
		fs.mkdirSync(sessDir, { recursive: true });
		fs.writeFileSync(
			path.join(sessDir, "manifest.json"),
			JSON.stringify({
				sessionId,
				schemaVersion: "1.0.0-rc.1",
				status: "executing",
				goal: "web-adapter red fixture",
				route: { id: "feature-standard" },
				createdAt: "2026-07-15T00:00:00.000Z",
				updatedAt: "2026-07-15T00:00:00.000Z",
				completedStages: [],
			}) + "\n",
		);

		// Contract: getCompletionStatus(sessionId, {strict}) — target may ride in options
		// as { target } or as a target-first overload; either must yield the flat DTO.
		let result;
		if (adapter.getCompletionStatus.length >= 3) {
			// target-first: (targetRoot, sessionId, options)
			result = adapter.getCompletionStatus(dir, sessionId, { strict: true });
		} else {
			// session-first: (sessionId, { strict, target })
			result = adapter.getCompletionStatus(sessionId, { strict: true, target: dir });
		}

		assert.equal(typeof result, "object");
		assert.ok(result !== null);
		assert.ok(["pass", "fail"].includes(result.status), "status must be pass|fail");
		assert.ok(Array.isArray(result.reasons), "reasons must be an array");
		assert.ok(Array.isArray(result.missing), "missing must be an array");
		assert.equal(typeof result.text, "string", "text must be the formatted completion string");
		assert.equal(typeof result.strict, "boolean");
		assert.equal(result.strict, true);

		// Flat DTO only — no nested evaluation/handle wrappers.
		assert.equal(
			Object.prototype.hasOwnProperty.call(result, "evaluation"),
			false,
			"must not nest evaluation under a handle",
		);

		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("runEvidenceCommand", () => {
	it("is available on the adapter with the evidence-runner shape", () => {
		const adapter = loadAdapter();
		assert.equal(typeof adapter.runEvidenceCommand, "function");

		// Same export as scripts/lib/core/evidence-runner.js (re-export or thin forward).
		const { runEvidenceCommand: coreRunner } = require("../../scripts/lib/core/evidence-runner");
		assert.equal(
			adapter.runEvidenceCommand,
			coreRunner,
			"adapter.runEvidenceCommand must be the same function as evidence-runner (re-export)",
		);
	});
});
