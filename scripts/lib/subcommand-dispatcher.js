"use strict";

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

module.exports = { createSubcommandDispatcher };
