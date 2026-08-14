"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PRODUCT_ROOT = path.resolve(__dirname, "../..");
const ROUTE_IDS = ["bugfix-quick", "feature-standard", "refactor-safe"];

function productRoutePath(routeId) {
	return path.join(PRODUCT_ROOT, "routes", `${routeId}.route.json`);
}

function installTargetRoutes(targetRoot, routeIds = ROUTE_IDS) {
	const sourceDir = path.join(PRODUCT_ROOT, "templates", "routes");
	const targetDir = path.join(targetRoot, "routes");
	fs.mkdirSync(targetDir, { recursive: true });
	for (const routeId of routeIds) {
		fs.copyFileSync(
			path.join(sourceDir, `${routeId}.route.json`),
			path.join(targetDir, `${routeId}.route.json`),
		);
	}
	return targetDir;
}

function writeTargetRoute(targetRoot, routeId, options = {}) {
	const { sourceRouteId = "feature-standard", displayName } = options;
	const routesDir = path.join(targetRoot, "routes");
	fs.mkdirSync(routesDir, { recursive: true });
	const route = JSON.parse(fs.readFileSync(productRoutePath(sourceRouteId), "utf8"));
	route.routeId = routeId;
	if (displayName !== undefined) {
		route.displayName = displayName;
	}
	fs.writeFileSync(
		path.join(routesDir, `${routeId}.route.json`),
		`${JSON.stringify(route, null, 2)}\n`,
	);
	return path.join(routesDir, `${routeId}.route.json`);
}

// Junction escape fixture: a routes directory outside the target, linked in
// as <target>/routes. Where the platform refuses junction creation
// (EPERM/ENOSYS) or the link already exists, the guard cannot be exercised,
// so run() is skipped and the caller's assertions pass vacuously.
function withRoutesJunctionEscape(targetRoot, run) {
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "amber-routes-outside-"));
	let linked = false;
	try {
		writeTargetRoute(outside, "outside-route");
		try {
			fs.symlinkSync(path.join(outside, "routes"), path.join(targetRoot, "routes"), "junction");
			linked = true;
		} catch (error) {
			if (!/EPERM|ENOSYS|existing/i.test(error.message)) {
				throw error;
			}
		}
		if (linked) {
			return run();
		}
	} finally {
		fs.rmSync(outside, { recursive: true, force: true });
	}
}

module.exports = { installTargetRoutes, writeTargetRoute, withRoutesJunctionEscape };
