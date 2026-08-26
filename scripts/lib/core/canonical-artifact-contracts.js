"use strict";

/**
 * Canonical Planning Artifact type and Trace contracts (F049 ticket 03, #220).
 *
 * These registries are the closed vocabulary the artifact store admits
 * against (scripts/lib/core/canonical-artifacts.js): Artifact Types with
 * lifecycle state machines and named transitions, plus the versioned Trace
 * registry (refines / realizes / supersedes) with direction, scope, and
 * cardinality. Everything here is frozen data plus pure functions — no I/O —
 * so the admission seam stays the only writer while projections and
 * integrity checks can import the contracts without the store.
 *
 * Lifecycle vocabulary (F049 spec, the authority on state names):
 * - Intent: draft -> accepted, via the named transition `accept`. "a Spec to
 *   refine one *accepted* Intent revision" (User Story 2); CONTEXT.md: "An
 *   accepted Intent may trigger a Spec".
 * - Spec: draft -> approved, via the named transition `approve`. "a Plan to
 *   realize one *approved* Spec revision" (User Story 3); CONTEXT.md: "A Spec
 *   can be approved for planning".
 * - Plan: draft -> approved, via the named transition `approve`. CONTEXT.md:
 *   a Plan links a feature to "goal, vertical slices, verification steps,
 *   evidence schema, and approval state".
 * `draft` is the initial admitted state of every type — the state before the
 * type's gate. A lifecycle change is always an admission carrying a named
 * transition: it produces a NEW revision, never an in-place status mutation
 * (ADR-0023 #3). A revision admitted without a transition carries the type's
 * initial state — changed content must pass the gate again.
 *
 * Trace contracts (F049 spec Implementation Decisions): "Trace types,
 * directions, scope, and cardinality are registered and versioned. A generic
 * relation cannot satisfy required planning lineage."
 * - refines:    spec -> intent, same scope, source cardinality exactly-one
 *   (required planning lineage); the target revision must be `accepted`.
 * - realizes:   plan -> spec, same scope, source cardinality exactly-one
 *   (required planning lineage); the target revision must be `approved`. A
 *   Plan cannot realize an Intent directly (omitted-Spec policy).
 * - supersedes: any registered type -> a DIFFERENT artifact of the same type,
 *   same scope, source cardinality zero-or-more, no target lifecycle gate.
 *   Same-identity revision succession is the Envelope's revision-level
 *   `supersedes` field (the compare-and-swap precondition), not a Trace.
 *
 * Cyclic Trace chains (A -> B -> A) are detected by ticket 04 (#221); this
 * registry only declares the per-admission contract.
 */

const TYPE_REGISTRY = Object.freeze({
	intent: Object.freeze({
		dir: "intents",
		lifecycle: Object.freeze({
			initial: "draft",
			states: Object.freeze(["draft", "accepted"]),
		}),
		transitions: Object.freeze({
			accept: Object.freeze({ name: "accept", from: "draft", to: "accepted" }),
		}),
		requiredTraces: Object.freeze({}),
	}),
	spec: Object.freeze({
		dir: "specs",
		lifecycle: Object.freeze({
			initial: "draft",
			states: Object.freeze(["draft", "approved"]),
		}),
		transitions: Object.freeze({
			approve: Object.freeze({ name: "approve", from: "draft", to: "approved" }),
		}),
		requiredTraces: Object.freeze({
			refines: Object.freeze({ source: "exactly-one" }),
		}),
		lineageRequirement: "a Spec must refine exactly one accepted Intent revision",
	}),
	plan: Object.freeze({
		dir: "plans",
		lifecycle: Object.freeze({
			initial: "draft",
			states: Object.freeze(["draft", "approved"]),
		}),
		transitions: Object.freeze({
			approve: Object.freeze({ name: "approve", from: "draft", to: "approved" }),
		}),
		requiredTraces: Object.freeze({
			realizes: Object.freeze({ source: "exactly-one" }),
		}),
		lineageRequirement: "a Plan must realize exactly one approved Spec revision",
	}),
});

const ARTIFACT_TYPES = Object.freeze(Object.keys(TYPE_REGISTRY));

/**
 * Version of the Trace contract registry as a whole. Recorded on every
 * Envelope that carries Traces (`traceContractVersion`) so later version
 * negotiation (F049 ticket 06, #223) can reject unknown required versions
 * instead of silently reinterpreting them.
 */
