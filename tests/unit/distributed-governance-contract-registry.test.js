"use strict";

// Both sides of the distributed-governance contract registry validator: the
// shipped registry must pass, and every rule the module states must reject a
// registry that breaks it. Rules with no rejecting test are rules nobody has
// ever seen fire.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadRegistry, loadSchema, evaluateCompatibility, validateRegistry } = require(
	path.resolve(
		__dirname,
		"..",
		"..",
		"scripts",
		"lib",
		"core",
		"distributed-governance-contract-registry.js",
	),
);

const registry = loadRegistry();
const schema = loadSchema();

function structuredClone(value) {
	return JSON.parse(JSON.stringify(value));
}

/** Mutate one copy and return the errors it produced. */
function errorsAfter(mutate) {
	const copy = structuredClone(registry);
	mutate(copy);
	const result = validateRegistry(copy, schema);
	assert.equal(result.valid, false, "mutation was expected to be rejected");
	return result.errors;
}

function hasMatch(errors, pattern) {
	return errors.some((error) => pattern.test(error));
}

function entryById(copy, id) {
	return copy.entries.find((entry) => entry.id === id);
}

const IMPLEMENTED = "amber.distributed-governance.contract.sync-envelope";
const ABSENT = "amber.distributed-governance.contract.team";
const INVARIANT = "amber.distributed-governance.invariant.repository-local-authority";
const ARTIFACT = "amber.distributed-governance.artifact.work";

// ── The shipped registry ───────────────────────────────────────

test("shipped registry passes schema and self-consistency checks", () => {
	const result = validateRegistry(registry, schema);
	assert.deepEqual(result.errors, []);
	assert.equal(result.valid, true);
});

test("registry declares 49 entries across three kinds", () => {
	assert.equal(registry.entries.length, 49);
	const kinds = registry.entries.reduce(
		(acc, entry) => ({ ...acc, [entry.kind]: (acc[entry.kind] || 0) + 1 }),
		{},
	);
	assert.deepEqual(kinds, { contract: 29, artifact: 8, invariant: 12 });
});

// ── Schema side ────────────────────────────────────────────────

test("rejects an unknown top-level field", () => {
	const errors = errorsAfter((copy) => {
		copy.extraTopLevel = true;
	});
	assert.ok(hasMatch(errors, /additional property "extraTopLevel"/));
});

test("rejects an entry field the schema does not know", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, IMPLEMENTED).disposition = "supported";
	});
	assert.ok(hasMatch(errors, /additional property "disposition"/));
});

test("rejects a version domain outside the declared set", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, IMPLEMENTED).versionDomain = "capability";
	});
	assert.ok(hasMatch(errors, /versionDomain must be one of/));
});

test("rejects a non-semver registry version", () => {
	const errors = errorsAfter((copy) => {
		copy.registryVersion = "2.0";
	});
	assert.ok(hasMatch(errors, /registryVersion .* does not match required pattern/));
});

// ── Taxonomy ───────────────────────────────────────────────────

test("rejects dropping a declared version domain", () => {
	const errors = errorsAfter((copy) => {
		copy.versionDomains = copy.versionDomains.filter((domain) => domain.id !== "projection-rule");
	});
	assert.ok(hasMatch(errors, /version domains must be .* in that order/));
});

test("rejects reordering the version domains", () => {
	const errors = errorsAfter((copy) => {
		copy.versionDomains.reverse();
	});
	assert.ok(hasMatch(errors, /version domains must be .* in that order/));
});

test("rejects a duplicate version domain identifier", () => {
	const errors = errorsAfter((copy) => {
		copy.versionDomains.push(structuredClone(copy.versionDomains[0]));
	});
	assert.ok(hasMatch(errors, /version domain identifiers must be unique/));
});

test("rejects dropping the one designed-not-implemented bounded context", () => {
	const errors = errorsAfter((copy) => {
		copy.boundedContexts = copy.boundedContexts.filter(
			(context) => context.id !== "organization-control-plane",
		);
	});
	assert.ok(hasMatch(errors, /bounded contexts must be exactly/));
});

