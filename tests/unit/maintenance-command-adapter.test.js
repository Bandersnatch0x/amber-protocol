"use strict";

// F014-M3: the Maintenance command adapter owns all ten subcommands.
// Characterizes action recognition, alias handling, envelopes, registry-path
// closure, and unknown-action guidance through maintenanceDispatch.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	MAINTENANCE_ACTIONS,
	maintenanceDispatch,
} = require("../../scripts/lib/maintenance/adapters/command");

const ALL_TEN = [
	"inspect",
	"propose",
	"stale-docs",
	"wiki-lint",
	"pack-drift",
	"upgrade-preview",
	"evolution-rollup",
	"regression-proposals",
	"scaffold-drift",
	"distill",
];

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "maint-adapter-"));
}

describe("maintenance command adapter", () => {
	it("declares exactly the ten documented subcommands", () => {
		assert.deepEqual([...MAINTENANCE_ACTIONS].sort(), [...ALL_TEN].sort());
	});

	it("resolves every subcommand to a structured result envelope", () => {
		const tmp = tempTarget();
		try {
			for (const action of ALL_TEN) {
				const out = maintenanceDispatch(action, { target: tmp });
				assert.ok(out && out.result, `"${action}" must yield an envelope`);
				assert.ok(Array.isArray(out.result.errors), `"${action}" errors array`);
				assert.ok(Array.isArray(out.result.warnings), `"${action}" warnings array`);
				// A resolved action must NOT fall through to the unknown branch.
				const errs = (out.result.errors || []).join(" ");
				assert.ok(
					!errs.includes("maintenance requires one of"),
					`"${action}" fell through to unknown-action envelope`,
				);
			}
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("unknown action returns the full ten-subcommand guidance", () => {
		const tmp = tempTarget();
		try {
			const out = maintenanceDispatch("bogus", { target: tmp });
			assert.ok(out.result.errors.length > 0);
			for (const action of ALL_TEN) {
				assert.ok(
					out.result.errors.join(" ").includes(action),
					`guidance lists ${action}`,
				);
			}
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("undefined action also returns the guidance envelope", () => {
		const out = maintenanceDispatch(undefined, {});
		assert.ok(out.result.errors.length > 0);
		assert.match(out.result.errors.join(" "), /maintenance requires one of/);
	});

	it("scaffold-drift returns scaffoldDrift envelope", () => {
		const tmp = tempTarget();
		try {
			const out = maintenanceDispatch("scaffold-drift", { target: tmp });
			assert.ok("scaffoldDrift" in out.result);
			assert.deepEqual(out.result.errors, []);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("distill returns outputPath and candidateCount envelope", () => {
		const tmp = tempTarget();
		try {
			const out = maintenanceDispatch("distill", { target: tmp });
			assert.ok(typeof out.result.outputPath === "string");
			assert.ok(typeof out.result.candidateCount === "number");
			assert.deepEqual(out.result.errors, []);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("propose alias is honored through runMaintenanceAction", () => {
		const tmp = tempTarget();
		try {
			const out = maintenanceDispatch("proposal", { target: tmp });
			// "proposal" is a long-standing alias for "propose" — the adapter
			// passes the raw action through; runMaintenanceAction normalizes it.
			assert.ok(out && out.result, "alias must resolve to an envelope");
			const errs = (out.result.errors || []).join(" ");
			assert.ok(
				!errs.includes("maintenance requires one of"),
				"proposal alias must not fall through to unknown",
			);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("registry value stays out of domain operations unresolved (stale-docs)", () => {
		const tmp = tempTarget();
		try {
			// stale-docs needs no registry; passing a raw registry must not
			// surface it as an error in the envelope.
			const out = maintenanceDispatch("stale-docs", {
				target: tmp,
				registry: "some/raw/path",
				thresholdDays: "60",
			});
			assert.deepEqual(out.result.errors, []);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
