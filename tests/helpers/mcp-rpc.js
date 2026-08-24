#!/usr/bin/env node
"use strict";

// RPC driver for the Amber Ontology MCP server (stdio JSON-RPC 2.0).
//
// The integration tests used to spawnSync the server directly with a fixed
// 120s timeout. Under the full test suite's parallel load (262 test files,
// node --test runs ~19 at a time), a single spawn could exceed 120s, and
// spawnSync's timeout kills only the DIRECT child: the MCP server itself
// spawnSyncs `amber` for action calls, and a surviving grandchild holds the
// inherited stdout pipe, so spawnSync blocks far beyond its timeout (one
// observed hang: 990s). See the amber-mcp integration flake.
//
// This helper fixes the class:
//   * async spawn with a wall-clock timeout that KILLS THE WHOLE PROCESS TREE
//     (taskkill /T on Windows, negative-pid kill on POSIX) so no grandchild
//     can outlive the timeout and pin the pipe;
//   * transient failures (spawn error, timeout) are retried (default 2) so a
//     single CPU-starved attempt is absorbed;
//   * permanent failures exit non-zero with a clear diagnostic instead of
//     hanging or asserting on an empty message.
//
// Usage: node tests/helpers/mcp-rpc.js [server args...] < request-lines
//   stdout = the server's stdout (JSON-RPC responses) on success
//   exit 0 = server responded; exit 2 = permanent failure (stderr explains)
// Env: MCP_RPC_TIMEOUT_MS (default 120000), MCP_RPC_RETRIES (default 2)

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const MCP_JS = process.env.MCP_SERVER_JS || path.join(ROOT, "scripts", "amber-mcp.js");
const TIMEOUT_MS = Number(process.env.MCP_RPC_TIMEOUT_MS || 120_000);
const RETRIES = Number(process.env.MCP_RPC_RETRIES || 2);

/**
 * Best-effort kill of a process and its whole descendant tree.
 * @param {number} pid - Process id.
 */
function killTree(pid) {
	if (!pid) return;
	try {
		if (process.platform === "win32") {
			spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
		} else {
			// negative pid signals the process group (the server is spawned
			// detached so it leads its own group)
			process.kill(-pid, "SIGKILL");
		}
	} catch {
		// best effort — the caller still fails fast either way
	}
}

/**
 * Run the server once with the given input and server args.
 * @param {string} input - Newline-delimited JSON-RPC request lines.
 * @param {string[]} serverArgs - Extra args for the server.
 * @returns {Promise<{ok: boolean, stdout: string, transient: boolean, reason: string}>}
 */
function runOnce(input, serverArgs) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [MCP_JS, ...serverArgs], {
			cwd: ROOT,
			detached: process.platform !== "win32",
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const timer = setTimeout(() => {
			killTree(child.pid);
			finish({
				ok: false,
				stdout,
				transient: true,
				reason: `server did not respond within ${TIMEOUT_MS}ms (process tree killed)`,
			});
		}, TIMEOUT_MS);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (err) => {
			finish({ ok: false, stdout, transient: true, reason: `spawn failed: ${err.message}` });
		});
		child.on("close", (code, signal) => {
			if (code === 0) {
				finish({ ok: true, stdout, transient: false, reason: "" });
			} else {
				finish({
					ok: false,
					stdout,
					transient: false,
					reason: `server exited ${code === null ? `via ${signal}` : `with code ${code}`}: ${stderr.trim()}`,
				});
			}
		});
		child.stdin.end(input);
	});
}

async function main() {
	const serverArgs = process.argv.slice(2);
	const input = fs.readFileSync(0, "utf8");
	let last = null;
	for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
		const result = await runOnce(input, serverArgs);
		if (result.ok) {
			process.stdout.write(result.stdout);
			process.exit(0);
		}
		last = result;
		if (!result.transient) break;
	}
	console.error(`MCP RPC failed after ${RETRIES + 1} attempt(s): ${last.reason}`);
	process.exit(2);
}

main();
