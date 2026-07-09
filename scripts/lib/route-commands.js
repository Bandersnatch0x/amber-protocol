"use strict";

const path = require("path");
const { loadRoutes, loadRouteFile } = require("./route-loader");
const { result } = require("./result");
const { appendLedgerRecord, verifyLedgerOutcome } = require("./core/loop-ledger");
const { runGovernedCommand } = require("./core/governed-runner");
const { resolveStateDirForCreate } = require("./state-dir-resolver");

const DEFAULT_ROUTES_DIR = path.join(__dirname, "../../routes");


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

	const { filePath, ...clean } = route;
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

function approveRouteStage(routeId, stageName, targetRoot, reviewer, routesDir = DEFAULT_ROUTES_DIR) {
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
	if (!route) return { text: `Route "${routeId}" not found.`, errors: [`Route "${routeId}" not found.`], exitCode: 1 };
	const stage = findStage(route, stageName);
	if (!stage) return { text: `Stage "${stageName}" not found.`, errors: [`Stage "${stageName}" not found in route ${routeId}.`], exitCode: 1 };
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
};
