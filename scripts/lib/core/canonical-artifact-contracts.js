"use strict";

/**
 * Canonical Planning Artifact type and Trace contracts (F049 ticket 03, #220;
 * F050 ticket 1, #226 adds the decision type and the decides trace).
 *
 * These registries are the closed vocabulary the artifact store admits
 * against (scripts/lib/core/canonical-artifacts.js): Artifact Types with
 * lifecycle state machines and named transitions, plus the versioned Trace
 * registry (refines / realizes / supersedes / decides; see below) with
 * direction, scope, and cardinality. Everything here is frozen data plus
 * pure functions — no I/O — so the admission seam stays the only writer
 * while projections and integrity checks can import the contracts without
 * the store.
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
 * - Decision (F050, #226): `recorded` is both the initial and only lifecycle
 *   state — a Decision is a point-in-time record, never a state machine. It
 *   binds the acting Principal (verified against the Principal registry at
 *   admission), the Decision kind, its subject artifact (via `decides`
 *   Traces), and its rationale (the Body). There is no transition: an
 *   amended decision is a new revision superseding the old one, exactly
 *   like every other revision-level change.
 * - Gate (F050, #228): draft -> active via the named transition `activate`,
 *   active -> retired via the named transition `retire`. A Gate is the
 *   reviewable contract admission is decided against — never hidden weights
 *   or model confidence — and its machine-actionable content (required
 *   evidence, assurance, thresholds, owners, expiry, dependencies, failure
 *   behavior) rides the Envelope's existing extensions carrier under the
 *   `gate` namespace. The registry adds NO type-specific envelope
 *   validation here: the deterministic evaluator
 *   (scripts/lib/core/gate-evaluation.js) is that content's first shape
 *   consumer and owns the contract verdicts.
 * - Policy (F050, #230): draft -> active via the named transition `activate`,
 *   active -> retired via the named transition `retire`. A Policy is the
 *   deny-wins ceiling for strict consumption. Its machine-actionable content
 *   rides the Envelope's existing extensions carrier under the `policy`
 *   namespace; the policy evaluator is the first shape consumer, so the
 *   artifact registry remains opaque and type-generic.
 * `draft` is the initial admitted state of every gate-bearing type — the
 *   state before the type's gate. A lifecycle change is always an admission
 *   carrying a named transition: it produces a NEW revision, never an
 *   in-place status mutation (ADR-0023 #3). A revision admitted without a
 *   transition carries the type's initial state — changed content must pass
 *   the gate again.
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
 * - decides:    decision -> any registered type, same scope, source
 *   cardinality exactly-one (required subject lineage), no target lifecycle
 *   gate. The direction toType is the reserved word "any": unlike every
 *   other trace type, a decides Trace MUST declare its target type
 *   explicitly, because the registry cannot derive it from the source type
 *   (a Decision may record against an Intent, Spec, Plan, or another
 *   Decision's revision).
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
	decision: Object.freeze({
		dir: "decisions",
		lifecycle: Object.freeze({
			initial: "recorded",
			states: Object.freeze(["recorded"]),
		}),
		transitions: Object.freeze({}),
		requiredTraces: Object.freeze({
			decides: Object.freeze({ source: "exactly-one" }),
		}),
		lineageRequirement:
			"a Decision must decide exactly one committed artifact revision of a registered type (declared by the decides Trace)",
	}),
	gate: Object.freeze({
		dir: "gates",
		lifecycle: Object.freeze({
			initial: "draft",
			states: Object.freeze(["draft", "active", "retired"]),
		}),
		transitions: Object.freeze({
			activate: Object.freeze({ name: "activate", from: "draft", to: "active" }),
			retire: Object.freeze({ name: "retire", from: "active", to: "retired" }),
		}),
		requiredTraces: Object.freeze({}),
	}),
	policy: Object.freeze({
		dir: "policies",
		lifecycle: Object.freeze({
			initial: "draft",
			states: Object.freeze(["draft", "active", "retired"]),
		}),
		transitions: Object.freeze({
			activate: Object.freeze({ name: "activate", from: "draft", to: "active" }),
			retire: Object.freeze({ name: "retire", from: "active", to: "retired" }),
		}),
		requiredTraces: Object.freeze({}),
	}),
	eval: Object.freeze({
		dir: "evals",
		lifecycle: Object.freeze({
			initial: "draft",
			states: Object.freeze(["draft", "active", "retired"]),
		}),
		transitions: Object.freeze({
			activate: Object.freeze({ name: "activate", from: "draft", to: "active" }),
			retire: Object.freeze({ name: "retire", from: "active", to: "retired" }),
		}),
		requiredTraces: Object.freeze({}),
	}),
	"eval-result": Object.freeze({
		dir: "eval-results",
		lifecycle: Object.freeze({
			initial: "recorded",
			states: Object.freeze(["recorded"]),
		}),
		transitions: Object.freeze({}),
		requiredTraces: Object.freeze({}),
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
	decides: Object.freeze({
		version: 1,
		description:
			"A Decision records its subject: exactly one committed revision of any registered artifact type (the target type must be declared by the Trace).",
		// fromType "decision": only Decisions carry a decides Trace.
		// toType "any": the target type CANNOT be derived from the source type,
		// so the Trace must declare it explicitly — the structural check and
		// the store both reject a decides Trace without a declared, registered
		// target type.
		direction: Object.freeze({ fromType: "decision", toType: "any" }),
		scope: "same",
		cardinality: Object.freeze({ source: "exactly-one", target: "many" }),
		targetLifecycle: null,
	}),
});

const TRACE_TYPES = Object.freeze(Object.keys(TRACE_REGISTRY));

/**
 * Envelope schema version this code writes (F049 ticket 06, #223). Version
 * negotiation is fail-closed in both directions: a reader rejects any
 * schemaVersion it cannot interpret instead of silently reinterpreting the
 * Envelope, and a writer only ever emits a supported version.
 */
