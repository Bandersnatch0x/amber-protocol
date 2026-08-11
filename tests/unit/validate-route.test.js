const { describe, it } = require("node:test");
const assert = require("assert");
const validateRoute = require("../../scripts/lib/validate-route");
const fs = require("fs");

describe("validateRoute", () => {
	it("should reject route without routeId", () => {
		const route = { schemaVersion: "1.0.0", stages: [] };
		const result = validateRoute(route);
		assert.strictEqual(result.valid, false);
		assert.ok(result.errors.some((e) => e.includes("routeId")));
	});

	it("should reject route with invalid schemaVersion", () => {
		const route = {
			routeId: "test",
			schemaVersion: "0.9.0",
			stages: [{ name: "test", type: "command" }],
		};
		const result = validateRoute(route);
		assert.strictEqual(result.valid, false);
	});

	it("should accept valid route", () => {
		const routeData = fs.readFileSync("routes/feature-standard.route.json", "utf8");
		const route = JSON.parse(routeData);
		const result = validateRoute(route);
		assert.strictEqual(result.valid, true);
	});

	it("should reject route with invalid stage type", () => {
		const route = {
			routeId: "test-route",
			schemaVersion: "1.0.0",
			stages: [{ name: "bad-stage", type: "invalid-type" }],
		};
		const result = validateRoute(route);
		assert.strictEqual(result.valid, false);
	});

	it("should reject empty stages array", () => {
		const route = {
			routeId: "empty-stages",
			schemaVersion: "1.0.0",
			stages: [],
		};
		const result = validateRoute(route);
		assert.strictEqual(result.valid, false);
	});
});
