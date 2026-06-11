#!/usr/bin/env node
"use strict";

const {
	acceptPlan,
	auditProject,
	bundleAdoptionArtifacts,
	compareAdoptionReports,
	dispatchAgentTask,
	doctor,
	dryRunLoopContract,
	gateAdoptionReport,
	generateAdoptionReport,
	inspectLoopContract,
	inspectLoopLedger,
	inspectMaintenance,
	inspectProjectProfile,
	inspectTeamDistribution,
	inspectWorkflowPack,
	inspectWorkflowPackReadiness,
	inspectTaskResult,
	installTeamDistribution,
	listAdoptionReports,
	parseArgs,
	pinTeamDistribution,
	proposeMaintenance,
	prepareTaskExecution,
	printResult,
	recordLoopContract,
	recordAgentReview,
	reviewPlan,
	rollbackTeamDistribution,
	scaffoldHarness,
	scaffoldPlan,
	scaffoldWiki,
	setAgentDispatchStatus,
	statusAdoptionReports,
	updateTeamDistribution,
	validateAdoptionReports,
	validatePlanGate,
	validateHandoff,
	writeAdoptionApplyPlan,
	writeAdoptionDecisionRecord,
	writeAdoptionNextActions,
	writeAdoptionSelectedFiles,
	writeAdoptionReportsIndex,
} = require("./lib/amber-core");

const {
	listRoutes,
	inspectRoute,
	validateRouteFile,
	testRoute,
} = require("./lib/route-commands");

const { migrateManifests } = require("./lib/migrate-command");
const { migrateState, migrateWiki } = require("./lib/state-migration");

const {
	startSession,
	statusSession,
	listSessions,
	abortSession,
	continueSession,
} = require("./lib/session-commands");

const {
	validateWorkflowPack,
} = require("./lib/core/execution-validator");

const COMMANDS = [
	"init",
	"audit",
	"wiki",
	"doctor",
	"handoff",
	"plan",
	"gate",
	"review",
	"accept",
	"pack",
	"profile",
	"task",
	"result",
	"agent",
	"team",
	"maintenance",
	"adoption",
	"loop",
	"route",
	"session",
	"migrate",
	"daemon",
	"governance",
	"execution",
];
const DRY_RUN_COMMANDS = new Set(["init", "wiki", "plan"]);
const SUMMARY_COMMANDS = new Set(["audit"]);

function usage(command) {
	if (command && COMMANDS.includes(command)) {
		const options = ["[--json]"];
		if (DRY_RUN_COMMANDS.has(command)) {
			options.push("[--dry-run]");
		}
		if (SUMMARY_COMMANDS.has(command)) {
			options.push("[--summary]");
		}

		return [
			`Usage: node scripts/amber.js ${command} --target <repo> ${options.join(" ")}`,
			"",
			commandSummary(command),
		].join("\n");
	}

	return [
		"Usage: node scripts/amber.js <command> --target <repo> [--json]",
		"",
		`Commands: ${COMMANDS.join(", ")}`,
		"Run `node scripts/amber.js <command> --help` for command-specific options.",
		"",
		"Examples:",
		"  node scripts/amber.js init --target path/to/repo",
		"  node scripts/amber.js audit --target path/to/repo",
		"  node scripts/amber.js wiki --target path/to/repo",
		"  node scripts/amber.js handoff --target path/to/repo",
		"  node scripts/amber.js doctor --target path/to/repo",
		'  node scripts/amber.js plan --target path/to/repo --feature F001 --title "Small slice"',
		"  node scripts/amber.js gate --target path/to/repo --plan docs/plans/F001-small-slice.md",
		"  node scripts/amber.js review --target path/to/repo --plan docs/plans/F001-small-slice.md",
		"  node scripts/amber.js accept --target path/to/repo --plan docs/plans/F001-small-slice.md",
		"  node scripts/amber.js pack inspect --file workflow-packs/safe-amber-bootstrap.pack.json",
		"  node scripts/amber.js pack readiness --file workflow-packs/safe-amber-bootstrap.pack.json --json",
		"  node scripts/amber.js pack validate-execution --file workflow-packs/safe-amber-bootstrap.pack.json --json",
		"  node scripts/amber.js profile inspect --file profiles/default.profile.json",
		"  node scripts/amber.js task prepare --target path/to/repo --plan docs/plans/F001-small-slice.md --task slice-1",
		"  node scripts/amber.js result inspect --target path/to/repo --task slice-1",
		"  node scripts/amber.js agent dispatch --target path/to/repo --task slice-1 --worker worker-a --reviewer reviewer-b",
		"  node scripts/amber.js team install --target path/to/repo --version 1.0.0 --preset safe-bootstrap",
		"  node scripts/amber.js maintenance inspect --target path/to/repo",
		"  node scripts/amber.js adoption report --target path/to/repo --output docs/examples/project-adoption-report.md",
		"  node scripts/amber.js adoption report --target path/to/repo --output-dir docs/examples",
		"  node scripts/amber.js adoption list --reports-dir docs/examples/adoptions",
		"  node scripts/amber.js adoption index --reports-dir docs/examples/adoptions --output docs/examples/adoptions-index.md",
		"  node scripts/amber.js adoption validate --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md",
		"  node scripts/amber.js adoption compare --reports-dir docs/examples/adoptions",
		"  node scripts/amber.js adoption gate --reports-dir docs/examples/adoptions",
		"  node scripts/amber.js adoption status --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md",
		"  node scripts/amber.js adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/sample-adoption-bundle",
		"  node scripts/amber.js adoption next-actions --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-next-actions.md",
		"  node scripts/amber.js adoption decision-record --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-decision-record.md",
		"  node scripts/amber.js adoption selected-files --bundle-dir docs/examples/sample-adoption-bundle --output docs/examples/sample-adoption-selected-files.md --include AGENTS.md",
	].join("\n");
}