const ENVELOPE_SCHEMA_VERSION = 1;

/** Every schemaVersion this reader can interpret, ascending. */
const SUPPORTED_ENVELOPE_SCHEMA_VERSIONS = Object.freeze([1]);

/**
 * The closed set of Decision kinds (F050, #226): Acceptance, Approval, and
 * Review are DISTINCT authorities and never interchangeable — one Decision
 * record exercises exactly one kind. Acceptance and Approval are human-only
 * slots (a service principal cannot occupy them); Review is the only kind a
 * service principal may carry.
 */
const DECISION_KINDS = Object.freeze(["acceptance", "approval", "review"]);

/** The closed set of Principal kinds: humans and service identities. */
const PRINCIPAL_KINDS = Object.freeze(["human", "service"]);

/**
 * The closed field set of the frozen principal snapshot a decision Envelope
 * carries: exactly the Principal registry's stored record (admission freezes
 * principalRecordOf's output), so any other key or shape on a stored
 * Envelope is hand-edited state.
 */
const PRINCIPAL_SNAPSHOT_FIELDS = Object.freeze([
	"id",
	"principalKind",
	"role",
	"membership",
	"capability",
	"scope",
	"validFrom",
	"validTo",
	"issuer",
]);

/**
 * The closed set of core Envelope field names (F049 ticket 06, #223). An
 * Envelope carrying a top-level field outside this set was written by a newer
 * writer (or hand-edited); readers reject it with
 * AMBER_E_ARTIFACT_UNKNOWN_FIELD instead of silently dropping the field.
 * Extension data lives under the reserved `extensions` carrier — never at the
 * top level — so the core semantics of every revision stay interpretable by
 * every reader that knows its schemaVersion.
 *
 * F050 (#226): `decisionKind` and `principal` are core fields (not extension
 * data — the extensions carrier is contractually opaque) but they are carried
 * ONLY by decision Envelopes; decisionBindingProblem rejects their presence on
 * any other type.
 */
