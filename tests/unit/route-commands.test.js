const { describe, it } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
	listRoutes,
	inspectRoute,
	validateRouteFile,
	testRoute,
	executeRouteStage,
	parseVerbTarget,
	resolveVerbTarget,
} = require("../../scripts/lib/route-commands");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const {
	registerRunner,
	registerRunnerCapability,
} = require("../../scripts/lib/core/runner-registry");

const ROUTES_DIR = path.join(__dirname, "../../routes");
const BROKEN = path.join(__dirname, "../fixtures/routes/broken.route.json");

const RUNNER_DIGEST = `sha256:${"a".repeat(64)}`;

function mkVerbTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-route-verb-"));
}

function admitDecision(dir, identity) {
	const decision = admitArtifact(dir, {
		type: "decision",
		identity,
		body: `# ${identity}\n`,
		decisionKind: "approval",
		principal: "alice@example.com",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/runner" } }],
	});
	assert.strictEqual(decision.ok, true, (decision.errors || []).join("; "));
}

function registerVerbCapability(dir) {
	assert.strictEqual(
		registerPrincipal(dir, { id: "alice@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.strictEqual(
		admitArtifact(dir, { type: "intent", identity: "intent/runner", body: "# Runner\n" }).ok,
		true,
	);
	admitDecision(dir, "decision/runner");
	assert.strictEqual(
		registerRunner(dir, {
			id: "runner/ci",
			version: "1.0.0",
			integrityDigest: RUNNER_DIGEST,
			owner: "platform-team",
			decision: { identity: "decision/runner", revision: 1 },
		}).ok,
		true,
	);
	admitDecision(dir, "decision/capability");
	assert.strictEqual(
		registerRunnerCapability(dir, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "diagnose.check",
			capabilityVersion: "1",
			effects: ["diagnose"],
			pathPrefixes: null,
			timeoutMsMax: 1000,
			credentialRequirement: "none",
			rollback: "none",
			decision: { identity: "decision/capability", revision: 1 },
		}).ok,
		true,
	);
}

describe("listRoutes", () => {
	it("lists all three reference routes with id, version, and stage count", () => {
		const { text, exitCode } = listRoutes(ROUTES_DIR);
		assert.strictEqual(exitCode, 0);
		assert.match(text, /feature-standard/);
		assert.match(text, /bugfix-quick/);
		assert.match(text, /refactor-safe/);
	});

	it("shows the stage count for a known route", () => {
		const { text } = listRoutes(ROUTES_DIR);
		assert.match(text, /feature-standard.*\b4 stages\b/);
	});

	it("returns exitCode 0 and a message when no routes exist", () => {
		const { text, exitCode } = listRoutes(path.join(__dirname, "../../no-routes-here"));
		assert.strictEqual(exitCode, 0);
		assert.match(text, /No routes found/);
	});
});

describe("inspectRoute", () => {
	it("prints the full JSON of a route by id", () => {
		const { text, exitCode } = inspectRoute("feature-standard", ROUTES_DIR);
		assert.strictEqual(exitCode, 0);
		const jsonStart = text.indexOf("{");
		const parsed = JSON.parse(text.slice(jsonStart, text.lastIndexOf("}") + 1));
		assert.strictEqual(parsed.routeId, "feature-standard");
	});

	it("renders a stage tree with gate annotations", () => {
		const { text } = inspectRoute("feature-standard", ROUTES_DIR);
		assert.match(text, /capture/);
		assert.match(text, /gate: user-approval-plan/);
	});

	it("returns exitCode 1 for an unknown route id", () => {
		const { text, exitCode } = inspectRoute("does-not-exist", ROUTES_DIR);
		assert.strictEqual(exitCode, 1);
		assert.match(text, /not found/);
	});
});

describe("validateRouteFile", () => {
	it("reports a valid route with exitCode 0", () => {
		const { text, exitCode } = validateRouteFile(
			path.join(ROUTES_DIR, "feature-standard.route.json"),
		);
		assert.strictEqual(exitCode, 0);
		assert.match(text, /VALID/);
	});

	it("reports an invalid route with exitCode 1 and lists errors", () => {
		const { text, exitCode } = validateRouteFile(BROKEN);
		assert.strictEqual(exitCode, 1);
		assert.match(text, /INVALID/);
		assert.match(text, /routeId/);
	});

	it("returns exitCode 1 when no file path is given", () => {
		const { text, exitCode } = validateRouteFile("");
		assert.strictEqual(exitCode, 1);
		assert.match(text, /requires a file path/);
	});
});

describe("verb stage target resolution", () => {
	it("parses the closed runner and capability pin grammar", () => {
		const parsed = parseVerbTarget("runner/ci@1.0.0#diagnose.check@1");
		assert.strictEqual(parsed.ok, true);
		assert.deepStrictEqual(parsed.pin, {
			runnerId: "runner/ci",
			runnerVersion: "1.0.0",
			name: "diagnose.check",
			capabilityVersion: "1",
		});
	});

	it("rejects malformed pins before consulting the runner registry", () => {
		for (const target of ["", "runner/ci@1.0.0", " runner/ci@1.0.0#diagnose.check@1"]) {
			const parsed = parseVerbTarget(target);
			assert.strictEqual(parsed.ok, false, target);
			assert.strictEqual(parsed.code, "AMBER_E_RUNNER_INVALID");
			assert.match(parsed.errors[0], /runnerId@version#capability@version/);
		}
	});

	it("fails closed for an unregistered runner and capability", () => {
		const dir = mkVerbTarget();
		const unknownRunner = resolveVerbTarget(dir, "runner/ghost@1.0.0#diagnose.check@1");
		assert.strictEqual(unknownRunner.ok, false);
		assert.strictEqual(unknownRunner.code, "AMBER_E_RUNNER_NOT_FOUND");

		registerVerbCapability(dir);
		const unknownCapability = resolveVerbTarget(dir, "runner/ci@1.0.0#diagnose.ghost@1");
		assert.strictEqual(unknownCapability.ok, false);
		assert.strictEqual(unknownCapability.code, "AMBER_E_RUNNER_CAPABILITY_NOT_FOUND");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("fails closed when the runner or capability version drifts", () => {
		const dir = mkVerbTarget();
		registerVerbCapability(dir);

		const runnerDrift = resolveVerbTarget(dir, "runner/ci@9.9.9#diagnose.check@1");
		assert.strictEqual(runnerDrift.ok, false);
		assert.strictEqual(runnerDrift.code, "AMBER_E_RUNNER_VERSION_DRIFT");

		const capabilityDrift = resolveVerbTarget(dir, "runner/ci@1.0.0#diagnose.check@2");
		assert.strictEqual(capabilityDrift.ok, false);
		assert.strictEqual(capabilityDrift.code, "AMBER_E_RUNNER_CAPABILITY_NOT_FOUND");
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("resolves a registered pin and route execution remains a non-spawning guard", () => {
		const dir = mkVerbTarget();
		registerVerbCapability(dir);
		const routesDir = path.join(dir, "routes");
		fs.mkdirSync(routesDir, { recursive: true });
		fs.writeFileSync(
			path.join(routesDir, "verb-route.route.json"),
			JSON.stringify({
				routeId: "verb-route",
				schemaVersion: "1.0.0",
				stages: [
					{
						name: "check",
						type: "verb",
						target: "runner/ci@1.0.0#diagnose.check@1",
					},
				],
			}),
		);

		const resolved = resolveVerbTarget(dir, "runner/ci@1.0.0#diagnose.check@1");
		assert.strictEqual(resolved.ok, true, resolved.errors?.join("; "));
		assert.strictEqual(resolved.capability.name, "diagnose.check");

		const execution = executeRouteStage("verb-route", "check", dir, routesDir);
		assert.strictEqual(execution.exitCode, 0, execution.errors?.join("; "));
		assert.strictEqual(execution.executed, false);
		assert.match(execution.text, /session run/);
		assert.strictEqual(fs.existsSync(path.join(dir, ".amber", "routes")), false);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("testRoute (dry-run)", () => {
	it("prints the ordered stage sequence for a route", () => {
		const { text, exitCode } = testRoute("bugfix-quick", ROUTES_DIR);
		assert.strictEqual(exitCode, 0);
		assert.match(text, /1\. reproduce/);
		assert.match(text, /2\. fix/);
		assert.match(text, /3\. verify/);
	});

	it("marks where gates fire", () => {
		const { text } = testRoute("bugfix-quick", ROUTES_DIR);
		assert.match(text, /GATE user-approval-fix fires after reproduce/);
	});

	it("returns exitCode 1 for an unknown route id", () => {
		const { exitCode } = testRoute("nope", ROUTES_DIR);
		assert.strictEqual(exitCode, 1);
	});
});
