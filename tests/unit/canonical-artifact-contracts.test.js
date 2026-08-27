"use strict";

// F049 ticket 03 (#220) — Artifact Type and Trace contract registries.
// These tests pin the closed vocabulary the admission seam enforces against:
// lifecycle state machines per registered type, named transitions, and the
// versioned Trace registry (direction / scope / cardinality). The behavioral
// enforcement (stable error codes at the admission seam) is covered by
// tests/unit/canonical-artifacts.test.js; this file pins the registered
// data itself, because a registry drift would silently change admission
// semantics with no code path failing.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
	TYPE_REGISTRY,
	ARTIFACT_TYPES,
	TRACE_REGISTRY,
	TRACE_REGISTRY_VERSION,
	TRACE_TYPES,
	DECISION_KINDS,
	lifecycleForAdmission,
	transitionFor,
	registeredTransitionsOf,
	transitionToState,
	expectedToType,
	traceRequiresDeclaredTarget,
	structuralTraceProblems,
	traceShapeProblem,
} = require("../../scripts/lib/core/canonical-artifact-contracts");

test("the type registry covers intent, spec, plan, and decision (closed set)", () => {
	assert.deepEqual(ARTIFACT_TYPES, ["intent", "spec", "plan", "decision"]);
	assert.equal(Object.isFrozen(TYPE_REGISTRY), true);
});

test("each registered type has a closed lifecycle with named transitions", () => {
	// Lifecycle vocabulary follows the F049 spec's own user stories: a Spec
	// refines an *accepted* Intent revision (US2); a Plan realizes an
	// *approved* Spec revision (US3). draft is every type's initial state.
	assert.deepEqual(TYPE_REGISTRY.intent.lifecycle, {
		initial: "draft",
		states: ["draft", "accepted"],
	});
	assert.deepEqual(TYPE_REGISTRY.spec.lifecycle, {
		initial: "draft",
		states: ["draft", "approved"],
	});
	assert.deepEqual(TYPE_REGISTRY.plan.lifecycle, {
		initial: "draft",
		states: ["draft", "approved"],
	});
	// A Decision records an authority act (F050 ticket 1, #226): its lifecycle
	// is a single recorded state — no transitions exist, so an amended
	// Decision is a new revision of the same identity, never a mutation.
	assert.deepEqual(TYPE_REGISTRY.decision.lifecycle, {
		initial: "recorded",
		states: ["recorded"],
	});
	assert.deepEqual(registeredTransitionsOf("intent"), ["accept"]);
	assert.deepEqual(registeredTransitionsOf("spec"), ["approve"]);
	assert.deepEqual(registeredTransitionsOf("plan"), ["approve"]);
	assert.deepEqual(registeredTransitionsOf("decision"), []);
	assert.deepEqual(registeredTransitionsOf("bogus"), []);
	// Every transition's from/to states are registered states of its type.
	for (const type of ARTIFACT_TYPES) {
		for (const transition of Object.values(TYPE_REGISTRY[type].transitions)) {
			assert.ok(
				TYPE_REGISTRY[type].lifecycle.states.includes(transition.from),
				`${type}.${transition.name}.from is a registered state`,
			);
			assert.ok(
				TYPE_REGISTRY[type].lifecycle.states.includes(transition.to),
				`${type}.${transition.name}.to is a registered state`,
			);
			assert.equal(
				transition.name,
				Object.keys(TYPE_REGISTRY[type].transitions).find(
					(k) => TYPE_REGISTRY[type].transitions[k] === transition,
				),
			);
		}
	}
});

