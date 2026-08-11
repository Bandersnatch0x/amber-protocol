"use strict";

// ADR-0008 P1: 12 deterministic checks across 5 dimensions (Amber vocabulary).
// Each check is a pure (evidence) => { status, evidenceRefs, confidenceImpact, note? }.
// status ∈ pass | partial | fail | not-applicable. No "null" literal — missing
// evidence is expressed as not-applicable at check level and propagates to
// score=null at dimension level via scoring.js.

// Dimension: Context Adequacy

function ca1FeatureObservable(evidence) {
	const { features } = evidence;
	if (!features.present) {
		return {
			id: "ca-1-feature-observable",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "feature_list.json not found.",
		};
	}
	if (features.features.length === 0) {
		return {
			id: "ca-1-feature-observable",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "feature_list.json has no features.",
		};
	}
	const missing = features.features.filter(
		(f) =>
			!f.user_visible_behavior || !Array.isArray(f.verification) || f.verification.length === 0,
	);
	if (missing.length === 0) {
		return {
			id: "ca-1-feature-observable",
			status: "pass",
			evidenceRefs: ["feature_list.json"],
			confidenceImpact: "medium",
		};
	}
	if (missing.length === features.features.length) {
		return {
			id: "ca-1-feature-observable",
			status: "fail",
			evidenceRefs: ["feature_list.json"],
			confidenceImpact: "medium",
			note: `${missing.length} features lack user_visible_behavior or verification.`,
		};
	}
	return {
		id: "ca-1-feature-observable",
		status: "partial",
		evidenceRefs: ["feature_list.json"],
		confidenceImpact: "medium",
		note: `${missing.length} of ${features.features.length} features lack user_visible_behavior or verification.`,
	};
}

function ca2PlanGoalAcceptance(evidence) {
	const { plans } = evidence;
	if (!plans.present) {
		return {
			id: "ca-2-plan-goal-acceptance",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "docs/plans/ empty.",
		};
	}
	const missing = plans.plans.filter((p) => !p.hasGoal || !p.hasAcceptanceCriteria);
	if (missing.length === 0) {
		return {
			id: "ca-2-plan-goal-acceptance",
			status: "pass",
			evidenceRefs: ["docs/plans/"],
			confidenceImpact: "medium",
		};
	}
	if (missing.length === plans.plans.length) {
		return {
			id: "ca-2-plan-goal-acceptance",
			status: "fail",
			evidenceRefs: ["docs/plans/"],
			confidenceImpact: "low",
			note: "No plan has both Goal and Acceptance Criteria.",
		};
	}
	return {
		id: "ca-2-plan-goal-acceptance",
		status: "partial",
		evidenceRefs: ["docs/plans/"],
		confidenceImpact: "low",
		note: `${missing.length} of ${plans.plans.length} plans lack Goal or Acceptance Criteria.`,
	};
}

function ca3RouteTrigger(evidence) {
	const { routes } = evidence;
	if (routes.count === 0) {
		return {
			id: "ca-3-route-trigger",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "routes/ empty.",
		};
	}
	// P1 checks route surface presence only; trigger goalPattern/complexity
	// content is not exposed by inspectRoutes (governance-readiness.js:75-100)
	// so we do not fabricate a trigger-content claim. Routes present => pass
	// at medium confidence; ADR-0008 P1 boundary defers trigger-content to P2.
	return {
		id: "ca-3-route-trigger",
		status: "pass",
		evidenceRefs: ["routes/"],
		confidenceImpact: "medium",
		note: `${routes.count} routes declared (trigger content not inspected in P1).`,
	};
}

function ca4AgentDocs(evidence) {
	const assets = evidence.agentAssets || { present: false, files: [] };
	if (!assets.present || !assets.files || assets.files.length === 0) {
		return {
			id: "ca-4-agent-docs",
			status: "fail",
			evidenceRefs: ["AGENTS.md", "docs/AGENTS.md"],
			confidenceImpact: "medium",
			note: "No agent-facing docs found (AGENTS.md / CLAUDE.md / docs/AGENTS.md).",
		};
	}
	return {
		id: "ca-4-agent-docs",
		status: "pass",
		evidenceRefs: assets.files,
		confidenceImpact: "medium",
		note: `${assets.files.length} agent doc(s): ${assets.files.join(", ")}.`,
	};
}

// Dimension: Lifecycle Discipline