const ENVELOPE_CORE_FIELDS = Object.freeze([
	"schemaVersion",
	"type",
	"identity",
	"revision",
	"supersedes",
	"bodyHash",
	"lifecycle",
	"transition",
	"scope",
	"traces",
	"traceContractVersion",
	"provenance",
	"committedAt",
	"envelopeHash",
	"extensions",
	"decisionKind",
	"principal",
]);

/** The reserved top-level carrier for extension namespaces (AC2). */
const EXTENSION_CARRIER_FIELD = "extensions";

const ENVELOPE_CORE_FIELD_SET = new Set(ENVELOPE_CORE_FIELDS);

function isCoreEnvelopeField(name) {
	return typeof name === "string" && ENVELOPE_CORE_FIELD_SET.has(name);
}

/**
 * Version negotiation over one stored Envelope (F049 spec story 13: unknown
 * required versions are rejected, never silently reinterpreted).
 *
 * Negotiated fields:
 * - `schemaVersion`: absent reads as the implicit only version (1 — every
 *   Envelope shape this store has ever written carries it, but legacy
 *   envelopes are not punished for omitting it); present values must be an
 *   integer this reader supports.
 * - `traceContractVersion`: recorded on every Envelope that carries Traces
 *   precisely so this check can refuse unknown Trace registries (see the
 *   TRACE_REGISTRY_VERSION contract above). Absent is fine (no Traces, or a
 *   pre-ticket-03 Envelope).
 *
 * @param {object} envelope - Stored Envelope.
 * @returns {{code: string, message: string}|null} The negotiation problem.
 */
function envelopeVersionProblem(envelope) {
	if (!envelope || typeof envelope !== "object") return null;
	if (envelope.schemaVersion !== undefined) {
		const version = envelope.schemaVersion;
		if (!Number.isInteger(version) || !SUPPORTED_ENVELOPE_SCHEMA_VERSIONS.includes(version)) {
			return {
				code: "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION",
				message: `the Envelope for "${envelope.identity}" revision ${envelope.revision} declares schemaVersion ${JSON.stringify(version)}, but this reader supports ${SUPPORTED_ENVELOPE_SCHEMA_VERSIONS.join(", ")}; a version this reader cannot interpret is rejected rather than reinterpreted — upgrade amber or re-admit the artifact at a supported schema version`,
			};
		}
	}
	const traceVersion = envelope.traceContractVersion;
	if (traceVersion !== undefined) {
		if (!Number.isInteger(traceVersion) || traceVersion !== TRACE_REGISTRY_VERSION) {
			return {
				code: "AMBER_E_ARTIFACT_UNSUPPORTED_VERSION",
				message: `the Envelope for "${envelope.identity}" revision ${envelope.revision} declares traceContractVersion ${JSON.stringify(traceVersion)}, but this reader implements Trace registry version ${TRACE_REGISTRY_VERSION}; an unknown Trace contract is rejected rather than reinterpreted — upgrade amber or re-admit the artifact under the registered Trace contract`,
			};
		}
	}
	return null;
}

/**
 * Closed-set check over the Envelope's top-level fields (F049 spec story 13:
 * a required field this reader does not recognize is rejected, not silently
 * dropped). Unknown field names are reported in sorted order so the verdict
 * is a pure function of the field SET, never of JSON key order.
 * @param {object} envelope - Stored Envelope.
 * @returns {{code: string, message: string}|null} The unknown-field problem.
 */
