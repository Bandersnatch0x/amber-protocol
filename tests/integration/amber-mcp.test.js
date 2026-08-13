"use strict";

// Integration coverage for the P1 Amber Ontology MCP server
// (scripts/amber-mcp.js). The server is a stdio JSON-RPC 2.0 process;
// these tests drive it with piped input and assert on the JSON responses.
//
// Safety invariants exercised (F018):
//   * Only registry-proven read-only variants are spawned; mutating actions
//     are always approvalRequired and never write into the target repository.
//   * _target must resolve to a configured repository (escape is rejected).
//   * Read-only / dry-run action types execute cleanly.
//   * Non-zero exits, corrupt governance state, and contract failures are
//     surfaced as isError; valid empty queries return exit 0.
//   * Unknown tools and invalid arguments produce JSON-RPC errors.

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const Ajv = require("ajv");

const ROOT = path.resolve(__dirname, "../..");
const MCP_JS = path.join(ROOT, "scripts", "amber-mcp.js");
const SCHEMA_PATH = path.join(ROOT, "schemas", "action.type.schema.json");
const ACTION_TYPES_DIR = path.join(ROOT, "action-types");

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-mcp-int-"));
}

function rpc(messages, extraArgs = []) {
	const lines = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
	const result = spawnSync(process.execPath, [MCP_JS, ...extraArgs], {
		cwd: ROOT,
		input: lines,
		encoding: "utf8",
		timeout: 120_000,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const responses = result.stdout
		.trim()
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l));
	const byId = new Map();
	for (const r of responses) byId.set(r.id, r);
	return byId;
}

function callOutcome(response) {
	assert.ok(response, "expected a response");
	assert.equal(response.error, undefined, JSON.stringify(response.error));
	return JSON.parse(response.result.content[0].text);
}

test("every action-types whitelist file validates against the schema", () => {
	const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
	const ajv = new Ajv({ allErrors: true });
	const validate = ajv.compile(schema);

	const files = fs
		.readdirSync(ACTION_TYPES_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort();
	assert.ok(files.length >= 6, "expected at least six action types");

	for (const file of files) {
		const definition = JSON.parse(fs.readFileSync(path.join(ACTION_TYPES_DIR, file), "utf8"));
		assert.equal(
			validate(definition),
			true,
			`${file} violates schema: ${JSON.stringify(validate.errors)}`,
		);
		assert.ok(definition.execution, `${file} must declare an execution mapping`);
		assert.match(definition.actionTypeId, /^amber\./, `${file} id must be namespaced`);
	}
});

test("initialize handshake returns server info and tools capability", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test", version: "1.0" },
				},
			},
		],
		["--target", target],
	);
	const result = byId.get(1).result;
	assert.equal(result.serverInfo.name, "amber-mcp");
	assert.equal(result.serverInfo.version, "0.7.0");
	assert.ok(result.capabilities.tools);
	assert.equal(result.protocolVersion, "2024-11-05");
});

