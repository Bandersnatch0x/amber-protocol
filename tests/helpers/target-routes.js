"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_ROOT = path.resolve(__dirname, "../..");
const ROUTE_IDS = ["bugfix-quick", "feature-standard", "refactor-safe"];

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

module.exports = { installTargetRoutes };
