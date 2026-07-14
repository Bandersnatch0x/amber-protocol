"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { doctor } = require("../../scripts/lib/core/doctor");
const { remedyFor } = require("../../scripts/lib/core/lifecycle");

function tmpRepo() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-doctor-remedy-"));
}

describe("doctor remedies", () => {
	it("attaches an init remedy to the failing required-files check", () => {
		const dir = tmpRepo();
		const result = doctor(dir);
		const filesCheck = result.checks.find((c) => c.name === "Required harness files");
		assert.equal(filesCheck.passed, false);
		assert.ok(filesCheck.remedy, "expected a remedy on the failing check");
	});

	it("sources the required-files remedy from lifecycle.remedyFor (single source)", () => {
		const dir = tmpRepo();
		const result = doctor(dir);
		const filesCheck = result.checks.find((c) => c.name === "Required harness files");
		assert.equal(filesCheck.remedy, remedyFor("init", { targetDisplay: dir }));
	});

	it("leaves passing checks without a remedy", () => {
		const dir = tmpRepo();
		const result = doctor(dir);
		for (const c of result.checks) {
			if (c.passed) assert.equal(c.remedy, undefined);
		}
	});
});


describe("product-repo doctor feature_list (#66)", () => {
	it("surfaces feature_list invariant errors on product-repo (not just target-repo)", () => {
		const dir = tmpRepo();
		// Product-repo signature: SPEC.md + ROADMAP.md + scripts/amber.js + templates/
		fs.writeFileSync(path.join(dir, "SPEC.md"), "# spec");
		fs.writeFileSync(path.join(dir, "ROADMAP.md"), "# roadmap");
		fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
		fs.writeFileSync(path.join(dir, "scripts", "amber.js"), "// cli");
		fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, "feature_list.json"),
			JSON.stringify({
				features: [
					{
						id: "F001",
						priority: 1,
						area: "a",
						title: "A",
						user_visible_behavior: "A",
						status: "in_progress",
						verification: ["check"],
						evidence: [],
						notes: [],
					},
					{
						id: "F002",
						priority: 2,
						area: "b",
						title: "B",
						user_visible_behavior: "B",
						status: "in_progress",
						verification: ["check"],
						evidence: [],
						notes: [],
					},
				],
			}),
		);

		const result = doctor(dir);
		assert.equal(result.classification.type, "product-repo");
		assert.ok(
			result.errors.some((e) => /At most one feature can be in_progress/.test(e)),
			`expected at-most-one-in_progress error, got: ${result.errors.join("; ")}`,
		);
		const check = result.productChecks.find((c) => c.name === "feature_list.json");
		assert.ok(check, "productChecks should include feature_list.json");
		assert.ok(check.errors > 0);
	});

	it("accepts accepted status written by amber accept", () => {
		const dir = tmpRepo();
		fs.writeFileSync(path.join(dir, "SPEC.md"), "# spec");
		fs.writeFileSync(path.join(dir, "ROADMAP.md"), "# roadmap");
		fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
		fs.writeFileSync(path.join(dir, "scripts", "amber.js"), "// cli");
		fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, "feature_list.json"),
			JSON.stringify({
				features: [
					{
						id: "F001",
						priority: 1,
						area: "a",
						title: "A",
						user_visible_behavior: "A",
						status: "accepted",
						verification: ["check"],
						evidence: ["npm test"],
						notes: [],
					},
				],
			}),
		);

		const result = doctor(dir);
		assert.equal(result.classification.type, "product-repo");
		assert.equal(
			result.errors.filter((e) => /status must be one of|At most one feature/.test(e)).length,
			0,
			`unexpected feature_list errors: ${result.errors.join("; ")}`,
		);
	});
});