test("startup rejects unknown CLI flags instead of silently ignoring configuration", () => {
	const result = spawnSync(process.execPath, [MCP_JS, "--definitely-unknown"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	assert.equal(result.status, 2);
	assert.match(result.stderr, /unknown option/);
});

test("tools/list exposes every whitelisted amber.* action", () => {
	const target = tempTarget();
	const byId = rpc([{ jsonrpc: "2.0", id: 1, method: "tools/list" }], ["--target", target]);
	const tools = byId.get(1).result.tools;
	const names = tools.map((t) => t.name).sort();

	assert.ok(tools.length >= 8);
	assert.ok(names.includes("amber.session.start"));
	assert.ok(names.includes("amber.session.approve"));
	assert.ok(names.includes("amber.route.test"));
	assert.ok(names.includes("amber.governance.report"));
	assert.ok(names.includes("amber.object.query"));
	for (const tool of tools) {
		assert.match(tool.name, /^amber\./);
		assert.ok(tool.inputSchema && tool.inputSchema.type === "object");
		assert.ok(
			tool.outputSchema && tool.outputSchema.type === "object",
			"tools advertise outputSchema",
		);
		assert.ok(
			"_target" in tool.inputSchema.properties,
			`${tool.name} accepts the reserved _target override`,
		);
		assert.ok(
			"_agent" in tool.inputSchema.properties,
			`${tool.name} accepts the reserved _agent identity`,
		);
	}
	const startTool = tools.find((tool) => tool.name === "amber.session.start");
	assert.equal(startTool.inputSchema.properties.mode, undefined);

	// Function tools are exposed alongside action tools.
	assert.ok(names.includes("amber.fn.sessionEvidence"));
	assert.ok(names.includes("amber.fn.repoOverview"));
});

test("object.query executes in default mode for every object family", () => {
	const target = tempTarget();
	fs.mkdirSync(path.join(target, ".amber"));
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.object.query", arguments: { objectType: "route" } },
			},
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "amber.object.query", arguments: { objectType: "session" } },
			},
			{
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "amber.object.query", arguments: { objectType: "ledger" } },
			},
			{
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: {
					name: "amber.object.query",
					arguments: { objectType: "context", route: "feature-standard" },
				},
			},
		],
		["--target", target],
	);

	const route = callOutcome(byId.get(1));
	assert.equal(route.executed, true, "route query must execute without --execute");
	assert.equal(route.dryRun, false);
	assert.equal(route.exitCode, 0);
	assert.match(route.command, /amber route list --json --target /);
	assert.match(route.stdout, /Available routes/);
	assert.equal(byId.get(1).result.isError, false);

	// Empty state answers are still answers: a valid empty query returns
	// exit 0 (F018: empty != error), so isError stays false.
	const session = callOutcome(byId.get(2));
	assert.equal(session.executed, true);
	assert.equal(session.exitCode, 0);
	assert.match(session.stdout, /No sessions found/);
	assert.equal(byId.get(2).result.isError, false);

	const ledger = callOutcome(byId.get(3));
	assert.equal(ledger.executed, true);
	assert.equal(ledger.exitCode, 0);
	assert.match(ledger.command, /amber ledger export --home all --format json --target /);
	assert.match(ledger.stdout, /"ledgers"/);

	const context = callOutcome(byId.get(4));
	assert.equal(context.executed, true);
	assert.match(context.command, /amber context preview --route feature-standard --json --target /);
	assert.ok(context.stdout.length > 0);
	assert.equal(fs.existsSync(path.join(target, ".amber", "context", "loadouts")), false);
});

test("object.query rejects unknown object types", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.object.query", arguments: { objectType: "bogus" } },
			},
		],
		["--target", target],
	);
	assert.ok(byId.get(1).error);
	assert.equal(byId.get(1).error.code, -32602);
	assert.match(byId.get(1).error.message, /objectType/);
});

test("closed loop: query -> decide -> act(read-only) -> verify chain works", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			// query: what routes exist?
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.object.query", arguments: { objectType: "route" } },
			},
			// act: starting a session needs human approval — reported, not executed
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "amber.session.start", arguments: { goal: "loop smoke" } },
			},
			// verify: current session state (read-only)
			{
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "amber.object.query", arguments: { objectType: "session" } },
			},
		],
		["--target", target],
	);

	const query = callOutcome(byId.get(1));
	assert.equal(query.executed, true);
	assert.match(query.stdout, /Available routes/);

	const act = callOutcome(byId.get(2));
	assert.equal(act.executed, false);
	assert.equal(
		act.approvalRequired,
		true,
		"mutating act is always approval-required (never spawned)",
	);
	assert.match(act.command, /amber session start --goal loop smoke --target /);

	const verify = callOutcome(byId.get(3));
	assert.equal(verify.executed, true);

	// No mutation leaked into the target from the attempted act.
	assert.ok(!fs.existsSync(path.join(target, ".amber", "sessions")));
});

