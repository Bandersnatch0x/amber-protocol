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

// ── Imports ─────────────────────────────────────────────────────────────────
// Command modules are required inside the handler that runs them, so a CLI
// call loads only its own command chain.
const { bindCommandHandlers } = require("./command-registry");

// ── Helpers ─────────────────────────────────────────────────────────────────

function handleMaintenance(args) {
	const { maintenanceDispatch } = require("./maintenance/adapters/command");
	return maintenanceDispatch(args._?.[0], args);
}

function handleLedger(args) {
	const action = args._?.[0];
	const targetRoot = require("./command-helpers").resolveTarget(args);
	if (action === "export") {
		const { exportLedger } = require("./core/ledger-export");
		const result = exportLedger(targetRoot, { format: args.format, home: args.home });
		if (args.out) {
			const { writeFileWithinTarget } = require("./core/fs-utils");
			const outputPath = writeFileWithinTarget(targetRoot, args.out, result.payload + "\n", {
				label: "Ledger export destination",
			});
			return require("./command-helpers").shapeResult(args, {
				text: `Wrote ${result.ledgers.length} ledger(s) to ${outputPath} (intact=${result.intactCount}, broken=${result.brokenCount})`,
				errors: result.errors,
				warnings: result.warnings,
			});
		}
		if (args.json) {
			return require("./command-helpers").shapeResult(args, result, { bypassPrint: false });
		}
		return require("./command-helpers").shapeResult(args, {
			text: result.payload,
			errors: result.errors,
			warnings: result.warnings,
		});
	}
	if (action === "seal") {
		const { sealLedger } = require("./core/ledger-seal");
		const result = sealLedger(targetRoot, {
			reviewer: args.reviewer,
			adoptLegacy: args.adoptLegacy,
		});
		const adoptedNote =
			result.adopted?.length > 0 ? ` (adopted ${result.adopted.length} legacy unanchored)` : "";
		const text = result.sealed
			? `Sealed ${result.ledgerCount} ledger(s)${adoptedNote} to tag ${result.tagName} at HEAD ${result.head}.`
			: `Seal failed: ${result.errors.join("; ")}`;
		return require("./command-helpers").shapeResult(
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
		return require("./command-helpers").shapeResult(
			args,
			{ text, ...result, errors: result.errors, warnings: result.warnings },
			{ exitCode: result.errors?.length ? 1 : result.anchored ? 0 : 1 },
		);
	}
	return require("./command-helpers").shapeResult(
		args,
		{ errors: ["ledger requires export, seal, or verify-anchoring."] },
		{ exitCode: 1 },
	);
}

async function handleSession(args) {
	const action = args._?.[0];
	const targetRoot = require("./command-helpers").resolveTarget(args);
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
			sessionResult = await require("./session-commands").startSession(targetRoot, {
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
		sessionResult = require("./session-commands").statusSession(targetRoot, {
			sessionId: args._?.[1] || args.session,
		});
	} else if (action === "list") {
		sessionResult = require("./session-commands").listSessions(targetRoot, {});
	} else if (action === "abort") {
		sessionResult = await require("./session-commands").abortSession(targetRoot, {
			sessionId: args._?.[1] || args.session,
			requestId: args.requestId,
		});
	} else if (action === "continue") {
		sessionResult = await require("./session-commands").continueSession(targetRoot, {
			sessionId: args._?.[1] || args.session,
			requestId: args.requestId,
		});
	} else if (action === "complete-check") {
		sessionResult = require("./command-helpers").requireSessionId(args, "complete-check");
		if (!sessionResult) {
			const { buildCompletionResult } = require("./completion-check");
			const completion = buildCompletionResult(targetRoot, args.session, args);
			sessionResult = { text: completion.text, exitCode: completion.errors.length > 0 ? 1 : 0 };
		}
	} else if (action === "complete") {
		sessionResult = require("./command-helpers").requireSessionId(args, "complete");
		if (!sessionResult) {
			sessionResult = await require("./session-commands").completeSession(targetRoot, {
				sessionId: args.session,
				strict: args.strict,
				requestId: args.requestId,
			});
		}
	} else if (action === "verify") {
		sessionResult = require("./command-helpers").requireSessionId(args, "verify");
		if (!sessionResult) {
			sessionResult = await require("./session-commands").verifySession(targetRoot, {
				sessionId: args.session,
				stage: args.stage,
				command: args.command,
				result: args.result,
				execute: args.execute,
				feature: args.feature,
				budgetMinutes: args.budgetMinutes,
			});
		}
	} else if (action === "approve") {
		sessionResult = require("./command-helpers").requireSessionId(args, "approve");
		if (!sessionResult) {
			sessionResult = await require("./session-commands").approveSession(targetRoot, {
				sessionId: args.session,
				gate: args.gate || args._?.[1],
				yes: args.yes,
			});
		}
	} else if (action === "verify-ledger") {
		sessionResult = require("./command-helpers").requireSessionId(args, "verify-ledger");
		if (!sessionResult) {
			sessionResult = require("./session-commands").verifyLedgerSession(targetRoot, args.session);
		}
	} else if (action === "lease") {
		// F062 lease reacquisition (ADR-0029 §8.1): explicit, owner-bound, new
		// fence. Owner proof is the same digest the run/settle seam uses.
		sessionResult = require("./command-helpers").requireSessionId(args, "lease");
		if (!sessionResult) {
			sessionResult = await require("./session-commands").leaseSession(targetRoot, {
				sessionId: args.session,
				ownerId: args.ownerId,
				tokenHash: args.tokenHash,
			});
		}
	} else if (action === "run" || action === "settle") {
		// F062 seam boundary (spec §"Legacy and external seams"): the run/settle
		// seam rejects arbitrary stage selection and free-form command text.
		// --stage and --command exist for OTHER session subcommands; binding
		// them here would smuggle selection through a typed seam.
		if (args.stage || args.command) {
			sessionResult = {
				text:
					`Error: session ${action} takes no --stage or --command. ` +
					"Stage selection, capability, and adapter come from the session's own state (F062 closed seam).",
				exitCode: 1,
			};
		} else if (action === "run") {
			sessionResult = require("./command-helpers").requireSessionId(args, "run");
			if (!sessionResult) {
				sessionResult = await require("./session-commands").runSession(targetRoot, {
					sessionId: args.session,
					execute: args.execute === true,
					ownerId: args.ownerId,
					tokenHash: args.tokenHash,
					leaseFence: args.leaseFence === undefined ? undefined : Number(args.leaseFence),
				});
			}
		} else {
			sessionResult = require("./command-helpers").requireSessionId(args, "settle");
			if (!sessionResult) {
				let parsedResult;
				let parseError = null;
				if (typeof args.result === "string") {
					try {
						parsedResult = JSON.parse(args.result);
					} catch (error) {
						parseError = `Error: --result must be a JSON object: ${error.message}`;
					}
				} else {
					parsedResult = args.result;
				}
				sessionResult = parseError
					? { text: parseError, exitCode: 1 }
					: await require("./session-commands").settleSession(targetRoot, {
							sessionId: args.session,
							requestId: args.requestId,
							attemptId: args.attemptId,
							requestHash: args.requestHash,
							settlementResult: parsedResult,
							ownerId: args.ownerId,
							tokenHash: args.tokenHash,
							leaseFence: args.leaseFence === undefined ? undefined : Number(args.leaseFence),
						});
			}
		}
	} else {
		sessionResult = {
			text: "session requires start, status, list, abort, continue, complete-check, complete, verify, verify-ledger, approve, lease, run, or settle.",
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
		result: require("./core/scaffold").scaffoldHarness(args.target, {
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
		return require("./org-audit-commands").orgAuditDispatch(args);
	}
	return { result: require("./core/audit").auditProject(args.target) };
}

function handleWiki(args) {
	const action = args._?.[0];

	// `--yaml` belongs to the knowledge scaffold, not the bare wiki skeleton.
	// Reject at the entry so export/okf variants cannot silently drop the flag;
	// the knowledge dispatch below is the legitimate consumer.
	// Accepting it outside the knowledge scaffold would re-seed the alternate
	// plan format the scaffold deliberately keeps out of the default install.
	if ((args.yaml || args.yml) && action !== "knowledge") {
		return {
			result: {
				target: args.target,
				errors: [
					"--yaml applies to `amber wiki knowledge scaffold`, not the default wiki scaffold.",
				],
				warnings: [],
			},
		};
	}

	if (action === "export") {
		return {
			result: require("./core/okf-export").exportOkfBundle(args.target, {
				outputDir: args.outputDir,
			}),
		};
	}

	// Knowledge Plan support (declarative architecture + knowledge cards, integrated for Amber).
	// F013-K1/K2: all knowledge subcommands cross the command adapter + root facade.
	// Adapter owns option mapping, aliases, unknown-action guidance, and rendering.
	if (action === "knowledge") {
		const { knowledgeDispatch } = require("./knowledge-plan/adapters/command");
		return knowledgeDispatch(args._?.[1], args);
	}

	if (args.okf) {
		return { result: require("./core/validators").validateWiki(args.target, { okf: true }) };
	}

	return { result: require("./core/scaffold").scaffoldWiki(args.target, { dryRun: args.dryRun }) };
}

function handleDoctor(args) {
	return { result: require("./core/doctor").doctor(args.target, { okf: args.okf }) };
}

function handleHandoff(args) {
	const action = args._?.[0];
	if (action === "bundle") {
		const { writeHandoffBundle } = require("./core/handoff-bundle");
		return {
			result: writeHandoffBundle(require("./command-helpers").resolveTarget(args), {
				outputDir: args.outputDir || args.bundleDir,
				targetDisplay: args.target || ".",
				replayScope: args.replayScope,
			}),
		};
	}
	if (action === "validate") {
		const {
			defaultBundleDir,
			resolveTargetRelativePath,
			validateHandoffBundle,
		} = require("./core/handoff-bundle");
		const targetRoot = require("./command-helpers").resolveTarget(args);
		const bundleDir =
			args.bundleDir || args.outputDir
				? resolveTargetRelativePath(targetRoot, args.bundleDir || args.outputDir)
				: defaultBundleDir(targetRoot);
		return { result: { target: targetRoot, ...validateHandoffBundle(bundleDir) } };
	}
	const { writeHandoff } = require("./handoff-command");
	const rel = "session-handoff.md";
	const written = writeHandoff(args.target, { dryRun: args.dryRun });
	const validation = require("./core/audit").validateHandoff(args.target);
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
		result: require("./core/planning").scaffoldPlan(args.target, {
			feature: args.feature,
			title: args.title,
			dryRun: args.dryRun,
		}),
	};
}

function handleGate(args) {
	// F050 ticket 3 (#228): the Gate Contract subcommand surface
	// (evaluate/show/list) rides the same command name as the legacy
	// plan-gate check. The first positional action selects the surface; a
	// bare `amber gate --plan <path> [--confirm]` keeps the legacy
	// behavior unchanged.
	const action = args._?.[0];
	if (action === "evaluate" || action === "show" || action === "list") {
		return require("./gate-commands").gateDispatch(args);
	}
	if (action !== undefined) {
		return {
			result: require("./command-helpers").unknownAction("gate", [
				"evaluate",
				"show",
				"list",
				"--plan <path>",
			]),
		};
	}
	if (args.confirm) {
		return { result: require("./core/planning").confirmPlanGate(args.target, args.plan) };
	}
	return { result: require("./core/planning").validatePlanGate(args.target, args.plan) };
}

function handleReview(args) {
	return { result: require("./core/planning").reviewPlan(args.target, args.plan) };
}

function handleAccept(args) {
	// Guard: when a session is named, the plan must belong to that session's
	// feature. Only block on a definite mismatch (both known and different) —
	// an unreadable session/plan falls through and is reported downstream.
	if (args.session) {
		const shape = require("./session-commands").validateSessionIdForLookup(args.session);
		if (!shape.valid) {
			return {
				result: {
					target: args.target,
					accepted: false,
					errors: [`${shape.error}: ${args.session}`],
					warnings: [],
				},
			};
		}
		const targetRoot = require("./command-helpers").resolveTarget(args);
		const sessionFeature = require("./core/feature-attribution").resolveSessionFeature(
			targetRoot,
			args.session,
		);
		const planFeature = require("./core/feature-attribution").readPlanFeature(
			targetRoot,
			args.plan,
		);
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

	const acceptResult = require("./core/planning").acceptPlan(args.target, args.plan, {
		force: args.force,
	});
	if (!args.session) return { result: acceptResult };

	const { buildCompletionResult } = require("./completion-check");
	const completion = buildCompletionResult(
		require("./command-helpers").resolveTarget(args),
		args.session,
		args,
	);
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
		const r = require("./core/workflow-packs").inspectWorkflowPack(args.file || "");
		if (action === "validate") r.valid = r.errors.length === 0;
		return { result: r };
	}
	if (action === "readiness") {
		return {
			result: require("./core/workflow-packs").inspectWorkflowPackReadiness(
				args.file || args._?.[1] || "",
			),
		};
	}
	if (action === "validate-execution") {
		const packPath = args.file || args.pack || args._?.[1] || "";
		const v = require("./core/execution-validator").validateWorkflowPack(packPath);
		return {
			result: { target: args.target, ...v, errors: v.errors || [], warnings: v.warnings || [] },
		};
	}
	return {
		result: require("./command-helpers").unknownAction("pack", [
			"inspect",
			"validate",
			"readiness",
			"validate-execution",
		]),
	};
}

function handleProfile(args) {
	const action = args._?.[0];
	if (action === "deployment") {
		return handleDeploymentProfile(args);
	}
	if (action !== "inspect") {
		return {
			result: require("./command-helpers").unknownAction("profile", ["inspect", "deployment"]),
		};
	}
	return { result: require("./core/profiles").inspectProjectProfile(args.file || "") };
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
	return {
		result: require("./command-helpers").unknownAction("profile deployment", [
			"show",
			"set",
			"validate",
			"resolve",
		]),
	};
}

function handleTask(args) {
	if (args._?.[0] !== "prepare") {
		return { result: require("./command-helpers").unknownAction("task", ["prepare"]) };
	}
	return {
		result: require("./core/task-execution").prepareTaskExecution(
			args.target,
			args.plan,
			args.task,
			args,
		),
	};
}

function handleResult(args) {
	if (args._?.[0] !== "inspect") {
		return { result: require("./command-helpers").unknownAction("result", ["inspect"]) };
	}
	return { result: require("./core/task-execution").inspectTaskResult(args.target, args.task) };
}

async function handleLoop(args) {
	const action = args._?.[0];
	if (action === "inspect") {
		return {
			result: require("./core/loops").inspectLoopContract({
				file: args.file,
				contract: args.contract,
			}),
		};
	}
	if (action === "recommend") {
		return {
			result: require("./core/loops").recommendLoopContract({
				target: args.target,
				file: args.file,
				goal: args.goal,
			}),
		};
	}
	if (action === "run") {
		return {
			result: await require("./core/loop-execution").executeLoopContract({
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
			result: require("./core/loop-execution").approveLoopContract({
				file: args.file,
				contract: args.contract,
				target: args.target,
				reviewer: args.reviewer,
			}),
		};
	}
	if (action === "verify-ledger") {
		return {
			result: require("./core/loop-execution").verifyLoopLedger({
				target: args.target,
				contract: args.contract,
			}),
		};
	}
	if (action === "record") {
		return {
			result: require("./core/loops").recordLoopContract({
				file: args.file,
				contract: args.contract,
				triggerSource: args.triggerSource,
				stopReason: args.stopReason,
				output: args.output,
			}),
		};
	}
	if (action === "status") {
		return { result: require("./core/loops").inspectLoopLedger({ ledger: args.ledger }) };
	}
	if (action === "validate-loop") {
		return { result: require("./core/execution-validator").validateLoopContract(args.contract) };
	}
	return {
		result: require("./command-helpers").unknownAction("loop", [
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

async function handleRoute(args) {
	const action = args._?.[0];
	const routeId = args._?.[1] || "";
	const targetRoot = require("./command-helpers").resolveTarget(args);
	const routesDir = require("./route-loader").resolveTargetRoutesDirectory(targetRoot);
	let routeResult;

	if (action === "list") routeResult = require("./route-commands").listRoutes(routesDir);
	else if (action === "inspect")
		routeResult = require("./route-commands").inspectRoute(routeId, routesDir);
	else if (action === "validate")
		routeResult = require("./route-commands").validateRouteFile(args.file || routeId);
	else if (action === "test") {
		// Governed execution of a single command stage (GLX Phase 3); default stays dry-run.
		if (args.execute && args.stage) {
			const er = await require("./route-commands").executeRouteStage(
				routeId,
				args.stage,
				targetRoot,
				routesDir,
			);
			routeResult = { text: er.text, exitCode: er.exitCode };
		} else {
			routeResult = require("./route-commands").testRoute(routeId, routesDir);
		}
	} else if (action === "approve") {
		if (!args.stage) {
			routeResult = { text: "route approve requires --stage <name>.", exitCode: 1 };
		} else {
			routeResult = require("./route-commands").approveRouteStage(
				routeId,
				args.stage,
				targetRoot,
				args.reviewer,
				routesDir,
			);
		}
	} else if (action === "verify-ledger") {
		routeResult = require("./route-commands").verifyRouteLedger(routeId, targetRoot);
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
	const targetRoot = require("./command-helpers").resolveTarget(args);
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
	const targetRoot = require("./command-helpers").resolveTarget(args);

	if (action === "state") {
		const stateResult = require("./state-migration").migrateState(targetRoot, {
			archiveLegacy: args.archiveLegacy,
		});
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
		return {
			result: { ...require("./state-migration").migrateWiki(targetRoot), target: targetRoot },
		};
	}

	// Default: migrate manifests
	const migrateResult = require("./migrate-command").migrateManifests(targetRoot, {
		dryRun: args.dryRun,
	});
	const versioningResult = require("./migrate-command").backfillVersioning(targetRoot, {
		dryRun: args.dryRun,
	});
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
		const { resolvePathWithin, resolveTarget: resolve } = require("./core/fs-utils");
		const targetRoot = resolve(args.target);
		const resolvedPlan = resolvePathWithin(targetRoot, planPath, {
			label: "Execution readiness plan",
			canonicalExisting: true,
		});
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
	return {
		result: require("./command-helpers").unknownAction("execution", [
			"validate-integration",
			"readiness",
		]),
	};
}

function handleSecurity(args) {
	if (args._?.[0] !== "audit")
		return { result: { errors: ["security requires audit."], warnings: [] } };
	const { generateSecurityAuditReport } = require("./security-commands");
	return { result: generateSecurityAuditReport(args.target || ".", args) };
}

function handleFeature(args) {
	const action = args._?.[0];
	const targetRoot = require("./command-helpers").resolveTarget(args);
	const featureResult = require("./feature-commands").runFeatureAction(action, targetRoot, args);

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
	const nextResult = require("./next-command").inferNext(args.target, {
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
	const targetRoot = require("./command-helpers").resolveTarget(args);
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
		r = inspectLearningWriteBack(require("./command-helpers").resolveTarget(args), {
			featureId: args.feature,
		});
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
		return { result: require("./command-helpers").unknownAction("break-loop", ["validate"]) };
	}
	const r =
		subAction === "validate"
			? validatePostMortem(require("./command-helpers").resolveTarget(args), { file: args.file })
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

function handleContext(args) {
	const { contextDispatch } = require("./context/adapters/command");
	return contextDispatch(args._?.[0], args);
}

function handleMemory(args) {
	const { memoryDispatch } = require("./memory-commands");
	return memoryDispatch(args._?.[0], args, require("./command-helpers").resolveTarget(args));
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
	policy: (args) => require("./policy-commands").policyDispatch(args),
	adapter: (args) => require("./adapter-commands").adapterDispatch(args),
	runner: (args) => require("./runner-commands").runnerDispatch(args),
	release: (args) => require("./release-commands").releaseDispatch(args),
	maintain: (args) => require("./maintain-commands").maintainDispatch(args),
	retention: (args) => require("./retention-commands").retentionDispatch(args),
	external: (args) => require("./external-commands").externalDispatch(args),
	breakglass: (args) => require("./breakglass-commands").breakglassDispatch(args),
	review: handleReview,
	accept: handleAccept,
	learnings: handleLearnings,
	"break-loop": handleBreakLoop,
	pack: handlePack,
	profile: handleProfile,
	status: handleStatus,
	drift: handleDrift,
	sync: (args) => require("./sync-commands").syncDispatch(args),
	task: handleTask,
	result: handleResult,
	loop: handleLoop,
	ledger: handleLedger,
	maintenance: handleMaintenance,
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
	hooks: (args) => require("./hooks-commands").hooksDispatch(args),
	workflow: handleWorkflow,
	context: handleContext,
	memory: handleMemory,
	projection: (args) => require("./projection-commands").projectionDispatch(args),
	knowledge: (args) => require("./knowledge-commands").knowledgeDispatch(args),
	phase: (args) => require("./phase-commands").phaseDispatch(args),
	artifact: (args) => require("./canonical-artifact-commands").artifactDispatch(args),
	principal: (args) => require("./principal-commands").principalDispatch(args),
	eval: (args) => require("./eval-commands").evalDispatch(args),
	evidence: (args) => require("./evidence-commands").evidenceDispatch(args),
	approval: (args) => require("./approval-commands").approvalDispatch(args),
	contracts: (args) => require("./contracts-commands").contractsDispatch(args),
	harness: (args) => require("./harness/harness-commands").harnessDispatch(args),
};

const COMMAND_REGISTRY = bindCommandHandlers(COMMAND_HANDLERS);
const { dispatchTypedInvocation } = require("./cli-typed-seam");

// ── Deprecated commands ─────────────────────────────────────────────────────
// Commands with tier "deprecated" stay callable but print a runtime warning
// pointing users at the equivalent governance commands.
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
		// UNDOC-9 (#273): `profile deployment` is not deprecated — it is the one
		// supported deployment-profile declaration surface, and 'amber governance'
		// has no equivalent. Only the legacy profile actions carry the warning.
		if (command === "profile" && args._?.[0] === "deployment") return resolvedResponse;
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
