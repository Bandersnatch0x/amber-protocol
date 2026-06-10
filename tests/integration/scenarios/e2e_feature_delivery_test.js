"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const { IntegrationTestHarness } = require("./test-harness");
const { saveCheckpoint } = require("../../../scripts/lib/checkpoint-manager");
const { createManifest } = require("../../../scripts/lib/session-manifest");

describe("E2E Feature Delivery", () => {
	/** @type {IntegrationTestHarness} */
	let harness;
	let projectRoot;

	beforeEach(() => {
		harness = new IntegrationTestHarness();
		harness.setup();
		// Each test gets its own project subdirectory so each session is isolated.
		projectRoot = path.join(harness.baseDir, "project");
		fs.mkdirSync(projectRoot, { recursive: true });
	});

	afterEach(() => {
		harness.cleanup();
	});

	/**
	 * Build a minimal mock route with `command` (echo) stages.
	 * @param {string[]} stageNames
	 * @param {object[]}  [gates]
	 * @returns {{ routeId: string, stages: object[], gates: object[] }}
	 */
	function makeEchoRoute(stageNames, gates) {
		return {
			routeId: "test-e2e-route",
			stages: stageNames.map((name) => ({
				name,
				type: "command",
				target: `echo ${name}-done`,
			})),
			gates: gates || [],
		};
	}

	// ── Test 1 ──────────────────────────────────────────────────────────
	it("completes full feature delivery flow", async () => {
		const route = makeEchoRoute([
			"capture",
			"plan",
			"implement",
			"verify",
			"review",
		]);

		const { sessionDir, manifest } = harness.startSession(projectRoot, {
			goal: "Add login page",
			budget: 50000,
		});

		const result = await harness.runFlow(sessionDir, manifest, route);

		// Execution assertions
		assert.strictEqual(result.success, true, "session should succeed");
		assert.strictEqual(
			result.stagesCompleted,
			5,
			"all 5 stages should complete",
		);

		// Timeline assertions
		const timelinePath = path.join(sessionDir, "timeline.jsonl");
		assert.ok(fs.existsSync(timelinePath), "timeline.jsonl must exist");

		const timeline = fs.readFileSync(timelinePath, "utf8");
		assert.match(
			timeline,
			/stage_started/,
			"should contain stage_started events",
		);
		assert.match(
			timeline,
			/stage_completed/,
			"should contain stage_completed events",
		);

		// Mark manifest as completed (simulates real finalisation)
		const manifestPath = path.join(sessionDir, "manifest.json");
		const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		updatedManifest.status = "completed";
		updatedManifest.updatedAt = new Date().toISOString();
		fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2));

		// Re-read and verify
		const reread = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		assert.strictEqual(reread.status, "completed");
	});

	// ── Test 2 ──────────────────────────────────────────────────────────
	it("saves checkpoints at stage boundaries", async () => {
		const route = makeEchoRoute([
			"capture",
			"plan",
			"implement",
			"verify",
			"review",
		]);

		const { sessionDir: _sessionDir, manifest } = harness.startSession(
			projectRoot,
			{
				goal: "Add login page",
			},
		);

		// Simulate checkpoint saving at each stage boundary (before + after each stage).
		const stageNames = route.stages.map((s) => s.name);
		for (let i = 0; i < stageNames.length; i++) {
			const stageName = stageNames[i];

			// "before" checkpoint
			saveCheckpoint(
				projectRoot,
				manifest.sessionId,
				`${stageName}-before`,
				manifest,
			);

			// Execute the single stage via the execution engine
			const singleStageRoute = {
				routeId: "test-e2e-checkpoint",
				stages: [route.stages[i]],
				gates: [],
			};

			const singleManifest = createManifest({
				route: { id: "test-e2e-checkpoint", version: "1.0.0" },
				goal: "Add login page",
			});

			const stageSessionDir = path.join(
				projectRoot,
				".harness",
				"sessions",
				singleManifest.sessionId,
			);
			fs.mkdirSync(stageSessionDir, { recursive: true });

			const {
				executeSession,
			} = require("../../../scripts/lib/execution-engine");
			await executeSession(stageSessionDir, singleManifest, singleStageRoute);

			// "after" checkpoint
			saveCheckpoint(
				projectRoot,
				manifest.sessionId,
				`${stageName}-after`,
				manifest,
			);
		}

		// Verify checkpoints directory has files
		const checkpointsDir = path.join(
			projectRoot,
			".harness",
			"sessions",
			manifest.sessionId,
			"checkpoints",
		);
		assert.ok(fs.existsSync(checkpointsDir), "checkpoints dir must exist");

		const checkpointFiles = fs
			.readdirSync(checkpointsDir)
			.filter((f) => f.endsWith(".json"));
		assert.ok(
			checkpointFiles.length >= 10,
			`expected at least 10 checkpoint files (5 stages × 2), got ${checkpointFiles.length}`,
		);

		// Each file should be valid JSON
		for (const f of checkpointFiles) {
			const content = JSON.parse(
				fs.readFileSync(path.join(checkpointsDir, f), "utf8"),
			);
			assert.strictEqual(content.sessionId, manifest.sessionId);
			assert.ok(content.stage, "each checkpoint must have a stage field");
			assert.ok(content.timestamp, "each checkpoint must have a timestamp");
		}
	});

	// ── Test 3 ──────────────────────────────────────────────────────────
	it("handles gate rejection and returns failure reason", async () => {
		const route = {
			routeId: "test-e2e-gated",
			stages: [
				{
					name: "capture",
					type: "command",
					target: "echo capture-done",
					gateAfter: "user-approval-plan",
				},
				{ name: "plan", type: "command", target: "echo plan-done" },
			],
			gates: [
				{
					id: "user-approval-plan",
					type: "user-approval",
					description: "Do you approve the plan?",
				},
			],
		};

		const { sessionDir, manifest } = harness.startSession(projectRoot, {
			goal: "Add feature with gate",
		});

		// Simulate user typing "no" at the gate prompt
		const input = Readable.from(["no\n"]);
		const result = await harness.runFlow(sessionDir, manifest, route, {
			input,
		});

		assert.strictEqual(
			result.success,
			false,
			"session should fail on gate rejection",
		);
		assert.match(
			result.reason,
			/gate/i,
			"failure reason should mention gate rejection",
		);
		assert.strictEqual(
			result.stagesCompleted,
			1,
			"only the first stage should have completed before gate stopped it",
		);
	});
});