test("--execute still gates mutating actions behind human approval", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.session.start", arguments: { goal: "smoke" } },
			},
		],
		["--target", target, "--execute"],
	);
	const outcome = callOutcome(byId.get(1));
	assert.equal(outcome.executed, false);
	assert.equal(outcome.approvalRequired, true);
	assert.ok(outcome.hint);

	// Approval-required actions must not mutate the target.
	assert.ok(!fs.existsSync(path.join(target, ".amber")));
});

test("--execute runs read-only action types and reports stdout", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.governance.report", arguments: {} },
			},
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "amber.route.test", arguments: { routeId: "feature-standard" } },
			},
		],
		["--target", target, "--execute"],
	);

	const report = callOutcome(byId.get(1));
	assert.equal(report.executed, true);
	assert.equal(report.exitCode, 0);
	assert.match(report.stdout, /Governance Report/);

	const routeTest = callOutcome(byId.get(2));
	assert.equal(routeTest.executed, true);
	assert.equal(routeTest.exitCode, 0);
	assert.match(routeTest.command, /amber route test feature-standard --target /);
	assert.match(routeTest.stdout, /No execution performed/);
});

test("invalid arguments are rejected with a JSON-RPC error", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.session.start", arguments: {} },
			},
		],
		["--target", target],
	);
	const response = byId.get(1);
	assert.ok(response.error);
	assert.equal(response.error.code, -32602);
	assert.match(response.error.message, /goal/);
});

test("unknown tool names are rejected", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.not.real", arguments: {} },
			},
			{ jsonrpc: "2.0", id: 2, method: "definitelyNotAMethod" },
		],
		["--target", target],
	);
	assert.equal(byId.get(1).error.code, -32602);
	assert.equal(byId.get(2).error.code, -32601);
});

test("object.query returns structuredContent for JSON-emitting commands", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.object.query", arguments: { objectType: "route" } },
			},
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "amber.object.query", arguments: { objectType: "ledger" } },
			},
			{
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "amber.object.query", arguments: { objectType: "loop" } },
			},
		],
		["--target", target],
	);

	const route = byId.get(1);
	assert.equal(route.result.isError, false);
	assert.ok(route.result.structuredContent, "route query must return structuredContent");
	assert.equal(typeof route.result.structuredContent.text, "string");
	assert.match(route.result.structuredContent.text, /Available routes/);

	const ledger = byId.get(2);
	assert.ok(Array.isArray(ledger.result.structuredContent.ledgers));

	const loop = byId.get(3);
	// `loop recommend` on a pack-less repo deliberately exits non-zero (the CLI
	// treats "no workflow packs" as a hard error — see phase-future-loop-
	// readiness.test.js). Fail-closed semantics surface that as isError: true,
	// while structuredContent is still shipped so agents get the payload.
	assert.equal(loop.result.isError, true, "non-zero loop recommend must surface as isError");
	assert.equal(loop.result.structuredContent.goal, "continuous improvement");
	assert.ok(
		"candidates" in loop.result.structuredContent || "selected" in loop.result.structuredContent,
		"loop query returns recommendation shape",
	);
});

test("multi-target: _target overrides the repository per call (configured member)", () => {
	const targetA = tempTarget();
	const targetB = tempTarget();
	fs.writeFileSync(path.join(targetB, "marker.txt"), "b");
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.object.query",
					arguments: { objectType: "route", _target: targetB },
				},
			},
		],
		// targetB must be a configured member to be accepted as a _target override.
		["--target", targetA, "--targets", targetB],
	);
	const outcome = callOutcome(byId.get(1));
	assert.equal(outcome.executed, true);
	assert.ok(
		outcome.command.endsWith(`--target ${targetB}`),
		`command must target the override: ${outcome.command}`,
	);
});

test("configured-repository invariant: existing but unconfigured _target is rejected", () => {
	const targetA = tempTarget();
	const targetB = tempTarget(); // exists, but is NOT in the configured set
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.object.query",
					arguments: { objectType: "route", _target: targetB },
				},
			},
		],
		["--target", targetA],
	);
	assert.ok(byId.get(1).error, "unconfigured existing directory must be rejected");
	assert.equal(byId.get(1).error.code, -32602);
	assert.match(byId.get(1).error.message, /not a configured repository/);
});

