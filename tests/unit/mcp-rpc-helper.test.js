"use strict";

// Regression tests for tests/helpers/mcp-rpc.js — the RPC driver that
// replaced the integration tests' raw spawnSync of the MCP server.
//
// The flake being locked down: under full-suite parallel load a single server
// spawn could exceed the old fixed 120s spawnSync timeout; spawnSync's
// timeout kills only the DIRECT child, and the MCP server's own spawned
// `amber` grandchildren hold the inherited stdout pipe, so the test blocked
// far past its timeout (one observed hang: 990s).
//
// The seam: the helper must (a) kill the WHOLE process tree when a server
// times out, (b) retry transient failures (timeout / spawn error), and
// (c) fail fast with a diagnostic on permanent failures.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HELPER = path.join(__dirname, "..", "helpers", "mcp-rpc.js");

function runHelper({ serverJs, input = "", timeoutMs = 2000, retries = 0 }) {
	const env = { ...process.env, MCP_SERVER_JS: serverJs };
	env.MCP_RPC_TIMEOUT_MS = String(timeoutMs);
	env.MCP_RPC_RETRIES = String(retries);
	return spawnSync(process.execPath, [HELPER], {
		encoding: "utf8",
		input,
		env,
		timeout: 30_000,
	});
}

function mkDir(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `mcp-rpc-${label}-`));
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// ── Normal passthrough ───────────────────────────────────────

test("helper passes a fast server's responses through unchanged", () => {
	const dir = mkDir("fast");
	const serverJs = path.join(dir, "server.js");
	fs.writeFileSync(
		serverJs,
		[
			'"use strict";',
			'const fs = require("node:fs");',
			'const input = fs.readFileSync(0, "utf8");',
			'process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }) + "\\n");',
		].join("\n"),
	);
	const result = runHelper({ serverJs, input: "{}" });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /"ok":true/);
});

// ── Retry on transient timeout ───────────────────────────────

test("helper retries a timed-out server and succeeds when a retry responds", () => {
	const dir = mkDir("retry");
	const serverJs = path.join(dir, "server.js");
	// First invocation sleeps past the timeout; later invocations respond fast.
	fs.writeFileSync(
		serverJs,
		[
			'"use strict";',
			'const fs = require("node:fs");',
			'const path = require("node:path");',
			`const counter = path.join(${JSON.stringify(dir)}, "count");`,
			'const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) + 1 : 1;',
			"fs.writeFileSync(counter, String(n));",
			"if (n === 1) { const until = Date.now() + 1500; while (Date.now() < until) {} }",
			'fs.readFileSync(0, "utf8");',
			'process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { attempt: n } }) + "\\n");',
		].join("\n"),
	);
	// timeout 800ms < 1500ms first-attempt sleep → attempt 1 times out,
	// retry (attempt 2) responds within budget → exit 0.
	const result = runHelper({ serverJs, input: "{}", timeoutMs: 800, retries: 2 });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /"attempt":2/);
});

// ── Process-tree kill on timeout ─────────────────────────────

test("helper kills the server AND its grandchildren on timeout (no pipe pin)", () => {
	const dir = mkDir("tree");
	const grandchildPidFile = path.join(dir, "grandchild.pid");
	const serverJs = path.join(dir, "server.js");
	fs.writeFileSync(
		serverJs,
		[
			'"use strict";',
			'const fs = require("node:fs");',
			'const path = require("node:path");',
			'const { spawn } = require("node:child_process");',
			// Grandchild: an orphan that keeps stdout open forever.
			'const grand = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "pipe"] });',
			`fs.writeFileSync(${JSON.stringify(grandchildPidFile)}, String(grand.pid));`,
			'process.stdout.write("server started\\n");',
			// Server itself never exits and ignores nothing — it just runs.
			"setInterval(() => {}, 1000);",
		].join("\n"),
	);
	const result = runHelper({ serverJs, input: "{}", timeoutMs: 800, retries: 0 });
	assert.equal(result.status, 2, "permanent timeout failure exits 2");
	assert.match(result.stderr, /did not respond within 800ms/);
	const grandPid = Number(fs.readFileSync(grandchildPidFile, "utf8"));
	assert.ok(Number.isInteger(grandPid) && grandPid > 1, `grandchild pid recorded (${grandPid})`);
	// give the tree kill a moment, then the grandchild must be dead
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline && isAlive(grandPid)) {
		// wait
	}
	assert.equal(
		isAlive(grandPid),
		false,
		"grandchild must not survive the helper's process-tree kill",
	);
});

// ── Permanent failure fails fast with a diagnostic ───────────

test("helper reports a server that exits non-zero with a clear diagnostic", () => {
	const dir = mkDir("boom");
	const serverJs = path.join(dir, "server.js");
	fs.writeFileSync(
		serverJs,
		'"use strict";\nconsole.error("server exploded");\nprocess.exit(7);\n',
	);
	const result = runHelper({ serverJs, input: "{}", retries: 0 });
	assert.equal(result.status, 2);
	assert.match(result.stderr, /server exploded/);
	assert.match(result.stderr, /exited with code 7/);
});
