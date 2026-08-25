"use strict";

// Extracted from command-dispatcher.js (architecture review #1). Envelope,
// routing, and exit codes are owned by defineCommand (F039 pilot).

const { defineCommand } = require("./subcommand-dispatcher");
const { unknownAction } = require("./command-helpers");

function hooksBreadcrumbPlatform(args) {
	const positional = Array.isArray(args._) ? args._ : [];
	const index = positional.findIndex(
		(token) => token === "--platform" || token.startsWith("--platform="),
	);
	if (index >= 0) {
		const token = positional[index];
		if (token.startsWith("--platform=")) return token.slice("--platform=".length);
		if (index + 1 < positional.length) return positional[index + 1];
	}
	return args.platform;
}

function hookBody(r) {
	return { text: r.text || "", errors: r.errors, warnings: r.warnings };
}

const dispatch = defineCommand({
	command: "hooks",
	actions: ["check", "install", "uninstall", "status", "breadcrumb"],
	handlers: {
		check: (args) => {
			const hooks = require("./hooks-command");
			return hookBody(hooks.checkGovernance(args.target, { warnOnly: args.warnOnly }));
		},
		install: (args) => {
			const hooks = require("./hooks-command");
			return hookBody(
				hooks.installHook(args.target, { warnOnly: args.warnOnly, force: args.force }),
			);
		},
		uninstall: (args) => {
			const hooks = require("./hooks-command");
			return hookBody(hooks.uninstallHook(args.target));
		},
		status: (args) => {
			const hooks = require("./hooks-command");
			return hookBody(hooks.statusHook(args.target));
		},
		breadcrumb: (args) => {
			const hooks = require("./hooks-command");
			const sub = args._?.[1];
			if (sub === "print") {
				const r = hooks.printBreadcrumb(args.target, { format: args.format });
				if (!args.json) {
					// A host hook pipes stdout straight into the conversation, so print
					// must emit exactly the renderer's text — no headers, no footers, and
					// nothing at all when bypassed. Diagnostics go to stderr only.
					return {
						...hookBody(r),
						bypassPrint: true,
						onBypass: () => {
							for (const w of r.warnings || []) console.error(`WARNING: ${w}`);
							for (const e of r.errors || []) console.error(`ERROR: ${e}`);
							if (r.text) process.stdout.write(`${r.text}\n`);
						},
					};
				}
				return hookBody(r);
			}
			if (sub === "install") {
				return hookBody(
					hooks.installBreadcrumb(args.target, { platform: hooksBreadcrumbPlatform(args) }),
				);
			}
			if (sub === "uninstall") return hookBody(hooks.uninstallBreadcrumb(args.target));
			if (sub === "status") return hookBody(hooks.statusBreadcrumb(args.target));
			// bypassPrint: false keeps the guidance on the printResult path, where
			// the legacy nested-unknown envelope rendered it.
			return {
				...unknownAction("hooks breadcrumb", ["print", "install", "uninstall", "status"]),
				bypassPrint: false,
			};
		},
	},
});

function hooksDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { hooksDispatch };