test("multi-target: invalid _target is rejected", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.object.query",
					arguments: { objectType: "route", _target: "definitely-missing-dir" },
				},
			},
		],
		["--target", target],
	);
	assert.ok(byId.get(1).error);
	assert.equal(byId.get(1).error.code, -32602);
	assert.match(byId.get(1).error.message, /_target/);
});

test("functions: amber.fn.sessionEvidence summarizes a session read-only", () => {
	const target = tempTarget();
	const start = spawnSync(
		process.execPath,
		[
			path.join(ROOT, "scripts", "amber.js"),
			"session",
			"start",
			"--goal",
			"fn probe",
			"--route",
			"feature-standard",
			"--confirm",
			"--target",
			target,
		],
		{ cwd: ROOT, encoding: "utf8" },
	);
	assert.equal(start.status, 0, start.stderr);
	const sessionId = start.stdout.match(/Session created: ([a-f0-9-]+)/)[1];

	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.fn.sessionEvidence", arguments: { sessionId } },
			},
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "amber.fn.sessionEvidence", arguments: {} },
			},
		],
		["--target", target],
	);

	const summary = byId.get(1).result.structuredContent;
	assert.ok(summary.sessions, "sessionEvidence returns a sessions array");
	assert.equal(summary.sessions.length, 1);
	assert.equal(summary.sessions[0].sessionId, sessionId);
	assert.equal(summary.sessions[0].status, "created");
	assert.equal(summary.sessions[0].active, true);
	assert.ok(summary.sessions[0].timelineEvents >= 1);
	assert.equal(byId.get(1).result.isError, false);

	// Most-recent fallback returns the same session.
	assert.equal(byId.get(2).result.structuredContent.sessions[0].sessionId, sessionId);
});

test("functions: schema-invalid session manifest fails closed", () => {
	const target = tempTarget();
	const sessionDir = path.join(target, ".amber", "sessions", "invalid");
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(path.join(sessionDir, "manifest.json"), JSON.stringify({}));
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.fn.sessionEvidence", arguments: { sessionId: "invalid" } },
			},
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "amber.fn.repoOverview", arguments: {} },
			},
		],
		["--target", target],
	);
	for (const id of [1, 2]) {
		assert.equal(byId.get(id).result.isError, true);
		assert.match(JSON.parse(byId.get(id).result.content[0].text).error, /corrupt session manifest/);
	}
});

test("functions: amber.fn.repoOverview aggregates across repositories", () => {
	const targetA = tempTarget();
	const targetB = tempTarget();
	fs.mkdirSync(path.join(targetB, "routes"));
	fs.writeFileSync(path.join(targetB, "routes", "configured.route.json"), "{}\n");
	const start = spawnSync(
		process.execPath,
		[
			path.join(ROOT, "scripts", "amber.js"),
			"session",
			"start",
			"--goal",
			"overview probe",
			"--route",
			"feature-standard",
			"--confirm",
			"--target",
			targetB,
		],
		{ cwd: ROOT, encoding: "utf8" },
	);
	assert.equal(start.status, 0, start.stderr);

	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.fn.repoOverview", arguments: {} },
			},
		],
		["--target", targetA, "--targets", targetB],
	);

	const overview = byId.get(1).result.structuredContent;
	assert.equal(overview.repoCount, 2);
	assert.equal(overview.totalSessions, 1);
	assert.equal(overview.totalActive, 1);
	const repoB = overview.repos.find((r) => r.target === targetB);
	assert.ok(repoB, "repo overview includes the second repository");
	assert.equal(repoB.sessionCount, 1);
	assert.equal(repoB.activeSessions.length, 1);
	assert.deepEqual(repoB.routes, ["configured"], "only configured-repository routes are included");
});

