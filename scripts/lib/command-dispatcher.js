"use strict";

/**
 * Command dispatcher for the Amber CLI.
 *
 * Replaces the monolithic if/else-if chain in amber.js with a lookup-table
 * pattern. Each command maps to a handler function that receives parsed args
 * and returns `{ result, exitCode }`. The dispatcher standardises the output
 * envelope (`{ target, errors, warnings, ... }`) so the CLI run() function
 * becomes a thin parser → dispatch → print pipeline.
 *
 * Command definitions bind to handlers at startup, so help, output policy,
 * dispatch, and the public command list cannot drift independently.
 */

const path = require("node:path");

// ── Barrel imports ──────────────────────────────────────────────────────────
// Direct core imports (the amber-core facade was removed — ADR-0005, #4 PR2).
const { scaffoldHarness, scaffoldWiki } = require("./core/scaffold");
const { auditProject, validateHandoff } = require("./core/audit");
const { doctor } = require("./core/doctor");
const {
	scaffoldPlan,
	validatePlanGate,
	confirmPlanGate,
	reviewPlan,
	acceptPlan,
} = require("./core/planning");
const { resolveSessionFeature, readPlanFeature } = require("./core/feature-attribution");
const { validateWiki } = require("./core/validators");
const { exportOkfBundle } = require("./core/okf-export");
const { inspectWorkflowPack, inspectWorkflowPackReadiness } = require("./core/workflow-packs");
const { inspectProjectProfile } = require("./core/profiles");
const { prepareTaskExecution, inspectTaskResult } = require("./core/task-execution");
const {
	dispatchAgentTask,
	setAgentDispatchStatus,
	recordAgentReview,
} = require("./core/agent-orchestration");
const {
	inspectLoopContract,
	recommendLoopContract,
	recordLoopContract,
	inspectLoopLedger,
} = require("./core/loops");
const {
	executeLoopContract,
	approveLoopContract,
	verifyLoopLedger,
} = require("./core/loop-execution");
const {
	inspectTeamDistribution,
	installTeamDistribution,
	pinTeamDistribution,
	updateTeamDistribution,
	rollbackTeamDistribution,
} = require("./core/team");
const routeCommands = require("./route-commands");
const { resolveTargetRoutesDirectory } = require("./route-loader");
const featureCommands = require("./feature-commands");
const {
	generateAdoptionReport,
	listAdoptionReports,
	writeAdoptionReportsIndex,
	validateAdoptionReports,
	compareAdoptionReports,
} = require("./core/adoption-reports");
const { gateAdoptionReport, statusAdoptionReports } = require("./core/adoption-gate");
const { bundleAdoptionArtifacts, writeAdoptionNextActions } = require("./core/adoption-bundle");
const {
	writeAdoptionDecisionRecord,
	writeAdoptionApplyPlan,
	writeAdoptionSelectedFiles,
} = require("./core/adoption-proposals");
const sessionCommands = require("./session-commands");
const {
	resolveTarget,
	unknownAction,
	shapeResult,
	requireSessionId,
} = require("./command-helpers");
const { projectionDispatch } = require("./projection-commands");
const { syncDispatch } = require("./sync-commands");
const { knowledgeDispatch } = require("./knowledge-commands");
const { phaseDispatch } = require("./phase-commands");
const { artifactDispatch } = require("./canonical-artifact-commands");
const { principalDispatch } = require("./principal-commands");
const { evalDispatch } = require("./eval-commands");
const { evidenceDispatch } = require("./evidence-commands");
const { orgAuditDispatch } = require("./org-audit-commands");
const { hooksDispatch } = require("./hooks-commands");
const { bindCommandHandlers } = require("./command-registry");
const { inferNext } = require("./next-command");
const { backfillVersioning, migrateManifests } = require("./migrate-command");
const { migrateState, migrateWiki } = require("./state-migration");
const { validateWorkflowPack, validateLoopContract } = require("./core/execution-validator");

// ── Helpers ─────────────────────────────────────────────────────────────────

function handleMaintenance(args) {
	const { maintenanceDispatch } = require("./maintenance/adapters/command");
	return maintenanceDispatch(args._?.[0], args);
}

function handleAdoption(args) {
	const action = args._?.[0];
	if (action === "report") return { result: generateAdoptionReport(args.target, args) };
	if (action === "list") return { result: listAdoptionReports(args) };
	if (action === "index") return { result: writeAdoptionReportsIndex(args) };
	if (action === "validate") return { result: validateAdoptionReports(args) };
	if (action === "compare") return { result: compareAdoptionReports(args) };
	if (action === "gate") return { result: gateAdoptionReport(args) };
	if (action === "status") return { result: statusAdoptionReports(args) };
	if (action === "bundle") return { result: bundleAdoptionArtifacts(args) };
	if (action === "next-actions") return { result: writeAdoptionNextActions(args) };
	if (action === "decision-record") return { result: writeAdoptionDecisionRecord(args) };
	if (action === "apply-plan") return { result: writeAdoptionApplyPlan(args) };
	if (action === "selected-files") return { result: writeAdoptionSelectedFiles(args) };
	return {
		result: unknownAction("adoption", [
			"report",
			"list",
			"index",
			"validate",
			"compare",
			"gate",
			"status",
			"bundle",
			"next-actions",
			"decision-record",
			"apply-plan",
			"selected-files",
		]),
	};
}

