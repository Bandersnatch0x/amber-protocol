"use strict";

// Extracted from command-dispatcher.js (architecture review #1). Envelope,
// routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget } = require("./command-helpers");

const dispatch = defineCommand({
	command: "projection",
	actions: ["rebuild", "status", "list", "query", "receipt", "view", "compare"],
	handlers: {
		query: (args) => {
			const targetRoot = resolveTarget(args);
			const { buildGovernanceGraph, queryGraph } = require("./core/governance-graph");
			const { recordReadReceipt } = require("./core/projection-receipts");
			const graph = buildGovernanceGraph(targetRoot);
			const result = queryGraph(graph, {
				scope: args.scope || null,
				limit: args.limit ? Number(args.limit) : 50,
			});
			// every read leaves an immutable receipt
			const receipt = recordReadReceipt(targetRoot, {
				scope: args.scope || "unscoped",
				projectionType: "governance-graph",
				resultHash: graph.sourceHash,
			});
			return {
				text: JSON.stringify(
					{
						ok: result.ok,
						code: result.code,
						nodes: result.nodes,
						truncated: result.truncated,
						receiptId: receipt.receiptId,
					},
					null,
					2,
				),
				errors: result.ok ? [] : [result.reason || result.code],
				warnings: [],
				exitCode: result.ok ? 0 : 1,
			};
		},
		receipt: (args) => {
			const targetRoot = resolveTarget(args);
			const { listReadReceipts, verifyReceipt } = require("./core/projection-receipts");
			if (args.id) {
				const { ok, receipt } = verifyReceipt(targetRoot, args.id);
				return {
					text: JSON.stringify({ ok, receipt }, null, 2),
					errors: ok ? [] : ["receipt not found"],
					warnings: [],
					exitCode: ok ? 0 : 1,
				};
			}
			return { text: JSON.stringify(listReadReceipts(targetRoot), null, 2) };
		},
		rebuild: (args) => {
			const targetRoot = resolveTarget(args);
			const { PROJECTION_TYPES, rebuildProjection } = require("./core/projection-registry");
			const type = args.type;
			if (!type || !PROJECTION_TYPES.includes(type)) {
				return {
					text: "",
					errors: [`projection rebuild requires --type <${PROJECTION_TYPES.join("|")}>`],
					warnings: [],
					exitCode: 1,
				};
			}
			// Default builder: derive a deterministic read-only summary from canonical pages.
			const built = rebuildProjection(targetRoot, type, (state) => ({
				projection: type,
				canonicalPageCount: state.artifacts.length,
				pages: state.artifacts.map((page) => ({
					id: page.pageId || page.id,
					title: page.title || "",
				})),
			}));
			return {
				text: built.ok ? JSON.stringify(built.manifest, null, 2) : "",
				errors: built.errors,
				warnings: [],
				exitCode: built.ok ? 0 : 1,
			};
		},
		status: (args) => {
			const targetRoot = resolveTarget(args);
			const { PROJECTION_TYPES, projectionStatus } = require("./core/projection-registry");
			const type = args.type;
			if (!type || !PROJECTION_TYPES.includes(type)) {
				return {
					text: "",
					errors: [`projection status requires --type <${PROJECTION_TYPES.join("|")}>`],
					warnings: [],
					exitCode: 1,
				};
			}
			const status = projectionStatus(targetRoot, type);
			return {
				text: JSON.stringify({ ok: status.ok, code: status.code, detail: status.detail }, null, 2),
				errors: status.ok ? [] : [status.detail],
				warnings: [],
				exitCode: status.ok ? 0 : 1,
			};
		},
		list: (args) => {
			const targetRoot = resolveTarget(args);
			const { PROJECTION_TYPES, projectionStatus } = require("./core/projection-registry");
			const statuses = PROJECTION_TYPES.map((type) => {
				const status = projectionStatus(targetRoot, type);
				return { projection_type: type, ok: status.ok, code: status.code, detail: status.detail };
			});
			return { text: JSON.stringify(statuses, null, 2) };
		},
		view: (args) => {
			const targetRoot = resolveTarget(args);
			const kind = args.kind;
			if (!kind) {
				return {
					text: "",
					errors: [
						"projection view requires --kind <temporal|timeline|causal|relationship|mind-map|context>",
					],
					warnings: [],
					exitCode: 1,
				};
			}
			const { buildWorkbenchProjection, applyBounds } = require("./core/visualization-workbench");
			const { recordReadReceipt } = require("./core/projection-receipts");
			const projection = buildWorkbenchProjection(targetRoot, kind);
			const items =
				projection.entries || projection.events || projection.nodes || projection.pages || [];
			const bounded = applyBounds(items, {
				limit: args.limit ? Number(args.limit) : 50,
				sortKey: args.sort || null,
			});
			const receipt = recordReadReceipt(targetRoot, {
				scope: args.scope || "unscoped",
				projectionType: `visualization-${kind}`,
				resultHash: projection.sourceHash,
			});
			return {
				text: JSON.stringify(
					{
						kind,
						items: bounded.items,
						truncated: bounded.truncated,
						sourceHash: projection.sourceHash,
						receiptId: receipt.receiptId,
					},
					null,
					2,
				),
				errors: [],
				warnings: [],
			};
		},
		compare: (args) => {
			const targetRoot = resolveTarget(args);
			const kind = args.kind;
			if (!kind) {
				return {
					text: "",
					errors: [
						"projection compare requires --kind <temporal|timeline|causal|relationship|mind-map|context>",
					],
					warnings: [],
					exitCode: 1,
				};
			}
			const {
				buildWorkbenchProjection,
				compareProjections,
			} = require("./core/visualization-workbench");
			const before = buildWorkbenchProjection(targetRoot, kind);
			const after = buildWorkbenchProjection(targetRoot, kind);
			const diff = compareProjections(before, after);
			return { text: JSON.stringify(diff, null, 2), errors: [], warnings: [] };
		},
	},
});

function projectionDispatch(args) {
	return dispatch(args._?.[0], args);
}

module.exports = { projectionDispatch };