test("functions: repoOverview refuses a session-directory junction escape", () => {
	const target = tempTarget();
	const outside = tempTarget();
	const sessionsDir = path.join(target, ".amber", "sessions");
	fs.mkdirSync(sessionsDir, { recursive: true });
	fs.writeFileSync(
		path.join(outside, "manifest.json"),
		JSON.stringify({ status: "created", goal: "outside", route: { id: "feature-standard" } }),
	);
	try {
		fs.symlinkSync(outside, path.join(sessionsDir, "escaped-session"), "junction");
	} catch (err) {
		if (/EPERM|ENOSYS|existing/i.test(err.message)) return;
		throw err;
	}

	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.fn.repoOverview", arguments: {} },
			},
		],
		["--target", target],
	);
	assert.equal(byId.get(1).result.isError, true);
	assert.match(byId.get(1).result.content[0].text, /escapes repository root via link/);
});

test("concurrency: mutating actions conflict on a busy repository", () => {
	const targetA = tempTarget();
	const targetB = tempTarget();
	const start = spawnSync(
		process.execPath,
		[
			path.join(ROOT, "scripts", "amber.js"),
			"session",
			"start",
			"--goal",
			"busy repo",
			"--route",
			"feature-standard",
			"--agent",
			"owner-agent",
			"--confirm",
			"--target",
			targetB,
		],
		{ cwd: ROOT, encoding: "utf8" },
	);
	assert.equal(start.status, 0, start.stderr);
	const sessionId = start.stdout.match(/Session created: ([a-f0-9-]+)/)[1];

	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.session.start",
					arguments: { goal: "second session", _target: targetB, _agent: "agent-y" },
				},
			},
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: {
					name: "amber.session.verify",
					arguments: {
						sessionId,
						stage: "s",
						result: "ok",
						_target: targetB,
					},
				},
			},
		],
		["--target", targetA, "--targets", targetB, "--execute"],
	);

	const conflict = JSON.parse(byId.get(1).result.content[0].text);
	assert.equal(conflict.executed, false);
	assert.ok(conflict.conflict, "busy repository must report a conflict");
	assert.deepEqual(conflict.conflict.activeSessions, [sessionId]);
	assert.deepEqual(conflict.conflict.owners, { [sessionId]: "owner-agent" });
	assert.equal(conflict.agent, "agent-y");
	assert.equal(byId.get(1).result.isError, false);

	// Actions referencing the active session are exempt from the guard.
	const verify = JSON.parse(byId.get(2).result.content[0].text);
	assert.equal(verify.conflict, undefined, "own-session actions are not conflicts");
	assert.equal(verify.approvalRequired, true);
});

test("ownership: --agent records agentId in the session manifest", () => {
	const target = tempTarget();
	const start = spawnSync(
		process.execPath,
		[
			path.join(ROOT, "scripts", "amber.js"),
			"session",
			"start",
			"--goal",
			"ownership probe",
			"--route",
			"feature-standard",
			"--agent",
			"agent-master",
			"--confirm",
			"--target",
			target,
		],
		{ cwd: ROOT, encoding: "utf8" },
	);
	assert.equal(start.status, 0, start.stderr);
	const sessionId = start.stdout.match(/Session created: ([a-f0-9-]+)/)[1];

	const manifestPath = path.join(target, ".amber", "sessions", sessionId, "manifest.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	assert.equal(manifest.agentId, "agent-master");
	assert.ok(manifest.agentClaimedAt);

	// The sessionEvidence function surfaces ownership.
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.fn.sessionEvidence", arguments: { sessionId } },
			},
		],
		["--target", target],
	);
	assert.equal(byId.get(1).result.structuredContent.sessions[0].agentId, "agent-master");
});

test("session.start renders --agent from the reserved _agent parameter", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.session.start",
					arguments: { goal: "g", _agent: "agent-master" },
				},
			},
		],
		["--target", target],
	);
	const outcome = callOutcome(byId.get(1));
	assert.equal(outcome.agent, "agent-master");
	assert.match(outcome.command, /amber session start --goal g --agent agent-master --target /);
});

