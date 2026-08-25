"use strict";

// Extracted from command-dispatcher.js (architecture review #1).

const { resolveTarget, unknownAction, readFailure } = require("./command-helpers");

function knowledgeDispatch(args) {
	const targetRoot = resolveTarget(args);
	const sub = args._?.[0];
	const {
		admitKnowledge,
		listRecords,
		checkFreshness,
		retireRecord,
		queryKnowledge,
	} = require("./core/knowledge-base");
	if (sub === "admit") {
		const result = admitKnowledge(targetRoot, {
			pageId: args.page,
			authorization: args.auth || null,
		});
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "list") {
		let records;
		try {
			records = listRecords(targetRoot);
		} catch (err) {
			return readFailure(args, err, "AMBER_E_KB_CORRUPT");
		}
		return {
			result: {
				target: args.target,
				text: JSON.stringify(records, null, 2),
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	if (sub === "status") {
		let status;
		try {
			status = checkFreshness(targetRoot, args.id);
		} catch (err) {
			return readFailure(args, err, "AMBER_E_KB_CORRUPT");
		}
		const exitCode = status.status === "stale" ? 1 : 0;
		return {
			result: {
				target: args.target,
				text: JSON.stringify(status, null, 2),
				errors: status.status === "stale" ? [status.detail] : [],
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "retire") {
		const result = retireRecord(targetRoot, args.id, { reason: args.reason });
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: result.ok ? JSON.stringify(result.record, null, 2) : "",
				errors: result.errors,
				warnings: [],
				...(result.code ? { code: result.code } : {}),
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "query") {
		const result = queryKnowledge(targetRoot, { scope: args.scope || null });
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: JSON.stringify(
					{ ok: result.ok, code: result.code, records: result.records },
					null,
					2,
				),
				errors: result.errors,
				warnings: [],
				...(result.code ? { code: result.code } : {}),
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	return {
		result: unknownAction("knowledge", ["admit", "list", "status", "retire", "query"]),
	};
}

module.exports = { knowledgeDispatch };
