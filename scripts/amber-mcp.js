#!/usr/bin/env node
"use strict";

// Amber Ontology MCP server (P1): exposes the Amber governance surface as
// typed, governed tools over the Model Context Protocol (stdio transport,
// newline-delimited JSON-RPC 2.0).
//
// Design reference: docs/wiki/amber-ontology-mcp.md
// Repair baseline: docs/plans/F018-Amber-MCP.md
//
// Safety model (F018 invariants, enforced in one place each):
//   * Configured repository invariant — every Action and Function operates
//     only on the canonical real path of a repository configured at startup.
//     `_target` resolves to an exact configured member (mcp-targets.js).
//   * Read-only invariant — an operation executes without approval ONLY when
//     its complete parameterized behavior is registry-proven read-only
//     (mcp-action-contracts.js). No write-capable flag may hide behind a
//     read-only declaration.
//   * Governed execution invariant — the adapter NEVER directly executes a
//     mutating Action. Mutation is returned as an approval-required
//     submission; a four-gate governed runner adapter would be required to
//     change that (none exists in this repair).
//   * Contract parity invariant — every Action Type's mode, effects,
//     approver, evidence, and command mapping are validated against the
//     capability registry at startup; a mismatch fails closed.
//   * Fail-closed invariant — corrupt governance state, unknown capabilities,
//     non-zero / signalled / timed-out command results, and contract failures
//     are MCP errors (isError: true), never empty/success states. Valid empty
//     queries return exit 0.
//   * Protocol truth invariant — unknown tools, docs, and tests agree on the
//     MCP-native JSON-RPC error shape.

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { spawnSync } = require("node:child_process");
const Ajv = require("ajv");

const {
	buildConfiguredTargets,
	resolveTargetOverride,
	resolveConfiguredRepoPath,
	resolveRepoPath,
} = require("./lib/mcp-targets");
const {
	resolveCapability,
	bindsWriteFlag,
	isReadOnlyExecutable,
	validateWhitelist,
} = require("./lib/mcp-action-contracts");
const { loadActionTypes, loadFunctions } = require("./lib/mcp-registry-loader");

const ROOT = path.resolve(__dirname, "..");
const AMBER_JS = path.join(ROOT, "scripts", "amber.js");
const SCHEMA_PATH = path.join(ROOT, "schemas", "action.type.schema.json");
const ACTION_TYPES_DIR = path.join(ROOT, "action-types");
const ACTION_FUNCTIONS_DIR = path.join(ROOT, "action-functions");

const ACTIVE_SESSION_STATUSES = new Set(["created", "routed", "executing", "paused"]);

const SERVER_INFO = { name: "amber-mcp", version: "0.3.0" };
const KNOWN_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

// ---- argument parsing ---------------------------------------------------

// Fail-closed configuration: every dash-prefixed token must be a known option.
// An unknown option exits 2 with a clear message instead of being silently
// ignored (which would let a misconfigured server start with the wrong intent).
const VALUE_FLAGS = new Set(["--target", "--targets", "--cache-ttl-ms"]);
const BOOLEAN_FLAGS = new Set(["--execute", "--no-cache", "--help", "-h"]);

function parseArgs(argv) {
	const flags = {
		target: process.cwd(),
		targets: [],
		execute: false,
		help: false,
		cacheTtlMs: 5000,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg.startsWith("-") && !VALUE_FLAGS.has(arg) && !BOOLEAN_FLAGS.has(arg)) {
			console.error(`unknown option: ${arg}`);
			process.exit(2);
		}
		if (arg === "--execute") flags.execute = true;
		else if (arg === "--no-cache") flags.cacheTtlMs = 0;
		else if (arg === "--help" || arg === "-h") flags.help = true;
		else if (arg === "--target") {
			i += 1;
			if (i >= argv.length) {
				console.error("--target requires a path");
				process.exit(2);
			}
			flags.target = path.resolve(argv[i]);
		} else if (arg === "--targets") {
			i += 1;
			if (i >= argv.length) {
				console.error("--targets requires a comma-separated path list");
				process.exit(2);
			}
			flags.targets = argv[i]
				.split(",")
				.map((p) => p.trim())
				.filter(Boolean)
				.map((p) => path.resolve(p));
		} else if (arg === "--cache-ttl-ms") {
			i += 1;
			if (i >= argv.length || !/^\d+$/.test(argv[i])) {
				console.error("--cache-ttl-ms requires a positive integer");
				process.exit(2);
			}
			flags.cacheTtlMs = parseInt(argv[i], 10);
		}
	}
	return flags;
}