test("functions: parameter schema is enforced (ajv) and results are cached", () => {
	const target = tempTarget();

	// Unknown parameter rejected by the function's own inputSchema.
	const bad = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.fn.sessionEvidence", arguments: { bogus: 1 } },
			},
		],
		["--target", target],
	);
	assert.ok(bad.get(1).error);
	assert.equal(bad.get(1).error.code, -32602);
	assert.match(bad.get(1).error.message, /additional propert/);

	// Identical read-only calls hit the TTL cache; the second reports cached.
	const two = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.fn.sessionEvidence", arguments: {} },
			},
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "amber.fn.sessionEvidence", arguments: {} },
			},
		],
		["--target", target],
	);
	const first = JSON.parse(two.get(1).result.content[0].text);
	const second = JSON.parse(two.get(2).result.content[0].text);
	assert.equal(first.cached, false);
	assert.equal(second.cached, true);
	assert.deepEqual(second.data, first.data);
});

test("notifications are ignored and ping returns an empty result", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: 1, method: "ping" },
		],
		["--target", target],
	);
	assert.deepEqual(byId.get(1).result, {});
});

// ---- F018 negative-path characterization ---------------------------------

test("read-only invariant: governance.report rejects the write-capable output parameter", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.governance.report",
					arguments: { output: "report.md" },
				},
			},
		],
		["--target", target, "--execute"],
	);
	// `output` is no longer in the read-only Action interface; the closed
	// inputSchema (additionalProperties: false) refuses it.
	assert.ok(byId.get(1).error, "output must be rejected on the read-only report action");
	assert.equal(byId.get(1).error.code, -32602);
});

test("fail-closed: non-zero read-only command surfaces as isError", () => {
	const target = tempTarget();
	// Querying a specific non-existent session id is a real error (not an empty
	// result): session status returns exit 1, which MCP must report as isError.
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.object.query",
					arguments: { objectType: "session", id: "definitely-no-such-session" },
				},
			},
		],
		["--target", target],
	);
	const outcome = callOutcome(byId.get(1));
	assert.equal(outcome.executed, true);
	assert.equal(outcome.exitCode, 1);
	assert.equal(byId.get(1).result.isError, true, "non-zero read-only exit must be isError");
});

test("fail-closed: corrupt active-session manifest blocks mutation with isError", () => {
	const target = tempTarget();
	// Seed an active session, then corrupt its manifest so the concurrency
	// guard cannot read governance state.
	const start = spawnSync(
		process.execPath,
		[
			path.join(ROOT, "scripts", "amber.js"),
			"session",
			"start",
			"--goal",
			"corrupt guard probe",
			"--route",
			"feature-standard",
			"--confirm",
			"--target",
			target,
		],
		{ cwd: ROOT, encoding: "utf8" },
	);
	assert.equal(start.status, 0, start.stderr);
	const sessionId = start.stdout.match(/Session created: ([a-f0-9-]+)/)[1];
	const manifestPath = path.join(target, ".amber", "sessions", sessionId, "manifest.json");
	fs.writeFileSync(manifestPath, "{ not valid json ");

	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.session.start",
					arguments: { goal: "second", _agent: "agent-z" },
				},
			},
		],
		["--target", target, "--execute"],
	);
	const outcome = JSON.parse(byId.get(1).result.content[0].text);
	assert.equal(outcome.executed, false);
	assert.match(outcome.error, /corrupt session manifest/);
	// Ownership information for the valid session id is preserved in the error.
	assert.ok(outcome.conflict, "fail-closed error preserves ownership context");
	assert.equal(byId.get(1).result.isError, true, "corrupt governance state must be isError");
});

