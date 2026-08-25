"use strict";

// Extracted from command-dispatcher.js (architecture review #1). Envelope,
// routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const dispatch = defineCommand({
	command: "knowledge",
	actions: ["admit", "list", "status", "retire", "query"],
	handlers: {
		admit: (args) => {
			const { admitKnowledge } = require("./core/knowledge-base");
			const result = admitKnowledge(resolveTarget(args), {
				pageId: args.page,
				authorization: args.auth || null,
			});
			return {
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
			};
		},
		list: (args) => {
			const { listRecords } = require("./core/knowledge-base");
			let records;
			try {
				records = listRecords(resolveTarget(args));
			} catch (err) {
				const failure = readFailure(args, err, "AMBER_E_KB_CORRUPT");
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: JSON.stringify(records, null, 2) };
		},
		status: (args) => {
			const { checkFreshness } = require("./core/knowledge-base");
			let status;
			try {
				status = checkFreshness(resolveTarget(args), args.id);
			} catch (err) {
				const failure = readFailure(args, err, "AMBER_E_KB_CORRUPT");
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return {
				text: JSON.stringify(status, null, 2),
				errors: status.status === "stale" ? [status.detail] : [],
				warnings: [],
				exitCode: status.status === "stale" ? 1 : 0,
			};
		},
		retire: (args) => {
			const { retireRecord } = require("./core/knowledge-base");
			const result = retireRecord(resolveTarget(args), args.id, { reason: args.reason });
			return {
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		query: (args) => {
			const { queryKnowledge } = require("./core/knowledge-base");
			const result = queryKnowledge(resolveTarget(args), { scope: args.scope || null });
			return {
				text: JSON.stringify(
					{ ok: result.ok, code: result.code, records: result.records },
					null,
					2,
				),
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
	},
});

function knowledgeDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { knowledgeDispatch };