function handleLedger(args) {
	const action = args._?.[0];
	const targetRoot = resolveTarget(args);
	if (action === "export") {
		const { exportLedger } = require("./core/ledger-export");
		const result = exportLedger(targetRoot, { format: args.format, home: args.home });
		if (args.out) {
			const fs = require("node:fs");
			const outputPath = path.resolve(targetRoot, args.out);
			fs.writeFileSync(outputPath, result.payload + "\n");
			return shapeResult(args, {
				text: `Wrote ${result.ledgers.length} ledger(s) to ${outputPath} (intact=${result.intactCount}, broken=${result.brokenCount})`,
				errors: result.errors,
				warnings: result.warnings,
			});
		}
		if (args.json) {
			return shapeResult(args, result, { bypassPrint: false });
		}
		return shapeResult(args, {
			text: result.payload,
			errors: result.errors,
			warnings: result.warnings,
		});
	}
	if (action === "seal") {
		const { sealLedger } = require("./core/ledger-seal");
		const result = sealLedger(targetRoot, { reviewer: args.reviewer });
		const text = result.sealed
			? `Sealed ${result.ledgerCount} ledger(s) to tag ${result.tagName} at HEAD ${result.head}.`
			: `Seal failed: ${result.errors.join("; ")}`;
		return shapeResult(
			args,
			{ text, ...result, errors: result.errors, warnings: result.warnings },
			{ exitCode: result.sealed ? 0 : 1 },
		);
	}
	if (action === "verify-anchoring") {
		const { verifyAnchoring } = require("./core/ledger-seal");
		const result = verifyAnchoring(targetRoot);
		let text;
		if (result.errors?.length > 0) {
			text = result.errors.join("; ");
		} else if (result.anchored) {
			text = `Anchored: all ledgers match seal tag ${result.sealTag}.`;
		} else {
			text = `NOT anchored: ${result.ledgerChangedSinceSeal} ledger(s) changed since seal tag ${result.sealTag}.`;
		}
		return shapeResult(
			args,
			{ text, ...result, errors: result.errors, warnings: result.warnings },
			{ exitCode: result.errors?.length ? 1 : result.anchored ? 0 : 1 },
		);
	}
	return shapeResult(
		args,
		{ errors: ["ledger requires export, seal, or verify-anchoring."] },
		{ exitCode: 1 },
	);
}

async function handleSession(args) {
	const action = args._?.[0];
	const targetRoot = resolveTarget(args);
	let sessionResult;

	if (action === "start") {
		let parsedBudget;
		if (args.budget) {
			parsedBudget = parseInt(args.budget, 10);
			if (isNaN(parsedBudget) || parsedBudget <= 0) {
				sessionResult = { text: "Error: --budget must be a positive integer", exitCode: 1 };
			}
		}
		if (!sessionResult) {
			sessionResult = await sessionCommands.startSession(targetRoot, {
				goal: args.goal || args._?.[1],
				route: args.route,
				budget: parsedBudget,
				worktree: args.worktree,
				mode: args.mode,
				feature: args.feature,
				agent: args.agent,
			});
		}
	} else if (action === "status") {
		sessionResult = sessionCommands.statusSession(targetRoot, { sessionId: args._?.[1] });
	} else if (action === "list") {
		sessionResult = sessionCommands.listSessions(targetRoot, {});
	} else if (action === "abort") {
		sessionResult = await sessionCommands.abortSession(targetRoot, {
			sessionId: args._?.[1] || args.session,
			requestId: args.requestId,
		});
	} else if (action === "continue") {
		sessionResult = await sessionCommands.continueSession(targetRoot, {
			sessionId: args._?.[1] || args.session,
			requestId: args.requestId,
		});
	} else if (action === "complete-check") {
		sessionResult = requireSessionId(args, "complete-check");
		if (!sessionResult) {
			const { buildCompletionResult } = require("./completion-check");
			const completion = buildCompletionResult(targetRoot, args.session, args);
			sessionResult = { text: completion.text, exitCode: completion.errors.length > 0 ? 1 : 0 };
		}
	} else if (action === "complete") {
		sessionResult = requireSessionId(args, "complete");
		if (!sessionResult) {
			sessionResult = await sessionCommands.completeSession(targetRoot, {
				sessionId: args.session,
				strict: args.strict,
				requestId: args.requestId,
			});
		}
	} else if (action === "verify") {
		sessionResult = requireSessionId(args, "verify");
		if (!sessionResult) {
			sessionResult = await sessionCommands.verifySession(targetRoot, {
				sessionId: args.session,
				stage: args.stage,
				command: args.command,
				result: args.result,
				execute: args.execute,
				feature: args.feature,
			});
		}
	} else if (action === "approve") {
		sessionResult = requireSessionId(args, "approve");
		if (!sessionResult) {
			sessionResult = await sessionCommands.approveSession(targetRoot, {
				sessionId: args.session,
				gate: args.gate || args._?.[1],
				yes: args.yes,
			});
		}
	} else if (action === "verify-ledger") {
		sessionResult = requireSessionId(args, "verify-ledger");
		if (!sessionResult) {
			sessionResult = sessionCommands.verifyLedgerSession(targetRoot, args.session);
		}
	} else {
		sessionResult = {
			text: "session requires start, status, list, abort, continue, complete-check, complete, verify, verify-ledger, or approve.",
			exitCode: 1,
		};
	}

	const result = {
		target: args.target,
		text: sessionResult.text,
		errors: sessionResult.exitCode === 0 ? [] : [sessionResult.text],
		warnings: [],
		...(sessionResult.sessionId ? { sessionId: sessionResult.sessionId } : {}),
	};
	return { result, exitCode: sessionResult.exitCode, bypassPrint: !args.json };
}

