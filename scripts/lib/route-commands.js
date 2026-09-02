"use strict";

const path = require("path");
const { loadRoutes, loadRouteFile } = require("./route-loader");
const { result } = require("./result");
const { appendLedgerRecord, verifyLedgerOutcome } = require("./core/loop-ledger");
const { runGovernedCommand } = require("./core/governed-runner");
const { codedError } = require("./core/error-catalog");
const { resolveRequestCapability } = require("./core/runner-registry");
const { resolveStateDirForCreate } = require("./state-dir-resolver");

const DEFAULT_ROUTES_DIR = path.join(__dirname, "../../routes");
const VERB_TARGET_PATTERN = /^([^@#\s]+)@([^@#\s]+)#([^@#\s]+)@([^@#\s]+)$/;
const VERB_TARGET_GRAMMAR = "runnerId@version#capability@version";

function findRoute(routeId, routesDir) {
	const { routes } = loadRoutes(routesDir);
	return routes.find((r) => r.routeId === routeId) || null;
}

function listRoutes(routesDir = DEFAULT_ROUTES_DIR) {
	const { routes } = loadRoutes(routesDir);
	if (routes.length === 0) {
		return result("No routes found.");
	}

	const lines = ["Available routes:"];
	for (const route of routes) {
		const version = route.version || "0.0.0";
		const description = route.description || "";
		lines.push(
			`  ${route.routeId} (v${version}) — ${Array.isArray(route.stages) ? route.stages.length : 0} stages — ${description}`,
		);
	}
	return result(lines.join("\n"));
}

function renderStageTree(route) {
	const gatesById = new Map((route.gates || []).map((g) => [g.id, g]));
	const lines = [];
	route.stages.forEach((stage, index) => {
		const branch = index === route.stages.length - 1 ? "└─" : "├─";
		lines.push(
			`  ${branch} ${stage.name} [${stage.type}${stage.target ? `: ${stage.target}` : ""}]`,
		);
		if (stage.gateAfter) {
			const gate = gatesById.get(stage.gateAfter);
			const gateType = gate ? gate.type : "unknown";
			lines.push(`       gate: ${stage.gateAfter} (${gateType})`);
		}
	});
	return lines.join("\n");
}

function inspectRoute(routeId, routesDir = DEFAULT_ROUTES_DIR) {
	const route = findRoute(routeId, routesDir);
	if (!route) {
		return result(`Route "${routeId}" not found.`, 1);
	}

	const { filePath: _filePath, ...clean } = route;
	const lines = [
		`Route: ${route.routeId}`,
		"",
		"Stage tree:",
		renderStageTree(route),
		"",
		"Full definition:",
		JSON.stringify(clean, null, 2),
	];
	return result(lines.join("\n"));
}

function validateRouteFile(filePath) {
	if (!filePath) {
		return result("route validate requires a file path.", 1);
	}

	const loadResult = loadRouteFile(filePath);
	if (loadResult.valid) {
		return result(`VALID: ${filePath}`);
	}

	const lines = [`INVALID: ${filePath}`, "Errors:"];
	for (const error of loadResult.errors) {
		lines.push(`  - ${error}`);
	}
	return result(lines.join("\n"), 1);
}

function testRoute(routeId, routesDir = DEFAULT_ROUTES_DIR) {
	const route = findRoute(routeId, routesDir);
	if (!route) {
		return result(`Route "${routeId}" not found.`, 1);
	}

	const lines = [`Dry-run for route: ${route.routeId}`, "Stage sequence:"];
	route.stages.forEach((stage, index) => {
		lines.push(`  ${index + 1}. ${stage.name} [${stage.type}]`);
		if (stage.gateAfter) {
			lines.push(`     >> GATE ${stage.gateAfter} fires after ${stage.name}`);
		}
	});
	lines.push("No execution performed (dry-run).");
	return result(lines.join("\n"));
}

// GLX Phase 3 — governed route-stage execution. A route `command` stage's target
// runs under the same four gates as a loop governed.command (policy, approval,
// worktree isolation, hash-chain ledger), recorded in a route-scoped ledger.
function routeLedgerPath(targetRoot, routeId) {
	return path.join(resolveStateDirForCreate(targetRoot), "routes", routeId, "ledger.jsonl");
}

function findStage(route, stageName) {
	return (route.stages || []).find((s) => s.name === stageName) || null;
}

/**
 * Parse the closed target grammar used by a route `verb` stage.
 *
 * The target is only a F052 capability pin.  It is deliberately not a
 * command-like string and is never passed to a shell.  Runner and capability
 * versions remain opaque here because F052 owns their validation rules.
 */
function parseVerbTarget(target) {
	if (typeof target !== "string" || target.length === 0 || target.trim() !== target) {
		return {
			ok: false,
			code: "AMBER_E_RUNNER_INVALID",
			errors: [`verb stage target must match ${VERB_TARGET_GRAMMAR}`],
		};
	}
	const match = VERB_TARGET_PATTERN.exec(target);
	if (!match) {
		return {
			ok: false,
			code: "AMBER_E_RUNNER_INVALID",
			errors: [`verb stage target must match ${VERB_TARGET_GRAMMAR}`],
		};
	}
	return {
		ok: true,
		code: null,
		errors: [],
		target,
		pin: {
			runnerId: match[1],
			runnerVersion: match[2],
			name: match[3],
			capabilityVersion: match[4],
		},
	};
}

/**
 * Resolve one route verb against the F052 registry.  This seam is shared by
 * route guards and `session run`; neither caller may substitute command text
 * or silently continue when the registry refuses the pin.
 */
function resolveVerbTarget(targetRoot, target) {
	const parsed = parseVerbTarget(target);
	if (!parsed.ok) return parsed;
	try {
		const resolved = resolveRequestCapability(targetRoot, parsed.pin);
		return { ...parsed, ...resolved };
	} catch (error) {
		return {
			...parsed,
			ok: false,
			code: error.amberCode || "AMBER_E_RUNNER_REGISTRY_CORRUPT",
			errors: [error.message || String(error)],
		};
	}
}

function verbResolutionFailure(routeId, stageName, resolution) {
	const message = resolution.errors?.[0] || `verb stage ${routeId}/${stageName} could not be resolved`;
	const error = resolution.code ? codedError(resolution.code, message) : message;
	return {
		text: error,
		errors: [error],
		exitCode: 1,
		code: resolution.code || "AMBER_E_RUNNER_INVALID",
	};
}

function approveRouteStage(
	routeId,
	stageName,
	targetRoot,
	reviewer,
	routesDir = DEFAULT_ROUTES_DIR,
) {
	const route = findRoute(routeId, routesDir);
	if (!route) return result(`Route "${routeId}" not found.`, 1);
	const stage = findStage(route, stageName);
	if (!stage) return result(`Stage "${stageName}" not found in route ${routeId}.`, 1);

	const lp = routeLedgerPath(targetRoot, routeId);
	const rec = appendLedgerRecord(lp, {
		schemaVersion: 2,
		kind: "approved",
		approvalState: "approved",
		approvalKey: `${routeId}:${stageName}`,
		routeId,
		stageName,
		reviewer: reviewer || "unknown",
		recordedAt: new Date().toISOString(),
		executesAnything: false,
	});
	return result(
		`Approved stage ${stageName} in ${routeId} (approvalKey ${rec.approvalKey}). ` +
			`Now run: amber route test ${routeId} --execute --stage ${stageName}`,
	);
}

function executeRouteStage(routeId, stageName, targetRoot, routesDir = DEFAULT_ROUTES_DIR) {
	const route = findRoute(routeId, routesDir);
	if (!route)
		return {
			text: `Route "${routeId}" not found.`,
			errors: [`Route "${routeId}" not found.`],
			exitCode: 1,
		};
	const stage = findStage(route, stageName);
	if (!stage)
		return {
			text: `Stage "${stageName}" not found.`,
			errors: [`Stage "${stageName}" not found in route ${routeId}.`],
			exitCode: 1,
		};
	if (stage.type === "verb") {
		const resolution = resolveVerbTarget(targetRoot, stage.target);
		if (!resolution.ok) return verbResolutionFailure(routeId, stageName, resolution);
		// F052 registrations confer an execution identity but do not make Amber a
		// launcher (ADR-0022).  Resolve here as a fail-closed execution guard;
		// session run owns the provider-specific execution/settlement path.
		return {
			text:
				`Resolved ${routeId}/${stageName} -> ${stage.target}. ` +
					"Execution is owned by session run; no runner was spawned.",
			errors: [],
			exitCode: 0,
			executed: false,
			capability: resolution.capability,
		};
	}
	if (stage.type !== "command") {
		const msg = `Only command stages can be executed; "${stageName}" is type "${stage.type}".`;
		return { text: msg, errors: [msg], exitCode: 1 };
	}

	const lp = routeLedgerPath(targetRoot, routeId);
	const outcome = runGovernedCommand({
		target: targetRoot,
		command: stage.target,
		ledgerPath: lp,
		budgetMinutes: 5,
		subject: { routeId, stageName },
		label: `${routeId}:${stageName}`,
		contextRules: stage.rules,
	});
	if (outcome.errors.length > 0) {
		return { text: outcome.errors.join("\n"), errors: outcome.errors, exitCode: 1 };
	}
	return {
		text: `Executed ${routeId}/${stageName} -> exit ${outcome.exitCode}. Ledger: .amber/routes/${routeId}/ledger.jsonl`,
		errors: [],
		exitCode: 0,
	};
}

function verifyRouteLedger(routeId, targetRoot) {
	const o = verifyLedgerOutcome(routeLedgerPath(targetRoot, routeId));
	if (!o.found) return result(`No ledger found for route ${routeId}.`, 1);
	if (o.intact) return result(`Ledger intact (${o.records} records).`);
	return result(o.tamperedMessage, 1);
}

module.exports = {
	listRoutes,
	inspectRoute,
	validateRouteFile,
	testRoute,
	approveRouteStage,
	executeRouteStage,
	verifyRouteLedger,
	routeLedgerPath,
	parseVerbTarget,
	resolveVerbTarget,
};
