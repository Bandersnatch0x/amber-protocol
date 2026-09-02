"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");
const CLI = path.join(ROOT, "scripts", "amber.js");

// Spec F062's Testing Decisions plans a positive e2e ("session run → session
// settle completes a host-agent stage end to end"), but the production
// ADAPTER_TABLE ships empty by design (ADR-0029 §7: the capability "ships dark
// until a route opts in", and adding a pin is a reviewed code change) — so no
// positive verb execution can exist end-to-end until a real pin lands. What
// CAN be pinned through the real CLI is the fail-closed direction: a verb
// stage on an unregistered pin refuses under F052's existing code (the
// registry lookup precedes the adapter lookup) and writes nothing. The
// adapter-unavailable refusal itself is covered at unit level.
describe("verb stage guard E2E (fail-closed direction)", () => {
	let target;

	beforeEach(() => {
		target = fs.mkdtempSync(path.join(os.tmpdir(), "amber-verb-e2e-"));
		fs.mkdirSync(path.join(target, "routes"), { recursive: true });
		fs.writeFileSync(
			path.join(target, "routes", "verb-probe.route.json"),
			JSON.stringify({
				schemaVersion: "1.0.0",
				routeId: "verb-probe",
				version: "1.0.0",
				description: "verb probe",
				stages: [{ name: "check", type: "verb", target: "runner/ci@1.0.0#diagnose.check@1" }],
			}),
		);
	});

	afterEach(() => {
		fs.rmSync(target, { recursive: true, force: true });
	});

	it("session run on a verb route fails closed on the unregistered pin and writes no ledger", () => {
		const started = spawnSync(
			"node",
			[
				CLI,
				"session",
				"start",
				"--goal",
				"probe the verb guard",
				"--route",
				"verb-probe",
				"--target",
				target,
				"--yes",
			],
			{ encoding: "utf8" },
		);
		assert.equal(started.status, 0, started.stdout + started.stderr);
		const sessionId = (started.stdout.match(/Session created: (\S+)/) || [])[1];
		assert.ok(sessionId, "session started");

		const run = spawnSync("node", [CLI, "session", "run", "--session", sessionId, "--target", target], {
			encoding: "utf8",
		});
		assert.equal(run.status, 1, "dry-run run refuses: the pin names no registered runner");
		assert.match(run.stdout + run.stderr, /AMBER_E_RUNNER_NOT_FOUND/);

		// Fail-closed means no attempt was created: no session ledger records.
		const ledgerPath = path.join(target, ".amber", "sessions", sessionId, "ledger.jsonl");
		assert.equal(fs.existsSync(ledgerPath), false, "no ledger written for a refused stage");
	});
});