test("transition admission derives the lifecycle state; no transition means the initial state", () => {
	assert.equal(lifecycleForAdmission("intent", null), "draft");
	assert.equal(lifecycleForAdmission("intent", "accept"), "accepted");
	assert.equal(lifecycleForAdmission("spec", "approve"), "approved");
	assert.equal(lifecycleForAdmission("plan", "approve"), "approved");
	assert.equal(lifecycleForAdmission("intent", "bogus"), null);
	assert.equal(lifecycleForAdmission("bogus", "accept"), null);
	assert.equal(lifecycleForAdmission("decision", null), "recorded");
	assert.equal(lifecycleForAdmission("decision", "accept"), null, "a decision has no transitions");
	assert.equal(transitionFor("decision", "accept"), null);
	assert.deepEqual(transitionFor("intent", "accept"), {
		name: "accept",
		from: "draft",
		to: "accepted",
	});
	assert.equal(transitionFor("spec", "accept"), null, "accept is not a spec transition");
	assert.equal(transitionFor("intent", "approve"), null, "approve is not an intent transition");
	assert.deepEqual(transitionToState("intent", "accepted"), {
		name: "accept",
		from: "draft",
		to: "accepted",
	});
	assert.equal(transitionToState("intent", "draft"), null);
});

test("the trace registry is versioned and defines direction, scope, and cardinality", () => {
	assert.deepEqual(TRACE_TYPES, ["refines", "realizes", "supersedes", "decides"]);
	assert.equal(typeof TRACE_REGISTRY_VERSION, "number");
	assert.ok(TRACE_REGISTRY_VERSION >= 1);
	for (const name of TRACE_TYPES) {
		const contract = TRACE_REGISTRY[name];
		assert.equal(typeof contract.version, "number", `${name} carries a registry version`);
		assert.ok(contract.direction && typeof contract.direction === "object");
		assert.ok(contract.cardinality && typeof contract.cardinality === "object");
		assert.ok(contract.scope, `${name} declares a scope rule`);
		assert.equal(Object.isFrozen(contract), true);
	}
	// Required planning lineage: spec -> accepted intent, plan -> approved spec.
	assert.equal(TRACE_REGISTRY.refines.direction.fromType, "spec");
	assert.equal(TRACE_REGISTRY.refines.direction.toType, "intent");
	assert.equal(TRACE_REGISTRY.refines.scope, "same");
	assert.equal(TRACE_REGISTRY.refines.cardinality.source, "exactly-one");
	assert.equal(TRACE_REGISTRY.refines.targetLifecycle, "accepted");
	assert.equal(TRACE_REGISTRY.realizes.direction.fromType, "plan");
	assert.equal(TRACE_REGISTRY.realizes.direction.toType, "spec");
	assert.equal(TRACE_REGISTRY.realizes.scope, "same");
	assert.equal(TRACE_REGISTRY.realizes.cardinality.source, "exactly-one");
	assert.equal(TRACE_REGISTRY.realizes.targetLifecycle, "approved");
	// Supersedes: any type -> a different artifact of the same type.
	assert.equal(TRACE_REGISTRY.supersedes.direction.fromType, null);
	assert.equal(TRACE_REGISTRY.supersedes.direction.toType, "same");
	assert.equal(TRACE_REGISTRY.supersedes.cardinality.source, "zero-or-more");
	assert.equal(TRACE_REGISTRY.supersedes.targetLifecycle, null);
	// Decides (F050 ticket 1, #226): a Decision names its subject — any
	// registered target type, so the Trace must DECLARE the type itself.
	assert.equal(TRACE_REGISTRY.decides.direction.fromType, "decision");
	assert.equal(TRACE_REGISTRY.decides.direction.toType, "any");
	assert.equal(TRACE_REGISTRY.decides.scope, "same");
	assert.equal(TRACE_REGISTRY.decides.cardinality.source, "exactly-one");
	assert.equal(TRACE_REGISTRY.decides.targetLifecycle, null);
	// Expected target types resolve per source type ("same" resolves, "any"
	// stays "any" — the declared-type requirement is enforced downstream).
	assert.equal(expectedToType("refines", "spec"), "intent");
	assert.equal(expectedToType("realizes", "plan"), "spec");
	assert.equal(expectedToType("supersedes", "plan"), "plan");
	assert.equal(expectedToType("decides", "decision"), "any");
	assert.equal(expectedToType("bogus", "plan"), null);
	assert.equal(traceRequiresDeclaredTarget("decides"), true);
	assert.equal(traceRequiresDeclaredTarget("refines"), false);
	assert.equal(traceRequiresDeclaredTarget("supersedes"), false);
	assert.equal(traceRequiresDeclaredTarget("bogus"), false);
});