// Derive the MCP tool input schema from the action type's parameter map.
// Protocol-level reserved parameters injected into every tool's input schema:
//   _target — per-call repository override, must resolve to a CONFIGURED repo
//   _agent  — identity used for attribution and the one-active-session guard
function injectReservedParams(schema) {
	const properties = { ...(schema.properties || {}) };
	properties._target = {
		type: "string",
		description:
			"Optional repository path override. Must resolve (relative to the server cwd) to a repository configured at startup via --target/--targets; otherwise rejected with JSON-RPC -32602.",
	};
	properties._agent = {
		type: "string",
		description:
			"Optional agent identity, recorded for attribution and concurrency guard diagnostics.",
	};
	return { ...schema, properties };
}

function toInputSchema(action) {
	const properties = {};
	const required = [];
	for (const [key, def] of Object.entries(action.parameters || {})) {
		const prop = { type: def.type };
		if (def.description) prop.description = def.description;
		if (def.enum) prop.enum = def.enum;
		if (def.type === "array") prop.items = { type: "string" };
		properties[key] = prop;
		if (def.required) required.push(key);
	}
	return injectReservedParams({
		type: "object",
		properties,
		required,
		additionalProperties: false,
	});
}

function toFunctionInputSchema(fn) {
	return injectReservedParams(fn.inputSchema || { type: "object", properties: {} });
}

function toOutputSchema() {
	return {
		type: "object",
		description:
			"Structured outcome: executed/dryRun/approvalRequired flags, rendered command, exitCode, and stdout parsed as JSON when possible. isError is true for every non-zero exit, signal, timeout, spawn failure, contract failure, and governance-state read failure.",
		additionalProperties: true,
	};
}

function toTool(action) {
	const approver = (action.governance.approver || []).join("/");
	return {
		name: action.actionTypeId,
		description: `${action.goal} Mode: ${action.mode}. Approver: ${approver}.`,
		inputSchema: toInputSchema(action),
		outputSchema: toOutputSchema(),
	};
}

function toFunctionTool(fn) {
	return {
		name: fn.name,
		description: `${fn.description} Function (in-process, read-only).`,
		inputSchema: toFunctionInputSchema(fn),
		outputSchema: toOutputSchema(),
	};
}

// Extract the first JSON value from a possibly-mixed stdout buffer
// (CLI JSON output followed by diagnostics). Returns null when absent.
function extractJson(text) {
	const trimmed = (text || "").trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start === -1 || end === -1 || end <= start) return null;
		try {
			return JSON.parse(trimmed.slice(start, end + 1));
		} catch {
			return null;
		}
	}
}

// Resolve the effective command mapping: a plain command/subcommand pair, or
// the variant selected by the submitted parameters (e.g. objectType).
function resolveExecution(action, parameters) {
	const ex = action.execution;
	if (ex.variants) {
		const variant = parameters[ex.variantParam];
		if (!variant || !ex.variants[variant]) {
			throw new Error(`unknown ${ex.variantParam}: ${variant}`);
		}
		return ex.variants[variant];
	}
	return ex;
}