function handleGovernance(args) {
	const action = args._?.[0];
	const { governanceDispatch } = require("./governance-commands");
	return {
		result: governanceDispatch(action, args.target, {
			session: args.session,
			task: args.task,
			all: args.all,
			output: args.output,
			since: args.since,
			framework: args.framework,
			json: args.json,
			targetDisplay: args.target || ".",
			action: args._?.[1],
			command: args.command,
		}),
	};
}

// ── Simple command wrappers ─────────────────────────────────────────────────

function handleInit(args) {
	return {
		result: scaffoldHarness(args.target, {
			dryRun: args.dryRun,
			withWiki: args.withWiki,
			skipDetection: args.skipDetection,
			refreshAmberOwned: args.refreshAmberOwned,
		}),
	};
}

function handleAudit(args) {
	const sub = args._?.[0];
	if (sub === "org") {
		return handleOrganizationAudit(args);
	}
	return { result: auditProject(args.target) };
}

function handleOrganizationAudit(args) {
	return orgAuditDispatch(args);
}

function handleWiki(args) {
	const action = args._?.[0];

	if (action === "export") {
		return { result: exportOkfBundle(args.target, { outputDir: args.outputDir }) };
	}

	// Knowledge Plan support (declarative architecture + knowledge cards, integrated for Amber).
	// F013-K1/K2: all knowledge subcommands cross the command adapter + root facade.
	// Adapter owns option mapping, aliases, unknown-action guidance, and rendering.
	if (action === "knowledge") {
		const { knowledgeDispatch } = require("./knowledge-plan/adapters/command");
		return knowledgeDispatch(args._?.[1], args);
	}

	if (args.okf) {
		return { result: validateWiki(args.target, { okf: true }) };
	}

	return { result: scaffoldWiki(args.target, { dryRun: args.dryRun }) };
}

function handleDoctor(args) {
	return { result: doctor(args.target, { okf: args.okf }) };
}

function handleHandoff(args) {
	const action = args._?.[0];
	if (action === "bundle") {
		const { writeHandoffBundle } = require("./core/handoff-bundle");
		return {
			result: writeHandoffBundle(resolveTarget(args), {
				outputDir: args.outputDir || args.bundleDir,
				targetDisplay: args.target || ".",
			}),
		};
	}
	if (action === "validate") {
		const {
			defaultBundleDir,
			resolveTargetRelativePath,
			validateHandoffBundle,
		} = require("./core/handoff-bundle");
		const targetRoot = resolveTarget(args);
		const bundleDir =
			args.bundleDir || args.outputDir
				? resolveTargetRelativePath(targetRoot, args.bundleDir || args.outputDir)
				: defaultBundleDir(targetRoot);
		return { result: { target: targetRoot, ...validateHandoffBundle(bundleDir) } };
	}
	const { writeHandoff } = require("./handoff-command");
	const rel = "session-handoff.md";
	const written = writeHandoff(args.target, { dryRun: args.dryRun });
	const validation = validateHandoff(args.target);
	const wrote = written.changed && !args.dryRun;
	return {
		result: {
			target: validation.target,
			created: wrote ? [rel] : [],
			skipped: written.changed ? [] : [rel],
			nextSteps: validation.nextSteps || [],
			warnings: [
				...(validation.warnings || []),
				...(args.dryRun && written.changed
					? [`Dry-run: ${rel} would be regenerated from live state (not written).`]
					: []),
			],
			errors: validation.errors || [],
		},
	};
}

function handlePlan(args) {
	return {
		result: scaffoldPlan(args.target, {
			feature: args.feature,
			title: args.title,
			dryRun: args.dryRun,
		}),
	};
}

