"use strict";

// Unit tests for scripts/lib/core/finding-attribution.js — the shared
// finding-attribution vocabulary and validator (trusted-control evolution
// contract §3). Pure module: closed enums, closed field set, explicit
// validation, immutability, no input mutation.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
	ENTRY_SURFACES,
	IMPACT_SURFACES,
	RESPONSIBLE_ARTIFACTS,
	FIELDS,
	attributionProblem,
} = require("../../scripts/lib/core/finding-attribution");

const VALID_BLOCK = {
	entrySurface: "tool-output",
	impactSurface: "context",
	failureMode: "ENOENT: no such file or directory, open <path>",
	responsibleArtifact: "wiki",
};

describe("finding-attribution vocabulary", () => {
	it("exposes the exact closed enums from the spec", () => {
		assert.deepEqual(
			[...ENTRY_SURFACES],
			["instruction-surface", "tool-output", "policy-rule", "capability-request"],
		);
		assert.deepEqual(
			[...IMPACT_SURFACES],
			["target-repo", "context", "external", "governance-state"],
		);
		assert.deepEqual(
			[...RESPONSIBLE_ARTIFACTS],
			[
				"instruction-surface",
				"rules",
				"memory",
				"capability-registry",
				"wiki",
				"route",
				"loop-contract",
			],
		);
		assert.deepEqual(
			[...FIELDS],
			["entrySurface", "impactSurface", "failureMode", "responsibleArtifact"],
		);
	});

	it("freezes the exported vocabulary so no consumer can widen it", () => {
		assert.ok(Object.isFrozen(ENTRY_SURFACES), "ENTRY_SURFACES must be frozen");
		assert.ok(Object.isFrozen(IMPACT_SURFACES), "IMPACT_SURFACES must be frozen");
		assert.ok(Object.isFrozen(RESPONSIBLE_ARTIFACTS), "RESPONSIBLE_ARTIFACTS must be frozen");
		assert.ok(Object.isFrozen(FIELDS), "FIELDS must be frozen");
		assert.throws(() => ENTRY_SURFACES.push("new-surface"), /not extensible|add property/);
		assert.throws(() => RESPONSIBLE_ARTIFACTS.push("new-artifact"), /not extensible|add property/);
		// Freeze is shallow-by-array only in the sense of the array itself; the
		// elements are primitives, so the closed set cannot be widened at all.
		assert.equal(ENTRY_SURFACES.length, 4);
	});

	it("accepts every enum value in each closed set", () => {
		for (const entrySurface of ENTRY_SURFACES) {
			assert.equal(attributionProblem({ ...VALID_BLOCK, entrySurface }), null);
		}
		for (const impactSurface of IMPACT_SURFACES) {
			assert.equal(attributionProblem({ ...VALID_BLOCK, impactSurface }), null);
		}
		for (const responsibleArtifact of RESPONSIBLE_ARTIFACTS) {
			assert.equal(attributionProblem({ ...VALID_BLOCK, responsibleArtifact }), null);
		}
	});
});

