const { describe, it } = require("node:test");
const assert = require("assert");
const path = require("path");
const { loadRoutes, loadRouteFile } = require("../../scripts/lib/route-loader");

const ROUTES_DIR = path.join(__dirname, "../../routes");

describe("loadRoutes", () => {
	it("loads all three reference routes from the routes directory", () => {
		const result = loadRoutes(ROUTES_DIR);
		const ids = result.routes.map((r) => r.routeId).sort();
		assert.deepStrictEqual(ids, [
			"bugfix-quick",
			"feature-standard",
			"refactor-safe",
		]);
	});

	it("returns no errors for the reference routes", () => {
		const result = loadRoutes(ROUTES_DIR);
		assert.deepStrictEqual(result.errors, []);
	});

	it("attaches the source file path to each loaded route", () => {
		const result = loadRoutes(ROUTES_DIR);
		const feature = result.routes.find((r) => r.routeId === "feature-standard");
		assert.ok(feature.filePath.endsWith("feature-standard.route.json"));
	});

	it("returns an empty list and no errors when the directory is missing", () => {
		const result = loadRoutes(path.join(__dirname, "../../does-not-exist"));
		assert.deepStrictEqual(result.routes, []);
		assert.deepStrictEqual(result.errors, []);
	});

	it("ignores files that do not end with .route.json", () => {
		const result = loadRoutes(ROUTES_DIR);
		assert.ok(result.routes.every((r) => r.filePath.endsWith(".route.json")));
	});
});

describe("loadRouteFile", () => {
	it("loads and validates a single route file", () => {
		const file = path.join(ROUTES_DIR, "feature-standard.route.json");
		const result = loadRouteFile(file);
		assert.strictEqual(result.valid, true);
		assert.strictEqual(result.route.routeId, "feature-standard");
		assert.deepStrictEqual(result.errors, []);
	});

	it("reports a parse error for a non-existent file", () => {
		const result = loadRouteFile(path.join(ROUTES_DIR, "nope.route.json"));
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.length > 0);
		assert.strictEqual(result.route, null);
	});
});
