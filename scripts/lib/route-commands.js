"use strict";

const path = require("path");
const { loadRoutes, loadRouteFile } = require("./route-loader");

const DEFAULT_ROUTES_DIR = path.join(__dirname, "../../routes");

function stageCount(route) {
	return Array.isArray(route.stages) ? route.stages.length : 0;
}

function findRoute(routeId, routesDir) {
	const { routes } = loadRoutes(routesDir);
	return routes.find((r) => r.routeId === routeId) || null;
}

function listRoutes(routesDir = DEFAULT_ROUTES_DIR) {
	const { routes } = loadRoutes(routesDir);
	if (routes.length === 0) {
		return { text: "No routes found.", exitCode: 0 };
	}

	const lines = ["Available routes:"];
	for (const route of routes) {
		const version = route.version || "0.0.0";
		const description = route.description || "";
		lines.push(
			`  ${route.routeId} (v${version}) — ${stageCount(route)} stages — ${description}`,
		);
	}
	return { text: lines.join("\n"), exitCode: 0 };
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
		return { text: `Route "${routeId}" not found.`, exitCode: 1 };
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
	return { text: lines.join("\n"), exitCode: 0 };
}

function validateRouteFile(filePath) {
	if (!filePath) {
		return { text: "route validate requires a file path.", exitCode: 1 };
	}

	const result = loadRouteFile(filePath);
	if (result.valid) {
		return { text: `VALID: ${filePath}`, exitCode: 0 };
	}

	const lines = [`INVALID: ${filePath}`, "Errors:"];
	for (const error of result.errors) {
		lines.push(`  - ${error}`);
	}
	return { text: lines.join("\n"), exitCode: 1 };
}

function testRoute(routeId, routesDir = DEFAULT_ROUTES_DIR) {
	const route = findRoute(routeId, routesDir);
	if (!route) {
		return { text: `Route "${routeId}" not found.`, exitCode: 1 };
	}

	const lines = [`Dry-run for route: ${route.routeId}`, "Stage sequence:"];
	route.stages.forEach((stage, index) => {
		lines.push(`  ${index + 1}. ${stage.name} [${stage.type}]`);
		if (stage.gateAfter) {
			lines.push(`     >> GATE ${stage.gateAfter} fires after ${stage.name}`);
		}
	});
	lines.push("No execution performed (dry-run).");
	return { text: lines.join("\n"), exitCode: 0 };
}

module.exports = { listRoutes, inspectRoute, validateRouteFile, testRoute };
