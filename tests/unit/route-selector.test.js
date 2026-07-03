const { describe, it } = require("node:test");
const assert = require("assert");
const path = require("path");
const {
	selectRoute,
	scoreRoutes,
} = require("../../scripts/lib/route-selector");
const { loadRoutes } = require("../../scripts/lib/route-loader");

const ROUTES = loadRoutes(path.join(__dirname, "../../routes")).routes;

function pick(goal) {
	return selectRoute(goal, ROUTES);
}

describe("selectRoute — feature goals", () => {
	it("routes 'implement a new export feature' to feature-standard", () => {
		assert.strictEqual(
			pick("implement a new export feature").routeId,
			"feature-standard",
		);
	});
	it("routes 'add a billing feature' to feature-standard", () => {
		assert.strictEqual(
			pick("add a billing feature").routeId,
			"feature-standard",
		);
	});
	it("routes 'build the reporting feature' to feature-standard", () => {
		assert.strictEqual(
			pick("build the reporting feature").routeId,
			"feature-standard",
		);
	});
	it("routes 'create a dashboard feature' to feature-standard", () => {
		assert.strictEqual(
			pick("create a dashboard feature").routeId,
			"feature-standard",
		);
	});
	it("routes 'add login' to feature-standard (no literal 'feature' word)", () => {
		assert.strictEqual(pick("add login").routeId, "feature-standard");
	});
	it("routes 'implement OAuth' to feature-standard", () => {
		assert.strictEqual(pick("implement OAuth").routeId, "feature-standard");
	});
});

describe("selectRoute — bugfix goals", () => {
	it("routes 'fix the login bug' to bugfix-quick", () => {
		assert.strictEqual(pick("fix the login bug").routeId, "bugfix-quick");
	});
	it("routes 'resolve crash on startup' to bugfix-quick", () => {
		assert.strictEqual(
			pick("resolve crash on startup").routeId,
			"bugfix-quick",
		);
	});
	it("routes 'patch the null pointer error' to bugfix-quick", () => {
		assert.strictEqual(
			pick("patch the null pointer error").routeId,
			"bugfix-quick",
		);
	});
	it("routes 'repair the broken export defect' to bugfix-quick", () => {
		assert.strictEqual(
			pick("repair the broken export defect").routeId,
			"bugfix-quick",
		);
	});
	it("routes 'fix the timeout issue' to bugfix-quick", () => {
		assert.strictEqual(pick("fix the timeout issue").routeId, "bugfix-quick");
	});
});

describe("selectRoute — refactor goals", () => {
	it("routes 'refactor the auth module' to refactor-safe", () => {
		assert.strictEqual(
			pick("refactor the auth module").routeId,
			"refactor-safe",
		);
	});
	it("routes 'restructure the payment service' to refactor-safe", () => {
		assert.strictEqual(
			pick("restructure the payment service").routeId,
			"refactor-safe",
		);
	});
	it("routes 'clean up the parser' to refactor-safe", () => {
		assert.strictEqual(pick("clean up the parser").routeId, "refactor-safe");
	});
	it("routes 'simplify the router' to refactor-safe", () => {
		assert.strictEqual(pick("simplify the router").routeId, "refactor-safe");
	});
	it("routes 'extract the validation helper' to refactor-safe", () => {
		assert.strictEqual(
			pick("extract the validation helper").routeId,
			"refactor-safe",
		);
	});
});

describe("selectRoute — confidence and shape", () => {
	it("returns a confidence between 0 and 1 for a match", () => {
		const match = pick("fix the login bug");
		assert.ok(match.confidence > 0 && match.confidence <= 1);
	});
	it("returns matched=true for a matching goal", () => {
		assert.strictEqual(pick("fix the login bug").matched, true);
	});
	it("includes the route displayName on a match", () => {
		assert.strictEqual(
			pick("add a billing feature").displayName,
			"Standard Feature Development",
		);
	});
});

describe("selectRoute — no match", () => {
	it("returns matched=false for an unrelated goal", () => {
		const match = pick("write the quarterly report");
		assert.strictEqual(match.matched, false);
		assert.strictEqual(match.routeId, null);
		assert.strictEqual(match.confidence, 0);
	});
	it("returns matched=false for an empty goal", () => {
		assert.strictEqual(pick("").matched, false);
	});
	it("returns matched=false when no routes are provided", () => {
		assert.strictEqual(selectRoute("fix the bug", []).matched, false);
	});
});

describe("selectRoute — input validation", () => {
	it("throws a TypeError when goal is not a string", () => {
		assert.throws(() => selectRoute(42, ROUTES), TypeError);
	});
	it("throws a TypeError when routes is not an array", () => {
		assert.throws(() => selectRoute("fix the bug", null), TypeError);
	});
});

describe("scoreRoutes — deterministic ordering", () => {
	it("ranks all matching routes and is sorted by descending confidence", () => {
		const scored = scoreRoutes("fix the login bug", ROUTES);
		for (let i = 1; i < scored.length; i += 1) {
			assert.ok(scored[i - 1].confidence >= scored[i].confidence);
		}
	});

	it("breaks confidence ties by longer pattern then routeId", () => {
		const routes = [
			{ routeId: "z-short", trigger: { goalPattern: "^do" } },
			{ routeId: "a-long", trigger: { goalPattern: "^do\\s+it" } },
			{ routeId: "b-long", trigger: { goalPattern: "^do\\s+it" } },
		];
		const scored = scoreRoutes("do it now", routes);
		assert.strictEqual(scored[0].routeId, "a-long");
		assert.strictEqual(scored[1].routeId, "b-long");
		assert.strictEqual(scored[2].routeId, "z-short");
	});

	it("skips routes without a goalPattern", () => {
		const routes = [
			{ routeId: "no-trigger" },
			{ routeId: "has-trigger", trigger: { goalPattern: "^go" } },
		];
		const scored = scoreRoutes("go now", routes);
		assert.strictEqual(scored.length, 1);
		assert.strictEqual(scored[0].routeId, "has-trigger");
	});

	it("ignores routes whose goalPattern is an invalid regex", () => {
		const routes = [
			{ routeId: "broken-regex", trigger: { goalPattern: "([unterminated" } },
			{ routeId: "good-regex", trigger: { goalPattern: "^go" } },
		];
		const scored = scoreRoutes("go now", routes);
		assert.strictEqual(scored.length, 1);
		assert.strictEqual(scored[0].routeId, "good-regex");
	});
});
