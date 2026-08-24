"use strict";

// Extracted from command-dispatcher.js (architecture review #1).

const { resolveTarget, unknownAction } = require("./command-helpers");

function projectionDispatch(args) {
	const targetRoot = resolveTarget(args);
	const sub = args._?.[0];
	const {
		PROJECTION_TYPES,
		rebuildProjection,
		projectionStatus,
	} = require("./core/projection-registry");
	if (sub === "query") {
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
		const exitCode = result.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
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
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "receipt") {
		const { listReadReceipts, verifyReceipt } = require("./core/projection-receipts");
		if (args.id) {
			const { ok, receipt } = verifyReceipt(targetRoot, args.id);
			return {
				result: {
					target: args.target,
					text: JSON.stringify({ ok, receipt }, null, 2),
					errors: ok ? [] : ["receipt not found"],
					warnings: [],
				},
				exitCode: ok ? 0 : 1,
				bypassPrint: !args.json,
			};
		}
		const receipts = listReadReceipts(targetRoot);
		return {
			result: {
				target: args.target,
				text: JSON.stringify(receipts, null, 2),
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	if (sub === "rebuild") {
		const type = args.type;
		if (!type || !PROJECTION_TYPES.includes(type)) {
			return {
				result: {
					target: args.target,
					text: "",
					errors: [`projection rebuild requires --type <${PROJECTION_TYPES.join("|")}>`],
					warnings: [],
				},
				exitCode: 1,
				bypassPrint: !args.json,
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
		const exitCode = built.ok ? 0 : 1;
		return {
			result: {
				target: args.target,
				text: built.ok ? JSON.stringify(built.manifest, null, 2) : "",
				errors: built.errors,
				warnings: [],
			},
			exitCode,
			bypassPrint: !args.json,
		};
	}
	if (sub === "status") {
		const type = args.type;
		if (!type || !PROJECTION_TYPES.includes(type)) {
			return {
				result: {
					target: args.target,
					text: "",
					errors: [`projection status requires --type <${PROJECTION_TYPES.join("|")}>`],
					warnings: [],
				},
				exitCode: 1,
				bypassPrint: !args.json,
			};
		}
		const status = projectionStatus(targetRoot, type);
		return {
			result: {
				target: args.target,
				text: JSON.stringify({ ok: status.ok, code: status.code, detail: status.detail }, null, 2),
				errors: status.ok ? [] : [status.detail],
				warnings: [],
			},
			exitCode: status.ok ? 0 : 1,
			bypassPrint: !args.json,
		};
	}
	if (sub === "list") {
		const statuses = PROJECTION_TYPES.map((type) => {
			const status = projectionStatus(targetRoot, type);
			return { projection_type: type, ok: status.ok, code: status.code, detail: status.detail };
		});
		return {
			result: {
				target: args.target,
				text: JSON.stringify(statuses, null, 2),
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	if (sub === "view") {
		const { buildWorkbenchProjection, applyBounds } = require("./core/visualization-workbench");
		const { recordReadReceipt } = require("./core/projection-receipts");
		const kind = args.kind;
		if (!kind) {
			return {
				result: {
					target: args.target,
					text: "",
					errors: [
						"projection view requires --kind <temporal|timeline|causal|relationship|mind-map|context>",
					],
					warnings: [],
				},
				exitCode: 1,
				bypassPrint: !args.json,
			};
		}
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
			result: {
				target: args.target,
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
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	if (sub === "compare") {
		const {
			buildWorkbenchProjection,
			compareProjections,
		} = require("./core/visualization-workbench");
		const kind = args.kind;
		if (!kind) {
			return {
				result: {
					target: args.target,
					text: "",
					errors: [
						"projection compare requires --kind <temporal|timeline|causal|relationship|mind-map|context>",
					],
					warnings: [],
				},
				exitCode: 1,
				bypassPrint: !args.json,
			};
		}
		const before = buildWorkbenchProjection(targetRoot, kind);
		const after = buildWorkbenchProjection(targetRoot, kind);
		const diff = compareProjections(before, after);
		return {
			result: {
				target: args.target,
				text: JSON.stringify(diff, null, 2),
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	return {
		result: unknownAction("projection", [
			"rebuild",
			"status",
			"list",
			"query",
			"receipt",
			"view",
			"compare",
		]),
	};
}

module.exports = { projectionDispatch };