function envelopeUnknownFieldProblem(envelope) {
	if (!envelope || typeof envelope !== "object") return null;
	const unknown = Object.keys(envelope)
		.filter((key) => !ENVELOPE_CORE_FIELD_SET.has(key))
		.sort();
	if (unknown.length === 0) return null;
	return {
		code: "AMBER_E_ARTIFACT_UNKNOWN_FIELD",
		message: `the Envelope for "${envelope.identity}" revision ${envelope.revision} carries the unknown field${unknown.length > 1 ? "s" : ""} ${unknown.map((field) => `"${field}"`).join(", ")}, which this reader does not know; unknown Envelope fields are rejected rather than silently dropped — the Envelope was written by a newer writer or hand-edited, and extension data belongs in the reserved "${EXTENSION_CARRIER_FIELD}" carrier`,
	};
}

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The Decision binding contract over one Envelope (F050 ticket 1, #226):
 * `decisionKind` and `principal` are core fields carried ONLY by decision
 * Envelopes. A decision Envelope must carry a kind from the closed set and a
 * well-formed principal snapshot (the verified-at-admission binding of the
 * acting Principal); any other Envelope must carry neither field.
 *
 * Shared by the read seam (committedProjection validates the stored Envelope)
 * so a hand-crafted or newer-writer binding is rejected with its own stable
 * code instead of being silently served — the writer seam (admitArtifact)
 * constructs the binding through registry verification, so admission can
 * never produce a malformed one.
 * @param {object} envelope - Stored Envelope.
 * @returns {{code: string, message: string}|null} The binding problem.
 */
function decisionBindingProblem(envelope) {
	if (!envelope || typeof envelope !== "object") return null;
	const isDecision = envelope.type === "decision";
	const carriesKind = envelope.decisionKind !== undefined && envelope.decisionKind !== null;
	const carriesPrincipal = envelope.principal !== undefined && envelope.principal !== null;
	if (!isDecision && !carriesKind && !carriesPrincipal) return null;
	if (!isDecision) {
		return {
			code: "AMBER_E_ARTIFACT_UNKNOWN_FIELD",
			message: `the Envelope for "${envelope.identity}" revision ${envelope.revision} is a ${envelope.type} artifact but carries decision-only field${carriesKind && carriesPrincipal ? "s" : ""} ${[
				carriesKind ? "decisionKind" : null,
				carriesPrincipal ? "principal" : null,
			]
				.filter(Boolean)
				.map((field) => `"${field}"`)
				.join(", ")}; only decision Envelopes bind a Decision kind and acting Principal`,
		};
	}
	if (!carriesKind || !DECISION_KINDS.includes(envelope.decisionKind)) {
		return {
			code: "AMBER_E_DECISION_KIND_INVALID",
			message: `the decision Envelope for "${envelope.identity}" revision ${envelope.revision} ${carriesKind ? `carries decisionKind ${JSON.stringify(envelope.decisionKind)}` : "carries no decisionKind"}, which is outside the closed kind set (${DECISION_KINDS.join(", ")})`,
		};
	}
	const principal = envelope.principal;
	if (!carriesPrincipal || !isPlainObject(principal)) {
		return {
			code: "AMBER_E_DECISION_PRINCIPAL_REQUIRED",
			message: `the decision Envelope for "${envelope.identity}" revision ${envelope.revision} carries no principal binding: every Decision binds the Principal that acted, verified against the registry at admission`,
		};
	}
	if (
		typeof principal.id !== "string" ||
		principal.id.length === 0 ||
		typeof principal.principalKind !== "string" ||
		!PRINCIPAL_KINDS.includes(principal.principalKind)
	) {
		return {
			code: "AMBER_E_DECISION_PRINCIPAL_REQUIRED",
			message: `the decision Envelope for "${envelope.identity}" revision ${envelope.revision} carries a malformed principal binding ${JSON.stringify(principal)}: the verified snapshot must bind { id, principalKind: human|service, role, membership, capability, scope, validFrom, validTo, issuer }`,
		};
	}
	// The snapshot's closed field set: admission freezes the registry's
	// 9-field record, so an unknown key or a non-string optional field on a
	// stored Envelope is hand-edited state, exactly like an unknown
	// top-level Envelope field.
	const snapshotKeys = Object.keys(principal).sort();
	if (
		snapshotKeys.length !== PRINCIPAL_SNAPSHOT_FIELDS.length ||
		snapshotKeys.some((field) => !PRINCIPAL_SNAPSHOT_FIELDS.includes(field)) ||
		["role", "membership", "capability", "scope", "validFrom", "validTo", "issuer"].some(
			(field) =>
				principal[field] !== null &&
				!(typeof principal[field] === "string" && principal[field].length > 0),
		)
	) {
		return {
			code: "AMBER_E_DECISION_PRINCIPAL_REQUIRED",
			message: `the decision Envelope for "${envelope.identity}" revision ${envelope.revision} carries a malformed principal binding ${JSON.stringify(principal)}: the snapshot must bind exactly the frozen registry record fields (${PRINCIPAL_SNAPSHOT_FIELDS.join(", ")}) with every optional field null or a non-empty string`,
		};
	}
	// Human-only slots are a binding invariant, not just an admission gate:
	// acceptance/approval authority requires a human principal, and admission
	// can never write a service principal into one — so a stored envelope that
	// carries one is hand-edited state and fails the read closed.
	if (
		(envelope.decisionKind === "acceptance" || envelope.decisionKind === "approval") &&
		principal.principalKind !== "human"
	) {
		return {
			code: "AMBER_E_DECISION_HUMAN_SLOT_REQUIRED",
			message: `the decision Envelope for "${envelope.identity}" revision ${envelope.revision} binds a ${envelope.decisionKind} Decision to a ${principal.principalKind} principal ("${principal.id}"); formal acceptance and approval are human-only slots that admission can never bind to a service identity — this is hand-edited state`,
		};
	}
	return null;
}

// Extension values are carried opaquely as JSON (AC2): probe-serialize each
// leaf so a caller can never smuggle a non-JSON value into the durable
// Envelope (where the canonical hash would silently mangle it).
function jsonSerializableProblem(namespace, key, value) {
	let serialized;
	try {
		serialized = JSON.stringify(value);
	} catch {
		serialized = undefined;
	}
	if (serialized === undefined) {
		return `the extension value under "${namespace}.${key}" is not JSON-serializable; extension data is carried opaquely as JSON, so it must survive JSON.stringify unchanged`;
	}
	return null;
}

/**
 * The extension namespace contract (F049 ticket 06, #223 — AC2) over one
 * `extensions` carrier value. Rules:
 *   (a) extension data is carried ONLY inside the carrier, one sub-object per
 *       namespace — never merged into the Envelope's core fields;
 *   (b) namespace names and per-namespace keys must never collide with or
 *       shadow a core Envelope field (a consumer that flattens a namespace
 *       must not be able to overwrite `type`, `identity`, `traces`, ...);
 *   (c) unregistered namespaces are carried opaquely — any shape check here
 *       is structural (strings, objects, JSON), never an interpretation of
 *       the namespace's meaning.
 *
 * Shared by the writer seam (admitArtifact validates caller-supplied
 * extensions before any durable state is touched) and the reader seam
 * (committedProjection validates the stored carrier), so admission can never
 * write an Envelope the read side would refuse a moment later.
 *
 * @param {*} extensions - The `extensions` carrier value to validate.
 * @returns {{code: string, message: string}|null} The contract violation.
 */
function extensionNamespaceProblem(extensions) {
	if (extensions === undefined || extensions === null) return null;
	if (!isPlainObject(extensions)) {
		return {
			code: "AMBER_E_ARTIFACT_EXTENSION_COLLISION",
			message: `the "${EXTENSION_CARRIER_FIELD}" carrier must be an object mapping namespace → { key → value } (or absent); got ${JSON.stringify(extensions)}`,
		};
	}
	for (const namespace of Object.keys(extensions).sort()) {
		if (typeof namespace !== "string" || namespace.length === 0) {
			return {
				code: "AMBER_E_ARTIFACT_EXTENSION_COLLISION",
				message: `extension namespace names must be non-empty strings; got ${JSON.stringify(namespace)}`,
			};
		}
		if (isCoreEnvelopeField(namespace)) {
			return {
				code: "AMBER_E_ARTIFACT_EXTENSION_COLLISION",
				message: `the extension namespace "${namespace}" collides with the core Envelope field "${namespace}"; extension namespaces must never shadow core Envelope fields — pick a namespace of your own`,
			};
		}
		const entries = extensions[namespace];
		if (!isPlainObject(entries)) {
			return {
				code: "AMBER_E_ARTIFACT_EXTENSION_COLLISION",
				message: `the extension namespace "${namespace}" must map to an object of key → value; got ${JSON.stringify(entries)}`,
			};
		}
		for (const key of Object.keys(entries).sort()) {
			if (typeof key !== "string" || key.length === 0) {
				return {
					code: "AMBER_E_ARTIFACT_EXTENSION_COLLISION",
					message: `extension keys under namespace "${namespace}" must be non-empty strings; got ${JSON.stringify(key)}`,
				};
			}
			if (isCoreEnvelopeField(key)) {
				return {
					code: "AMBER_E_ARTIFACT_EXTENSION_COLLISION",
					message: `the extension key "${namespace}.${key}" would shadow the core Envelope field "${key}"; extension keys must never collide with core Envelope fields — rename the key`,
				};
			}
			const unsafe = jsonSerializableProblem(namespace, key, entries[key]);
			if (unsafe !== null) {
				return { code: "AMBER_E_ARTIFACT_EXTENSION_COLLISION", message: unsafe };
			}
		}
	}
	return null;
}

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
 * source artifact of `sourceType` ("same" resolves to the source type). The
 * reserved word "any" passes through unresolved: the Trace MUST declare its
 * target type, which the structural check and the store validate against
 * ARTIFACT_TYPES (see traceRequiresDeclaredTarget).
 */
function expectedToType(traceType, sourceType) {
	const contract = traceContract(traceType);
	if (!contract) return null;
	return contract.direction.toType === "same" ? sourceType : contract.direction.toType;
}

/**
 * Whether a Trace type's contract direction cannot derive the target type
 * from the source type ("any"), so the Trace record must declare its target
 * type explicitly. Shared by the structural check here and the CLI trace
 * parser (scripts/lib/canonical-artifact-commands.js), so both seams enforce
 * the same grammar.
 */
function traceRequiresDeclaredTarget(traceType) {
	return traceContract(traceType)?.direction.toType === "any";
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
		if (toType === "any") {
			// A decides Trace names its own target type: the registry cannot
			// derive it from the source type, so the declaration is REQUIRED
			// and must itself be a registered type.
			if (typeof declared !== "string" || declared.length === 0) {
				problems.push({
					code: "AMBER_E_ARTIFACT_TRACE_DIRECTION",
					message: `"${trace.type}" Traces must declare their target artifact type — the "${trace.type}" contract allows any registered type, so the Trace itself names it: { to: { type, identity } } (registered types: ${ARTIFACT_TYPES.join(", ")})`,
				});
			} else if (!ARTIFACT_TYPES.includes(declared)) {
				problems.push({
					code: "AMBER_E_ARTIFACT_TRACE_DIRECTION",
					message: `"${trace.type}" Traces must declare a registered target artifact type; "${declared}" is not registered (registered types: ${ARTIFACT_TYPES.join(", ")})`,
				});
			}
			continue;
		}
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
	ENVELOPE_SCHEMA_VERSION,
	SUPPORTED_ENVELOPE_SCHEMA_VERSIONS,
	ENVELOPE_CORE_FIELDS,
	EXTENSION_CARRIER_FIELD,
	DECISION_KINDS,
	isCoreEnvelopeField,
	envelopeVersionProblem,
	envelopeUnknownFieldProblem,
	decisionBindingProblem,
	extensionNamespaceProblem,
	isValidArtifactIdentity,
	transitionFor,
	registeredTransitionsOf,
	lifecycleForAdmission,
	transitionToState,
	traceContract,
	expectedToType,
	traceRequiresDeclaredTarget,
	structuralTraceProblems,
	traceShapeProblem,
};
