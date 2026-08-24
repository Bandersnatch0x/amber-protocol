"use strict";

// Extracted from command-dispatcher.js (architecture review #1).

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

function hooksDispatch(args) {
	const hooks = require("./hooks-command");
	const action = args._?.[0];
	let r;
	if (action === "breadcrumb") {
		const subAction = args._?.[1];
		if (subAction === "print") r = hooks.printBreadcrumb(args.target, { format: args.format });
		else if (subAction === "install")
			r = hooks.installBreadcrumb(args.target, { platform: hooksBreadcrumbPlatform(args) });
		else if (subAction === "uninstall") r = hooks.uninstallBreadcrumb(args.target);
		else if (subAction === "status") r = hooks.statusBreadcrumb(args.target);
		else
			return {
				result: unknownAction("hooks breadcrumb", ["print", "install", "uninstall", "status"]),
			};

		if (subAction === "print" && !args.json) {
			// A host hook pipes stdout straight into the conversation, so print
			// must emit exactly the renderer's text — no headers, no footers, and
			// nothing at all when bypassed. Diagnostics go to stderr only.
			return {
				result: {
					target: args.target,
					text: r.text || "",
					errors: r.errors || [],
					warnings: r.warnings || [],
				},
				exitCode: (r.errors || []).length > 0 ? 1 : 0,
				bypassPrint: true,
				onBypass: () => {
					for (const w of r.warnings || []) console.error(`WARNING: ${w}`);
					for (const e of r.errors || []) console.error(`ERROR: ${e}`);
					if (r.text) process.stdout.write(`${r.text}\n`);
				},
			};
		}
	} else if (action === "check")
		r = hooks.checkGovernance(args.target, { warnOnly: args.warnOnly });
	else if (action === "install")
		r = hooks.installHook(args.target, { warnOnly: args.warnOnly, force: args.force });
	else if (action === "uninstall") r = hooks.uninstallHook(args.target);
	else if (action === "status") r = hooks.statusHook(args.target);
	else
		return {
			result: unknownAction("hooks", ["check", "install", "uninstall", "status", "breadcrumb"]),
		};

	return {
		result: {
			target: args.target,
			text: r.text || "",
			errors: r.errors || [],
			warnings: r.warnings || [],
		},
		exitCode: (r.errors || []).length > 0 ? 1 : 0,
		bypassPrint: !args.json,
	};
}

module.exports = { hooksDispatch };
