"use strict";

const { unknownAction: defaultUnknownAction } = require("./command-helpers");

// Deep subcommand-dispatch module. Takes an action table { name → handler }
// plus an envelope shaper and returns a dispatcher that resolves aliases,
// rejects unknown actions, and shapes every result through one envelope.
//
// Each adapter shrinks to a table declaration; the unknownAction /
// knownSubcommands parity that was duplicated across four adapters becomes
// one check here.

/**
 * Create a subcommand dispatcher from a declarative action table.
 *
 * @param {object} opts
 * @param {string[]} opts.actions - Known action names (canonical, in order).
 * @param {Record<string, string>} [opts.aliases] - Alias → canonical name.
 * @param {Record<string, (args: object) => object>} opts.handlers - Canonical name → handler.
 * @param {() => object} opts.unknownHandler - Returns the unknown-action envelope.
 * @param {(result: object) => { result, exitCode, bypassPrint }} [opts.envelope]
 *        Optional envelope shaper. Default: { result, exitCode: 0, bypassPrint: false }.
 * @returns {(action: string, args: object) => { result, exitCode, bypassPrint }}
 */
function createSubcommandDispatcher({ actions, aliases = {}, handlers, unknownHandler, envelope }) {
	const actionSet = new Set(actions);
	const shape = envelope || ((result) => ({ result, exitCode: 0, bypassPrint: false }));

	return function dispatch(action, args = {}) {
		const canonical = aliases[action] || action;
		if (!actionSet.has(canonical)) {
			return shape(unknownHandler());
		}
		const handler = handlers[canonical];
		if (!handler) {
			return shape(unknownHandler());
		}
		const result = handler(args);
		// F081: a handler may be asynchronous (governed execution is an awaited
		// spawn now). A thenable is shaped after it resolves so every caller sees
		// the same synchronous envelope shape it always did — or a promise for it.
		return result && typeof result.then === "function" ? result.then(shape) : shape(result);
	};
}

/**
 * Create a command dispatcher where handlers return only a body and the
 * dispatcher owns routing, aliasing, the envelope, and exit-code derivation
 * (F039, survey Finding 1: one convention replaces four).
 *
 * Handler body: { text|data|...payload, errors?, warnings?, code?, ok?,
 * exitCode?, bypassPrint?, onBypass? }. ok/exitCode/bypassPrint/onBypass are
 * control fields — they shape the envelope and never leak into result.
 * Exit code: explicit body.exitCode > ok === false > errors present > 0.
 * bypassPrint: body.bypassPrint ?? !args.json.
 *
 * The unknown path returns exitCode 1 with bypassPrint left undefined so the
 * CLI renders the guidance through printResult, matching the legacy
 * unknown-action envelopes byte for byte.
 *
 * @param {object} opts
 * @param {string} opts.command - Command name for unknown-action guidance.
 * @param {string[]} opts.actions - Known action names (canonical, in order).
 * @param {Record<string, string>} [opts.aliases] - Alias → canonical name.
 * @param {Record<string, (args: object) => object>} opts.handlers - Canonical name → handler.
 * @param {(command: string, actions: string[]) => object} [opts.unknown]
 *        Custom unknown-action body. Default: the unknownAction envelope.
 * @param {Record<string, {actions: string[], unknown?: string}>} [opts.groups]
 *        Optional second-level verb tables. A group is entered by its action
 *        name and validated against its own verbs; an unknown or missing verb
 *        inside a group answers with that group's guidance, shaped like any
 *        other handler body (so it keeps the caller's existing print path).
 * @param {(err: Error) => object} [opts.onError]
 *        Optional handler-error policy. Without it a throw propagates as before.
 * @returns {(action: string|string[], args: object) => { result, exitCode, bypassPrint, onBypass? }}
 */