function handleGate(args) {
	if (args.confirm) {
		return { result: confirmPlanGate(args.target, args.plan) };
	}
	return { result: validatePlanGate(args.target, args.plan) };
}

function handleReview(args) {
	return { result: reviewPlan(args.target, args.plan) };
}

function handleAccept(args) {
	// Guard: when a session is named, the plan must belong to that session's
	// feature. Only block on a definite mismatch (both known and different) —
	// an unreadable session/plan falls through and is reported downstream.
	if (args.session) {
		const targetRoot = resolveTarget(args);
		const sessionFeature = resolveSessionFeature(targetRoot, args.session);
		const planFeature = readPlanFeature(targetRoot, args.plan);
		if (sessionFeature && planFeature && sessionFeature !== planFeature) {
			return {
				result: {
					target: args.target,
					accepted: false,
					errors: [
						`Plan feature ${planFeature} does not match session ${args.session} (feature ${sessionFeature}). ` +
							`Accept the plan for ${sessionFeature}, or pass a --session whose feature is ${planFeature}.`,
					],
					warnings: [],
				},
			};
		}
	}

	const acceptResult = acceptPlan(args.target, args.plan, { force: args.force });
	if (!args.session) return { result: acceptResult };

	const { buildCompletionResult } = require("./completion-check");
	const completion = buildCompletionResult(resolveTarget(args), args.session, args);
	return {
		result: {
			...acceptResult,
			text: [acceptResult.text || "", completion.text].join("\n"),
			warnings: [...(acceptResult.warnings || []), ...completion.warnings],
			errors: [...(acceptResult.errors || []), ...completion.errors],
		},
	};
}

// ── Subcommand-driven command handlers ──────────────────────────────────────

function handlePack(args) {
	const action = args._?.[0];
	if (action === "inspect" || action === "validate") {
		const r = inspectWorkflowPack(args.file || "");
		if (action === "validate") r.valid = r.errors.length === 0;
		return { result: r };
	}
	if (action === "readiness") {
		return { result: inspectWorkflowPackReadiness(args.file || args._?.[1] || "") };
	}
	if (action === "validate-execution") {
		const packPath = args.file || args.pack || args._?.[1] || "";
		const v = validateWorkflowPack(packPath);
		return {
			result: { target: args.target, ...v, errors: v.errors || [], warnings: v.warnings || [] },
		};
	}
	return {
		result: unknownAction("pack", ["inspect", "validate", "readiness", "validate-execution"]),
	};
}

function handleProfile(args) {
	const action = args._?.[0];
	if (action === "deployment") {
		return handleDeploymentProfile(args);
	}
	if (action !== "inspect") {
		return { result: unknownAction("profile", ["inspect", "deployment"]) };
	}
	return { result: inspectProjectProfile(args.file || "") };
}