// Build the rendered CLI invocation for an action, applying argument
// templates against the submitted parameters.
function buildCommand(action, parameters) {
	const mapping = resolveExecution(action, parameters);
	const positional = [];
	const flagArgs = [];
	for (const tmpl of mapping.args || []) {
		if (tmpl.position !== undefined) {
			if (tmpl.source) {
				const key = tmpl.source.replace(/^parameters\./, "");
				const value = parameters[key];
				if (value === undefined || value === null) {
					if (tmpl.optional) continue;
					throw new Error(`missing required parameter: ${key}`);
				}
				positional[tmpl.position] = String(value);
			} else {
				positional[tmpl.position] = tmpl.value;
			}
			continue;
		}
		if (tmpl.flagOnly) {
			flagArgs.push(tmpl.flag);
			continue;
		}
		if (tmpl.source) {
			const key = tmpl.source.replace(/^parameters\./, "");
			const value = parameters[key];
			if (value === undefined || value === null) {
				if (tmpl.optional) continue;
				throw new Error(`missing required parameter: ${key}`);
			}
			flagArgs.push(tmpl.flag, String(value));
		} else {
			flagArgs.push(tmpl.flag, tmpl.value);
		}
	}
	return [mapping.command, mapping.subcommand, ...positional, ...flagArgs];
}

// ---- concurrency guard --------------------------------------------------

// Enumerate active sessions for the one-active-session-per-repository guard.
// Returns { active, corrupt }. Corrupt manifests are reported (not silently
// ignored) so the decision gate can fail closed while preserving ownership
// information for valid sessions.
function listActiveSessions(target) {
	// Resolve the sessions directory through real-path-aware containment so a
	// symlink/Windows junction inside the repo (e.g. `.amber` -> outside) cannot
	// make the guard read governance state from outside the configured repo.
	// resolveRepoPath throws (-> isError) on escape; the message propagates as-is.
	const sessionsDir = resolveRepoPath(target, path.join(".amber", "sessions"));
	if (!fs.existsSync(sessionsDir)) return { active: [], corrupt: [] };
	const active = [];
	const corrupt = [];
	for (const name of fs.readdirSync(sessionsDir).sort()) {
		const manifestPath = path.join(sessionsDir, name, "manifest.json");
		if (!fs.existsSync(manifestPath)) continue;
		let manifest;
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		} catch {
			corrupt.push({ sessionId: name });
			continue;
		}
		if (ACTIVE_SESSION_STATUSES.has(manifest.status)) {
			active.push({ sessionId: name, agentId: manifest.agentId || null });
		}
	}
	return { active, corrupt };
}

// Concurrency guard for mutating actions. Throws a fail-closed error when any
// active-session manifest is unreadable; returns { conflict } when another
// session is active; otherwise { conflict: null }.
function concurrencyGuard(target, parameters) {
	const { active, corrupt } = listActiveSessions(target);
	if (corrupt.length > 0) {
		const owners = {};
		for (const s of active) owners[s.sessionId] = s.agentId;
		const err = new Error(
			`corrupt session manifest prevents the concurrency check: ${corrupt
				.map((c) => c.sessionId)
				.join(", ")}. Refusing to proceed (fail-closed).`,
		);
		err.code = "CORRUPT_GOVERNANCE_STATE";
		err.conflict = {
			activeSessions: active.map((s) => s.sessionId),
			owners,
			corrupt: corrupt.map((c) => c.sessionId),
		};
		throw err;
	}
	const mySession = parameters.sessionId || parameters.id;
	const otherActive = active.filter((s) => s.sessionId !== mySession);
	if (otherActive.length > 0) {
		const owners = {};
		for (const s of otherActive) owners[s.sessionId] = s.agentId;
		return {
			conflict: {
				activeSessions: otherActive.map((s) => s.sessionId),
				owners,
			},
		};
	}
	return { conflict: null };
}

// ---- action execution ---------------------------------------------------