function defineCommand({
	command,
	actions,
	aliases = {},
	handlers,
	unknown,
	groups = {},
	onError,
}) {
	const actionSet = new Set(actions);
	const groupTables = new Map(
		Object.entries(groups).map(([name, group]) => [name, new Set(group.actions)]),
	);
	const unknownBody =
		typeof unknown === "function"
			? () => unknown(command, actions)
			: () => defaultUnknownAction(command, actions);

	// A group's own guidance text is supplied by the caller (every group words
	// it for its own verbs); the envelope shape is the shared invalid-argument
	// body so an unknown verb renders exactly like a handler's own refusal.
	const groupUnknownBody = (name, group) =>
		typeof group.unknown === "string" && group.unknown.length > 0
			? {
					text: "",
					errors: [group.unknown],
					warnings: [],
					exitCode: 1,
					code: "AMBER_E_INVALID_ARG",
				}
			: defaultUnknownAction(`${command} ${name}`, group.actions);

	return function dispatch(action, args = {}) {
		// A single action plus, for a grouped command, its second-level verb.
		const tokens = Array.isArray(action) ? action.filter((token) => token !== undefined) : [action];
		const canonical = aliases[tokens[0]] || tokens[0];
		const group = groups[canonical];
		let handlerKey = canonical;
		if (group) {
			const verb = tokens[1];
			if (verb === undefined || !groupTables.get(canonical).has(verb)) {
				return shapeBody(canonical, args, groupUnknownBody(canonical, group));
			}
			handlerKey = `${canonical} ${verb}`;
		}
		if (!group && !actionSet.has(canonical)) {
			return unknownEnvelope(args, unknownBody());
		}
		const handler = handlers[handlerKey];
		if (!handler) {
			const body = unknownBody();
			return unknownEnvelope(args, body);
		}

		let handlerResult;
		try {
			handlerResult = handler(args) || {};
		} catch (err) {
			if (!onError) throw err;
			return shapeBody(action, args, onError(err));
		}
		// F081: a handler may be asynchronous (governed execution is an awaited
		// spawn now). Shape a thenable only after it resolves, so every caller
		// sees the same envelope shape it always did — or a promise for it.
		if (handlerResult && typeof handlerResult.then === "function") {
			const failed = onError ? handlerResult.catch((err) => onError(err)) : handlerResult;
			return failed.then((body) => shapeBody(action, args, body));
		}
		return shapeBody(action, args, handlerResult);
	};

	// The top-level unknown path keeps bypassPrint undefined on purpose: the CLI
	// renders its guidance through printResult, which is what the legacy
	// unknown-action envelopes look like.
	function unknownEnvelope(args, body) {
		return {
			result: {
				target: args.target,
				...body,
				errors: body.errors || [],
				warnings: body.warnings || [],
			},
			exitCode: 1,
		};
	}

	function shapeBody(action, args, body) {
		const { ok, exitCode, bypassPrint, onBypass, data, ...rest } = body;
		// A handler that returns `data` is saying "this value IS the text" — the
		// exact object a hand-written `text: JSON.stringify(x, null, 2)` named.
		// Naming it explicitly is what makes the substitution exact: some handlers
		// serialized their `result` (no `ok`), others the body (with `ok`), and no
		// single implicit rule reproduces both. An explicit `text` always wins.
		const payload =
			rest.text === undefined && data !== undefined
				? { ...rest, text: JSON.stringify(data, null, 2) }
				: rest;
		const errors = payload.errors || [];
		const warnings = payload.warnings || [];
		const derivedExitCode = exitCode ?? (ok === false ? 1 : errors.length > 0 ? 1 : 0);
		return {
			result: { target: args.target, ...payload, errors, warnings },
			exitCode: derivedExitCode,
			bypassPrint: bypassPrint ?? !args.json,
			...(onBypass ? { onBypass } : {}),
		};
	}
}

/**
 * defineCommand bound to the CLI: the action is the positional at actionIndex,
 * plus the next positional when a group table claims it.
 *
 * @param {object} opts - defineCommand options plus actionIndex (default 0).
 * @returns {(args: object) => { result, exitCode, bypassPrint, onBypass? }}
 */
function defineCliCommand({ actionIndex = 0, ...spec }) {
	const dispatch = defineCommand(spec);
	const tokens = new Set(Object.keys(spec.groups || {}));
	return (args) => {
		const head = args._?.[actionIndex];
		return dispatch(tokens.has(head) ? [head, args._?.[actionIndex + 1]] : head, args);
	};
}

module.exports = { createSubcommandDispatcher, defineCommand, defineCliCommand };
