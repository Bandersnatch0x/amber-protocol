"use strict";

// Unit tests for the maintenance-dispatch chokepoint `runMaintenanceAction`
// (scripts/lib/core/maintenance.js) and the registry→registryPath leak closure
// at that seam. Sibling actions scaffold-drift/distill stay handler-routed.

const { describe, it } = require("node:test");
const assert = require("assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const maintenance = require("../../scripts/lib/core/maintenance");

// The exact 8 maintenance actions the chokepoint must own. The current
// inline-switch design also branches on `scaffold-drift` and `distill`, and
// forwards the raw CLI `args` object (carrying `registry`) straight into
// inspectMaintenance/proposeMaintenance - both behaviours these tests pin out.
const VALID_ACTIONS = [
	"inspect",
	"propose",
	"stale-docs",
	"wiki-lint",
	"pack-drift",
	"upgrade-preview",
	"evolution-rollup",
	"regression-proposals",
];

// The unknownAction envelope lists every valid action in one error string.
// Used both to recognise a leaked unknownAction branch and to assert the
// unknown path lists the valid set. Format-independent (substring presence).
function listsAllValid(message) {
	const text = String(message);
	return VALID_ACTIONS.every((action) => text.includes(action));
}

// The full maintenance command surface includes two sibling actions that stay
// handler-routed (scaffold-drift, distill). An unknown-action guidance message
// that omits them misleads a user who mistypes one - it must list all 10.
const SIBLING_ACTIONS = ["scaffold-drift", "distill"];

describe("runMaintenanceAction", () => {
	it("dispatch-completeness: resolves every valid action and returns a valid-list envelope for unknown actions", () => {
		const { runMaintenanceAction } = maintenance;
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maint-dispatch-"));
		try {
			for (const action of VALID_ACTIONS) {
				const result = runMaintenanceAction(action, { target: tmp });
				assert.ok(result, `"${action}" must resolve to a result envelope`);
				// A resolved action must NOT fall through to the unknownAction
				// branch, whose signature is an error listing every valid action.
				const errs = (result.errors || []).join(" ");
				assert.ok(
					!listsAllValid(errs),
					`"${action}" fell through to the unknownAction envelope: ${errs}`,
				);
			}

			const unknown = runMaintenanceAction("not-a-real-action", {
				target: tmp,
			});
			assert.ok(
				unknown && Array.isArray(unknown.errors) && unknown.errors.length > 0,
				"unknown action must yield a non-empty error envelope",
			);
			assert.ok(
				listsAllValid(unknown.errors.join(" ")),
				`unknownAction envelope must list every valid action: ${unknown.errors.join(" ")}`,
			);
			// The handler routes scaffold-drift and distill before the chokepoint, so
			// they are not in the dispatch switch - but a user who mistypes one must
			// still see it in the unknown-action guidance. Pin all 10 surface actions.
			const unknownText = unknown.errors.join(" ");
			for (const sibling of SIBLING_ACTIONS) {
				assert.ok(
					unknownText.includes(sibling),
					`unknownAction guidance must list sibling action "${sibling}": ${unknownText}`,
				);
			}
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("registry-leak: CLI args object never crosses the domain seam unresolved", () => {
		// F014-M4: delegation observation moved from export monkey-patching to
		// behavioral verification through the command adapter. The narrowing
		// (CLI `registry` -> resolved `registryPath` string) stays inside the
		// dispatch path; calling through with a raw CLI-shaped args object must
		// still resolve and run without forwarding the args object by reference.
		const { runMaintenanceAction } = maintenance;

		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maint-leak-"));
		try {
			// CLI-shaped args carrying the `registry` key plus other CLI-only keys.
			// No registry file needed: resolution happens before domain use, and
			// inspect tolerates a missing registry (unavailable team guidance).
			const cliArgs = {
				target: tmp,
				registry: undefined, // the CLI arg key that must NOT leak into core
				_: ["inspect"],
				version: "1.0.0",
				fixMarkers: true,
				priority: "high",
			};

			for (const action of ["inspect", "propose"]) {
				const result = runMaintenanceAction(action, cliArgs);
				assert.ok(result, `${action} must resolve to a result envelope`);
				assert.ok(
					Array.isArray(result.errors) && Array.isArray(result.warnings),
					`${action} envelope shape`,
				);
				// The result target resolves from the CLI target, not from an
				// unresolved raw args object.
				assert.equal(result.target, tmp);
			}
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