function commandSummary(command) {
	if (command === "init") {
		return "Create missing Harness files without overwriting existing files. Supports --dry-run.";
	}
	if (command === "audit") {
		return "Inspect an existing project without writing files. Supports --summary for bounded text output.";
	}
	if (command === "wiki") {
		return "Create missing Wiki starter files, skip existing files, then validate links. Supports --dry-run.";
	}
	if (command === "handoff") {
		return "Validate session-handoff.md required V1 sections.";
	}
	if (command === "doctor") {
		return "Run Harness guardrail checks and target classification.";
	}
	if (command === "plan") {
		return "Create a feature-linked vertical-slice plan without overwriting existing files. Supports --dry-run.";
	}
	if (command === "gate") {
		return "Validate that a plan is tied to feature state and has user confirmation.";
	}
	if (command === "review") {
		return "Review a plan against static Harness standards and release-readiness checks.";
	}
	if (command === "accept") {
		return "Accept a reviewed plan and append a Harness evolution record.";
	}
	if (command === "pack") {
		return "Inspect or validate declarative workflow packs without executing them.";
	}
	if (command === "profile") {
		return "Inspect declarative project profiles.";
	}
	if (command === "task") {
		return "Prepare isolated task ledger, evidence, replay, and worktree artifacts.";
	}
	if (command === "result") {
		return "Inspect replayable task result artifacts without relying on chat history.";
	}
	if (command === "agent") {
		return "Create and control auditable worker/reviewer dispatch records without executing agent work.";
	}
	if (command === "team") {
		return "Inspect, install, pin, update, and roll back local team distribution metadata.";
	}
	if (command === "maintenance") {
		return "Inspect stale docs, wiki lint readiness, upgrade guidance, drift, and reviewable maintenance proposals.";
	}
	if (command === "adoption") {
		return [
			"Generate, list, or index safe adoption report artifacts without modifying target projects.",
			"",
			"Examples:",
			"  node scripts/amber.js adoption report --target path/to/repo --output docs/examples/project-adoption-report.md",
			"  node scripts/amber.js adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/project-adoption-bundle",
			"  node scripts/amber.js adoption next-actions --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-next-actions.md",
			"  node scripts/amber.js adoption decision-record --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-decision-record.md",
			"  node scripts/amber.js adoption apply-plan --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-apply-plan.md --dry-run",
			"  node scripts/amber.js adoption selected-files --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-selected-files.md --include AGENTS.md",
		].join("\n");
	}
	if (command === "loop") {
		return [
			"Inspect loop contracts, write dry-run ledger previews, and record manual loop evidence without live scheduling.",
			"",
			"Examples:",
			"  node scripts/amber.js loop inspect --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --json",
			"  node scripts/amber.js loop run --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --dry-run --output .amber/loops/daily-amber-triage/ledger-preview.json --json",
			"  node scripts/amber.js loop record --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --trigger-source manual --stop-reason reviewer-gate-required --output .amber/loops/daily-amber-triage/manual-ledger.json --json",
			"  node scripts/amber.js loop status --ledger .amber/loops/daily-amber-triage/manual-ledger.json --json",
			"  node scripts/amber.js loop validate-loop --contract path/to/contract.json --json",
		].join("\n");
	}
	if (command === "route") {
		return [
			"Inspect, validate, and dry-run delivery routes from routes/*.route.json.",
			"",
			"Subcommands:",
			"  list                 List all routes (id, version, stage count).",
			"  inspect <id>         Print a route's stage tree and full JSON.",
			"  validate <file>      Validate a route file; non-zero exit on invalid.",
			"  test <id> --dry-run  Print the ordered stage sequence and gate points.",
			"",
			"Examples:",
			"  node scripts/amber.js route list",
			"  node scripts/amber.js route inspect feature-standard",
			"  node scripts/amber.js route validate routes/feature-standard.route.json",
			"  node scripts/amber.js route test bugfix-quick --dry-run",
		].join("\n");
	}
	if (command === "session") {
		return [
			"Manage session lifecycle: start, status, list, abort, continue.",
			"",
			"Subcommands:",
			'  start --goal "..." [--route <id>] [--budget <n>] [--worktree] [--mode interactive]',
			"      Create a new session, write manifest + timeline, optionally create worktree.",
			"  status [<id>]",
			"      Show status of current session or specified session by ID.",
			"  list",
			"      List all sessions in reverse chronological order.",
			"  abort <id>",
			"      Set session status to aborted, write abort event, cleanup worktree.",
			"  continue [<id>]",
			"      Continue a paused or incomplete session from its current stage.",
			"",
			"Examples:",
			'  node scripts/amber.js session start --goal "implement user auth"',
			'  node scripts/amber.js session start --goal "fix login bug" --route bugfix-quick --worktree',
			'  node scripts/amber.js session start --goal "add feature" --mode interactive',
			"  node scripts/amber.js session status",
			"  node scripts/amber.js session list",
			"  node scripts/amber.js session abort <session-id>",
			"  node scripts/amber.js session continue",
		].join("\n");
	}
	if (command === "migrate") {
		return [
			"Migrate session manifests to the current schema version, or migrate",
			"legacy state and wiki naming to the Amber Protocol layout.",
			"",
			"Subcommands:",
			"  state        Copy legacy .harness state into .amber (source kept).",
			"  wiki         Rename docs/wiki/agent/harness.md to amber.md and fix links.",
			"  (none)       Migrate session manifests to the current schema version.",
			"",
			"Options:",
			"  --dry-run    Preview changes without writing files (manifest mode).",
			"",
			"Examples:",
			"  node scripts/amber.js migrate --target <path>",
			"  node scripts/amber.js migrate state --target <path>",
			"  node scripts/amber.js migrate wiki --target <path>",
		].join("\n");
	}
	if (command === "governance") {
		return [
			"Create governance documentation for a target repository.",
			"",
			"Subcommands:",
			"  docs         Generate governance documents (CODE_OF_CONDUCT.md, CONTRIBUTING.md, GOVERNANCE.md).",
			"  evidence     Export governance evidence from sessions or tasks.",
			"  policy       Show governance policy (defaults and overrides).",
			"  audit        Generate comprehensive audit report with policy, sessions, and executions.",
			"",
			"Examples:",
			"  node scripts/amber.js governance docs --target path/to/repo",
			"  node scripts/amber.js governance docs --target path/to/repo --json",
			"  node scripts/amber.js governance evidence --session <id> --output evidence.md",
			"  node scripts/amber.js governance evidence --task <id> --output evidence.md --json",
			"  node scripts/amber.js governance policy --target path/to/repo",
			"  node scripts/amber.js governance policy --target path/to/repo --json",
			"  node scripts/amber.js governance audit --target path/to/repo --output audit.md",
			"  node scripts/amber.js governance audit --target path/to/repo --output audit.md --since 2025-01-01",
			"  node scripts/amber.js governance audit --target path/to/repo --output audit.md --json",
		].join("\n");
	}
	return "Run Amber Protocol command.";
}

