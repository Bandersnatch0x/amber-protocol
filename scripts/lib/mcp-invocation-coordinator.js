"use strict";

const Ajv = require("ajv");
const { resolveTargetOverride } = require("./mcp-targets");
const actionRuntime = require("./mcp-action-runtime");

function createInvocationCoordinator({
	configured,
	flags,
	actionMap,
	functionMap,
	functionRuntime,
	actionSchema,
	functionSchema,
	root,
	amberJs,
}) {
	const functionCache = new Map();
	const ajv = new Ajv({ allErrors: true });
	// F: memoize compiled validators — action/function schemas are stable per
	// tool, so recompiling on every tools/call RPC is pure codegen waste under
	// burst load. Keyed by the tool name the schema was built for.
	const validatorCache = new Map();
	const validate = (schema, input, toolName) => {
		let checker = validatorCache.get(toolName);
		if (!checker) {
			checker = ajv.compile(schema);
			validatorCache.set(toolName, checker);
		}
		if (checker(input)) return null;
		return `invalid arguments for ${toolName}: ${checker.errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")}`;
	};
	const resolveTarget = (input) => {
		if (input._target === undefined || input._target === null || input._target === "") return null;
		return resolveTargetOverride({ override: input._target, configured, cwd: process.cwd() });
	};
	const invokeFunction = (fn, input, target) => {
		const cacheKey = `${fn.name}|${target || configured.primary}|${configured.targets.join(",")}|${JSON.stringify({ ...input, _target: undefined, _agent: undefined })}`;
		const hit = flags.cacheTtlMs > 0 && functionCache.get(cacheKey);
		if (hit && Date.now() - hit.at < flags.cacheTtlMs)
			return {
				executed: true,
				function: fn.name,
				target: target || configured.primary,
				cached: true,
				data: hit.data,
			};
		try {
			const data = functionRuntime.invoke(
				fn.name,
				{ ...input, _target: undefined, _agent: undefined },
				target,
			);
			if (flags.cacheTtlMs > 0) functionCache.set(cacheKey, { data, at: Date.now() });
			return {
				executed: true,
				function: fn.name,
				target: target || configured.primary,
				cached: false,
				data,
			};
		} catch (error) {
			return {
				executed: false,
				function: fn.name,
				target: target || configured.primary,
				cached: false,
				error: error.message,
			};
		}
	};
	return {
		invoke(toolName, input) {
			const action = actionMap.get(toolName);
			const fn = functionMap.get(toolName);
			if (!action && !fn) return { kind: "unknown", error: `unknown tool: ${toolName}` };
			const invalid = validate(fn ? functionSchema(fn) : actionSchema(action), input, toolName);
			if (invalid) return { kind: "invalid", error: invalid };
			let target;
			try {
				target = resolveTarget(input);
			} catch (error) {
				return { kind: "invalid", error: error.message };
			}
			if (fn) {
				const outcome = invokeFunction(fn, input, target);
				return {
					kind: "function",
					outcome,
					structuredContent: outcome.error ? undefined : outcome.data,
					isError: Boolean(outcome.error),
				};
			}
			let outcome;
			try {
				outcome = actionRuntime.runAction(action, input, flags, configured, target, root, amberJs);
			} catch (error) {
				outcome = {
					executed: false,
					dryRun: false,
					approvalRequired: false,
					error: error.message,
					...(error.conflict ? { conflict: error.conflict } : {}),
				};
			}
			return {
				kind: "action",
				outcome,
				structuredContent: outcome.executed ? actionRuntime.extractJson(outcome.stdout) : undefined,
				isError: actionRuntime.isErrorOutcome(outcome),
			};
		},
	};
}

module.exports = { createInvocationCoordinator };
