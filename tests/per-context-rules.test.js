"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { approveLoopContract, executeLoopContract } = require("../scripts/lib/core/loop-execution");
const { approveRouteStage, executeRouteStage } = require("../scripts/lib/route-commands");

function tmpGitRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-pcr-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
	fs.writeFileSync(path.join(dir, "x.txt"), "hi");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	return dir;
}

// A loop contract whose governed block declares an extra allow rule for `node --version`.
function loopPackWith(extraRules) {
	return {
		id: "p",
		version: "1",
		loopContracts: [
			{
				id: "c1",
				trigger: { type: "manual", enabled: false },
				cadence: "on-demand",
				stateSpine: ".amber/loops/c1/state.json",
				hardStops: { maxIterations: 1 },
				reviewGates: ["human-approval"],
				governed: { command: "node --version", requiresApproval: true, rules: extraRules },
				execution: { executesAnything: false },
			},
		],
	};
}

test("context allow rule permits a command the global rules.json does not allow", () => {
	const dir = tmpGitRepo();
	// global rules.json: default-deny, NO allow for `node --version`
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			confidence_gating: { enabled: true, defaultConfidence: "low" },
			rules: [],
		}),
	);
	const packPath = path.join(dir, "pack.json");
	fs.writeFileSync(
		packPath,
		JSON.stringify(
			loopPackWith([
				{
					id: "ctx-allow-node-ver",
					action: "allow",
					match: "exact",
					pattern: "node --version",
					mapsTo: ["ASI04"],
				},
			]),
		),
	);
	execSync("git add -A && git commit -qm pkg", { cwd: dir });
	approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
	const r = executeLoopContract({ file: packPath, contract: "c1", target: dir, execute: true });
	assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
	assert.equal(r.executed, true);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a global deny is NOT overridden by a context allow (deny-wins is absolute)", () => {
	const dir = tmpGitRepo();
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			rules: [{ id: "global-deny-rm", action: "deny", match: "regex", pattern: "rm\\s+-rf" }],
		}),
	);
	// contract command is `rm -rf /tmp/x`; context tries to allow it — must still deny
	const pack = {
		id: "p",
		version: "1",
		loopContracts: [
			{
				id: "c1",
				trigger: { type: "manual", enabled: false },
				cadence: "on-demand",
				stateSpine: ".amber/loops/c1/state.json",
				hardStops: { maxIterations: 1 },
				reviewGates: ["human-approval"],
				governed: {
					command: "rm -rf /tmp/x",
					requiresApproval: true,
					rules: [{ id: "ctx-allow-rm", action: "allow", match: "regex", pattern: "rm\\s+-rf" }],
				},
				execution: { executesAnything: false },
			},
		],
	};
	const packPath = path.join(dir, "pack.json");
	fs.writeFileSync(packPath, JSON.stringify(pack));
	execSync("git add -A && git commit -qm pkg", { cwd: dir });
	approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
	const r = executeLoopContract({ file: packPath, contract: "c1", target: dir, execute: true });
	assert.ok(r.errors.join("\n").includes("AMBER_E_POLICY_DENY"), r.errors.join("\n"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a context deny blocks a command even if global rules would allow it", () => {
	const dir = tmpGitRepo();
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			rules: [{ id: "global-allow-node", action: "allow", match: "prefix", pattern: "node " }],
		}),
	);
	// contract command `node -e "require('child_process')..."` — context denies `node -e`
	const pack = {
		id: "p",
		version: "1",
		loopContracts: [
			{
				id: "c1",
				trigger: { type: "manual", enabled: false },
				cadence: "on-demand",
				stateSpine: ".amber/loops/c1/state.json",
				hardStops: { maxIterations: 1 },
				reviewGates: ["human-approval"],
				governed: {
					command: "node -e 0",
					requiresApproval: true,
					rules: [{ id: "ctx-deny-node-e", action: "deny", match: "regex", pattern: "node\\s+-e" }],
				},
				execution: { executesAnything: false },
			},
		],
	};
	const packPath = path.join(dir, "pack.json");
	fs.writeFileSync(packPath, JSON.stringify(pack));
	execSync("git add -A && git commit -qm pkg", { cwd: dir });
	approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
	const r = executeLoopContract({ file: packPath, contract: "c1", target: dir, execute: true });
	assert.ok(r.errors.join("\n").includes("AMBER_E_POLICY_DENY"), r.errors.join("\n"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("route stage with rules composes the same way (context allow supplements global)", () => {
	const dir = tmpGitRepo();
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			confidence_gating: { enabled: true, defaultConfidence: "low" },
			rules: [],
		}),
	);
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ scripts: { test: "node -e 0" } }),
	);
	// a route with a command stage that carries its own allow rule
	const route = {
		routeId: "r1",
		schemaVersion: "1.0.0",
		version: "1.0.0",
		stages: [
			{
				name: "verify",
				type: "command",
				target: "npm test",
				rules: [
					{
						id: "ctx-allow-npm-test",
						action: "allow",
						match: "exact",
						pattern: "npm test",
						mapsTo: ["ASI04"],
					},
				],
			},
		],
		gates: [],
	};
	fs.mkdirSync(path.join(dir, "routes"), { recursive: true });
	fs.writeFileSync(path.join(dir, "routes", "r1.route.json"), JSON.stringify(route));
	execSync("git add -A && git commit -qm route", { cwd: dir });
	const routesDir = path.join(dir, "routes");
	approveRouteStage("r1", "verify", dir, "me", routesDir);
	const r = executeRouteStage("r1", "verify", dir, routesDir);
	assert.equal(r.exitCode, 0, r.text + JSON.stringify(r.errors));
	fs.rmSync(dir, { recursive: true, force: true });
});
