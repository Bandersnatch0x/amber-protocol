"use strict";

// Harness command adapter (F065 H0): `amber harness <admit|inspect|start|advance|status>`.
// Envelope, routing, and exit codes are owned by defineCommand (F039); this
// adapter parses flags and forwards to the harness cores, which own every
// semantic verdict (schema validation, Snapshot Hash identity, immutability,
// run transitions, fail-closed reads) as stable AMBER_E_* codes. Expert tier
// by registration; the default seven-verb help surface is unchanged.

const { defineCommand } = require("../subcommand-dispatcher");
const { resolveTarget, parseRevisionPin } = require("../command-helpers");
const path = require("node:path");

function invalidArg(message) {
	return { text: "", errors: [message], warnings: [], exitCode: 1, code: "AMBER_E_INVALID_ARG" };
}

function writeFailure(err) {
	return {
		text: "",
		errors: [err.message || String(err)],
		warnings: [],
		exitCode: 1,
		...(err.amberCode ? { code: err.amberCode } : {}),
	};
}

// A value flag as the LAST argv token parses to `undefined` (parseArgs only
// sets the key when the flag appears), so present-but-undefined names the
// truncated invocation and fails closed here.
function requiredFlag(args, key, label, example) {
	if (args[key] === undefined) {
		return { error: `${label} is required. Example: ${example}` };
	}
	return { value: args[key] };
}