test("fail-closed: missing session manifest blocks mutation", () => {
	const target = tempTarget();
	const sessionDir = path.join(target, ".amber", "sessions", "orphan");
	fs.mkdirSync(sessionDir, { recursive: true });
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.session.start", arguments: { goal: "blocked" } },
			},
		],
		["--target", target],
	);
	const response = byId.get(1);
	assert.equal(response.result.isError, true);
	assert.match(JSON.parse(response.result.content[0].text).error, /corrupt session manifest/);
});

test("fail-closed: schema-invalid session manifest blocks mutation", () => {
	const target = tempTarget();
	const sessionDir = path.join(target, ".amber", "sessions", "invalid");
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(path.join(sessionDir, "manifest.json"), JSON.stringify({}));
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "amber.session.start", arguments: { goal: "blocked" } },
			},
		],
		["--target", target],
	);
	const response = byId.get(1);
	assert.equal(response.result.isError, true);
	assert.match(JSON.parse(response.result.content[0].text).error, /corrupt session manifest/);
});

test("fail-closed: concurrency guard refuses governance-state junction escape", () => {
	const target = tempTarget();
	const outside = tempTarget();
	fs.mkdirSync(path.join(outside, "sessions"));
	try {
		fs.symlinkSync(outside, path.join(target, ".amber"), "junction");
	} catch (err) {
		if (/EPERM|ENOSYS|existing/i.test(err.message)) return;
		throw err;
	}

	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.session.start",
					arguments: { goal: "must stay contained" },
				},
			},
		],
		["--target", target, "--execute"],
	);
	assert.equal(byId.get(1).result.isError, true);
	assert.match(byId.get(1).result.content[0].text, /escapes repository root via link/);
});

test("fail-closed: concurrency guard refuses a session-directory junction escape", () => {
	const target = tempTarget();
	const outside = tempTarget();
	const sessionsDir = path.join(target, ".amber", "sessions");
	fs.mkdirSync(sessionsDir, { recursive: true });
	fs.writeFileSync(
		path.join(outside, "manifest.json"),
		JSON.stringify({ status: "created", agentId: "outside-agent" }),
	);
	try {
		fs.symlinkSync(outside, path.join(sessionsDir, "escaped-session"), "junction");
	} catch (err) {
		if (/EPERM|ENOSYS|existing/i.test(err.message)) return;
		throw err;
	}

	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.session.start",
					arguments: { goal: "must stay contained" },
				},
			},
		],
		["--target", target, "--execute"],
	);
	assert.equal(byId.get(1).result.isError, true);
	assert.match(byId.get(1).result.content[0].text, /escapes repository root via link/);
});

test("governed execution: mutation is never spawned, even under --execute", () => {
	const target = tempTarget();
	const byId = rpc(
		[
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "amber.session.verify",
					arguments: { sessionId: "s-none", stage: "verify", result: "ok" },
				},
			},
		],
		["--target", target, "--execute"],
	);
	const outcome = callOutcome(byId.get(1));
	assert.equal(outcome.executed, false, "mutating action must never be spawned by the adapter");
	assert.equal(outcome.approvalRequired, true);
	// No governance state written for a non-executing submission.
	assert.ok(!fs.existsSync(path.join(target, ".amber")));
});

test("contract parity: startup refuses a whitelist with a broken action contract", () => {
	// Drive the contract validator directly: a deliberately mismatched action
	// (write command, empty edits) is refused, proving registration fails closed.
	const { validateActionContract } = require("../../scripts/lib/mcp-action-contracts");
	const broken = {
		actionTypeId: "amber.test.broken",
		version: 1,
		goal: "x",
		mode: "interactive",
		parameters: { goal: { type: "string", required: true } },
		effects: { edits: [], sideEffects: [], rollback: false },
		evidenceRequired: ["timeline-event"],
		governance: { policy: "p", approver: ["system"], evidence: ["timeline-event"] },
		execution: {
			command: "session",
			subcommand: "start",
			args: [{ flag: "--goal", source: "parameters.goal" }],
		},
	};
	const findings = validateActionContract(broken);
	assert.ok(
		findings.some((f) => /effect mismatch/.test(f)),
		findings.join("\n"),
	);
});
