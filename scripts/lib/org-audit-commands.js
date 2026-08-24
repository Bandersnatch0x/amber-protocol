"use strict";

// Extracted from command-dispatcher.js (architecture review #1).

const { resolveTarget, unknownAction } = require("./command-helpers");

function orgAuditDispatch(args) {
	const targetRoot = resolveTarget(args);
	const sub = args._?.[1];
	const {
		checkIsolation,
		auditCrossRepository,
		recordRetentionAction,
		listAuditEvents,
	} = require("./core/organization-audit");
	if (sub === "events") {
		const events = listAuditEvents(targetRoot);
		return {
			result: {
				target: args.target,
				text: JSON.stringify(events, null, 2),
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	if (sub === "isolation") {
		const result = checkIsolation(targetRoot, {
			tenantId: args.tenant,
			repositoryId: args.repository || null,
			queryTenantId: args.queryTenant || null,
		});
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: JSON.stringify({ ok: result.ok, events: result.events }, null, 2),
				errors: result.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "cross-repo") {
		const result = auditCrossRepository(targetRoot, {
			tenantId: args.tenant,
			scope: args.scope || null,
		});
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: JSON.stringify({ ok: result.ok, events: result.events }, null, 2),
				errors: result.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "retention") {
		const result = recordRetentionAction(targetRoot, {
			tenantId: args.tenant,
			repositoryId: args.repository,
			action: args.action,
			target: args.entity,
			reason: args.reason,
		});
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: result.ok ? JSON.stringify(result.event, null, 2) : "",
				errors: result.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	return {
		result: unknownAction("audit org", ["events", "isolation", "cross-repo", "retention"]),
	};
}

module.exports = { orgAuditDispatch };