test("rejects one version assigned to two dispositions", () => {
	const errors = errorsAfter((copy) => {
		copy.versionDomains[0].refusedVersions = ["0.9.0"];
	});
	assert.ok(hasMatch(errors, /assigns a version to multiple dispositions/));
});

// ── Entry consistency ──────────────────────────────────────────

test("rejects a duplicate entry identifier", () => {
	const errors = errorsAfter((copy) => {
		copy.entries.push(structuredClone(entryById(copy, IMPLEMENTED)));
	});
	assert.ok(hasMatch(errors, /entry identifiers must be unique/));
});

test("rejects an identifier whose kind segment disagrees with kind", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, IMPLEMENTED).kind = "invariant";
	});
	assert.ok(hasMatch(errors, /filed as invariant but its identifier says contract/));
});

test("rejects an entry naming an unknown owning context", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, IMPLEMENTED).owningContext = "nowhere";
	});
	assert.ok(hasMatch(errors, /owningContext must be one of|unknown owning context/));
});

test("rejects an invariant that claims an owning context", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, INVARIANT).owningContext = "amber-core";
	});
	assert.ok(hasMatch(errors, /must be cross-cutting, not owned/));
});

test("rejects an artifact that claims a version domain", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, ARTIFACT).versionDomain = "contract-schema";
	});
	assert.ok(hasMatch(errors, /must own a context and carry no version domain/));
});

test("rejects a contract with no version domain", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, IMPLEMENTED).versionDomain = null;
	});
	assert.ok(hasMatch(errors, /must name a version domain and an owning context/));
});

test("rejects crossCutting on a non-invariant entry", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, IMPLEMENTED).crossCutting = true;
	});
	assert.ok(hasMatch(errors, /sets crossCutting on a non-invariant entry/));
});

// ── The derived pair ───────────────────────────────────────────

test("rejects supported compatibility on an unimplemented entry", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, ABSENT).compatibility = "supported";
	});
	assert.ok(hasMatch(errors, /compatibility is derived/));
});

test("rejects unknown compatibility on an implemented entry", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, IMPLEMENTED).compatibility = "unknown";
	});
	assert.ok(hasMatch(errors, /compatibility is derived/));
});

test("rejects a master concept named for a designed-not-implemented entry", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, ABSENT).masterConcept = "Team";
	});
	assert.ok(hasMatch(errors, /names a master concept for a designed-not-implemented entry/));
});

test("rejects an implemented entry with no master concept", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, IMPLEMENTED).masterConcept = null;
	});
	assert.ok(hasMatch(errors, /omits a master concept for a implemented entry/));
});

// ── Justification surfaces ─────────────────────────────────────

test("rejects an implemented entry with no path", () => {
	const errors = errorsAfter((copy) => {
		entryById(copy, IMPLEMENTED).paths = [];
	});
	assert.ok(hasMatch(errors, /carries no path/));
});

test("rejects a non-implemented entry with no justification at all", () => {
	const errors = errorsAfter((copy) => {
		const entry = entryById(copy, ABSENT);
		delete entry.note;
		delete entry.nearMisses;
		delete entry.nameCollision;
		entry.paths = [];
	});
	assert.ok(hasMatch(errors, /no justification surface/));
});

test("rejects a superseded entry naming neither a successor nor a reason", () => {
	const errors = errorsAfter((copy) => {
		const entry = entryById(copy, "amber.distributed-governance.contract.read-snapshot");
		assert.equal(entry.implementation, "superseded");
		delete entry.note;
		delete entry.supersededBy;
		entry.paths = [];
		entry.nearMisses = [
			{ path: "schemas/sync-envelope.schema.json", why: "keeps the note-free case reachable" },
		];
	});
	assert.ok(hasMatch(errors, /names neither its successor nor a reason/));
});

// ── Compatibility matrix ───────────────────────────────────────

test("rejects a duplicate compatibility case identifier", () => {
	const errors = errorsAfter((copy) => {
		copy.compatibility.cases.push(structuredClone(copy.compatibility.cases[0]));
	});
	assert.ok(
		hasMatch(errors, /evidence identifiers must be unique/) ||
			hasMatch(errors, /case identifiers must be unique/),
	);
});