test("required planning lineage is declared per type; intent carries none", () => {
	assert.deepEqual(TYPE_REGISTRY.intent.requiredTraces, {});
	assert.deepEqual(TYPE_REGISTRY.spec.requiredTraces, {
		refines: { source: "exactly-one" },
	});
	assert.deepEqual(TYPE_REGISTRY.plan.requiredTraces, {
		realizes: { source: "exactly-one" },
	});
	// A Decision must decide exactly one subject (F050 ticket 1, #226).
	assert.deepEqual(TYPE_REGISTRY.decision.requiredTraces, {
		decides: { source: "exactly-one" },
	});
	assert.deepEqual(DECISION_KINDS, ["acceptance", "approval", "review"]);
	assert.equal(Object.isFrozen(DECISION_KINDS), true);
});

test("a decides Trace must declare a registered target type (structural check)", () => {
	// No declared type: the contract cannot derive it from the source type.
	const undeclared = structuralTraceProblems("decision", "decision/x", [
		{ type: "decides", to: { identity: "spec/a" } },
	]);
	assert.equal(undeclared.length, 1);
	assert.equal(undeclared[0].code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");
	assert.match(undeclared[0].message, /must declare their target artifact type/);

	// A declared type outside the closed registry.
	const unregistered = structuralTraceProblems("decision", "decision/x", [
		{ type: "decides", to: { type: "epic", identity: "epic/a" } },
	]);
	assert.equal(unregistered.length, 1);
	assert.equal(unregistered[0].code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");
	assert.match(unregistered[0].message, /must declare a registered target artifact type/);

	// A declared, registered type satisfies the structural cardinality.
	const ok = structuralTraceProblems("decision", "decision/x", [
		{ type: "decides", to: { type: "spec", identity: "spec/a" } },
	]);
	assert.equal(ok.length, 0);

	// A decision carrying no decides Trace misses its required lineage.
	const missing = structuralTraceProblems("decision", "decision/x", []);
	assert.equal(missing.length, 1);
	assert.equal(missing[0].code, "AMBER_E_ARTIFACT_TRACE_CARDINALITY");
	assert.match(missing[0].message, /exactly one/);

	// decides is carried by decision artifacts only.
	const wrongCarrier = structuralTraceProblems("spec", "spec/x", [
		{ type: "decides", to: { type: "intent", identity: "intent/a" } },
	]);
	assert.equal(wrongCarrier.length, 2);
	assert.equal(wrongCarrier[0].code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");
	assert.equal(wrongCarrier[1].code, "AMBER_E_ARTIFACT_TRACE_CARDINALITY");
});

test("a generic relation cannot satisfy required planning lineage (structural check)", () => {
	// An unregistered relation on a Spec: unknown trace type, and the
	// required refines lineage is still unmet.
	const generic = structuralTraceProblems("spec", "spec/x", [
		{ type: "relates-to", to: { type: "intent", identity: "intent/a" } },
	]);
	assert.equal(generic.length, 2);
	assert.equal(generic[0].code, "AMBER_E_ARTIFACT_TRACE_UNKNOWN");
	assert.match(generic[0].message, /relates-to.*not registered/);
	assert.equal(generic[1].code, "AMBER_E_ARTIFACT_TRACE_CARDINALITY");

	// A supersedes Trace is a registered relation, but it is not planning
	// lineage: a Spec carrying only supersedes still misses its required
	// refines Trace.
	const onlySupersedes = structuralTraceProblems("spec", "spec/x", [
		{ type: "supersedes", to: { identity: "spec/other" } },
	]);
	assert.equal(onlySupersedes.length, 1);
	assert.equal(onlySupersedes[0].code, "AMBER_E_ARTIFACT_TRACE_CARDINALITY");
	assert.match(onlySupersedes[0].message, /exactly one accepted Intent revision/);

	// Exactly one refines trace satisfies the structural cardinality.
	const okTraces = structuralTraceProblems("spec", "spec/x", [
		{ type: "refines", to: { type: "intent", identity: "intent/a" } },
	]);
	assert.equal(okTraces.length, 0);
});

test("structural check rejects wrong carriers, wrong target types, and duplicate required traces", () => {
	// refines is carried by spec artifacts, not intents.
	const wrongCarrier = structuralTraceProblems("intent", "intent/a", [
		{ type: "refines", to: { type: "intent", identity: "intent/b" } },
	]);
	assert.equal(wrongCarrier.length, 1);
	assert.equal(wrongCarrier[0].code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");

	// A declared target type the contract contradicts.
	const wrongTarget = structuralTraceProblems("spec", "spec/x", [
		{ type: "refines", to: { type: "plan", identity: "plan/a" } },
	]);
	assert.equal(wrongTarget.length, 1);
	assert.equal(wrongTarget[0].code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");
	assert.match(wrongTarget[0].message, /must target intent artifacts.*"plan"/);

	// Two refines traces violate exactly-one.
	const duplicate = structuralTraceProblems("spec", "spec/x", [
		{ type: "refines", to: { identity: "intent/a" } },
		{ type: "refines", to: { identity: "intent/b" } },
	]);
	assert.equal(duplicate.length, 1);
	assert.equal(duplicate[0].code, "AMBER_E_ARTIFACT_TRACE_CARDINALITY");

	// A Plan realizing an Intent directly names the omitted-Spec policy.
	const omitted = structuralTraceProblems("plan", "plan/x", [
		{ type: "realizes", to: { type: "intent", identity: "intent/a" } },
	]);
	assert.equal(omitted.length, 1);
	assert.equal(omitted[0].code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");
	assert.match(omitted[0].message, /omitted-Spec policy/);
});

test("same-identity supersedes is revision succession, not a Trace", () => {
	// An intent source carries no required lineage, so the ONLY problem here
	// is the self-targeting supersedes Trace.
	const self = structuralTraceProblems("intent", "intent/a", [
		{ type: "supersedes", to: { identity: "intent/a" } },
	]);
	assert.equal(self.length, 1);
	assert.equal(self[0].code, "AMBER_E_ARTIFACT_TRACE_DIRECTION");
	assert.match(self[0].message, /revision-level succession/);
});

test("trace shape validation rejects malformed trace records before any registry check", () => {
	assert.match(traceShapeProblem(null), /each trace must be an object/);
	assert.match(traceShapeProblem({}), /trace\.type must be a non-empty/);
	assert.match(traceShapeProblem({ type: "refines" }), /missing its target/);
	assert.match(
		traceShapeProblem({ type: "refines", to: { identity: "." } }),
		/target identity must be a usable artifact identity/,
	);
	assert.match(
		traceShapeProblem({ type: "refines", to: { identity: "intent/a", revision: 0 } }),
		/target revision must be a positive integer/,
	);
	assert.match(
		traceShapeProblem({ type: "refines", to: { identity: "intent/a", revision: "2" } }),
		/target revision must be a positive integer/,
	);
	assert.equal(traceShapeProblem({ type: "refines", to: { identity: "intent/a" } }), null);
	assert.equal(
		traceShapeProblem({
			type: "refines",
			to: { type: "intent", identity: "intent/a", revision: 2 },
		}),
		null,
	);
});
