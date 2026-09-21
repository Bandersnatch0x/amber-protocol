"use strict";

// `amber contracts validate` — the read-only CLI face of the distributed
// governance contract registry (docs/architecture/distributed-governance-
// contract-registry.json). Report-only: it reads the registry, its schema and
// the pointers the registry claims, writes nothing, and exits 1 on any finding.
//
// Envelope, routing and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const {
	loadRegistry,
	loadSchema,
	registryPathFor,
	validateRegistry,
} = require("./core/distributed-governance-contract-registry");

function resolveRoot(args) {
	// No --target: the registry describes Amber itself, so the running
	// installation is the default subject. --target names another checkout.
	return args.target ? String(args.target) : undefined;
}

function tally(entries, key) {
	return entries.reduce((acc, entry) => {
		acc[entry[key]] = (acc[entry[key]] || 0) + 1;
		return acc;
	}, {});
}

function renderCounts(counts) {
	return Object.keys(counts)
		.sort()
		.map((key) => `${key} ${counts[key]}`)
		.join(", ");
}

function formatReport(registry, result) {
	const lines = [
		`${registry.registryId} ${registry.registryVersion}`,
		result.valid ? "  valid" : `  invalid (${result.errors.length})`,
		`  entries ${registry.entries.length} — ${renderCounts(tally(registry.entries, "implementation"))}`,
		`  compatibility ${renderCounts(tally(registry.entries, "compatibility"))}`,
		`  version domains ${registry.versionDomains.length}, bounded contexts ${registry.boundedContexts.length}, compatibility cases ${registry.compatibility.cases.length}`,
	];
	for (const error of result.errors) lines.push(`  - ${error}`);
	return lines.join("\n");
}

const dispatch = defineCommand({
	command: "contracts",
	actions: ["validate"],
	handlers: {
		validate: (args) => {
			const root = resolveRoot(args);
			const registryPath = registryPathFor(root);
			let registry;
			try {
				registry = loadRegistry(registryPath);
			} catch (err) {
				return {
					text: "",
					errors: [
						`no contract registry at ${registryPath} [AMBER_E_INVALID_ARG] — fix: --target must name an Amber checkout, or omit it to validate the running installation`,
					],
					ok: false,
				};
			}
			const result = validateRegistry(registry, loadSchema(), root);
			return {
				text: args.json
					? JSON.stringify(
							{
								registryId: registry.registryId,
								registryVersion: registry.registryVersion,
								registryPath,
								valid: result.valid,
								entries: {
									total: registry.entries.length,
									...tally(registry.entries, "implementation"),
								},
								compatibility: tally(registry.entries, "compatibility"),
								cases: registry.compatibility.cases.length,
								errors: result.errors,
							},
							null,
							2,
						)
					: formatReport(registry, result),
				errors: result.errors,
				ok: result.valid,
			};
		},
	},
});

function contractsDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { contractsDispatch };