test("rejects dropping an outcome from the matrix", () => {
	const errors = errorsAfter((copy) => {
		copy.compatibility.cases = copy.compatibility.cases.filter(
			(item) => item.expectedOutcome !== "refused",
		);
	});
	assert.ok(hasMatch(errors, /must cover refused combinations/));
});

test("rejects a case whose combination does not evaluate to its claim", () => {
	const errors = errorsAfter((copy) => {
		const item = copy.compatibility.cases.find((c) => c.expectedOutcome === "deprecated");
		item.expectedOutcome = "supported";
	});
	assert.ok(hasMatch(errors, /expects supported but evaluates as deprecated/));
});

test("rejects an evidence identifier unrelated to its combination", () => {
	const errors = errorsAfter((copy) => {
		copy.compatibility.cases[0].evidenceId =
			"amber.distributed-governance.evidence.compatibility.supported.deadbeefdeadbeef";
	});
	assert.ok(hasMatch(errors, /evidence identifier unrelated to its combination/));
});

test("rejects an outcome precedence that is not the declared one", () => {
	const errors = errorsAfter((copy) => {
		copy.compatibility.outcomePrecedence = ["supported", "deprecated", "refused", "unknown"];
	});
	assert.ok(hasMatch(errors, /outcome precedence must be/));
});

test("rejects a rollup that disagrees with the entries", () => {
	const errors = errorsAfter((copy) => {
		copy.compatibility.entryRollup.unknown = 11;
	});
	assert.ok(hasMatch(errors, /rollup says 11 unknown entries but there are 12/));
});

// ── evaluateCompatibility ──────────────────────────────────────

test("classifies each declared version against its domain", () => {
	const at = (version) => ({
		contractSchema: version,
		runtimeProtocol: "1.0.0",
		projectionRule: "1.0.0",
	});
	assert.equal(evaluateCompatibility(registry, at("1.0.0"), schema).outcome, "supported");
	assert.equal(evaluateCompatibility(registry, at("0.9.0"), schema).outcome, "deprecated");
	assert.equal(evaluateCompatibility(registry, at("0.8.0"), schema).outcome, "refused");
	assert.equal(evaluateCompatibility(registry, at("3.1.4"), schema).outcome, "unknown");
});

test("the most severe domain outcome wins", () => {
	const combination = {
		contractSchema: "1.0.0",
		runtimeProtocol: "0.8.0",
		projectionRule: "0.9.0",
	};
	const result = evaluateCompatibility(registry, combination, schema);
	assert.equal(result.outcome, "refused");
	assert.ok(result.reasons.some((reason) => reason.includes("runtime-protocol 0.8.0 is refused")));
});

test("a partial combination fails closed as unknown", () => {
	const result = evaluateCompatibility(registry, { contractSchema: "1.0.0" }, schema);
	assert.equal(result.outcome, "unknown");
	assert.match(result.reasons[0], /must name every version domain exactly once/);
});

test("evidence identifiers are stable and combination-derived", () => {
	const combination = {
		contractSchema: "1.0.0",
		runtimeProtocol: "1.0.0",
		projectionRule: "1.0.0",
	};
	const first = evaluateCompatibility(registry, combination, schema);
	const second = evaluateCompatibility(registry, structuredClone(combination), schema);
	assert.equal(first.evidenceId, second.evidenceId);
	assert.equal(first.evidenceId, registry.compatibility.cases[0].evidenceId);
});

test("an unregistered combination still derives an identifier", () => {
	const result = evaluateCompatibility(
		registry,
		{ contractSchema: "1.0.0", runtimeProtocol: "1.0.0", projectionRule: "5.0.0" },
		schema,
	);
	assert.equal(result.outcome, "unknown");
	assert.match(
		result.evidenceId,
		/^amber\.distributed-governance\.evidence\.compatibility\.unknown\.[0-9a-f]{16}$/,
	);
});
