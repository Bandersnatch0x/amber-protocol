"use strict";

// Unit tests for the governance-dispatch chokepoint `governanceDispatch`
// (scripts/lib/governance-commands.js): action routing, shared requireTarget
// guard, and shared try/catch (runGuarded).

const { describe, it, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GOVERNANCE_COMMANDS_PATH = require.resolve("../../scripts/lib/governance-commands");

const VALID_ACTIONS = [
	"docs",
	"evidence",
	"policy",
	"audit",
	"readiness",
	"report",
	"standards",
	"rules",
];

// Per-action empty fields that requireTarget(extra) must preserve on the shared
// guard envelope so error shapes still type-match success envelopes.
const GUARD_EXTRA_BY_ACTION = {
	docs: { created: [], skipped: [] },
};

function listsAllValid(message) {
	const text = String(message);
	return VALID_ACTIONS.every((action) => text.includes(action));
}

function loadGovernanceCommands() {
	delete require.cache[GOVERNANCE_COMMANDS_PATH];
	return require(GOVERNANCE_COMMANDS_PATH);
}

// Force a core export to throw, re-load governance-commands so it re-binds the
// stubbed export, run `fn(governanceDispatch)`, then restore.
function withCoreThrow(coreRelPath, exportName, message, fn) {
	const corePath = require.resolve(coreRelPath);
	const core = require(corePath);
	const original = core[exportName];
	core[exportName] = () => {
		throw new Error(message);
	};
	try {
		const { governanceDispatch } = loadGovernanceCommands();
		return fn(governanceDispatch);
	} finally {
		core[exportName] = original;
		delete require.cache[GOVERNANCE_COMMANDS_PATH];
	}
}

// Core seams each action eventually reaches (post-guard). Used by shared-catch.
const CORE_THROW_SEAMS = {
	docs: {
		mod: "../../scripts/lib/core/governance",
		exportName: "governanceDocs",
		options: undefined,
	},
	evidence: {
		mod: "../../scripts/lib/core/governance",
		exportName: "exportSessionEvidence",
		// Pass guards that sit before the core call.
		options: { session: "s1", output: "out.md" },
	},
	policy: {
		mod: "../../scripts/lib/core/governance",
		exportName: "inspectPolicy",
		options: undefined,
	},
	audit: {
		mod: "../../scripts/lib/core/governance",
		exportName: "generateAuditReport",
		options: { output: "audit.md" },
	},
	readiness: {
		mod: "../../scripts/lib/core/governance-readiness",
		exportName: "inspectGovernanceReadiness",
		options: undefined,
	},
	report: {
		mod: "../../scripts/lib/core/governance-report",
		exportName: "buildGovernanceReport",
		options: undefined,
	},
	standards: {
		mod: "../../scripts/lib/core/standards",
		exportName: "mapStandards",
		options: undefined,
	},
	rules: {
		// init path hits resolveStateDirForCreate; force throw earlier via DEFAULT_RULES
		// access on the inspect path by stubbing loadPolicyRules after a missing file.
		// Use inspect sub-action which calls loadPolicyRules only when rules.json exists;
		// instead stub evaluateCommandPolicy via check, or force fs via init.
		// Simplest reliable seam: loadPolicyRules is always used by check; check needs --command.
		// For inspect with defaults, loadPolicyRules is NOT called. Use check:
		mod: "../../scripts/lib/core/loop-policy",
		exportName: "loadPolicyRules",
		options: { action: "check", command: "echo hi" },
	},
};

afterEach(() => {
	// Drop any re-required copy so later suites see a clean module.
	delete require.cache[GOVERNANCE_COMMANDS_PATH];
});

describe("governanceDispatch", () => {
	it("dispatch-completeness: resolves all 8 actions; unknown lists all 8", () => {
		const { governanceDispatch } = loadGovernanceCommands();
		assert.strictEqual(
			typeof governanceDispatch,
			"function",
			"governanceDispatch must be exported from governance-commands.js",
		);

		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-dispatch-"));
		try {
			for (const action of VALID_ACTIONS) {
				const result = governanceDispatch(action, tmp, {});
				assert.ok(result, `"${action}" must resolve to a result envelope`);
				const errs = (result.errors || []).join(" ");
				assert.ok(
					!listsAllValid(errs),
					`"${action}" fell through to the unknownAction envelope: ${errs}`,
				);
			}

			const unknown = governanceDispatch("not-a-real-action", tmp, {});
			assert.ok(
				unknown && Array.isArray(unknown.errors) && unknown.errors.length > 0,
				"unknown action must yield a non-empty error envelope",
			);
			assert.ok(
				listsAllValid(unknown.errors.join(" ")),
				`unknownAction envelope must list every valid action: ${unknown.errors.join(" ")}`,
			);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("shared-guard: every action returns --target is required envelope when target falsy (extras preserved)", () => {
		const { governanceDispatch } = loadGovernanceCommands();
		assert.strictEqual(
			typeof governanceDispatch,
			"function",
			"governanceDispatch must be exported from governance-commands.js",
		);

		for (const action of VALID_ACTIONS) {
			for (const falsy of [undefined, null, "", 0, false]) {
				const result = governanceDispatch(action, falsy, {});
				assert.ok(result, `"${action}" with falsy target must return an envelope`);
				assert.strictEqual(
					result.target,
					falsy,
					`"${action}": target field must echo the falsy input`,
				);
				assert.deepStrictEqual(
					result.errors,
					["--target is required"],
					`"${action}": shared guard error message`,
				);
				assert.deepStrictEqual(result.warnings, [], `"${action}": warnings must be empty array`);

				const extra = GUARD_EXTRA_BY_ACTION[action];
				if (extra) {
					for (const [key, value] of Object.entries(extra)) {
						assert.deepStrictEqual(
							result[key],
							value,
							`"${action}": must preserve empty extra field "${key}" on guard envelope`,
						);
					}
				}
			}
		}
	});

	it("shared-catch: for each action, core throw becomes {target, errors:[msg], warnings:[]}", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-dispatch-catch-"));
		try {
			for (const action of VALID_ACTIONS) {
				const seam = CORE_THROW_SEAMS[action];
				const boom = `forced-throw-${action}`;
				const result = withCoreThrow(seam.mod, seam.exportName, boom, (governanceDispatch) => {
					assert.strictEqual(
						typeof governanceDispatch,
						"function",
						"governanceDispatch must be exported from governance-commands.js",
					);
					return governanceDispatch(action, tmp, seam.options || {});
				});

				assert.ok(result, `"${action}" must return a catch envelope, not throw`);
				assert.strictEqual(result.target, tmp, `"${action}": target preserved`);
				assert.deepStrictEqual(
					result.errors,
					[boom],
					`"${action}": shared catch must surface error.message as sole errors[] entry`,
				);
				assert.deepStrictEqual(
					result.warnings,
					[],
					`"${action}": warnings must be empty array on catch envelope`,
				);
			}
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});

// F039 slice 4: byte-level pins for the defineCommand routing. The dispatcher
// owns routing and the unknown-action guidance; governanceDispatch unwraps
// its result at the boundary so the plain-body contract stays pinned above.
describe("governanceDispatch defineCommand envelopes", () => {
	it("unknown action body matches the legacy unknownGovernanceAction shape", () => {
		const { governanceDispatch } = loadGovernanceCommands();
		assert.deepStrictEqual(governanceDispatch("bogus", "some-target", {}), {
			target: undefined,
			errors: [
				"governance requires docs, evidence, policy, audit, readiness, report, standards, or rules.",
			],
			warnings: [],
		});
	});

	it("docs success body: target, created/skipped arrays, defaulted errors/warnings", () => {
		const { governanceDispatch } = loadGovernanceCommands();
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-dispatch-docs-"));
		try {
			const result = governanceDispatch("docs", tmp, {});
			assert.deepStrictEqual(result, {
				target: tmp,
				created: result.created,
				skipped: result.skipped,
				errors: [],
				warnings: [],
			});
			assert.ok(result.created.length > 0, "docs scaffolding must create files");
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("rules check body: verdict fields with defaulted errors/warnings", () => {
		const { governanceDispatch } = loadGovernanceCommands();
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-dispatch-rules-"));
		try {
			const result = governanceDispatch("rules", tmp, { action: "check", command: "rm -rf ." });
			assert.strictEqual(result.target, tmp);
			assert.strictEqual(result.command, "rm -rf .");
			assert.strictEqual(result.allowed, false);
			assert.match(result.text, /^DENY: /);
			assert.deepStrictEqual(result.errors, []);
			assert.deepStrictEqual(result.warnings, []);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("readiness body keeps the core target and defaulted errors/warnings", () => {
		const { governanceDispatch } = loadGovernanceCommands();
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gov-dispatch-readiness-"));
		try {
			const result = governanceDispatch("readiness", tmp, {});
			assert.strictEqual(result.target, tmp);
			// Findings surface as warnings (decision: warn on a bare target);
			// the pin is the key presence, not the findings themselves.
			assert.ok(Array.isArray(result.errors), "errors must default to an array");
			assert.ok(Array.isArray(result.warnings), "warnings must default to an array");
			assert.strictEqual(typeof result.text, "string");
			assert.ok(result.decision);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