describe("finding-attribution validation (attributionProblem)", () => {
	it("accepts a valid block", () => {
		assert.equal(attributionProblem(VALID_BLOCK), null);
	});

	it("rejects non-object values with a repo-style problem string", () => {
		for (const bad of [null, undefined, "tool-output", 42, [], () => {}]) {
			const problem = attributionProblem(bad);
			assert.ok(
				typeof problem === "string" && problem.length > 0,
				`must return a problem string for ${JSON.stringify(bad)}`,
			);
			assert.ok(problem.startsWith("findingAttribution must be a plain object"), problem);
		}
	});

	it("rejects unknown keys with a count — untrusted property names are never echoed (B1R2)", () => {
		const problem = attributionProblem({ ...VALID_BLOCK, permission: "apply" });
		assert.match(problem, /carries 1 unknown field beyond the closed field set/);
		assert.match(problem, /entrySurface, impactSurface, failureMode, responsibleArtifact/);
		assert.ok(!problem.includes("permission"), "the unknown property NAME must not be echoed");
		const two = attributionProblem({ ...VALID_BLOCK, alpha: 1, beta: 2 });
		assert.match(two, /carries 2 unknown fields/);
	});

	it("rejects missing required fields", () => {
		const problem = attributionProblem({
			entrySurface: "tool-output",
			impactSurface: "context",
			responsibleArtifact: "wiki",
		});
		assert.match(problem, /must carry the four fields as own properties/);
		assert.match(problem, /"failureMode"/);
	});

	it("rejects enum violations per field with the closed set named", () => {
		const entry = attributionProblem({ ...VALID_BLOCK, entrySurface: "human-say-so" });
		assert.match(entry, /entrySurface must be one of the closed set/);
		assert.match(entry, /instruction-surface \| tool-output \| policy-rule \| capability-request/);

		const impact = attributionProblem({ ...VALID_BLOCK, impactSurface: "the-moon" });
		assert.match(impact, /impactSurface must be one of the closed set/);

		const artifact = attributionProblem({ ...VALID_BLOCK, responsibleArtifact: "prod-db" });
		assert.match(artifact, /responsibleArtifact must be one of the closed set/);
	});

	it("rejects wrong types on enum fields (no silent coercion)", () => {
		const problem = attributionProblem({ ...VALID_BLOCK, entrySurface: 7 });
		assert.match(problem, /entrySurface must be one of the closed set/);
		assert.match(problem, /got a value of type number/);
	});

	it("rejects blank and non-string failureMode", () => {
		for (const bad of ["", "   ", "\n\t", null, 42, {}]) {
			const problem = attributionProblem({ ...VALID_BLOCK, failureMode: bad });
			assert.match(problem, /failureMode must be a non-empty string/);
		}
	});

	it("never mutates the supplied value and never repairs it", () => {
		const input = { ...VALID_BLOCK, entrySurface: "not-an-enum" };
		const snapshot = JSON.stringify(input);
		const problem = attributionProblem(input);
		assert.match(problem, /entrySurface must be one of the closed set/);
		assert.equal(JSON.stringify(input), snapshot, "input must not be mutated");
		assert.equal(input.entrySurface, "not-an-enum", "no silent coercion or repair");
	});

	it("is deterministic: the same input always yields the same verdict", () => {
		const bad = { ...VALID_BLOCK, impactSurface: "somewhere" };
		assert.equal(attributionProblem(bad), attributionProblem(bad));
		assert.equal(attributionProblem(VALID_BLOCK), attributionProblem({ ...VALID_BLOCK }));
	});

	it("rejects inherited-only carriers (own-fields requirement, B1R SP-B1-03)", () => {
		const inherited = Object.create(VALID_BLOCK);
		assert.notEqual(attributionProblem(inherited), null, "Object.create(valid) must not pass");
		// Its prototype is not Object.prototype/null, so it fails the plain-carrier
		// check — and it serializes to {}, so it must not impersonate a block.
		assert.match(attributionProblem(inherited), /must be a plain object/);
		assert.match(attributionProblem(inherited), /as its own properties/);
		assert.equal(JSON.stringify(inherited), "{}");
		// A plain-prototype object with only SOME own fields hits the explicit
		// own-fields branch.
		const partial = { entrySurface: "tool-output" };
		assert.match(attributionProblem(partial), /as own properties/);
		assert.match(attributionProblem(partial), /inherited-only or non-plain carriers/);
		// A null-prototype object carrying its OWN copies of the four fields is
		// a valid plain carrier (serializable, own fields).
		const ownNullProto = Object.assign(Object.create(null), VALID_BLOCK);
		assert.equal(attributionProblem(ownNullProto), null);
	});

	it("rejects explicit null (present-but-null is not legacy)", () => {
		const problem = attributionProblem(null);
		assert.match(problem, /findingAttribution must be a plain object/);
		assert.match(problem, /got null/);
	});

	it("never echoes rejected strings or untrusted key names — type-only descriptions (B1R2)", () => {
		// Short secret-like strings a partial pattern would miss: the value is
		// described by type only, never quoted. No heuristic decides what is
		// safe to copy — nothing is copied.
		const shortToken = "sk-SyntheticTestCaseTokenABC";
		const entryProblem = attributionProblem({ ...VALID_BLOCK, entrySurface: shortToken });
		assert.ok(!entryProblem.includes(shortToken), "a rejected string value must never be echoed");
		assert.match(entryProblem, /entrySurface must be one of the closed set/);
		assert.match(entryProblem, /got a value of type string/);

		const longProblem = attributionProblem({ ...VALID_BLOCK, entrySurface: "x".repeat(200) });
		assert.ok(!longProblem.includes("x".repeat(10)), "long values are not echoed either");
		assert.match(longProblem, /got a value of type string/);

		// A secret-like unknown property NAME is just as untrusted as a value.
		const secretKeyName = "x_api_key_token_value";
		const keyProblem = attributionProblem({ ...VALID_BLOCK, [secretKeyName]: true });
		assert.ok(!keyProblem.includes(secretKeyName), "unknown property names must never be echoed");
		assert.match(keyProblem, /carries 1 unknown field/);

		// Free-text field: same rule — the observed type is reported, not the text.
		const modeProblem = attributionProblem({ ...VALID_BLOCK, failureMode: `Bearer ${shortToken}` });
		assert.equal(
			modeProblem,
			null,
			"a secret-bearing string is still a non-empty string — shape-valid",
		);
	});
});