function ld1RouteGate(evidence) {
	const { routes } = evidence;
	if (routes.count === 0) {
		return {
			id: "ld-1-route-gate",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "routes/ empty.",
		};
	}
	if (routes.withoutGates.length > 0) {
		return {
			id: "ld-1-route-gate",
			status: "fail",
			evidenceRefs: ["routes/"],
			confidenceImpact: "high",
			note: `${routes.withoutGates.length} route(s) declare no gates.`,
		};
	}
	if (routes.withUserApprovalGates.length === routes.count) {
		return {
			id: "ld-1-route-gate",
			status: "pass",
			evidenceRefs: ["routes/"],
			confidenceImpact: "high",
		};
	}
	// All routes have some gate, but not every route has a user-approval gate.
	const approved = routes.withUserApprovalGates.length;
	const note =
		approved === 0
			? "Gates declared but none is user-approval."
			: `Gates declared; only ${approved}/${routes.count} route(s) have a user-approval gate.`;
	return {
		id: "ld-1-route-gate",
		status: "partial",
		evidenceRefs: ["routes/"],
		confidenceImpact: "medium",
		note,
	};
}

function ld2DenyByDefault(evidence) {
	const { glx } = evidence;
	if (glx.rulesMissing) {
		return {
			id: "ld-2-deny-by-default",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "rules.json not found.",
		};
	}
	if (glx.unsafeDefaultAllow) {
		return {
			id: "ld-2-deny-by-default",
			status: "fail",
			evidenceRefs: [".amber/governance/rules.json"],
			confidenceImpact: "high",
			note: "defaultAction is allow.",
		};
	}
	return {
		id: "ld-2-deny-by-default",
		status: "pass",
		evidenceRefs: [".amber/governance/rules.json"],
		confidenceImpact: "high",
	};
}

function ld3WorktreeIsolation(evidence) {
	const { workflowPacks } = evidence;
	if (workflowPacks.count === 0) {
		return {
			id: "ld-3-worktree-isolation",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "No workflow packs present.",
		};
	}
	const issues =
		workflowPacks.missingWorktreeIsolation.length + workflowPacks.missingReviewGates.length;
	if (issues === 0) {
		return {
			id: "ld-3-worktree-isolation",
			status: "pass",
			evidenceRefs: ["workflow-packs/"],
			confidenceImpact: "high",
		};
	}
	return {
		id: "ld-3-worktree-isolation",
		status: "partial",
		evidenceRefs: ["workflow-packs/"],
		confidenceImpact: "medium",
		note: `${workflowPacks.missingWorktreeIsolation.length} pack(s) missing worktree isolation, ${workflowPacks.missingReviewGates.length} missing review gates.`,
	};
}

// P2: correlate amber-native session gate events with lifecycle discipline.
// Host-transcript-only sessions (no stage/gate signals) stay not-applicable.
function ld4SessionGateEvidence(evidence) {
	const sessions = evidence.sessions || [];
	if (sessions.length === 0) {
		return {
			id: "ld-4-session-gate-evidence",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "No session observations.",
		};
	}
	const withLifecycle = sessions.filter(
		(s) => (s.stageTransitions || 0) > 0 || (s.approvals || 0) > 0 || (s.denials || 0) > 0,
	);
	if (withLifecycle.length === 0) {
		return {
			id: "ld-4-session-gate-evidence",
			status: "not-applicable",
			evidenceRefs: [".amber/sessions/"],
			confidenceImpact: "low",
			note: "Session observations present but no stage/gate events (host transcript-only).",
		};
	}
	const withGate = withLifecycle.filter((s) => (s.approvals || 0) > 0 || (s.denials || 0) > 0);
	if (withGate.length === withLifecycle.length) {
		return {
			id: "ld-4-session-gate-evidence",
			status: "pass",
			evidenceRefs: [".amber/sessions/"],
			confidenceImpact: "high",
			note: `${withGate.length} session(s) record gate approvals or denials.`,
		};
	}
	if (withGate.length > 0) {
		return {
			id: "ld-4-session-gate-evidence",
			status: "partial",
			evidenceRefs: [".amber/sessions/"],
			confidenceImpact: "medium",
			note: `${withGate.length}/${withLifecycle.length} lifecycle session(s) record gate events.`,
		};
	}
	return {
		id: "ld-4-session-gate-evidence",
		status: "fail",
		evidenceRefs: [".amber/sessions/"],
		confidenceImpact: "medium",
		note: "Sessions show stage transitions but no gate approvals/denials.",
	};
}

// Dimension: Verification Coverage