const dispatch = defineCommand({
	command: "harness",
	actions: [
		"admit",
		"inspect",
		"start",
		"advance",
		"status",
		"bind",
		"tool",
		"execution",
		"runtime",
		"context",
		"checkpoint",
		"attempt",
		"lifecycle",
		"validate",
		"replay",
		"propose-regression",
		"trace",
		"events",
		"policy",
		"capabilities",
		"eval",
		"legacy",
		"diff",
	],
	handlers: {
		admit: (args) => {
			const { admitHarnessContract } = require("./contract-core");
			const target = resolveTarget(args);
			const file = requiredFlag(
				args,
				"file",
				"--file",
				"amber harness admit --file path/to/contract.json --target <repo>",
			);
			if (file.error) return invalidArg(file.error);
			let result;
			try {
				result = admitHarnessContract(target, { contractPath: file.value });
			} catch (err) {
				return writeFailure(err);
			}
			const body = {
				id: result.id,
				snapshotHash: result.snapshotHash,
				admittedAt: result.admittedAt,
				contractFile: result.contractFile,
				idempotent: result.idempotent,
			};
			return {
				...body,
				text: JSON.stringify(body, null, 2),
				warnings: result.idempotent
					? [
							`contract "${result.id}" was already admitted; byte-identical re-admission left the record unchanged`,
						]
					: [],
				ok: true,
			};
		},
		inspect: (args) => {
			const { inspectHarnessContract, listHarnessContracts } = require("./contract-core");
			const target = resolveTarget(args);
			let result;
			try {
				if (args.run) {
					// §38 gate shape: one view over the run and its verified event
					// chain (Agent→Contract→Run→Events) — read-only, fail-closed.
					const { getRun } = require("./run-core");
					const { readRunEvents } = require("./event-ledger");
					const run = getRun(target, { runId: args.run }).run;
					result = { ok: true, run, events: readRunEvents(target, args.run) };
				} else if (args.contract) {
					result = inspectHarnessContract(target, { contractId: args.contract });
				} else if (args.all) {
					result = { ok: true, contracts: listHarnessContracts(target) };
				} else {
					return invalidArg(
						"--contract <id>, --run <id>, or --all is required for harness inspect",
					);
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		start: (args) => {
			const target = resolveTarget(args);
			const contract = requiredFlag(
				args,
				"contract",
				"--contract",
				"amber harness start --contract coding-task --agent worker --target <repo>",
			);
			if (contract.error) return invalidArg(contract.error);
			let result;
			try {
				if (args.fromLoop) {
					// F066: one governed loop execution maps to Task + Run + Receipt.
					const { startRunFromLoop } = require("./loop-adapter");
					result = startRunFromLoop(target, {
						contractId: contract.value,
						loopContractId: args.fromLoop,
						packFile: args.file,
						runId: args.run,
						agent: args.agent,
					});
				} else {
					const { createRun } = require("./run-core");
					result = createRun(target, {
						contractId: contract.value,
						runId: args.run,
						subject: {
							agent: args.agent || "unspecified-agent",
							...(args.session ? { session: args.session } : {}),
							...(args.task ? { task: args.task } : {}),
						},
						executionRef: args.execution,
					});
				}
			} catch (err) {
				return writeFailure(err);
			}
			const body = { run: result.run, runFile: result.runFile };
			return { ...body, text: JSON.stringify(body, null, 2), ok: true };
		},
		bind: (args) => {
			const { bindLoopOutcome } = require("./loop-adapter");
			const target = resolveTarget(args);
			const run = requiredFlag(
				args,
				"run",
				"--run",
				"amber harness bind --run run-xyz --from-loop daily-amber-triage --target <repo>",
			);
			if (run.error) return invalidArg(run.error);
			const loop = requiredFlag(
				args,
				"fromLoop",
				"--from-loop",
				"amber harness bind --run run-xyz --from-loop daily-amber-triage --target <repo>",
			);
			if (loop.error) return invalidArg(loop.error);
			let result;
			try {
				result = bindLoopOutcome(target, { runId: run.value, loopContractId: loop.value });
			} catch (err) {
				return writeFailure(err);
			}
			const body = {
				run: result.run,
				outcomeExitCode: result.exitCode,
				executedPointer: result.executedPointer,
			};
			return { ...body, text: JSON.stringify(body, null, 2), ok: true };
		},
		advance: (args) => {
			const { transitionRun, ADMISSION_CHECK_NAMES } = require("./run-core");
			const target = resolveTarget(args);
			const run = requiredFlag(
				args,
				"run",
				"--run",
				"amber harness advance --run run-xyz --to running --target <repo>",
			);
			if (run.error) return invalidArg(run.error);
			const to = requiredFlag(
				args,
				"to",
				"--to",
				"amber harness advance --run run-xyz --to running --target <repo>",
			);
			if (to.error) return invalidArg(to.error);
			let admission;
			if (Array.isArray(args.checks) && args.checks.length > 0) {
				admission = {};
				for (const entry of args.checks) {
					const sep = String(entry).indexOf(":");
					if (sep <= 0) {
						return invalidArg(
							`--check must be <name:pointer> (got ${JSON.stringify(entry)}); names: ${ADMISSION_CHECK_NAMES.join(", ")}`,
						);
					}
					const name = String(entry).slice(0, sep);
					const pointer = String(entry).slice(sep + 1);
					if (!ADMISSION_CHECK_NAMES.includes(name)) {
						return invalidArg(
							`unknown admission check "${name}"; names: ${ADMISSION_CHECK_NAMES.join(", ")}`,
						);
					}
					admission[name] = { result: "pass", pointer };
				}
			}
			let result;
			try {
				result = transitionRun(target, {
					runId: run.value,
					to: to.value,
					reason: args.reason,
					admission,
				});
			} catch (err) {
				return writeFailure(err);
			}
			const body = { run: result.run };
			return { ...body, text: JSON.stringify(body, null, 2), ok: true };
		},
		tool: (args) => {
			const sub = args._?.[1];
			const target = resolveTarget(args);
			const {
				admitHarnessTool,
				inspectHarnessTool,
				listHarnessTools,
				checkHarnessTool,
			} = require("./tool-core");
			let result;
			try {
				if (sub === "admit") {
					const file = requiredFlag(
						args,
						"file",
						"--file",
						"amber harness tool admit --file path/to/tool.json --target <repo>",
					);
					if (file.error) return invalidArg(file.error);
					result = admitHarnessTool(target, { toolPath: file.value });
					const body = {
						id: result.id,
						snapshotHash: result.snapshotHash,
						admittedAt: result.admittedAt,
						toolFile: result.toolFile,
						idempotent: result.idempotent,
					};
					return {
						...body,
						text: JSON.stringify(body, null, 2),
						warnings: result.idempotent
							? [
									`tool "${result.id}" was already admitted; byte-identical re-admission left the record unchanged`,
								]
							: [],
						ok: true,
					};
				}
				if (sub === "list") {
					result = { ok: true, tools: listHarnessTools(target) };
				} else if (sub === "inspect") {
					// `--tool` maps to toolVal in FLAG_SPECS (the evidence command
					// owns the accumulate form); tests may pass `tool` directly.
					const toolId = args.toolVal || args.tool;
					if (!toolId) {
						return invalidArg("--tool <id> is required for harness tool inspect");
					}
					result = inspectHarnessTool(target, { toolId });
				} else if (sub === "check") {
					const toolId = args.toolVal || args.tool;
					if (!toolId) {
						return invalidArg("--tool <id> is required for harness tool check");
					}
					result = checkHarnessTool(target, { toolId });
				} else {
					return invalidArg(
						"harness tool requires admit, list, inspect, or check. Example: amber harness tool admit --file path/to/tool.json",
					);
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		execution: async (args) => {
			const sub = args._?.[1];
			const target = resolveTarget(args);
			let result;
			try {
				if (sub === "admit") {
					const { admitExecutionContract } = require("./execution-core");
					const file = requiredFlag(
						args,
						"file",
						"--file",
						"amber harness execution admit --file path/to/contract.json --target <repo>",
					);
					if (file.error) return invalidArg(file.error);
					result = admitExecutionContract(target, { contractPath: file.value });
					const body = {
						id: result.id,
						snapshotHash: result.snapshotHash,
						admittedAt: result.admittedAt,
						contractFile: result.contractFile,
						idempotent: result.idempotent,
					};
					return {
						...body,
						text: JSON.stringify(body, null, 2),
						warnings: result.idempotent
							? [
									`execution contract "${result.id}" was already admitted; byte-identical re-admission left the record unchanged`,
								]
							: [],
						ok: true,
					};
				}
				if (sub === "list") {
					const { listExecutionContracts } = require("./execution-core");
					const { listPreparedExecutions } = require("./execution-adapter");
					result = {
						ok: true,
						contracts: listExecutionContracts(target),
						executions: listPreparedExecutions(target),
					};
				} else if (sub === "inspect") {
					if (args.contract) {
						const { inspectExecutionContract } = require("./execution-core");
						result = inspectExecutionContract(target, { contractId: args.contract });
					} else if (args.run) {
						const { inspectExecution } = require("./execution-adapter");
						result = inspectExecution(target, { runId: args.run });
					} else {
						return invalidArg(
							"--contract <id> or --run <id> is required for harness execution inspect",
						);
					}
				} else if (sub === "prepare") {
					const { prepareExecution } = require("./execution-adapter");
					const contract = requiredFlag(
						args,
						"contract",
						"--contract",
						"amber harness execution prepare --contract <id> --run <id> --target <repo>",
					);
					if (contract.error) return invalidArg(contract.error);
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness execution prepare --contract <id> --run <id> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					result = prepareExecution(target, { contractId: contract.value, runId: run.value });
				} else if (sub === "evaluate") {
					const { evaluateExecution } = require("./execution-adapter");
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness execution evaluate --run <id> --file observed.json --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					let observedEntries = [];
					if (args.file) {
						const fs = require("node:fs");
						const parsed = JSON.parse(fs.readFileSync(path.resolve(target, args.file), "utf8"));
						observedEntries = Array.isArray(parsed) ? parsed : parsed.entries || [];
					}
					result = evaluateExecution(target, { runId: run.value, observedEntries });
				} else if (sub === "run") {
					const { runPreparedExecution } = require("./execution-adapter");
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness execution run --run <id> --command-id <id> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					const commandId = requiredFlag(
						args,
						"commandId",
						"--command-id",
						"amber harness execution run --run <id> --command-id <id> --target <repo>",
					);
					if (commandId.error) return invalidArg(commandId.error);
					result = await runPreparedExecution(target, {
						runId: run.value,
						commandId: commandId.value,
						...(args.ledger === undefined ? {} : { ledger: args.ledger }),
						...(args.budgetMinutes === undefined
							? {}
							: Number.isInteger(Number(args.budgetMinutes))
								? { budgetMinutes: Number(args.budgetMinutes) }
								: (() => {
										throw new Error(
											`--budget-minutes must be an integer; got ${JSON.stringify(args.budgetMinutes)}`,
										);
									})()),
						...(args.producer === undefined ? {} : { producer: args.producer }),
						...(args.requestId === undefined ? {} : { requestId: args.requestId }),
					});
					if (result.refused) {
						// A gate refusal IS the governed outcome: fail closed with the
						// governing gate's errors; the denied record is already on the
						// governed ledger.
						const body = {
							refused: true,
							attemptId: result.attemptId,
							governed: result.governed,
						};
						return {
							...body,
							text: JSON.stringify(body, null, 2),
							errors: result.governed.errors.map((entry) => String(entry)),
							warnings: [],
							exitCode: 1,
						};
					}
					if (result.commandErrors) {
						// The attempt executed and its mutations are folded, but the
						// command itself failed: report it while keeping the verdict.
						result.errors = result.commandErrors.map((entry) => String(entry));
						result.exitCode = 1;
					}
				} else if (sub === "terminate") {
					// F078/F081: the ambiguous verb stays refused — but F081 delivered the
					// authorized surface, so the refusal now points at it. Composing Run
					// cancellation with workspace deletion is still never done: those
					// remain separate audited facts.
					return invalidArg(
						"harness execution terminate is an explicit refusal: 'terminate' conflates Run cancellation, request settlement, and workspace deletion, and F081 cancellation is addressed per governed execution instead. Cancel a live governed execution with `amber harness execution cancel --run <id> --decision <identity>@<revision> --reason <text>` (or inspect the owned handles with `amber harness execution handles`); cancel the Run record with `amber harness advance --run <id> --to cancelled --reason <text>`; settle a prepared runner request that will never produce a receipt with `amber runner execution abort --request-hash <hash> --reason <text>`; remove a prepared workspace with `amber harness execution release --run <id>`. These are separate auditable facts; terminate never bypasses the F070 BLOCK posture and writes nothing.",
					);
				} else if (sub === "cancel") {
					const { cancelExecution } = require("./execution-cancel");
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness execution cancel --run <id> --decision <identity>@<revision> --reason <text> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					const decision = requiredFlag(
						args,
						"decision",
						"--decision",
						"amber harness execution cancel --run <id> --decision decision/cancel-1@1 --reason <text> --target <repo>",
					);
					if (decision.error) return invalidArg(decision.error);
					const parsedDecision = parseRevisionPin(
						decision.value,
						"--decision",
						"decision/cancel-1@1",
					);
					if (parsedDecision.error) return invalidArg(parsedDecision.error);
					if (!args.reason) return invalidArg("--reason <text> is required for execution cancel");
					result = await cancelExecution(target, {
						runId: run.value,
						decision: parsedDecision.value,
						reason: String(args.reason),
						...(args.now === undefined ? {} : { now: args.now }),
					});
				} else if (sub === "handles") {
					const { handleView } = require("./execution-cancel");
					result = handleView(target, {
						...(args.run === undefined ? {} : { runId: args.run }),
					});
				} else if (sub === "release") {
					const { releaseExecution } = require("./execution-adapter");
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness execution release --run <id> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					result = releaseExecution(target, { runId: run.value });
				} else {
					return invalidArg(
						"harness execution requires admit, list, inspect, prepare, evaluate, run, cancel, handles, release, or the explicit terminate refusal. Example: amber harness execution admit --file path/to/contract.json",
					);
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		runtime: (args) => {
			const sub = args._?.[1];
			const op = args._?.[2];
			const target = resolveTarget(args);
			const {
				admitSchedule,
				revokeSchedule,
				listSchedules,
				showSchedule,
				listJobs,
				tickRuntime,
				startDaemon,
				stopDaemon,
				daemonStatus,
			} = require("./runtime-core");
			let result;
			try {
				if (sub === "jobs") {
					result = { ok: true, jobs: listJobs() };
				} else if (sub === "schedule" && op === "admit") {
					const file = requiredFlag(
						args,
						"file",
						"--file",
						"amber harness runtime schedule admit --file schedule.json --target <repo>",
					);
					if (file.error) return invalidArg(file.error);
					const fs = require("node:fs");
					const input = JSON.parse(fs.readFileSync(path.resolve(target, file.value), "utf8"));
					result = admitSchedule(target, input);
				} else if (sub === "schedule" && op === "list") {
					result = { ok: true, schedules: listSchedules(target, { now: args.now }) };
				} else if (sub === "schedule" && op === "show") {
					const schedule = requiredFlag(
						args,
						"schedule",
						"--schedule",
						"amber harness runtime schedule show --schedule <id> --target <repo>",
					);
					if (schedule.error) return invalidArg(schedule.error);
					result = {
						ok: true,
						...showSchedule(target, { scheduleId: schedule.value, now: args.now }),
					};
				} else if (sub === "schedule" && op === "revoke") {
					const schedule = requiredFlag(
						args,
						"schedule",
						"--schedule",
						"amber harness runtime schedule revoke --schedule <id> --decision <identity>@<revision> --reason <text> --target <repo>",
					);
					if (schedule.error) return invalidArg(schedule.error);
					const decision = requiredFlag(
						args,
						"decision",
						"--decision",
						"amber harness runtime schedule revoke --schedule <id> --decision decision/runtime-revoke@1 --reason <text> --target <repo>",
					);
					if (decision.error) return invalidArg(decision.error);
					const parsed = parseRevisionPin(
						decision.value,
						"--decision",
						"decision/runtime-revoke@1",
					);
					if (parsed.error) return invalidArg(parsed.error);
					if (!args.reason) return invalidArg("--reason <text> is required for schedule revoke");
					result = revokeSchedule(target, {
						scheduleId: schedule.value,
						decision: parsed.value,
						reason: args.reason,
					});
				} else if (sub === "tick") {
					result = tickRuntime(target, {
						...(args.schedule === undefined ? {} : { scheduleId: args.schedule }),
						...(args.now === undefined ? {} : { now: args.now }),
					});
				} else if (sub === "daemon" && op === "start") {
					result = startDaemon(target, {
						...(args.pollMs === undefined ? {} : { pollMs: Number(args.pollMs) }),
					});
				} else if (sub === "daemon" && op === "stop") {
					result = stopDaemon(target);
				} else if (sub === "daemon" && op === "status") {
					result = daemonStatus(target);
				} else {
					return invalidArg(
						"harness runtime requires jobs; schedule admit|list|show|revoke; tick; or daemon start|stop|status",
					);
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		context: (args) => {
			const sub = args._?.[1];
			const target = resolveTarget(args);
			let result;
			try {
				if (sub === "admit") {
					const { admitContextGrant } = require("./context-core");
					const file = requiredFlag(
						args,
						"file",
						"--file",
						"amber harness context admit --file path/to/grant.json --target <repo>",
					);
					if (file.error) return invalidArg(file.error);
					result = admitContextGrant(target, { grantPath: file.value });
					const body = {
						id: result.id,
						snapshotHash: result.snapshotHash,
						admittedAt: result.admittedAt,
						grantFile: result.grantFile,
						idempotent: result.idempotent,
					};
					return {
						...body,
						text: JSON.stringify(body, null, 2),
						warnings: result.idempotent
							? [
									`context grant "${result.id}" was already admitted; byte-identical re-admission left the record unchanged`,
								]
							: [],
						ok: true,
					};
				}
				if (sub === "list") {
					const { listContextGrants } = require("./context-core");
					result = { ok: true, grants: listContextGrants(target) };
				} else if (sub === "inspect") {
					const { inspectContextGrant } = require("./context-core");
					if (!args.grant) {
						return invalidArg("--grant <id> is required for harness context inspect");
					}
					result = inspectContextGrant(target, { grantId: args.grant });
				} else if (sub === "check") {
					const { checkContextAccess } = require("./context-core");
					result = checkContextAccess(target, {
						subject: args.subject,
						resource: args.resource,
						purpose: args.purpose,
						classification: args.classification,
						now: args.now,
						runId: args.run,
					});
				} else if (sub === "revoke") {
					const { revokeContextGrant } = require("./context-core");
					const grant = requiredFlag(
						args,
						"grant",
						"--grant",
						"amber harness context revoke --grant <id> --revoker <who> --target <repo>",
					);
					if (grant.error) return invalidArg(grant.error);
					result = revokeContextGrant(target, {
						grantId: grant.value,
						revoker: args.revoker,
						reason: args.reason,
					});
				} else {
					return invalidArg(
						"harness context requires admit, list, inspect, check, or revoke. Example: amber harness context check --subject worker --resource docs/ --purpose review --target <repo>",
					);
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		checkpoint: (args) => {
			const sub = args._?.[1];
			const target = resolveTarget(args);
			const {
				captureCheckpoint,
				listCheckpoints,
				verifyCheckpoint,
				getCheckpoint,
			} = require("./checkpoint-core");
			let result;
			try {
				if (sub === "capture") {
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness checkpoint capture --run <id> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					result = captureCheckpoint(target, { runId: run.value, reason: args.reason });
				} else if (sub === "list") {
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness checkpoint list --run <id> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					result = { ok: true, checkpoints: listCheckpoints(target, { runId: run.value }) };
				} else if (sub === "verify") {
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness checkpoint verify --run <id> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					result = verifyCheckpoint(target, {
						runId: run.value,
						...(args.checkpoint === undefined ? {} : { checkpointId: args.checkpoint }),
					});
				} else if (sub === "inspect") {
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness checkpoint inspect --run <id> --checkpoint <id> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					const checkpoint = requiredFlag(
						args,
						"checkpoint",
						"--checkpoint",
						"amber harness checkpoint inspect --run <id> --checkpoint <id> --target <repo>",
					);
					if (checkpoint.error) return invalidArg(checkpoint.error);
					result = getCheckpoint(target, { runId: run.value, checkpointId: checkpoint.value });
				} else {
					return invalidArg(
						"harness checkpoint requires capture, list, verify, or inspect. Example: amber harness checkpoint capture --run <id>",
					);
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		attempt: (args) => {
			const sub = args._?.[1];
			const target = resolveTarget(args);
			const { listAttempts, getAttempt, detectNoProgress } = require("./attempt-core");
			let result;
			try {
				if (sub === "list") {
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness attempt list --run <id> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					const attempts = listAttempts(target, { runId: run.value });
					result = { ok: true, attempts, noProgress: detectNoProgress(attempts) };
				} else if (sub === "inspect") {
					const run = requiredFlag(
						args,
						"run",
						"--run",
						"amber harness attempt inspect --run <id> --attempt <id> --target <repo>",
					);
					if (run.error) return invalidArg(run.error);
					if (args.attemptId === undefined && args.attempt === undefined) {
						return invalidArg("--attempt <id> is required for harness attempt inspect");
					}
					result = getAttempt(target, {
						runId: run.value,
						attemptId: args.attemptId || args.attempt,
					});
				} else {
					return invalidArg(
						"harness attempt requires list or inspect. Example: amber harness attempt list --run <id>",
					);
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		lifecycle: (args) => {
			const { lifecycleView } = require("./lifecycle-view");
			const target = resolveTarget(args);
			let result;
			try {
				result = lifecycleView(target, { ...(args.run === undefined ? {} : { runId: args.run }) });
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		validate: (args) => {
			const { validateRun, listReceipts } = require("./validation-core");
			const target = resolveTarget(args);
			const sub = args._?.[1];
			let result;
			try {
				if (sub === "list") {
					if (!args.run) return invalidArg("--run <id> is required for harness validate list");
					// Listing existing receipts is read-only and does not bind a
					// caller-supplied eval result; --eval-result is intentionally
					// ignored on this subcommand.
					result = { ok: true, receipts: listReceipts(target, { runId: args.run }) };
				} else if (args.run || sub) {
					let evalResult;
					if (Object.prototype.hasOwnProperty.call(args, "evalResult")) {
						if (args.evalResult === undefined) {
							return invalidArg(
								"--eval-result requires a value; it was the last token on the command line",
							);
						}
						const parsed = parseRevisionPin(
							args.evalResult,
							"--eval-result",
							"eval-result/instruction-surface/0123456789abcdef@1",
						);
						if (parsed.error) return invalidArg(parsed.error);
						evalResult = parsed.value;
					}
					result = validateRun(target, {
						runId: args.run || sub,
						...(evalResult !== undefined ? { evalResult } : {}),
					});
				} else {
					return invalidArg("--run <id> is required for harness validate");
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		replay: (args) => {
			const { replayRun, listReplays } = require("./replay-core");
			const target = resolveTarget(args);
			const sub = args._?.[1];
			let result;
			try {
				if (sub === "list") {
					if (!args.run) return invalidArg("--run <id> is required for harness replay list");
					result = { ok: true, replays: listReplays(target, { runId: args.run }) };
				} else if (args.run || sub) {
					result = replayRun(target, { runId: args.run || sub });
				} else {
					return invalidArg("--run <id> is required for harness replay");
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		"propose-regression": (args) => {
			const { proposeRegression } = require("./replay-core");
			const target = resolveTarget(args);
			const run = requiredFlag(
				args,
				"run",
				"--run",
				"amber harness propose-regression --run <id> --target <repo>",
			);
			if (run.error) return invalidArg(run.error);
			let result;
			try {
				result = proposeRegression(target, { runId: run.value });
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		trace: (args) => {
			const { getRun } = require("./run-core");
			const { readRunEvents } = require("./event-ledger");
			const target = resolveTarget(args);
			const run = requiredFlag(
				args,
				"run",
				"--run",
				"amber harness trace --run <id> --target <repo>",
			);
			if (run.error) return invalidArg(run.error);
			let result;
			try {
				// F074 H6: the run's causal line in one view — the record, its
				// state history, the admission pointers, and the ordered trail.
				// Composes getRun + readRunEvents verbatim (the same citations
				// inspect --run uses); zero new verdicts; corrupt records fail
				// closed through the readers.
				const record = getRun(target, { runId: run.value }).run;
				const events = readRunEvents(target, run.value);
				result = {
					ok: true,
					run: record,
					stateHistory: record.stateHistory,
					...(record.admission ? { admission: record.admission } : {}),
					events,
				};
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		events: (args) => {
			const { readRunEvents, readHarnessEvents } = require("./event-ledger");
			const { getRun } = require("./run-core");
			const target = resolveTarget(args);
			let result;
			try {
				// F074 H6: the verified event stream — one run's (with --run) or
				// the whole harness ledger's (without). The fold re-walks the
				// chain either way; a corrupt event refuses the read. A --run
				// that is present-but-empty or names no existing run fails
				// closed (a silent empty success would present absence as
				// evidence).
				if (args.run !== undefined) {
					if (!args.run) {
						return invalidArg("--run <id> requires a value");
					}
					getRun(target, { runId: args.run });
					result = { ok: true, runId: args.run, events: readRunEvents(target, args.run) };
				} else {
					result = { ok: true, events: readHarnessEvents(target) };
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		policy: (args) => {
			const sub = args._?.[1];
			const target = resolveTarget(args);
			let result;
			try {
				if (sub === "check") {
					// F074 H6: the run's policy POSTURE from the trail —
					// report-only visibility; enforcement stays inside the
					// governed runner, unchanged (this view can never deny or
					// allow an operation).
					const toolId = args.toolVal || args.tool;
					if (toolId !== undefined && !args.run) {
						// The --tool leg: the connector ≠ permission verdict for
						// ONE tool — the same `checkHarnessTool` composition
						// `tool check` uses (verbatim, never re-implemented).
						const { checkHarnessTool } = require("./tool-core");
						result = { ok: true, tool: checkHarnessTool(target, { toolId }), reportOnly: true };
					} else if (!args.run) {
						return invalidArg(
							"--run <id> (run posture) or --tool <id> (tool verdict) is required for harness policy check",
						);
					} else if (toolId !== undefined) {
						return invalidArg("--run and --tool are separate legs; use one per invocation");
					} else {
						const { getRun } = require("./run-core");
						const { readRunEvents } = require("./event-ledger");
						const record = getRun(target, { runId: args.run }).run;
						const events = readRunEvents(target, args.run).filter(
							(event) => event.kind === "policy.evaluated",
						);
						result = {
							ok: true,
							runId: args.run,
							frozenPolicyRef: record.harness ? (record.harness.policy ?? null) : null,
							trailVerdicts: events.map((event) => ({
								at: event.at,
								result: event.decision ? event.decision.result : null,
								policy: event.decision ? (event.decision.policy ?? null) : null,
								...(event.reason ? { reason: event.reason } : {}),
							})),
							...(record.replay ? { replayVerdict: record.replay.verdict } : {}),
							...(record.validation ? { validationStatus: record.validation.status } : {}),
							reportOnly: true,
						};
					}
				} else {
					return invalidArg(
						"harness policy requires check. Example: amber harness policy check --run <id>",
					);
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		capabilities: (args) => {
			const { listHarnessTools, toolsSnapshot } = require("./tool-core");
			const target = resolveTarget(args);
			let result;
			try {
				// F074 H6: the capability snapshot — admitted tools with their
				// resolved pins (tombstones for corrupt records) plus the
				// registry's snapshot hash. Read-only; admission stays
				// `harness tool admit` (explicitly gated as today).
				result = {
					ok: true,
					tools: listHarnessTools(target),
					registrySnapshot: toolsSnapshot(target),
				};
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		eval: (args) => {
			const target = resolveTarget(args);
			let result;
			try {
				if (args.run !== undefined) {
					// With --run: the run's eval artifacts on record — read from
					// the run's own event pointers (the closed eval/eval-result
					// artifact-identity prefixes; never a substring over-match
					// of caller-controlled fields). Report-only.
					if (args.run === undefined) {
						return invalidArg("--run <id> requires a value");
					}
					const { getRun } = require("./run-core");
					const { readRunEvents } = require("./event-ledger");
					const record = getRun(target, { runId: args.run }).run;
					const pointers = readRunEvents(target, args.run)
						.flatMap((event) => event.pointers || [])
						.filter((pointer) => pointer.startsWith("eval/") || pointer.startsWith("eval-result/"));
					result = {
						ok: true,
						runId: args.run,
						evaluationPointers: pointers,
						...(record.validation ? { validationStatus: record.validation.status } : {}),
						reportOnly: true,
					};
					return { ...result, text: JSON.stringify(result, null, 2), ok: true };
				}
				// A stray positional (e.g. `harness eval admit`) is refused
				// loudly: the alias aggregates only the report-only `run` subverb
				// — `eval admit` stays on its own explicitly gated surface.
				if (args._?.[1]) {
					return invalidArg(
						`harness eval aggregates only the report-only suite (no subverbs); for ${JSON.stringify(args._[1])} use the eval surface directly (e.g. amber eval ${args._[1]})`,
					);
				}
				// F074 H6: a governed ALIAS over the F058 surface — the same
				// dispatch path (and therefore the same handler) `amber eval
				// run` resolves to; report-only, never an Approval, never a
				// model call. The alias is the §35 aggregation, not a second
				// authority: `eval admit` is NOT aliased and stays on its own
				// explicitly gated surface.
				const { evalDispatch } = require("../eval-commands");
				const aliasArgs = {
					...args,
					_: ["run"],
					target: args.target,
				};
				const evalResult = evalDispatch(aliasArgs);
				return {
					...evalResult.result,
					text: evalResult.result.text,
					errors: evalResult.result.errors || [],
					warnings: evalResult.result.warnings || [],
					exitCode: evalResult.exitCode,
				};
			} catch (err) {
				return writeFailure(err);
			}
		},
		legacy: (args) => {
			const { legacyTaskView, legacyDispositions, legacyProfileView } = require("./legacy-core");
			const target = resolveTarget(args);
			const sub = args._?.[1];
			let result;
			try {
				if (sub === "task") {
					// F075: the declared §52 mapping for ONE legacy task — a
					// read-only projection over the frozen on-disk legacy
					// shape; nothing is migrated or adopted. The task id
					// comes only from --task (the spec's sole affordance —
					// no positional run/task ids on the harness surface).
					result = legacyTaskView(target, { taskId: args.task });
				} else if (sub === "profile") {
					result = legacyProfileView();
				} else if (sub === undefined) {
					result = legacyDispositions();
				} else {
					return invalidArg(
						"harness legacy requires task (--task <id>), profile, or no subaction (the disposition table)",
					);
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		diff: (args) => {
			const { diffRuns } = require("./replay-core");
			const target = resolveTarget(args);
			const from = requiredFlag(
				args,
				"from",
				"--from",
				"amber harness diff --from <runId> --to <runId> --target <repo>",
			);
			if (from.error) return invalidArg(from.error);
			const to = requiredFlag(
				args,
				"to",
				"--to",
				"amber harness diff --from <runId> --to <runId> --target <repo>",
			);
			if (to.error) return invalidArg(to.error);
			let result;
			try {
				// F076: the cross-run comparison over the replay axes —
				// response-only (a diff of two immutable records is reproducible
				// by re-running), read-only, outcome never in the verdict.
				result = diffRuns(target, { fromRunId: from.value, toRunId: to.value });
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
		status: (args) => {
			const { getRun, listRuns } = require("./run-core");
			const target = resolveTarget(args);
			let result;
			try {
				if (args.run) {
					result = getRun(target, { runId: args.run });
				} else {
					result = { ok: true, runs: listRuns(target) };
				}
			} catch (err) {
				return writeFailure(err);
			}
			return { ...result, text: JSON.stringify(result, null, 2), ok: true };
		},
	},
});

function harnessDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { harnessDispatch };