// Decide whether the SELECTED variant of an action may execute directly as a
// read-only operation: registry-proven read + directReadOnlyExec + no
// write-capable flag bound by the rendered invocation.
function selectedVariantIsReadOnlyExec(action, parameters) {
	if (!isReadOnlyExecutable(action)) return false;
	const resolved = resolveCapability(action, parameters);
	if (!resolved.capability) return false;
	if (resolved.capability.effect !== "read" || !resolved.capability.directReadOnlyExec)
		return false;
	return !bindsWriteFlag(resolved);
}

function runAction(action, parameters, flags, configured, targetOverride) {
	const target = targetOverride || configured.primary;
	const argv = buildCommand(action, parameters);
	const commandLine = `amber ${argv.join(" ")} --target ${target}`;
	const attribution = parameters._agent ? { agent: parameters._agent } : {};

	// Resolve the selected variant's capability (fail-closed on unknown).
	const resolved = resolveCapability(action, parameters);
	if (!resolved.capability) {
		throw new Error(
			`action ${action.actionTypeId} maps to an unknown command (${resolved.key}) — registration contract broken`,
		);
	}

	// Read-only path: registry-proven read variants execute directly. They
	// cannot mutate the target, so the concurrency guard does not apply.
	if (selectedVariantIsReadOnlyExec(action, parameters)) {
		const result = spawnSync(process.execPath, [AMBER_JS, ...argv, "--target", target], {
			cwd: ROOT,
			encoding: "utf8",
			timeout: (action.timeout || 60) * 1000,
		});
		return {
			executed: true,
			dryRun: false,
			approvalRequired: false,
			command: commandLine,
			exitCode: result.status,
			signal: result.signal || undefined,
			error: result.error ? result.error.message : undefined,
			stdout: (result.stdout || "").trim(),
			stderr: (result.stderr || "").trim(),
			...attribution,
		};
	}

	// Mutation / interactive path: NEVER spawn. Run the concurrency guard
	// first (fail-closed on corrupt governance state), then return the
	// submission as approval-required. The adapter does not spawn mutations
	// regardless of --execute; a four-gate governed runner adapter would be
	// required to change that (none exists in this repair).
	const guard = concurrencyGuard(target, parameters);
	if (guard.conflict) {
		return {
			executed: false,
			dryRun: false,
			approvalRequired: false,
			conflict: guard.conflict,
			command: commandLine,
			hint: "Repository already has an active session. One active session per repository: wait for completion or abort before mutating.",
			...attribution,
		};
	}

	return {
		executed: false,
		dryRun: false,
		approvalRequired: true,
		command: commandLine,
		hint: "Action requires human approval. Run the rendered command in an interactive terminal, then record the outcome.",
		...attribution,
	};
}

// ---- JSON-RPC plumbing --------------------------------------------------