const TRACE_REGISTRY_VERSION = 1;

const TRACE_REGISTRY = Object.freeze({
	refines: Object.freeze({
		version: 1,
		description: "A Spec refines exactly one accepted Intent revision (required planning lineage).",
		direction: Object.freeze({ fromType: "spec", toType: "intent" }),
		// "same": both endpoints of the Trace must declare the same scope tag
		// (null counts as a scope); cross-scope Traces are rejected.
		scope: "same",
		cardinality: Object.freeze({ source: "exactly-one", target: "many" }),
		// The target revision must sit in this lifecycle state when the Trace
		// is admitted (an Intent must be accepted before a Spec can refine it).
		targetLifecycle: "accepted",
	}),
	realizes: Object.freeze({
		version: 1,
		description:
			"A Plan realizes exactly one approved Spec revision (required planning lineage; omitted-Spec policy).",
		direction: Object.freeze({ fromType: "plan", toType: "spec" }),
		scope: "same",
		cardinality: Object.freeze({ source: "exactly-one", target: "many" }),
		targetLifecycle: "approved",
	}),
	supersedes: Object.freeze({
		version: 1,
		description:
			"One artifact supersedes a different artifact of the same type; same-identity revision succession is the revision-level supersedes field.",
		// fromType null: any registered type may carry a supersedes Trace.
		// toType "same": the target must be the same type as the source.
		direction: Object.freeze({ fromType: null, toType: "same" }),
		scope: "same",
		cardinality: Object.freeze({ source: "zero-or-more", target: "many" }),
		targetLifecycle: null,
	}),
});

const TRACE_TYPES = Object.freeze(Object.keys(TRACE_REGISTRY));

// Pure-dot path segments ("." / "..") would resolve an artifact home outside
// its per-identity directory — shared by the store and the CLI trace parser.
const DOT_SEGMENT_PATTERN = /^\.+$/;

function isValidArtifactIdentity(identity) {
	return typeof identity === "string" && identity.length > 0 && !DOT_SEGMENT_PATTERN.test(identity);
}

/** The named transition contract of a type, or null when unregistered. */
function transitionFor(type, name) {
	const registry = TYPE_REGISTRY[type];
	if (!registry || typeof name !== "string") return null;
	return registry.transitions[name] || null;
}

/** Registered transition names of a type, in declaration order. */
function registeredTransitionsOf(type) {
	const registry = TYPE_REGISTRY[type];
	return registry ? Object.keys(registry.transitions) : [];
}

/** The lifecycle state a transition leads to, or the type's initial state. */
function lifecycleForAdmission(type, transitionName) {
	if (transitionName !== null && transitionName !== undefined) {
		const contract = transitionFor(type, transitionName);
		return contract ? contract.to : null;
	}
	const registry = TYPE_REGISTRY[type];
	return registry ? registry.lifecycle.initial : null;
}

/** The named transition of a type that lands in a lifecycle state, if any. */
function transitionToState(type, state) {
	const registry = TYPE_REGISTRY[type];
	if (!registry) return null;
	return Object.values(registry.transitions).find((t) => t.to === state) || null;
}

/** The Trace contract registered under a name, or null when unregistered. */
function traceContract(name) {
	return typeof name === "string" ? TRACE_REGISTRY[name] || null : null;
}

/**
 * The concrete Artifact Type a Trace of `traceType` must resolve to for a
 * source artifact of `sourceType` ("same" resolves to the source type).
 */
function expectedToType(traceType, sourceType) {
	const contract = traceContract(traceType);
	if (!contract) return null;
	return contract.direction.toType === "same" ? sourceType : contract.direction.toType;
}

function omittedSpecNote(traceType, declaredType) {
	if (traceType === "realizes" && declaredType === "intent") {
		return " — a Plan cannot realize an Intent directly (omitted-Spec policy): admit a Spec that refines the accepted Intent revision, then realize that Spec";
	}
	return "";
}

/**
 * Structural (I/O-free) Trace validation against the registry: unknown Trace
 * types, direction violations (wrong carrier type, wrong declared target
 * type, same-identity supersedes), and required-lineage cardinality. Target
 * resolution (existence, lifecycle gate, scope confinement) is the store's
 * job — it needs the artifact homes on disk.
 * @param {string} sourceType - The admitting artifact's type.
 * @param {string} sourceIdentity - The admitting artifact's identity.
 * @param {Array<object>} traces - Caller-supplied Trace records.
 * @returns {Array<{code: string, message: string}>} Problems in fixed order.
 */
