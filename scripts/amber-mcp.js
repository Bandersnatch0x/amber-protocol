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

const path = require("node:path");
const readline = require("node:readline");
const { buildConfiguredTargets } = require("./lib/mcp-targets");
const { validateWhitelist } = require("./lib/mcp-action-contracts");
const { loadActionTypes, loadFunctions } = require("./lib/mcp-registry-loader");
const { createFunctionRuntime } = require("./lib/mcp-functions");
const { createInvocationCoordinator } = require("./lib/mcp-invocation-coordinator");

const ROOT = path.resolve(__dirname, "..");
const AMBER_JS = path.join(ROOT, "scripts", "amber.js");
const SCHEMA_PATH = path.join(ROOT, "schemas", "action.type.schema.json");
const ACTION_TYPES_DIR = path.join(ROOT, "action-types");
const ACTION_FUNCTIONS_DIR = path.join(ROOT, "action-functions");

const SERVER_INFO = { name: "amber-mcp", version: "0.7.0" };
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
	const execution = action.execution;
	const variantRequirements = execution?.variants
		? Object.entries(execution.variants)
				.map(([variant, mapping]) => ({
					variant,
					required: (mapping.args || [])
						.filter((argument) => argument.source && !argument.optional)
						.map((argument) => argument.source.replace(/^parameters\./, ""))
						.filter((parameter) => parameter !== execution.variantParam),
				}))
				.filter(({ required }) => required.length > 0)
		: [];
	const requiredByVariant = new Set(variantRequirements.flatMap(({ required }) => required));
	const properties = {};
	const required = [];
	for (const [key, def] of Object.entries(action.parameters || {})) {
		const prop = { type: def.type };
		if (def.description) prop.description = def.description;
		if (def.enum) prop.enum = def.enum;
		if (def.pattern) prop.pattern = def.pattern;
		else if ((def.required || requiredByVariant.has(key)) && def.type === "string")
			prop.pattern = "\\S";
		if (def.type === "array") prop.items = { type: "string" };
		properties[key] = prop;
		if (def.required) required.push(key);
	}
	const schema = injectReservedParams({
		type: "object",
		properties,
		required,
		additionalProperties: false,
	});
	if (variantRequirements.length > 0) {
		schema.allOf = variantRequirements.map(({ variant, required: variantRequired }) => ({
			if: {
				properties: { [execution.variantParam]: { const: variant } },
				required: [execution.variantParam],
			},
			then: { required: [...new Set(variantRequired)] },
		}));
	}
	return schema;
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
const functionRuntime = createFunctionRuntime({ configured, definitions: functions });
const allTools = [...actions.map(toTool), ...functions.map(toFunctionTool)];
const invocationCoordinator = createInvocationCoordinator({
	configured,
	flags,
	actionMap,
	functionMap,
	functionRuntime,
	actionSchema: toInputSchema,
	functionSchema: toFunctionInputSchema,
	root: ROOT,
	amberJs: AMBER_JS,
});

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

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
		const invocation = invocationCoordinator.invoke(toolName, input);
		if (invocation.kind === "unknown" || invocation.kind === "invalid") {
			return jsonError(id, -32602, invocation.error);
		}
		const coordinatedOutcome = invocation.outcome;
		const coordinatedResult = {
			content: [{ type: "text", text: JSON.stringify(coordinatedOutcome, null, 2) }],
			isError: invocation.isError,
		};
		// dsh MCP client requires structuredContent to be an object (not null)
		// when outputSchema is declared. Set to {} when absent.
		coordinatedResult.structuredContent = invocation.structuredContent ?? {};
		return jsonResult(id, coordinatedResult);
	}

	return jsonError(id, -32601, `method not found: ${method}`);
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
	handleRequest,
};
