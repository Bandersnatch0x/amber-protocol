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
