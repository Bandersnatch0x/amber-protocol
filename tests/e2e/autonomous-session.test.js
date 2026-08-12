const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("autonomous session E2E", () => {
	const testRoot = path.join(__dirname, "../fixtures/e2e-autonomous");

	beforeEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
		fs.mkdirSync(testRoot, { recursive: true });

		// Copy routes so session start can find them
		const routesSrc = path.join(ROOT, "routes");
		const routesDest = path.join(testRoot, "routes");
		fs.mkdirSync(routesDest, { recursive: true });
		for (const f of fs.readdirSync(routesSrc)) {
			fs.copyFileSync(path.join(routesSrc, f), path.join(routesDest, f));
		}
	});

	afterEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
	});

	it("refuses autonomous mode at session start (ADR-0005)", () => {
		const start = spawnSync(
			process.execPath,
			[
				path.join(ROOT, "scripts/amber.js"),
				"session",
				"start",
				"--goal",
				"implement test feature",
				"--mode",
				"autonomous",
				"--confirm",
				"--json",
			],
			{ cwd: testRoot, encoding: "utf8", timeout: 15000 },
		);

		// Autonomous execution is removed (ADR-0005): start must refuse at the gate,
		// not accept and defer the refusal to continue.
		assert.notStrictEqual(start.status, 0, `expected non-zero exit, got ${start.status}`);
		assert.ok(
			/Autonomous execution is not available/.test(start.stdout + start.stderr),
			`expected refusal message, got: ${start.stdout}${start.stderr}`,
		);
	});

	it("does not create a session for autonomous mode", () => {
		spawnSync(
			process.execPath,
			[
				path.join(ROOT, "scripts/amber.js"),
				"session",
				"start",
				"--goal",
				"implement test feature",
				"--mode",
				"autonomous",
				"--confirm",
				"--json",
			],
			{ cwd: testRoot, encoding: "utf8", timeout: 15000 },
		);

		// A refused mode must not write a manifest.
		const sessionsDir = path.join(testRoot, ".amber", "sessions");
		const created = fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : [];
		assert.deepEqual(created, [], `expected no session, found: ${created.join(", ")}`);
	});
});