// P2: session-level validation/failure signals when lifecycle sessions exist.
function vc3SessionValidationEvidence(evidence) {
	const sessions = evidence.sessions || [];
	if (sessions.length === 0) {
		return {
			id: "vc-3-session-validation",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "No session observations.",
		};
	}
	const withSignal = sessions.filter(
		(s) =>
			(s.stageTransitions || 0) > 0 || (s.validationFailures || 0) > 0 || (s.failures || 0) > 0,
	);
	if (withSignal.length === 0) {
		return {
			id: "vc-3-session-validation",
			status: "not-applicable",
			evidenceRefs: [".amber/sessions/"],
			confidenceImpact: "low",
			note: "Session observations present but no stage/validation failure signals (host transcript-only).",
		};
	}
	const withFailures = withSignal.filter(
		(s) => (s.validationFailures || 0) > 0 || (s.failures || 0) > 0,
	);
	// Failures preserved is good evidence; stage transitions without failures
	// also pass (successful runs leave stage events). Sessions with no signal
	// at all already returned not-applicable above — this check observes
	// capability and never fails; defect detection is ld-4's job.
	return {
		id: "vc-3-session-validation",
		status: "pass",
		evidenceRefs: [".amber/sessions/"],
		confidenceImpact: "medium",
		note:
			withFailures.length > 0
				? `${withFailures.length} session(s) preserve validation/runtime failure counts; ${withSignal.length} with lifecycle signal.`
				: `${withSignal.length} session(s) record stage transitions (no validation failures recorded).`,
	};
}

function vc1VerifyDiscoverable(evidence) {
	const cmd = evidence.verifyCommand;
	if (!cmd) {
		return {
			id: "vc-1-verify-discoverable",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "No toolchain evidence.",
		};
	}
	return {
		id: "vc-1-verify-discoverable",
		status: "pass",
		evidenceRefs: ["package.json"],
		confidenceImpact: "medium",
		note: `verify command: ${cmd}`,
	};
}

function vc2ExecutionCommands(evidence) {
	const { executions } = evidence;
	if (!executions.present) {
		return {
			id: "vc-2-execution-commands",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "No executions recorded.",
		};
	}
	if (!executions.hasCommands) {
		// ponytail: P1 reads evidence.json.commands; Amber's task-execution model
		// records commands in ledger.json. Aligning the read source is P2 work;
		// until then this check reports the gap honestly rather than fabricating.
		return {
			id: "vc-2-execution-commands",
			status: "fail",
			evidenceRefs: [".amber/executions/"],
			confidenceImpact: "low",
			note: "Executions present but none record commands in evidence.json (P2: align to ledger.json).",
		};
	}
	return {
		id: "vc-2-execution-commands",
		status: "pass",
		evidenceRefs: [".amber/executions/"],
		confidenceImpact: "medium",
	};
}

// Dimension: Delivery Integrity

function di1HandoffComplete(evidence) {
	const { handoff } = evidence;
	if (!handoff.present) {
		return {
			id: "di-1-handoff-complete",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "Handoff bundle not present.",
		};
	}
	if (handoff.missing.length === 0) {
		return {
			id: "di-1-handoff-complete",
			status: "pass",
			evidenceRefs: [".amber/handoff/latest/"],
			confidenceImpact: "medium",
		};
	}
	return {
		id: "di-1-handoff-complete",
		status: "partial",
		evidenceRefs: [".amber/handoff/latest/"],
		confidenceImpact: "low",
		note: `Bundle missing ${handoff.missing.length} required file(s): ${handoff.missing.join(", ")}.`,
	};
}

function di2RisksRecorded(evidence) {
	const { handoff } = evidence;
	if (!handoff.present) {
		return {
			id: "di-2-risks-recorded",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "Handoff bundle not present.",
		};
	}
	const risksOk = handoff.risksBody.trim().length > 0;
	const recoveryOk = handoff.recoveryBody.trim().length > 0;
	if (risksOk && recoveryOk) {
		return {
			id: "di-2-risks-recorded",
			status: "pass",
			evidenceRefs: [
				".amber/handoff/latest/risks.md",
				".amber/handoff/latest/recovery-commands.md",
			],
			confidenceImpact: "medium",
		};
	}
	if (!risksOk && !recoveryOk) {
		return {
			id: "di-2-risks-recorded",
			status: "fail",
			evidenceRefs: [".amber/handoff/latest/risks.md"],
			confidenceImpact: "low",
			note: "Both risks and recovery sections empty.",
		};
	}
	return {
		id: "di-2-risks-recorded",
		status: "partial",
		evidenceRefs: [".amber/handoff/latest/"],
		confidenceImpact: "low",
		note: "Risks or recovery section empty.",
	};
}

// Dimension: Improvement Loop

