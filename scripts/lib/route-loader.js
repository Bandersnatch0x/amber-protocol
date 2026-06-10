"use strict";

const fs = require("fs");
const path = require("path");
const validateRoute = require("./validate-route");

const ROUTE_FILE_SUFFIX = ".route.json";

function loadRouteFile(filePath) {
	let raw;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch (err) {
		return {
			valid: false,
			route: null,
			filePath,
			errors: [`Cannot read ${filePath}: ${err.message}`],
		};
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		return {
			valid: false,
			route: null,
			filePath,
			errors: [`Invalid JSON in ${filePath}: ${err.message}`],
		};
	}

	const { valid, errors } = validateRoute(parsed);
	return { valid, route: valid ? parsed : null, filePath, errors };
}

function listRouteFiles(routesDir) {
	if (!fs.existsSync(routesDir)) {
		return [];
	}
	return fs
		.readdirSync(routesDir)
		.filter((name) => name.endsWith(ROUTE_FILE_SUFFIX))
		.sort()
		.map((name) => path.join(routesDir, name));
}

function loadRoutes(routesDir) {
	const routes = [];
	const errors = [];

	for (const filePath of listRouteFiles(routesDir)) {
		const result = loadRouteFile(filePath);
		if (result.valid) {
			routes.push({ ...result.route, filePath });
		} else {
			errors.push(...result.errors);
		}
	}

	return { routes, errors };
}

module.exports = { loadRoutes, loadRouteFile, ROUTE_FILE_SUFFIX };
