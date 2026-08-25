"use strict";

// Extracted from command-dispatcher.js (architecture review #1). Envelope,
// routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const dispatch = defineCommand({
	command: "audit org",
	actions: ["events", "isolation", "cross-repo", "retention"],
	handlers: {
		events: (args) => {
			const { listAuditEvents } = require("./core/organization-audit");
			let events;
			try {
				events = listAuditEvents(resolveTarget(args));
			} catch (err) {
				const failure = readFailure(args, err, "AMBER_E_ORG_CORRUPT");
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: JSON.stringify(events, null, 2) };
		},
		isolation: (args) => {
			const { checkIsolation } = require("./core/organization-audit");
			const result = checkIsolation(resolveTarget(args), {
				tenantId: args.tenant,
				repositoryId: args.repository || null,
				queryTenantId: args.queryTenant || null,
			});
			return {
				text: JSON.stringify({ ok: result.ok, code: result.code, events: result.events }, null, 2),
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		"cross-repo": (args) => {
			const { auditCrossRepository } = require("./core/organization-audit");
			const result = auditCrossRepository(resolveTarget(args), {
				tenantId: args.tenant,
				scope: args.scope || null,
			});
			return {
				text: JSON.stringify({ ok: result.ok, code: result.code, events: result.events }, null, 2),
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		retention: (args) => {
			const { recordRetentionAction } = require("./core/organization-audit");
			const result = recordRetentionAction(resolveTarget(args), {
				tenantId: args.tenant,
				repositoryId: args.repository,
				action: args.action,
				target: args.entity,
				reason: args.reason,
			});
			return {
				text: result.ok ? JSON.stringify(result.event, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
			};
		},
	},
});

function orgAuditDispatch(args) {
	return dispatch(args._?.[1], args);
}

module.exports = { orgAuditDispatch };