function jsonError(id, code, message) {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

function jsonResult(id, result) {
	return { jsonrpc: "2.0", id, result };
}

// ---- server loop --------------------------------------------------------

const flags = parseArgs(process.argv.slice(2));

if (flags.help) {
	console.log(
		[
			"Usage: node scripts/amber-mcp.js [--target <dir>] [--targets <a,b,c>] [--execute]",
			"",
			"stdio MCP server exposing Amber governance as typed tools (F018 governance repair).",
			"",
			"  --target <dir>   Primary repository to govern (default: cwd).",
			"  --targets <list> Additional repositories for the cross-repo view",
			"                   (amber.fn.repoOverview) and _target overrides.",
			"  --execute        Acknowledge execution intent. Read-only queries always",
			"                   run; mutating actions are STILL approval-required (the",
			"                   adapter never spawns a mutation without a four-gate",
			"                   governed runner adapter, which does not exist).",
			"  --cache-ttl-ms N Function result cache TTL in ms (default 5000;",
			"                   0/--no-cache disables).",
			"",
			"Protocol: newline-delimited JSON-RPC 2.0. Methods: initialize,",
			"tools/list, tools/call, ping.",
		].join("\n"),
	);
	process.exit(0);
}

// Startup: canonicalize the configured repository set (fail-closed) and
// validate every Action Type against the capability registry.
let configured;
try {
	configured = buildConfiguredTargets({ primary: flags.target, extras: flags.targets });
} catch (err) {
	console.error(`fatal: ${err.message}`);
	process.exit(2);
}

let actions;
let functions;
try {
	actions = loadActionTypes({ directory: ACTION_TYPES_DIR, schemaPath: SCHEMA_PATH });
	const contractCheck = validateWhitelist(actions);
	if (!contractCheck.valid) {
		throw new Error(
			`action contract parity check failed:\n  - ${contractCheck.findings.join("\n  - ")}`,
		);
	}
	functions = loadFunctions({ directory: ACTION_FUNCTIONS_DIR });
} catch (err) {
	console.error(`fatal: ${err.message}`);
	process.exit(2);
}

const actionMap = new Map(actions.map((a) => [a.actionTypeId, a]));
const functionMap = new Map(functions.map((f) => [f.name, f]));
const allTools = [...actions.map(toTool), ...functions.map(toFunctionTool)];

// In-process result cache for read-only Functions (TTL-bounded; see
// --cache-ttl-ms / --no-cache). Keyed by function, canonical repository set,
// and input so per-repo results never cross-contaminate.
const functionCache = new Map();

// Read-only file context handed to Function handlers. All paths resolve
// through resolveRepoPath (real-path-aware containment): no shell, no
// execution, no symlink/junction/`..` escape from a configured repository.
function makeFunctionContext(configured, targetOverride) {
	const target = targetOverride || configured.primary;
	const targets = [target, ...configured.targets.filter((t) => t !== target)];
	const resolvePath = (relativePath, requestedTarget) =>
		resolveConfiguredRepoPath({
			configured,
			target: requestedTarget || target,
			relativePath,
		});
	return { target, targets, resolvePath };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

// Resolve a per-call _target override against the configured set for either an
// action or a function. Returns the canonical target, or null when no override
// was supplied. Throws (-> JSON-RPC -32602) on escape / unknown repo.
function resolveCallTarget(input) {
	if (input._target === undefined || input._target === null || input._target === "") return null;
	try {
		return resolveTargetOverride({ override: input._target, configured, cwd: process.cwd() });
	} catch (err) {
		const e = new Error(err.message);
		e.rpcCode = -32602;
		throw e;
	}
}

function handleRequest(message) {
	const { id, method, params } = message;

	if (method === "initialize") {
		const requested = params && params.protocolVersion;
		const protocolVersion = KNOWN_VERSIONS.has(requested) ? requested : "2025-06-18";
		return jsonResult(id, {
			protocolVersion,
			capabilities: { tools: { listChanged: false } },
			serverInfo: SERVER_INFO,
		});
	}

	if (method === "ping") {
		return jsonResult(id, {});
	}

	if (method === "tools/list") {
		return jsonResult(id, { tools: allTools });
	}

	if (method === "tools/call") {
		const toolName = params && params.name;
		const input = (params && params.arguments) || {};
		const action = actionMap.get(toolName);

		// Function tools (amber.fn.*) run in-process against configured repos.
		if (!action) {
			const fn = functionMap.get(toolName);
			if (fn) {
				const ajv = new Ajv({ allErrors: true });
				const validate = ajv.compile(toFunctionInputSchema(fn));
				if (!validate(input)) {
					const details = validate.errors
						.map((e) => `${e.instancePath || "/"} ${e.message}`)
						.join("; ");
					return jsonError(id, -32602, `invalid arguments for ${toolName}: ${details}`);
				}

				let targetOverride;
				try {
					targetOverride = resolveCallTarget(input);
				} catch (err) {
					return jsonError(id, err.rpcCode || -32602, err.message);
				}

				let data;
				let error;
				let cached = false;
				const cacheKey =
					`${fn.name}|${targetOverride || configured.primary}|${configured.targets.join(",")}|` +
					JSON.stringify({ ...input, _target: undefined, _agent: undefined });
				const hit = flags.cacheTtlMs > 0 && functionCache.get(cacheKey);
				if (hit && Date.now() - hit.at < flags.cacheTtlMs) {
					data = hit.data;
					cached = true;
				} else {
					try {
						data = fn.handler(
							{ ...input, _target: undefined, _agent: undefined },
							makeFunctionContext(configured, targetOverride),
						);
					} catch (err) {
						error = err.message;
					}
					if (!error && flags.cacheTtlMs > 0) {
						functionCache.set(cacheKey, { data, at: Date.now() });
					}
				}
				const outcome = {
					executed: !error,
					function: fn.name,
					target: targetOverride || configured.primary,
					cached,
					error,
					data: error ? undefined : data,
				};
				const result = {
					content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
					isError: Boolean(error),
				};
				if (!error && data && typeof data === "object") {
					result.structuredContent = data;
				}
				return jsonResult(id, result);
			}
			// Unknown tool — MCP-native JSON-RPC error shape (canonical).
			return jsonError(id, -32602, `unknown tool: ${toolName}`);
		}

		const ajv = new Ajv({ allErrors: true });
		const validate = ajv.compile(toInputSchema(action));
		if (!validate(input)) {
			const details = validate.errors
				.map((e) => `${e.instancePath || "/"} ${e.message}`)
				.join("; ");
			return jsonError(id, -32602, `invalid arguments for ${toolName}: ${details}`);
		}

		let targetOverride;
		try {
			targetOverride = resolveCallTarget(input);
		} catch (err) {
			return jsonError(id, err.rpcCode || -32602, err.message);
		}

		let outcome;
		try {
			outcome = runAction(action, input, flags, configured, targetOverride);
		} catch (err) {
			// Fail-closed: contract failure, corrupt governance state, or a
			// command-rendering failure is an MCP error, never a silent success.
			outcome = {
				executed: false,
				dryRun: false,
				approvalRequired: false,
				error: err.message,
				...(err.conflict ? { conflict: err.conflict } : {}),
			};
		}

		// Structured return (OAG): when the executed command emitted JSON, ship
		// it as MCP structuredContent so agents consume typed data, not text.
		const structured = outcome.executed ? extractJson(outcome.stdout) : undefined;
		const result = {
			content: [{ type: "text", text: JSON.stringify(outcome, null, 2) }],
			isError: isErrorOutcome(outcome),
		};
		if (structured !== null && structured !== undefined) result.structuredContent = structured;
		return jsonResult(id, result);
	}

	return jsonError(id, -32601, `method not found: ${method}`);
}

// Fail-closed isError classification (F018 Slice 5):
//   * executed read-only command -> error on any non-zero exit, signal, or
//     spawn error (no command-specific exceptions).
//   * non-executed outcome -> error only when an error field is present
//     (corrupt governance state, contract failure). dry-run, approval-
//     required, and structured conflicts are successful non-executions.
function isErrorOutcome(outcome) {
	if (outcome.executed) {
		return outcome.exitCode !== 0 || Boolean(outcome.signal) || Boolean(outcome.error);
	}
	return Boolean(outcome.error);
}

rl.on("line", (line) => {
	const trimmed = line.trim();
	if (!trimmed) return;

	let message;
	try {
		message = JSON.parse(trimmed);
	} catch {
		process.stdout.write(
			`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } })}\n`,
		);
		return;
	}

	if (message.id === undefined) {
		// JSON-RPC notification (e.g. notifications/initialized) — no reply.
		return;
	}

	const response = handleRequest(message);
	process.stdout.write(`${JSON.stringify(response)}\n`);
});

rl.on("close", () => {
	process.exit(0);
});

module.exports = {
	runAction,
	concurrencyGuard,
	listActiveSessions,
	selectedVariantIsReadOnlyExec,
	isErrorOutcome,
	buildCommand,
};
