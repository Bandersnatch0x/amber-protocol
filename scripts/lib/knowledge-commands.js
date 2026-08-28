"use strict";

// Extracted from command-dispatcher.js (architecture review #1). Envelope,
// routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const dispatch = defineCommand({
	command: "knowledge",
	actions: [
		"admit",
		"list",
		"status",
		"retire",
		"query",
		"graph",
		"context-manifest",
		"context-sync",
		"context-review-sample",
	],
	handlers: {
		// F059 T1 (#247): the deterministic knowledge graph. Read-only; the
		// canonical serialization is emitted verbatim (bypassPrint) so
		// recompute over an unchanged tree is byte-identical at the CLI seam.
		graph: (args) => {
			const {
				buildKnowledgeGraph,
				serializeKnowledgeGraph,
				ERROR_CODES,
			} = require("./core/knowledge-graph");
			let graph;
			try {
				graph = buildKnowledgeGraph(resolveTarget(args));
			} catch (err) {
				const failure = readFailure(args, err, ERROR_CODES.invalid);
				return { ...failure.result, exitCode: failure.exitCode };
			}
			return { text: serializeKnowledgeGraph(graph), bypassPrint: true };
		},
		"context-manifest": (args) => {
			const {
				buildKnowledgeContextManifest,
				membershipErrors,
				committedManifestPath,
			} = require("./core/knowledge-projection");
			const fs = require("node:fs");
			const target = resolveTarget(args);
			const result = buildKnowledgeContextManifest(target);
			const errors = [...result.errors];
			// Validate against the census's single source of truth when it exists;
			// on a bootstrap tree there is nothing to compare against yet.
			try {
				const committed = JSON.parse(fs.readFileSync(committedManifestPath(target), "utf8"));
				errors.push(...membershipErrors(result.manifest.rows, committed.rows || []));
			} catch {
				// No committed manifest yet — rendering alone is the outcome.
			}
			return {
				text: JSON.stringify(result.manifest, null, 2),
				errors,
				warnings: [],
				exitCode: errors.length === 0 ? 0 : 1,
			};
		},
		"context-sync": (args) => {
			const { syncKnowledgeContextPages } = require("./core/knowledge-projection");
			const result = syncKnowledgeContextPages(resolveTarget(args), {
				refresh: Boolean(args.refresh),
			});
			return {
				text: JSON.stringify(
					{
						ok: result.ok,
						code: result.code,
						counts: result.manifest && result.manifest.counts,
						actions: result.actions,
						verification: result.verification && {
							ok: result.verification.ok,
							code: result.verification.code,
							detail: result.verification.detail,
							summary: result.verification.summary,
						},
						projection: result.projection,
					},
					null,
					2,
				),
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		"context-review-sample": (args) => {
			const fs = require("node:fs");
			const path = require("node:path");
			const { resolvePathWithin } = require("./core/fs-utils");
			const { buildHumanReviewSample } = require("./core/knowledge-projection");
			const targetRoot = resolveTarget(args);
			const result = buildHumanReviewSample(targetRoot, {
				limit: args.limit ? Number(args.limit) : undefined,
			});
			let reportPath = null;
			if (result.sample && args.output) {
				reportPath = resolvePathWithin(targetRoot, args.output, {
					label: "Knowledge review sample",
				});
				fs.mkdirSync(path.dirname(reportPath), { recursive: true });
				fs.writeFileSync(reportPath, `${JSON.stringify(result.sample, null, 2)}\n`, "utf8");
			}
			return {
				text: JSON.stringify({ ok: result.ok, sample: result.sample, reportPath }, null, 2),
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
			};
		},
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