function structuralTraceProblems(sourceType, sourceIdentity, traces) {
	const problems = [];
	const counts = new Map();
	for (const trace of traces) {
		const contract = traceContract(trace.type);
		if (!contract) {
			problems.push({
				code: "AMBER_E_ARTIFACT_TRACE_UNKNOWN",
				message: `trace type "${trace.type}" is not registered; registered trace types: ${TRACE_TYPES.join(", ")} — a generic or unregistered relation cannot satisfy required planning lineage`,
			});
			continue;
		}
		counts.set(trace.type, (counts.get(trace.type) || 0) + 1);
		if (contract.direction.fromType !== null && contract.direction.fromType !== sourceType) {
			problems.push({
				code: "AMBER_E_ARTIFACT_TRACE_DIRECTION",
				message: `"${trace.type}" Traces are carried by ${contract.direction.fromType} artifacts, but this admission is a ${sourceType} artifact`,
			});
			continue;
		}
		if (trace.type === "supersedes" && trace.to.identity === sourceIdentity) {
			problems.push({
				code: "AMBER_E_ARTIFACT_TRACE_DIRECTION",
				message: `"supersedes" Traces target a different artifact of the same type; "${sourceIdentity}" succeeding itself is revision-level succession — declare it with the expected head (supersedes revision), not a Trace`,
			});
			continue;
		}
		const toType = expectedToType(trace.type, sourceType);
		const declared = trace.to.type;
		if (typeof declared === "string" && declared !== toType) {
			problems.push({
				code: "AMBER_E_ARTIFACT_TRACE_DIRECTION",
				message: `"${trace.type}" Traces must target ${toType} artifacts, but the Trace names target type "${declared}"${omittedSpecNote(trace.type, declared)}`,
			});
		}
	}
	const registry = TYPE_REGISTRY[sourceType];
	if (registry) {
		for (const [required, cardinality] of Object.entries(registry.requiredTraces)) {
			const count = counts.get(required) || 0;
			if (cardinality.source === "exactly-one" && count !== 1) {
				problems.push({
					code: "AMBER_E_ARTIFACT_TRACE_CARDINALITY",
					message: `${registry.lineageRequirement} (required planning lineage); this admission carries ${count} "${required}" Trace${count === 1 ? "" : "s"}`,
				});
			}
		}
	}
	return problems;
}

/**
 * Shape validation for one caller-supplied Trace record. Malformed input is
 * rejected as an argument error before any registry or I/O check — garbage
 * never reaches the Trace contract as a semantic violation.
 * @param {object} trace
 * @returns {string|null} The problem message, or null when well-formed.
 */
function traceShapeProblem(trace) {
	if (!trace || typeof trace !== "object") {
		return `each trace must be an object of the form { type, to: { type?, identity, revision? } }; got ${JSON.stringify(trace)}`;
	}
	if (typeof trace.type !== "string" || trace.type.length === 0) {
		return `trace.type must be a non-empty Trace type name; got ${JSON.stringify(trace.type)}`;
	}
	if (!trace.to || typeof trace.to !== "object") {
		return `trace "${trace.type}" is missing its target: { to: { type?, identity, revision? } }`;
	}
	if (trace.to.type !== undefined && trace.to.type !== null && typeof trace.to.type !== "string") {
		return `trace "${trace.type}" target type must be a string when provided; got ${JSON.stringify(trace.to.type)}`;
	}
	if (!isValidArtifactIdentity(trace.to.identity)) {
		return `trace "${trace.type}" target identity must be a usable artifact identity; got ${JSON.stringify(trace.to.identity)}`;
	}
	if (trace.to.revision !== undefined && trace.to.revision !== null) {
		if (!Number.isInteger(trace.to.revision) || trace.to.revision < 1) {
			return `trace "${trace.type}" target revision must be a positive integer revision number or null; got ${JSON.stringify(trace.to.revision)}`;
		}
	}
	return null;
}

module.exports = {
	TYPE_REGISTRY,
	ARTIFACT_TYPES,
	TRACE_REGISTRY,
	TRACE_REGISTRY_VERSION,
	TRACE_TYPES,
	isValidArtifactIdentity,
	transitionFor,
	registeredTransitionsOf,
	lifecycleForAdmission,
	transitionToState,
	traceContract,
	expectedToType,
	structuralTraceProblems,
	traceShapeProblem,
};