async function run(argv = process.argv.slice(2)) {
	const [command, ...rest] = argv;

	if (!command || command === "--help" || command === "-h") {
		console.log(usage());
		return 0;
	}

	if (!COMMANDS.includes(command)) {
		console.error(`Unknown command: ${command}`);
		console.error(`Expected one of: ${COMMANDS.join(", ")}`);
		return 1;
	}

	const args = parseArgs(rest);
	if (args.help) {
		console.log(usage(command));
		return 0;
	}

	let result;
	if (command === "init") {
		result = scaffoldHarness(args.target, { dryRun: args.dryRun });
	} else if (command === "audit") {
		result = auditProject(args.target);
	} else if (command === "wiki") {
		result = scaffoldWiki(args.target, { dryRun: args.dryRun });
	} else if (command === "handoff") {
		result = validateHandoff(args.target);
	} else if (command === "plan") {
		result = scaffoldPlan(args.target, {
			feature: args.feature,
			title: args.title,
			dryRun: args.dryRun,
		});
	} else if (command === "gate") {
		result = validatePlanGate(args.target, args.plan);
	} else if (command === "review") {
		result = reviewPlan(args.target, args.plan);
	} else if (command === "accept") {
		result = acceptPlan(args.target, args.plan);
	} else if (command === "pack") {
		const action = args._ && args._[0];
		if (action === "inspect" || action === "validate") {
			result = inspectWorkflowPack(args.file || "");
			if (action === "validate") {
				result.valid = result.errors.length === 0;
			}
		} else if (action === "readiness") {
			result = inspectWorkflowPackReadiness(args.file || args._[1] || "");
		} else if (action === "validate-execution") {
			const packPath = args.file || args.pack || args._[1] || "";
			const validationResult = validateWorkflowPack(packPath);
			result = {
				target: args.target,
				...validationResult,
				errors: validationResult.errors || [],
				warnings: validationResult.warnings || [],
			};
		} else {
			result = {
				target: args.target,
				errors: ["pack requires inspect, validate, readiness, or validate-execution."],
				warnings: [],
			};
		}
	} else if (command === "profile") {
		const action = args._ && args._[0];
		if (action !== "inspect") {
			result = {
				target: args.target,
				errors: ["profile requires inspect."],
				warnings: [],
			};
		} else {
			result = inspectProjectProfile(args.file || "");
		}
	} else if (command === "task") {
		const action = args._ && args._[0];
		if (action !== "prepare") {
			result = {
				target: args.target,
				errors: ["task requires prepare."],
				warnings: [],
			};
		} else {
			result = prepareTaskExecution(args.target, args.plan, args.task, args);
		}
	} else if (command === "result") {
		const action = args._ && args._[0];
		if (action !== "inspect") {
			result = {
				target: args.target,
				errors: ["result requires inspect."],
				warnings: [],
			};
		} else {
			result = inspectTaskResult(args.target, args.task);
		}
	} else if (command === "agent") {
		const action = args._ && args._[0];
		if (action === "dispatch") {
			result = dispatchAgentTask(args.target, args);
		} else if (action === "stop") {
			result = setAgentDispatchStatus(args.target, args.task, "stopped");
		} else if (action === "resume") {
			result = setAgentDispatchStatus(args.target, args.task, "dispatched");
		} else if (action === "review") {
			result = recordAgentReview(args.target, args);
		} else {
			result = {
				target: args.target,
				errors: ["agent requires dispatch, stop, resume, or review."],
				warnings: [],
			};
		}
	} else if (command === "loop") {
		const action = args._ && args._[0];
		if (action === "inspect") {
			result = inspectLoopContract({
				file: args.file,
				contract: args.contract,
			});
		} else if (action === "run") {
			result = dryRunLoopContract({
				file: args.file,
				contract: args.contract,
				dryRun: args.dryRun,
				output: args.output,
			});
		} else if (action === "record") {
			result = recordLoopContract({
				file: args.file,
				contract: args.contract,
				triggerSource: args.triggerSource,
				stopReason: args.stopReason,
				output: args.output,
			});
		} else if (action === "status") {
			result = inspectLoopLedger({ ledger: args.ledger });
		} else if (action === "validate-loop") {
			const { validateLoopContract } = require("./lib/amber-core");
			result = validateLoopContract(args.contract);
		} else {
			result = {
				target: args.target,
				errors: ["loop requires inspect, run, record, status, or validate-loop."],
				warnings: [],
			};
		}
	} else if (command === "team") {
		const action = args._ && args._[0];
		if (action === "inspect") {
			result = inspectTeamDistribution(args.target, args);
		} else if (action === "install") {
			result = installTeamDistribution(args.target, args);
		} else if (action === "pin") {
			result = pinTeamDistribution(args.target, args);
		} else if (action === "update") {
			result = updateTeamDistribution(args.target, args);
		} else if (action === "rollback") {
			result = rollbackTeamDistribution(args.target, args);
		} else {
			result = {
				target: args.target,
				errors: ["team requires inspect, install, pin, update, or rollback."],
				warnings: [],
			};
		}
	} else if (command === "maintenance") {
		const action = args._ && args._[0];
		if (action === "inspect") {
			result = inspectMaintenance(args.target, args);
		} else if (action === "propose" || action === "proposal") {
			result = proposeMaintenance(args.target, args);
		} else if (action === "stale-docs") {
			const { detectStaleDocs } = require("./lib/core/maintenance");
			const { resolveTarget } = require("./lib/core/fs-utils");
			const targetRoot = resolveTarget(args.target);
			const thresholdDays = args.thresholdDays || 180;
			const staleResult = detectStaleDocs(targetRoot, thresholdDays);
			result = {
				target: targetRoot,
				staleDocs: staleResult.staleDocs,
				thresholdDays: staleResult.thresholdDays,
				errors: [],
				warnings: [],
			};
		} else if (action === "wiki-lint") {
			const { validateWikiStructure } = require("./lib/core/maintenance");
			const { resolveTarget } = require("./lib/core/fs-utils");
			const targetRoot = resolveTarget(args.target);
			result = validateWikiStructure(targetRoot);
		} else if (action === "pack-drift") {
			const { detectPackDrift } = require("./lib/core/maintenance");
			const { resolveTarget } = require("./lib/core/fs-utils");
			const { resolveRegistryPath } = require("./lib/core/team");
			const targetRoot = resolveTarget(args.target);
			const registryPath = resolveRegistryPath(args.registry);
			const driftResult = detectPackDrift(targetRoot, registryPath);
			result = {
				target: targetRoot,
				...driftResult,
				errors: [],
				warnings: [],
			};
		} else if (action === "upgrade-preview") {
			const { previewUpgrade } = require("./lib/core/maintenance");
			const { resolveTarget } = require("./lib/core/fs-utils");
			const { resolveRegistryPath } = require("./lib/core/team");
			const targetRoot = resolveTarget(args.target);
			const registryPath = resolveRegistryPath(args.registry);
			const previewResult = previewUpgrade(targetRoot, args.version, registryPath);
			result = {
				target: targetRoot,
				...previewResult,
				errors: [],
				warnings: [],
			};
		} else if (action === "evolution-rollup") {
			const { rollupEvolutionFindings } = require("./lib/core/maintenance");
			const { resolveTarget } = require("./lib/core/fs-utils");
			const targetRoot = resolveTarget(args.target);
			const threshold = args.threshold ? parseInt(args.threshold, 10) : 2;
			const rollupResult = rollupEvolutionFindings(targetRoot);
			result = {
				target: targetRoot,
				findings: rollupResult.findings.filter((f) => f.count >= threshold),
				threshold,
				errors: [],
				warnings: [],
			};
		} else if (action === "regression-proposals") {
			const { extractRegressionProposals } = require("./lib/core/maintenance");
			const { resolveTarget } = require("./lib/core/fs-utils");
			const targetRoot = resolveTarget(args.target);
			const proposals = extractRegressionProposals(targetRoot);
			result = {
				target: targetRoot,
				proposals,
				errors: [],
				warnings: [],
			};
		} else {
			result = {
				target: args.target,
				errors: ["maintenance requires inspect, propose, proposal, stale-docs, wiki-lint, pack-drift, upgrade-preview, evolution-rollup, or regression-proposals."],
				warnings: [],
			};
		}
	} else if (command === "adoption") {
		const action = args._ && args._[0];
		if (action === "report") {
			result = generateAdoptionReport(args.target, args);
		} else if (action === "list") {
			result = listAdoptionReports(args);
		} else if (action === "index") {
			result = writeAdoptionReportsIndex(args);
		} else if (action === "validate") {
			result = validateAdoptionReports(args);
		} else if (action === "compare") {
			result = compareAdoptionReports(args);
		} else if (action === "gate") {
			result = gateAdoptionReport(args);
		} else if (action === "status") {
			result = statusAdoptionReports(args);
		} else if (action === "bundle") {
			result = bundleAdoptionArtifacts(args);
		} else if (action === "next-actions") {
			result = writeAdoptionNextActions(args);
		} else if (action === "decision-record") {
			result = writeAdoptionDecisionRecord(args);
		} else if (action === "apply-plan") {
			result = writeAdoptionApplyPlan(args);
		} else if (action === "selected-files") {
			result = writeAdoptionSelectedFiles(args);
		} else {
			result = {
				target: args.target,
				errors: [
					"adoption requires report, list, index, validate, compare, gate, status, bundle, next-actions, decision-record, apply-plan, or selected-files.",
				],
				warnings: [],
			};
		}
	} else if (command === "route") {
		const action = args._ && args._[0];
		let routeResult;
		if (action === "list") {
			routeResult = listRoutes();
		} else if (action === "inspect") {
			routeResult = inspectRoute(args._[1] || "");
		} else if (action === "validate") {
			routeResult = validateRouteFile(args._[1] || args.file || "");
		} else if (action === "test") {
			routeResult = testRoute(args._[1] || "");
		} else {
			routeResult = {
				text: "route requires list, inspect, validate, or test.",
				exitCode: 1,
			};
		}
		result = {
			target: args.target,
			text: routeResult.text,
			errors: routeResult.exitCode === 0 ? [] : [routeResult.text],
			warnings: [],
		};
		if (!args.json) {
			console.log(routeResult.text);
			return routeResult.exitCode;
		}
		printResult(result, { json: true });
		return routeResult.exitCode;
	} else if (command === "session") {
		const action = args._ && args._[0];
		let sessionResult;
		if (action === "start") {
			let parsedBudget;
			if (args.budget) {
				parsedBudget = parseInt(args.budget, 10);
				if (isNaN(parsedBudget) || parsedBudget <= 0) {
					sessionResult = {
						text: "Error: --budget must be a positive integer",
						exitCode: 1,
					};
				}
			}
			if (!sessionResult) {
				sessionResult = await startSession(args.target || process.cwd(), {
					goal: args.goal || args._[1],
					route: args.route,
					budget: parsedBudget,
					worktree: args.worktree,
					mode: args.mode,
				});
			}
		} else if (action === "status") {
			sessionResult = statusSession(args.target || process.cwd(), {
				sessionId: args._[1],
			});
		} else if (action === "list") {
			sessionResult = listSessions(args.target || process.cwd(), {});
		} else if (action === "abort") {
			sessionResult = await abortSession(args.target || process.cwd(), {
				sessionId: args._[1],
			});
		} else if (action === "continue") {
			sessionResult = await continueSession(args.target || process.cwd(), {
				sessionId: args._[1],
			});
		} else {
			sessionResult = {
				text: "session requires start, status, list, abort, or continue.",
				exitCode: 1,
			};
		}
		result = {
			target: args.target,
			text: sessionResult.text,
			errors: sessionResult.exitCode === 0 ? [] : [sessionResult.text],
			warnings: [],
		};
		if (sessionResult.sessionId) {
			result.sessionId = sessionResult.sessionId;
		}
		if (!args.json) {
			console.log(sessionResult.text);
			return sessionResult.exitCode;
		}
		printResult(result, { json: true });
		return sessionResult.exitCode;
	} else if (command === "migrate") {
		const migrateAction = args._ && args._[0];
		if (migrateAction === "state") {
			const stateResult = migrateState(args.target || process.cwd());
			result = {
				...stateResult,
				target: args.target || process.cwd(),
				errors: [
					...stateResult.errors,
					...stateResult.failed.map((f) => `validation failed: ${f}`),
				],
			};
		} else if (migrateAction === "wiki") {
			const wikiResult = migrateWiki(args.target || process.cwd());
			result = { ...wikiResult, target: args.target || process.cwd() };
		} else {
			const migrateResult = migrateManifests(args.target || process.cwd(), {
				dryRun: args.dryRun,
			});
			result = {
				target: args.target,
				text: migrateResult.message,
				errors: [],
				warnings: [],
			};
			if (!args.json) {
				console.log(migrateResult.message);
				if (migrateResult.logs && migrateResult.logs.length > 0) {
					for (const log of migrateResult.logs) {
						console.log(`  ${log}`);
					}
				}
				return 0;
			}
			printResult(result, { json: true });
			return 0;
		}
	} else if (command === "daemon") {
		const action = args._ && args._[0];
		const { stopDaemon, getDaemonStatus } = require("./lib/daemon");

		if (action === "status") {
			const status = getDaemonStatus(process.cwd());
			const text = status.running
				? `Daemon running (PID: ${status.pid})`
				: "Daemon not running";
			result = {
				target: args.target,
				text,
				errors: [],
				warnings: [],
			};
			if (!args.json) {
				console.log(text);
				return status.running ? 0 : 1;
			}
			printResult(result, { json: true });
			return status.running ? 0 : 1;
		}

		if (action === "stop") {
			const stopResult = stopDaemon(process.cwd());
			result = {
				target: args.target,
				text: stopResult.success ? "Daemon stopped" : stopResult.error,
				errors: stopResult.success ? [] : [stopResult.error],
				warnings: [],
			};
			if (!args.json) {
				console.log(stopResult.success ? "Daemon stopped" : stopResult.error);
				return stopResult.success ? 0 : 1;
			}
			printResult(result, { json: true });
			return stopResult.success ? 0 : 1;
		}

		result = {
			target: args.target,
			text: "Usage: harness daemon <status|stop>",
			errors: ["Unknown daemon subcommand"],
			warnings: [],
		};
		if (!args.json) {
			console.log("Usage: harness daemon <status|stop>");
			return 1;
		}
		printResult(result, { json: true });
		return 1;
	} else if (command === "doctor") {
		result = doctor(args.target);
	} else if (command === "governance") {
		const action = args._ && args._[0];
		const {
			createGovernanceDocs,
			exportGovernanceEvidence,
			inspectGovernancePolicy,
			auditGovernance,
		} = require("./lib/governance-commands");
		if (action === "docs") {
			result = createGovernanceDocs(args.target);
		} else if (action === "evidence") {
			result = exportGovernanceEvidence(args.target || process.cwd(), {
				sessionId: args.session,
				taskId: args.task,
				output: args.output,
				json: args.json,
			});
		} else if (action === "policy") {
			result = inspectGovernancePolicy(args.target);
		} else if (action === "audit") {
			result = auditGovernance(args.target, {
				output: args.output,
				since: args.since,
			});
		} else {
			result = {
				target: args.target,
				errors: ["governance requires docs, evidence, policy, or audit."],
				warnings: [],
			};
		}
	} else if (command === "execution") {
		const action = args._ && args._[0];
		if (action === "validate-integration") {
			const { validateIntegration } = require("./lib/core/execution-validator");
			const contractPath = args.contract || "";
			const validationResult = validateIntegration(contractPath);
			result = {
				target: args.target,
				...validationResult,
			};
		} else if (action === "readiness") {
			const planPath = args.plan || "";
			if (!planPath) {
				result = {
					target: args.target,
					errors: ["execution readiness requires --plan <path>."],
					warnings: [],
				};
			} else {
				const review = reviewPlan(args.target, planPath);
				const ready = review.errors.length === 0;
				result = {
					target: args.target,
					plan: planPath,
					ready,
					blockers: ready ? [] : review.errors,
					errors: ready ? [] : review.errors,
					warnings: [],
				};
			}
		} else {
			result = {
				target: args.target,
				errors: ["execution requires validate-integration or readiness."],
				warnings: [],
			};
		}
	} else {
		console.error(`No handler registered for command: ${command}`);
		return 1;
	}

	printResult(result, { json: args.json, summary: args.summary });
	return Array.isArray(result.errors) && result.errors.length > 0 ? 1 : 0;
}

if (require.main === module) {
	run()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((err) => {
			console.error(err.message || err);
			process.exitCode = 1;
		});
}

module.exports = { run, usage };
