"use strict";

const path = require("path");
const { loadRoutes, loadRouteFile } = require("./route-loader");
const { result } = require("./result");

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

module.exports = { listRoutes, inspectRoute, validateRouteFile, testRoute };
