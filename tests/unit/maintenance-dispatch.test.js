"use strict";

// Red tests driving T1 (architecture-deepening candidate #1): extract a single
// maintenance-dispatch chokepoint `runMaintenanceAction` out of the inline
// `switch` in scripts/lib/command-handler-families.js#handleMaintenance, and
// narrow the systemic CLI-arg leak (`options.registry`) into a resolved
// `registryPath` string before it reaches the domain functions.
//
// These MUST fail red now: `runMaintenanceAction` does not exist yet in
// scripts/lib/core/maintenance.js. See .scratch/architecture-deepening/plan.md.

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

	it("leak-regression: inspect/propose receive a resolved registryPath string, never the raw CLI args object", () => {
		const { runMaintenanceAction } = maintenance;

		// Stub the two domain functions at the chokepoint's delegation seam so we
		// can observe EXACTLY what runMaintenanceAction hands them. The narrowing
		// (CLI `registry` -> resolved `registryPath` string) must happen inside the
		// chokepoint, before these are called - the single place the leak is closed.
		const captured = [];
		const real = {
			inspect: maintenance.inspectMaintenance,
			propose: maintenance.proposeMaintenance,
		};
		maintenance.inspectMaintenance = (target, options) => {
			captured.push({ fn: "inspect", target, options });
			return { target, errors: [], warnings: [] };
		};
		maintenance.proposeMaintenance = (target, options) => {
			captured.push({ fn: "propose", target, options });
			return {
				target,
				errors: [],
				warnings: [],
				proposalPath: "stub.md",
				reviewable: true,
				sourceFilesChanged: false,
			};
		};

		try {
			// CLI-shaped args carrying the `registry` key plus other CLI-only keys.
			const cliArgs = {
				target: "/tmp/amber-leak-regression",
				registry: undefined, // the CLI arg key that must NOT leak into core
				_: ["inspect"],
				version: "1.0.0",
				fixMarkers: true,
				priority: "high",
			};
			runMaintenanceAction("inspect", cliArgs);
			runMaintenanceAction("propose", cliArgs);

			assert.strictEqual(
				captured.length,
				2,
				"chokepoint must dispatch to both inspect and propose",
			);
			for (const call of captured) {
				const { fn, options } = call;

				// The narrowed value: a RESOLVED registryPath (string). It may be
				// passed directly (options is the string) or as options.registryPath.
				const registryPath =
					typeof options === "string"
						? options
						: options && options.registryPath;
				assert.strictEqual(
					typeof registryPath,
					"string",
					`${fn}: expected a resolved registryPath string, got ${
						options === undefined ? "undefined" : JSON.stringify(options)
					}`,
				);

				// Never the raw CLI args object: the `registry` arg key must not
				// leak through, nor may the whole args object be forwarded by reference.
				assert.ok(
					!(
						options &&
						typeof options === "object" &&
						Object.prototype.hasOwnProperty.call(options, "registry")
					),
					`${fn}: raw CLI args object leaked into domain function (carries 'registry')`,
				);
				assert.notStrictEqual(
					options,
					cliArgs,
					`${fn}: raw CLI args object forwarded to domain function by reference`,
				);
			}
		} finally {
			maintenance.inspectMaintenance = real.inspect;
			maintenance.proposeMaintenance = real.propose;
		}
	});
});
