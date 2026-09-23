"use strict";

// Harness command adapter (F065 H0): `amber harness <admit|inspect|start|advance|status>`.
// Envelope, routing, and exit codes are owned by defineCommand (F039); this
// adapter parses flags and forwards to the harness cores, which own every
// semantic verdict (schema validation, Snapshot Hash identity, immutability,
// run transitions, fail-closed reads) as stable AMBER_E_* codes. Expert tier
// by registration; the default seven-verb help surface is unchanged.

const { defineCommand } = require("../subcommand-dispatcher");
const { resolveTarget } = require("../command-helpers");
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
		"context",
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
		execution: (args) => {
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
					result = runPreparedExecution(target, {
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
						"harness execution requires admit, list, inspect, prepare, evaluate, run, or release. Example: amber harness execution admit --file path/to/contract.json",
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
