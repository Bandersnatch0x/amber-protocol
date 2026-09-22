"use strict";

// F065 H0 — the §38 gate as a live CLI walk (ADR-0100/0101/0102): admit a
// contract, start a run bound to its snapshot, advance the state machine,
// then `amber harness inspect --run` presents the whole chain
// Agent → Contract → Run → Events from one read-only command. Driven through
// scripts/amber.js run() with captured stdout, so the exercised path is the
// public CLI, not an internal function. All state lives in a temporary
// target directory (suite leak guard).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { run } = require("../../scripts/amber.js");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-gate-"));
}

async function runCapture(argv) {
	const lines = [];
	const originalLog = console.log;
	const originalWrite = process.stdout.write;
	console.log = (...args) => {
		lines.push(args.join(" "));
	};
	process.stdout.write = (chunk, ...rest) => {
		lines.push(String(chunk));
		return originalWrite.call(process.stdout, "", ...rest);
	};
	try {
		const exitCode = await run(argv);
		return { exitCode, output: lines.join("") };
	} finally {
		console.log = originalLog;
		process.stdout.write = originalWrite;
	}
}

test("the §38 gate: one inspect presents Contract → Run → Events end to end", async () => {
	const target = tmpTarget();
	try {
		const contractFile = path.join(target, "contract.json");
		fs.writeFileSync(
			contractFile,
			JSON.stringify({
				apiVersion: "amber.dev/v1",
				kind: "HarnessContract",
				metadata: { id: "gate-walk", version: "1" },
				agent: { id: "worker", role: "implementation" },
				governance: { policy: "default-safe" },
			}),
			"utf8",
		);

		const admit = await runCapture([
			"harness",
			"admit",
			"--file",
			contractFile,
			"--target",
			target,
			"--json",
		]);
		assert.equal(admit.exitCode, 0);
		const admitted = JSON.parse(admit.output);
		assert.match(admitted.snapshotHash, /^sha256:[0-9a-f]{64}$/);

		const start = await runCapture([
			"harness",
			"start",
			"--contract",
			"gate-walk",
			"--agent",
			"worker",
			"--run",
			"run-gate-1",
			"--target",
			target,
			"--json",
		]);
		assert.equal(start.exitCode, 0);

		const admissionChecks = [
			"identity:subjects/worker",
			"contract:harness/contracts/gate-walk.json",
			"policy:governance/rules.json#default-safe",
			"context:loops/gate/context-authority",
			"execution:worktrees/gate-1",
			"approval:loops/ledger#approval-1",
		];
		const steps = [{ to: "admitted", checks: admissionChecks }, { to: "running" }];
		for (const step of steps) {
			const advanceArgs = [
				"harness",
				"advance",
				"--run",
				"run-gate-1",
				"--to",
				step.to,
				"--target",
				target,
				"--json",
			];
			for (const check of step.checks || []) {
				advanceArgs.push("--check", check);
			}
			const advance = await runCapture(advanceArgs);
			assert.equal(advance.exitCode, 0, `advance to ${step.to}`);
		}

		const inspect = await runCapture([
			"harness",
			"inspect",
			"--run",
			"run-gate-1",
			"--target",
			target,
			"--json",
		]);
		assert.equal(inspect.exitCode, 0);
		const view = JSON.parse(inspect.output);
		assert.equal(view.run.kind, "HarnessRun");
		assert.equal(view.run.harness.contract, "gate-walk");
		assert.equal(view.run.harness.contractSnapshotHash, admitted.snapshotHash);
		assert.deepEqual(
			view.events.map((event) => event.kind),
			["run.created", "run.admitted", "run.started"],
		);
		for (const event of view.events) {
			assert.equal(event.runId, "run-gate-1");
			assert.ok(event.hash && event.prevHash);
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
