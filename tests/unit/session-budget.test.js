const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startSession, statusSession } = require("../../scripts/lib/session-commands");
const { validateManifest, writeSessionManifest } = require("../../scripts/lib/session-manifest");
const { installTargetRoutes } = require("../helpers/target-routes");
const { readSessionArtifacts } = require("../helpers/session-artifacts");

describe("session token budget", () => {
	let projectRoot;

	beforeEach(() => {
		projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-session-budget-"));
		installTargetRoutes(projectRoot);
	});

	afterEach(() => {
		fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 3 });
	});

	it("starts with explicitly untracked usage and renders no percentage", async () => {
		const started = await startSession(projectRoot, { goal: "fix budget display", budget: 1000 });
		assert.equal(started.exitCode, 0, started.text);
		const { manifest } = readSessionArtifacts(projectRoot, started.sessionId);
		assert.equal(manifest.budget.used, null);
		assert.equal(validateManifest(manifest).valid, true);

		const status = statusSession(projectRoot, { sessionId: started.sessionId });
		assert.equal(status.exitCode, 0, status.text);
		assert.match(status.text, /Budget: 1000 tokens .*untracked.*not measured/);
		assert.doesNotMatch(status.text, /%/);
	});

	it("renders a percentage for externally supplied nonzero usage", async () => {
		const started = await startSession(projectRoot, { goal: "fix budget display", budget: 1000 });
		assert.equal(started.exitCode, 0, started.text);
		const { manifest } = readSessionArtifacts(projectRoot, started.sessionId);
		manifest.budget.used = 250;
		assert.equal(validateManifest(manifest).valid, true);
		writeSessionManifest(path.join(projectRoot, ".amber", "sessions", started.sessionId), manifest);

		const status = statusSession(projectRoot, { sessionId: started.sessionId });
		assert.equal(status.exitCode, 0, status.text);
		assert.match(status.text, /Budget: 250\/1000 \(25%\)/);
	});

	for (const budget of [{ total: 1000, used: 0 }, { total: 1000 }, { total: 0, used: null }]) {
		it(`renders ${JSON.stringify(budget)} as untracked without a percentage`, async () => {
			const started = await startSession(projectRoot, { goal: "fix budget display" });
			assert.equal(started.exitCode, 0, started.text);
			const { manifest } = readSessionArtifacts(projectRoot, started.sessionId);
			manifest.budget = budget;
			assert.equal(validateManifest(manifest).valid, true);
			writeSessionManifest(
				path.join(projectRoot, ".amber", "sessions", started.sessionId),
				manifest,
			);

			const status = statusSession(projectRoot, { sessionId: started.sessionId });
			assert.equal(status.exitCode, 0, status.text);
			assert.match(status.text, /usage untracked.*not measured/);
			assert.doesNotMatch(status.text, /%/);
		});
	}
});