function handleDeploymentProfile(args) {
	const sub = args._?.[1];
	const {
		showDeploymentProfile,
		resolveDeploymentProfile,
		writeProfileFile,
		validateDeploymentProfile,
	} = require("./core/deployment-profile");
	const target = args.target || ".";
	if (sub === "show") {
		const shown = showDeploymentProfile(target);
		const exitCode = shown.errors.length > 0 ? 1 : 0;
		return {
			result: {
				target,
				text: JSON.stringify(shown, null, 2),
				errors: shown.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "set") {
		const profile = args.profile;
		if (!profile) {
			return {
				result: {
					target,
					text: "",
					errors: [
						"profile deployment set requires --profile <personal-node|team-hub|organization>",
					],
					warnings: [],
				},
				exitCode: 1,
				bypassPrint: !args.json,
			};
		}
		const written = writeProfileFile(target, profile);
		const exitCode = written.errors.length > 0 ? 1 : 0;
		return {
			result: {
				target,
				text: written.errors.length > 0 ? "" : `Deployment profile set to ${profile}.`,
				errors: written.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "validate") {
		const { valid, deploymentProfile, errors } = validateDeploymentProfile(target);
		return {
			result: {
				target,
				text: JSON.stringify({ valid, deploymentProfile }, null, 2),
				errors: errors,
				warnings: [],
			},
			exitCode: valid ? 0 : 1,
			bypassPrint: !args.json,
		};
	}
	if (sub === "resolve") {
		const resolved = resolveDeploymentProfile(target);
		const exitCode = resolved.errors.length > 0 ? 1 : 0;
		return {
			result: {
				target,
				text: JSON.stringify(resolved, null, 2),
				errors: resolved.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	return { result: unknownAction("profile deployment", ["show", "set", "validate", "resolve"]) };
}

function handleTask(args) {
	if (args._?.[0] !== "prepare") {
		return { result: unknownAction("task", ["prepare"]) };
	}
	return { result: prepareTaskExecution(args.target, args.plan, args.task, args) };
}

function handleResult(args) {
	if (args._?.[0] !== "inspect") {
		return { result: unknownAction("result", ["inspect"]) };
	}
	return { result: inspectTaskResult(args.target, args.task) };
}

function handleAgent(args) {
	const action = args._?.[0];
	if (action === "dispatch") return { result: dispatchAgentTask(args.target, args) };
	if (action === "stop")
		return { result: setAgentDispatchStatus(args.target, args.task, "stopped") };
	if (action === "resume")
		return { result: setAgentDispatchStatus(args.target, args.task, "dispatched") };
	if (action === "review") return { result: recordAgentReview(args.target, args) };
	return { result: unknownAction("agent", ["dispatch", "stop", "resume", "review"]) };
}

function handleLoop(args) {
	const action = args._?.[0];
	if (action === "inspect") {
		return { result: inspectLoopContract({ file: args.file, contract: args.contract }) };
	}
	if (action === "recommend") {
		return {
			result: recommendLoopContract({ target: args.target, file: args.file, goal: args.goal }),
		};
	}
	if (action === "run") {
		return {
			result: executeLoopContract({
				file: args.file,
				contract: args.contract,
				target: args.target,
				execute: args.execute,
				dryRun: args.dryRun,
				output: args.output,
			}),
		};
	}
	if (action === "approve") {
		return {
			result: approveLoopContract({
				file: args.file,
				contract: args.contract,
				target: args.target,
				reviewer: args.reviewer,
			}),
		};
	}
	if (action === "verify-ledger") {
		return { result: verifyLoopLedger({ target: args.target, contract: args.contract }) };
	}
	if (action === "record") {
		return {
			result: recordLoopContract({
				file: args.file,
				contract: args.contract,
				triggerSource: args.triggerSource,
				stopReason: args.stopReason,
				output: args.output,
			}),
		};
	}
	if (action === "status") {
		return { result: inspectLoopLedger({ ledger: args.ledger }) };
	}
	if (action === "validate-loop") {
		return { result: validateLoopContract(args.contract) };
	}
	return {
		result: unknownAction("loop", [
			"inspect",
			"recommend",
			"run",
			"approve",
			"verify-ledger",
			"record",
			"status",
			"validate-loop",
		]),
	};
}

function handleTeam(args) {
	const action = args._?.[0];
	if (action === "inspect") return { result: inspectTeamDistribution(args.target, args) };
	if (action === "install") return { result: installTeamDistribution(args.target, args) };
	if (action === "pin") return { result: pinTeamDistribution(args.target, args) };
	if (action === "update") return { result: updateTeamDistribution(args.target, args) };
	if (action === "rollback") return { result: rollbackTeamDistribution(args.target, args) };
	return { result: unknownAction("team", ["inspect", "install", "pin", "update", "rollback"]) };
}

function handleRoute(args) {
	const action = args._?.[0];
	const routeId = args._?.[1] || "";
	const targetRoot = resolveTarget(args);
	const routesDir = resolveTargetRoutesDirectory(targetRoot);
	let routeResult;

	if (action === "list") routeResult = routeCommands.listRoutes(routesDir);
	else if (action === "inspect") routeResult = routeCommands.inspectRoute(routeId, routesDir);
	else if (action === "validate")
		routeResult = routeCommands.validateRouteFile(args.file || routeId);
	else if (action === "test") {
		// Governed execution of a single command stage (GLX Phase 3); default stays dry-run.
		if (args.execute && args.stage) {
			const er = routeCommands.executeRouteStage(routeId, args.stage, targetRoot, routesDir);
			routeResult = { text: er.text, exitCode: er.exitCode };
		} else {
			routeResult = routeCommands.testRoute(routeId, routesDir);
		}
	} else if (action === "approve") {
		if (!args.stage) {
			routeResult = { text: "route approve requires --stage <name>.", exitCode: 1 };
		} else {
			routeResult = routeCommands.approveRouteStage(
				routeId,
				args.stage,
				targetRoot,
				args.reviewer,
				routesDir,
			);
		}
	} else if (action === "verify-ledger") {
		routeResult = routeCommands.verifyRouteLedger(routeId, targetRoot);
	} else {
		routeResult = {
			text: "route requires list, inspect, validate, test, approve, or verify-ledger.",
			exitCode: 1,
		};
	}

	const r = {
		target: args.target,
		text: routeResult.text,
		errors: routeResult.exitCode === 0 ? [] : [routeResult.text],
		warnings: [],
	};
	return { result: r, exitCode: routeResult.exitCode, bypassPrint: !args.json };
}

function handleWorkflow(args) {
	const action = args._?.[0];
	const targetRoot = resolveTarget(args);
	// Guard before dispatch: only assess supports --output-dir.
	const SUPPORTS_OUTPUT_DIR = action === "assess";
	if (args.outputDir && !SUPPORTS_OUTPUT_DIR) {
		const msg = `'amber workflow ${action}' does not support --output-dir (only assess writes a report file).`;
		return {
			result: { target: targetRoot, errors: [msg], warnings: [] },
			exitCode: 1,
			bypassPrint: !args.json,
		};
	}
	const { workflowDispatch } = require("./workflow-assessment/adapters/command");
	const result = workflowDispatch(action, targetRoot, {
		...args,
		target: targetRoot,
	});
	if (args.outputDir && action === "assess") {
		// Report written to disk; print only a one-line confirmation, not the body.
		for (const e of result.errors || []) console.error(`ERROR: ${e}`);
		return {
			result,
			bypassPrint: true,
			onBypass: () => {
				if (result.outputPath) console.log(`Wrote ${result.outputPath}`);
			},
			exitCode: (result.errors || []).length > 0 ? 1 : 0,
		};
	}
	if (action === "assess" || action === "findings" || action === "compare" || action === "plan") {
		const errors = Array.isArray(result.errors) ? result.errors : [];
		const warnings = Array.isArray(result.warnings) ? result.warnings : [];
		let text = "";
		// On hard errors for findings/plan/compare, leave stdout empty so a bare
		// `{}` is not mistaken for a valid empty result. assess still renders the
		// report body when present (schema-valid even with findings).
		if (errors.length === 0 || action === "assess") {
			if (action === "assess" && result.report) {
				const { renderJson, renderMarkdown } = require("./workflow-assessment/adapters/renderers");
				text =
					args.format === "markdown" ? renderMarkdown(result.report) : renderJson(result.report);
			} else if (action === "plan") {
				text = JSON.stringify(
					{ findingId: result.findingId, draft: result.draft, dryRun: true, notice: result.notice },
					null,
					2,
				);
			} else if (action === "findings" || action === "compare") {
				// findings/compare: emit the result envelope as JSON minus non-data keys
				const out =
					action === "findings"
						? { findings: result.findings, count: result.count }
						: {
								dimensionDeltas: result.dimensionDeltas,
								findingsAdded: result.findingsAdded,
								findingsResolved: result.findingsResolved,
								suspiciousImprovements: result.suspiciousImprovements,
								schemaVersionBaseline: result.schemaVersionBaseline,
								schemaVersionCurrent: result.schemaVersionCurrent,
								versionMismatch: result.versionMismatch,
								coverageBaseline: result.coverageBaseline,
								coverageCurrent: result.coverageCurrent,
							};
				text = JSON.stringify(out, null, 2);
			}
		}
		for (const w of warnings) console.error(`WARNING: ${w}`);
		for (const e of errors) console.error(`ERROR: ${e}`);
		// onBypass prints body only so amber.js does not re-emit warnings/errors
		// onto stdout (diagnostics already went to stderr; stdout stays parser-safe).
		return {
			result: { ...result, text },
			bypassPrint: true,
			onBypass: () => {
				if (text) console.log(text);
			},
			exitCode: errors.length > 0 ? 1 : 0,
		};
	}
	return { result };
}

function handleMigrate(args) {
	const action = args._?.[0];
	const targetRoot = resolveTarget(args);

	if (action === "state") {
		const stateResult = migrateState(targetRoot, { archiveLegacy: args.archiveLegacy });
		return {
			result: {
				...stateResult,
				target: targetRoot,
				errors: [
					...stateResult.errors,
					...stateResult.failed.map((f) => `validation failed: ${f}`),
				],
			},
		};
	}
	if (action === "wiki") {
		return { result: { ...migrateWiki(targetRoot), target: targetRoot } };
	}

	// Default: migrate manifests
	const migrateResult = migrateManifests(targetRoot, { dryRun: args.dryRun });
	const versioningResult = backfillVersioning(targetRoot, { dryRun: args.dryRun });
	const message = `${migrateResult.message}\n${versioningResult.message}`;
	const logs = [...(migrateResult.logs || []), ...(versioningResult.logs || [])];
	return {
		result: {
			target: targetRoot,
			migration: migrateResult,
			versioning: versioningResult,
			text: message,
			errors: [],
			warnings: [],
		},
		exitCode: 0,
		bypassPrint: !args.json,
		onBypass: () => {
			console.log(message);
			if (logs.length > 0) {
				for (const log of logs) console.log(`  ${log}`);
			}
		},
	};
}

function handleExecution(args) {
	const action = args._?.[0];
	if (action === "validate-integration") {
		const { validateIntegration } = require("./core/execution-validator");
		return {
			result: {
				target: args.target,
				...validateIntegration(args.contract || "", { explain: args.explain || false }),
			},
		};
	}
	if (action === "readiness") {
		const planPath = args.plan || "";
		if (!planPath)
			return {
				result: {
					target: args.target,
					errors: ["execution readiness requires --plan <path>."],
					warnings: [],
				},
			};

		const { checkExecutionReadiness } = require("./core/execution-validator");
		const { resolveTarget: resolve } = require("./core/fs-utils");
		const targetRoot = resolve(args.target);
		const resolvedPlan = path.resolve(targetRoot, planPath);
		const readiness = checkExecutionReadiness(targetRoot, resolvedPlan, {
			strict: args.strict || false,
		});
		return {
			result: {
				target: args.target,
				plan: planPath,
				ready: readiness.ready,
				blockers: readiness.blockers,
				errors: readiness.blockers,
				warnings: readiness.warnings,
				strictMode: readiness.strictMode,
			},
		};
	}
	return { result: unknownAction("execution", ["validate-integration", "readiness"]) };
}

function handleSecurity(args) {
	if (args._?.[0] !== "audit")
		return { result: { errors: ["security requires audit."], warnings: [] } };
	const { generateSecurityAuditReport } = require("./security-commands");
	return { result: generateSecurityAuditReport(args.target || ".", args) };
}

function handleFeature(args) {
	const action = args._?.[0];
	const targetRoot = resolveTarget(args);
	const featureResult = featureCommands.runFeatureAction(action, targetRoot, args);

	return {
		result: {
			target: args.target,
			text: featureResult.text || "",
			errors: featureResult.errors || [],
			warnings: featureResult.warnings || [],
		},
		exitCode: (featureResult.errors || []).length > 0 ? 1 : 0,
		bypassPrint: !args.json,
	};
}

function handleClean(args) {
	const { cleanAmber } = require("./clean-command");
	const cleanResult = cleanAmber(args.target, { dryRun: args.dryRun });
	const lines = [];
	if (cleanResult.dryRun) {
		lines.push("[DRY RUN] Would remove:");
	} else {
		lines.push("Removed:");
	}
	for (const item of cleanResult.removed) {
		lines.push(`  - ${item}`);
	}
	return {
		result: {
			target: args.target,
			text: lines.join("\n"),
			errors: cleanResult.errors,
			warnings: cleanResult.warnings,
		},
		bypassPrint: !args.json,
	};
}

function handleNext(args) {
	// strict defaults true inside lifecycle.buildContext so next matches
	// complete-check --strict / session complete (last-mile terminal steps).
	const nextResult = inferNext(args.target, {
		feature: args.feature,
		session: args.session,
		strict: args.strict !== false,
		objective: args.objective,
	});
	return { result: nextResult, exitCode: 0, bypassPrint: !args.json };
}

function handleDrift(args) {
	const { runDrift, renderDrift } = require("./drift-command");
	const result = runDrift(args.target, {
		scope: args.scope,
		noFail: args.noFail,
	});
	if (args.json) {
		return {
			result: { target: args.target, ...result, errors: [], warnings: [] },
			exitCode: result.exitCode,
			bypassPrint: false,
		};
	}
	const text =
		args.format === "gh-annotations"
			? renderDrift(result, { format: "gh-annotations" })
			: renderDrift(result);
	return {
		result: { target: args.target, text, drift: result, errors: [], warnings: [] },
		exitCode: result.exitCode,
		bypassPrint: true,
	};
}

function handleStatus(args) {
	const statusCommand = require("./status-command");
	const targetRoot = resolveTarget(args);
	const status = statusCommand.buildStatus(targetRoot);
	return {
		result: {
			target: args.target,
			text: statusCommand.renderStatus(status),
			status,
			errors: [],
			warnings: [],
		},
		bypassPrint: !args.json,
	};
}

function handleSync(args) {
	return syncDispatch(args);
}

function handleProjection(args) {
	return projectionDispatch(args);
}

function handleKnowledge(args) {
	return knowledgeDispatch(args);
}

function handlePhase(args) {
	return phaseDispatch(args);
}

function handleArtifact(args) {
	return artifactDispatch(args);
}

function handlePrincipal(args) {
	return principalDispatch(args);
}

function handleEval(args) {
	return evalDispatch(args);
}

function handleEvidence(args) {
	return evidenceDispatch(args);
}

function handleExplain(args) {
	const { explain } = require("./explain-command");
	const r = explain(args);
	return {
		result: { target: args.target, text: r.text, errors: r.errors, warnings: r.warnings },
		exitCode: r.errors.length > 0 ? 1 : 0,
		bypassPrint: !args.json,
	};
}

// --platform is scoped to `hooks breadcrumb install`, so it is read from the
// positional stream here instead of joining the global FLAG_SPECS table.
// Both `--platform <value>` and `--platform=<value>` forms are accepted.
// F023: read-only inspection by default; --reviewed books the review on the
// feature entry (featureId comes from args.feature — booking never resolves a
// focus implicitly). --surface is repeatable via FLAG_SPECS accumulate, and a
// single flag may also carry a comma-separated list.
function handleLearnings(args) {
	const { inspectLearningWriteBack, bookLearningWriteBack } = require("./core/learning-writeback");
	let r;
	if (args.reviewed) {
		r = bookLearningWriteBack(args.target, {
			featureId: args.feature,
			surfaces: args.surfaces,
			owner: args.owner,
			owners: args.owners,
		});
	} else {
		r = inspectLearningWriteBack(resolveTarget(args), { featureId: args.feature });
	}
	return {
		result: {
			...r,
			target: r.target,
			text: r.text || "",
			errors: r.errors || [],
			warnings: r.warnings || [],
		},
		exitCode: (r.errors || []).length > 0 ? 1 : 0,
		bypassPrint: !args.json,
	};
}

// F025: `amber break-loop` — dispatch on the first positional: `validate`
// validates an existing post-mortem; any other positional is a typo that must
// not fall through to the WRITING scaffold action. The analysis stays with the
// operator; Amber only scaffolds and validates.
function handleBreakLoop(args) {
	const { scaffoldPostMortem, validatePostMortem } = require("./core/break-loop");
	const subAction = args._?.[0];
	if (subAction !== undefined && subAction !== "validate") {
		return { result: unknownAction("break-loop", ["validate"]) };
	}
	const r =
		subAction === "validate"
			? validatePostMortem(resolveTarget(args), { file: args.file })
			: scaffoldPostMortem(args.target, {
					issue: args.issue,
					title: args.title,
					recurrence: args.recurrence,
				});
	return {
		result: {
			...r,
			target: r.target,
			text: r.text || "",
			errors: r.errors || [],
			warnings: r.warnings || [],
		},
		exitCode: (r.errors || []).length > 0 ? 1 : 0,
		bypassPrint: !args.json,
	};
}

function handleHooks(args) {
	return hooksDispatch(args);
}

function handleContext(args) {
	const { contextDispatch } = require("./context/adapters/command");
	return contextDispatch(args._?.[0], args);
}

function handleMemory(args) {
	const { memoryDispatch } = require("./memory-commands");
	return memoryDispatch(args._?.[0], args, resolveTarget(args));
}

// ── Command registry ────────────────────────────────────────────────────────

const COMMAND_HANDLERS = {
	init: handleInit,
	audit: handleAudit,
	wiki: handleWiki,
	doctor: handleDoctor,
	handoff: handleHandoff,
	plan: handlePlan,
	gate: handleGate,
	review: handleReview,
	accept: handleAccept,
	learnings: handleLearnings,
	"break-loop": handleBreakLoop,
	pack: handlePack,
	profile: handleProfile,
	status: handleStatus,
	drift: handleDrift,
	sync: handleSync,
	task: handleTask,
	result: handleResult,
	agent: handleAgent,
	loop: handleLoop,
	ledger: handleLedger,
	team: handleTeam,
	maintenance: handleMaintenance,
	adoption: handleAdoption,
	route: handleRoute,
	session: handleSession,
	migrate: handleMigrate,
	governance: handleGovernance,
	execution: handleExecution,
	security: handleSecurity,
	feature: handleFeature,
	clean: handleClean,
	next: handleNext,
	explain: handleExplain,
	hooks: handleHooks,
	workflow: handleWorkflow,
	context: handleContext,
	memory: handleMemory,
	projection: handleProjection,
	knowledge: handleKnowledge,
	phase: handlePhase,
	artifact: handleArtifact,
	principal: handlePrincipal,
	eval: handleEval,
	evidence: handleEvidence,
};

const COMMAND_REGISTRY = bindCommandHandlers(COMMAND_HANDLERS);
const { dispatchTypedInvocation } = require("./cli-typed-seam");

// ── Deprecated commands ─────────────────────────────────────────────────────
// These commands are isolated from the core governance flow and will be removed
// in v2. Users should migrate to equivalent governance commands.
const DEPRECATED_COMMANDS = new Set(
	Object.values(COMMAND_REGISTRY)
		.filter((registration) => registration.definition.tier === "deprecated")
		.map((registration) => registration.definition.name),
);

// ── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Dispatch a command to its registered handler.
 *
 * @param {string} command
 * @param {object} args  Parsed CLI arguments
 * @returns {object|Promise<object>} A response envelope, synchronously or asynchronously.
 */
function dispatch(command, args) {
	const registration = COMMAND_REGISTRY[command];
	if (!registration) {
		return {
			result: { errors: [`No handler registered for command: ${command}`], warnings: [] },
			exitCode: 1,
		};
	}
	const response = dispatchTypedInvocation(command, args, () => registration.handler(args));
	const addDeprecationWarning = (resolvedResponse) => {
		if (!DEPRECATED_COMMANDS.has(command)) return resolvedResponse;
		const msg =
			`⚠️  DEPRECATED: 'amber ${command}' will be removed in a future version. ` +
			"Use 'amber governance' or 'amber maintenance' for equivalent functionality.";
		resolvedResponse.result.warnings = [...(resolvedResponse.result.warnings || []), msg];
		return resolvedResponse;
	};
	return response && typeof response.then === "function"
		? response.then(addDeprecationWarning)
		: addDeprecationWarning(response);
}

module.exports = { dispatch, COMMAND_REGISTRY, DEPRECATED_COMMANDS };
