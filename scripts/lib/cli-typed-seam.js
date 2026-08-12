"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
	COMMAND_CAPABILITIES,
	capabilityKey,
	validateWhitelist,
} = require("./mcp-action-contracts");

const ACTION_TYPES_DIR = path.resolve(__dirname, "../../action-types");
const TYPED_COMMANDS = new Set(["session", "route", "context", "governance", "ledger", "loop"]);

function validateTypedSeam(actionTypesDir = ACTION_TYPES_DIR) {
	const actions = fs
		.readdirSync(actionTypesDir)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => JSON.parse(fs.readFileSync(path.join(actionTypesDir, file), "utf8")));
	const result = validateWhitelist(actions);
	if (!result.valid) throw new Error(`CLI typed seam is invalid:\n${result.findings.join("\n")}`);
	return actions;
}

const REGISTERED_ACTIONS = validateTypedSeam();
const ACTIONS_BY_CAPABILITY = new Map();
for (const action of REGISTERED_ACTIONS) {
	const execution = action.execution;
	const mappings = execution.variants ? Object.values(execution.variants) : [execution];
	for (const mapping of mappings) {
		ACTIONS_BY_CAPABILITY.set(capabilityKey(mapping.command, mapping.subcommand), action);
	}
}

function classifyCliInvocation(command, args = {}) {
	if (!TYPED_COMMANDS.has(command)) return null;
	const subcommand = args._?.[0];
	if (!subcommand) return null;
	const capability = COMMAND_CAPABILITIES[capabilityKey(command, subcommand)];
	if (!capability) return null;
	const writeFlags = new Set(capability.writeFlags || []);
	const bindsWrite = [...writeFlags].some((flag) => {
		const key = flag.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
		return args[key] !== undefined && args[key] !== null && args[key] !== false;
	});
	return Object.freeze({
		key: capabilityKey(command, subcommand),
		effect: bindsWrite ? "write" : capability.effect,
		approver: capability.approver,
		directReadOnlyExec: !bindsWrite && capability.directReadOnlyExec,
	});
}

function validateCliInvocation(command, args = {}) {
	if (!TYPED_COMMANDS.has(command)) {
		return { valid: true, disposition: "untyped", capability: null, action: null };
	}
	const subcommand = args._?.[0];
	if (!subcommand) {
		return { valid: true, disposition: "unmapped", capability: null, action: null };
	}
	const key = capabilityKey(command, subcommand);
	const capability = classifyCliInvocation(command, args);
	const action = ACTIONS_BY_CAPABILITY.get(key) || null;
	if (!capability || !action) {
		return { valid: true, disposition: "unmapped", capability: null, action: null };
	}
	return { valid: true, disposition: "typed", capability, action };
}

function dispatchTypedInvocation(command, args, invokeHandler) {
	const check = validateCliInvocation(command, args);
	if (!check.valid) {
		return { result: { errors: [check.error], warnings: [] }, exitCode: 1 };
	}
	if (
		check.disposition === "typed" &&
		check.capability.effect === "write" &&
		!args.yes &&
		!args.confirm
	) {
		return {
			result: {
				errors: [],
				warnings: [],
				executed: false,
				approvalRequired: true,
				actionTypeId: check.action.actionTypeId,
				capability: check.capability.key,
				hint: "This typed mutation requires explicit approval (--yes or --confirm).",
			},
			exitCode: 1,
		};
	}
	const annotate = (response) => {
		if (check.disposition !== "typed" || !response?.result || typeof response.result !== "object") {
			return response;
		}
		Object.defineProperty(response.result, "typedCapability", {
			value: check.capability,
			enumerable: false,
		});
		Object.defineProperty(response.result, "typedAction", {
			value: check.action.actionTypeId,
			enumerable: false,
		});
		return response;
	};
	const response = invokeHandler();
	return response && typeof response.then === "function"
		? response.then(annotate)
		: annotate(response);
}

module.exports = {
	TYPED_COMMANDS,
	REGISTERED_ACTIONS,
	validateTypedSeam,
	classifyCliInvocation,
	validateCliInvocation,
	dispatchTypedInvocation,
};
