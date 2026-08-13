"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { resolveRepoPath } = require("./mcp-targets");
const { readSessionsForConcurrency } = require("./session-manifest");
const {
	resolveCapability,
	bindsWriteFlag,
	isReadOnlyExecutable,
} = require("./mcp-action-contracts");

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

function resolveExecution(action, parameters) {
	const ex = action.execution;
	if (ex.variants) {
		const variant = parameters[ex.variantParam];
		if (!variant || !ex.variants[variant])
			throw new Error(`unknown ${ex.variantParam}: ${variant}`);
		return ex.variants[variant];
	}
	return ex;
}

function buildCommand(action, parameters) {
	const mapping = resolveExecution(action, parameters);
	const positional = [];
	const flags = [];
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
			} else positional[tmpl.position] = tmpl.value;
			continue;
		}
		if (tmpl.flagOnly) {
			flags.push(tmpl.flag);
			continue;
		}
		if (tmpl.source) {
			const key = tmpl.source.replace(/^parameters\./, "");
			const value = parameters[key];
			if (value === undefined || value === null) {
				if (tmpl.optional) continue;
				throw new Error(`missing required parameter: ${key}`);
			}
			flags.push(tmpl.flag, String(value));
		} else flags.push(tmpl.flag, tmpl.value);
	}
	return [mapping.command, mapping.subcommand, ...positional, ...flags];
}

function listActiveSessions(target) {
	const sessionsDir = resolveRepoPath(target, path.join(".amber", "sessions"));
	return readSessionsForConcurrency(sessionsDir, (name) =>
		resolveRepoPath(target, path.join(".amber", "sessions", name)),
	);
}

function concurrencyGuard(target, parameters) {
	const { active, corrupt } = listActiveSessions(target);
	if (corrupt.length > 0) {
		const err = new Error(
			`corrupt session manifest prevents the concurrency check: ${corrupt.map((c) => c.sessionId).join(", ")}. Refusing to proceed (fail-closed).`,
		);
		err.code = "CORRUPT_GOVERNANCE_STATE";
		err.conflict = {
			activeSessions: active.map((s) => s.sessionId),
			owners: Object.fromEntries(active.map((s) => [s.sessionId, s.agentId])),
			corrupt: corrupt.map((c) => c.sessionId),
		};
		throw err;
	}
	const mySession = parameters.sessionId || parameters.id;
	const other = active.filter((s) => s.sessionId !== mySession);
	if (other.length === 0) return { conflict: null };
	return {
		conflict: {
			activeSessions: other.map((s) => s.sessionId),
			owners: Object.fromEntries(other.map((s) => [s.sessionId, s.agentId])),
		},
	};
}

function selectedVariantIsReadOnlyExec(action, parameters) {
	if (!isReadOnlyExecutable(action)) return false;
	const resolved = resolveCapability(action, parameters);
	return Boolean(
		resolved.capability &&
		resolved.capability.effect === "read" &&
		resolved.capability.directReadOnlyExec &&
		!bindsWriteFlag(resolved),
	);
}

function runAction(action, parameters, flags, configured, targetOverride, root, amberJs) {
	const target = targetOverride || configured.primary;
	const argv = buildCommand(action, parameters);
	const command = `amber ${argv.join(" ")} --target ${target}`;
	const attribution = parameters._agent ? { agent: parameters._agent } : {};
	const resolved = resolveCapability(action, parameters);
	if (!resolved.capability)
		throw new Error(
			`action ${action.actionTypeId} maps to an unknown command (${resolved.key}) — registration contract broken`,
		);
	if (selectedVariantIsReadOnlyExec(action, parameters)) {
		const result = spawnSync(process.execPath, [amberJs, ...argv, "--target", target], {
			cwd: root,
			encoding: "utf8",
			timeout: (action.timeout || 60) * 1000,
		});
		return {
			executed: true,
			dryRun: false,
			approvalRequired: false,
			command,
			exitCode: result.status,
			signal: result.signal || undefined,
			error: result.error ? result.error.message : undefined,
			stdout: (result.stdout || "").trim(),
			stderr: (result.stderr || "").trim(),
			...attribution,
		};
	}
	const guard = concurrencyGuard(target, parameters);
	if (guard.conflict)
		return {
			executed: false,
			dryRun: false,
			approvalRequired: false,
			conflict: guard.conflict,
			command,
			hint: "Repository already has an active session. One active session per repository: wait for completion or abort before mutating.",
			...attribution,
		};
	return {
		executed: false,
		dryRun: false,
		approvalRequired: true,
		command,
		hint: "Action requires human approval. Run the rendered command in an interactive terminal, then record the outcome.",
		...attribution,
	};
}

function isErrorOutcome(outcome) {
	if (outcome.executed)
		return outcome.exitCode !== 0 || Boolean(outcome.signal) || Boolean(outcome.error);
	return Boolean(outcome.error);
}

module.exports = {
	extractJson,
	buildCommand,
	listActiveSessions,
	concurrencyGuard,
	selectedVariantIsReadOnlyExec,
	runAction,
	isErrorOutcome,
};
