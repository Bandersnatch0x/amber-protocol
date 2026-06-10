const { describe, it } = require("node:test");
const assert = require("assert");
const path = require("path");
const {
	listRoutes,
	inspectRoute,
	validateRouteFile,
	testRoute,
} = require("../../scripts/lib/route-commands");

const ROUTES_DIR = path.join(__dirname, "../../routes");
const BROKEN = path.join(__dirname, "../fixtures/routes/broken.route.json");

describe("listRoutes", () => {
	it("lists all three reference routes with id, version, and stage count", () => {
		const { text, exitCode } = listRoutes(ROUTES_DIR);
		assert.strictEqual(exitCode, 0);
		assert.match(text, /feature-standard/);
		assert.match(text, /bugfix-quick/);
		assert.match(text, /refactor-safe/);
	});

	it("shows the stage count for a known route", () => {
		const { text } = listRoutes(ROUTES_DIR);
		assert.match(text, /feature-standard.*\b4 stages\b/);
	});

	it("returns exitCode 0 and a message when no routes exist", () => {
		const { text, exitCode } = listRoutes(
			path.join(__dirname, "../../no-routes-here"),
		);
		assert.strictEqual(exitCode, 0);
		assert.match(text, /No routes found/);
	});
});

describe("inspectRoute", () => {
	it("prints the full JSON of a route by id", () => {
		const { text, exitCode } = inspectRoute("feature-standard", ROUTES_DIR);
		assert.strictEqual(exitCode, 0);
		const jsonStart = text.indexOf("{");
		const parsed = JSON.parse(text.slice(jsonStart, text.lastIndexOf("}") + 1));
		assert.strictEqual(parsed.routeId, "feature-standard");
	});

	it("renders a stage tree with gate annotations", () => {
		const { text } = inspectRoute("feature-standard", ROUTES_DIR);
		assert.match(text, /capture/);
		assert.match(text, /gate: user-approval-plan/);
	});

	it("returns exitCode 1 for an unknown route id", () => {
		const { text, exitCode } = inspectRoute("does-not-exist", ROUTES_DIR);
		assert.strictEqual(exitCode, 1);
		assert.match(text, /not found/);
	});
});

describe("validateRouteFile", () => {
	it("reports a valid route with exitCode 0", () => {
		const { text, exitCode } = validateRouteFile(
			path.join(ROUTES_DIR, "feature-standard.route.json"),
		);
		assert.strictEqual(exitCode, 0);
		assert.match(text, /VALID/);
	});

	it("reports an invalid route with exitCode 1 and lists errors", () => {
		const { text, exitCode } = validateRouteFile(BROKEN);
		assert.strictEqual(exitCode, 1);
		assert.match(text, /INVALID/);
		assert.match(text, /routeId/);
	});

	it("returns exitCode 1 when no file path is given", () => {
		const { text, exitCode } = validateRouteFile("");
		assert.strictEqual(exitCode, 1);
		assert.match(text, /requires a file path/);
	});
});

describe("testRoute (dry-run)", () => {
	it("prints the ordered stage sequence for a route", () => {
		const { text, exitCode } = testRoute("bugfix-quick", ROUTES_DIR);
		assert.strictEqual(exitCode, 0);
		assert.match(text, /1\. reproduce/);
		assert.match(text, /2\. fix/);
		assert.match(text, /3\. verify/);
	});

	it("marks where gates fire", () => {
		const { text } = testRoute("bugfix-quick", ROUTES_DIR);
		assert.match(text, /GATE user-approval-fix fires after reproduce/);
	});

	it("returns exitCode 1 for an unknown route id", () => {
		const { exitCode } = testRoute("nope", ROUTES_DIR);
		assert.strictEqual(exitCode, 1);
	});
});
