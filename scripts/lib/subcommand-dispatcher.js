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
		return shape(result);
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
 * @returns {(action: string, args: object) => { result, exitCode, bypassPrint, onBypass? }}
 */
function defineCommand({ command, actions, aliases = {}, handlers, unknown }) {
	const actionSet = new Set(actions);
	const unknownBody =
		typeof unknown === "function"
			? () => unknown(command, actions)
			: () => defaultUnknownAction(command, actions);

	return function dispatch(action, args = {}) {
		const canonical = aliases[action] || action;
		if (!actionSet.has(canonical) || !handlers[canonical]) {
			const body = unknownBody();
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

		const body = handlers[canonical](args) || {};
		const { ok, exitCode, bypassPrint, onBypass, ...payload } = body;
		const errors = payload.errors || [];
		const warnings = payload.warnings || [];
		const derivedExitCode = exitCode ?? (ok === false ? 1 : errors.length > 0 ? 1 : 0);
		return {
			result: { target: args.target, ...payload, errors, warnings },
			exitCode: derivedExitCode,
			bypassPrint: bypassPrint ?? !args.json,
			...(onBypass ? { onBypass } : {}),
		};
	};
}

module.exports = { createSubcommandDispatcher, defineCommand };