function il1EvolutionRecurrent(evidence) {
	const { evolution } = evidence;
	if (evolution.findings.length === 0) {
		return {
			id: "il-1-evolution-recurrent",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "Evolution log has no Finding: entries.",
		};
	}
	if (evolution.significant.length > 0) {
		return {
			id: "il-1-evolution-recurrent",
			status: "pass",
			evidenceRefs: ["docs/wiki/engineering/harness-evolution.md"],
			confidenceImpact: "high",
			note: `${evolution.significant.length} recurring finding(s) at count>=2.`,
		};
	}
	return {
		id: "il-1-evolution-recurrent",
		status: "partial",
		evidenceRefs: ["docs/wiki/engineering/harness-evolution.md"],
		confidenceImpact: "low",
		note: "Findings present but none recurrent (count<2).",
	};
}

function il2RegressionTraceable(evidence) {
	if (evidence.regressionProposals.length === 0) {
		return {
			id: "il-2-regression-traceable",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "No regression proposals present.",
		};
	}
	return {
		id: "il-2-regression-traceable",
		status: "pass",
		evidenceRefs: [".amber/executions/"],
		confidenceImpact: "high",
		note: `${evidence.regressionProposals.length} regression proposal(s) with assertion.`,
	};
}

// P3: intervention outcome validation. A full structured intervention ledger
// (mechanism vocabulary + validation state) is not yet implemented — ADR-0008
// P3 defers it. Per ADR-0008 §Status, this check reports not-applicable
// honestly until the ledger lands: it cannot validate an intervention→outcome
// link because no per-intervention ledger exists. The detected signal (accepted
// features with an evolution trail) is recorded as a candidate for the future
// ledger, not as a validation result. When the ledger lands, this check is
// replaced by one that validates each intervention's later outcome explicitly.
function il3InterventionValidated(evidence) {
	const { evolution, features } = evidence;
	if (!features.present) {
		return {
			id: "il-3-intervention-validated",
			status: "not-applicable",
			evidenceRefs: [],
			confidenceImpact: "low",
			note: "No feature_list.json to validate outcomes against.",
		};
	}
	const acceptedCount = features.features.filter((f) => f.status === "accepted").length;
	const hasTrail = evolution.findings.length > 0;
	// ponytail: honest not-applicable, not partial — without a per-intervention
	// ledger (P3-deferred) we cannot link any specific intervention to a later
	// validated outcome. Record the candidate signal in the note for the future
	// ledger; never report partial/pass.
	const note =
		hasTrail && acceptedCount > 0
			? `${acceptedCount} accepted feature(s) with an evolution trail detected as candidates; structured intervention ledger is P3-deferred, so validation is not yet possible.`
			: hasTrail
				? "Evolution trail present but no features reached accepted state; structured intervention ledger is P3-deferred."
				: "No structured interventions in the evolution log; P3 intervention ledger not yet implemented.";
	const evidenceRefs =
		hasTrail && acceptedCount > 0
			? ["feature_list.json", "docs/wiki/engineering/harness-evolution.md"]
			: ["feature_list.json"];
	return {
		id: "il-3-intervention-validated",
		status: "not-applicable",
		evidenceRefs,
		confidenceImpact: "low",
		note,
	};
}

const CHECKS_BY_DIMENSION = {
	contextAdequacy: [ca1FeatureObservable, ca2PlanGoalAcceptance, ca3RouteTrigger, ca4AgentDocs],
	lifecycleDiscipline: [
		ld1RouteGate,
		ld2DenyByDefault,
		ld3WorktreeIsolation,
		ld4SessionGateEvidence,
	],
	verificationCoverage: [vc1VerifyDiscoverable, vc2ExecutionCommands, vc3SessionValidationEvidence],
	deliveryIntegrity: [di1HandoffComplete, di2RisksRecorded],
	improvementLoop: [il1EvolutionRecurrent, il2RegressionTraceable, il3InterventionValidated],
};

function runChecks(evidence) {
	const byDimension = {};
	for (const [dim, checks] of Object.entries(CHECKS_BY_DIMENSION)) {
		byDimension[dim] = checks.map((fn) => fn(evidence));
	}
	return byDimension;
}

module.exports = {
	CHECKS_BY_DIMENSION,
	runChecks,
	ca1FeatureObservable,
	ca2PlanGoalAcceptance,
	ca3RouteTrigger,
	ca4AgentDocs,
	ld1RouteGate,
	ld2DenyByDefault,
	ld3WorktreeIsolation,
	ld4SessionGateEvidence,
	vc1VerifyDiscoverable,
	vc2ExecutionCommands,
	vc3SessionValidationEvidence,
	di1HandoffComplete,
	di2RisksRecorded,
	il1EvolutionRecurrent,
	il2RegressionTraceable,
	il3InterventionValidated,
};
