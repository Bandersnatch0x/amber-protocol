"use strict";

// Extracted from command-dispatcher.js (architecture review #1). Envelope,
// routing, and exit codes are owned by defineCommand (F039).

const { defineCommand } = require("./subcommand-dispatcher");
const { resolveTarget, readFailure } = require("./command-helpers");

const dispatch = defineCommand({
	command: "projection",
	actions: [
		"rebuild",
		"status",
		"list",
		"query",
		"strict-query",
		"invalidate",
		"receipt",
		"view",
		"compare",
	],
	handlers: {
		"strict-query": (args) => {
			const targetRoot = resolveTarget(args);
			const { strictGovernanceGraphQuery } = require("./core/strict-query");
			const result = strictGovernanceGraphQuery(targetRoot, {
				scope: args.scope,
				checkpoint: args.checkpoint,
				projectionVersion: args.projectionVersion,
				limit: args.limit,
				sort: args.sort || "id",
				depth: args.depth === undefined ? 1 : args.depth,
				cursor: args.cursor || null,
			});
			return {
				text: result.ok ? JSON.stringify(result, null, 2) : "",
				errors: result.errors,
				warnings:
					result.degraded && result.ok
						? [
								"strict query returned a partial page; it cannot satisfy a strict Gate until the cursor is exhausted",
							]
						: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		invalidate: (args) => {
			const targetRoot = resolveTarget(args);
			const { recordInvalidation } = require("./core/staleness-registry");
			const dependency = String(args.dependency || "");
			const [type, identityWithRevision = ""] = dependency.split(":", 2);
			const [identity, revisionText = null] = identityWithRevision.split("@", 2);
			const revision = revisionText === null ? null : Number(revisionText);
			const result = recordInvalidation(targetRoot, {
				subject: args.subject || args.scope,
				dependency: {
					type,
					identity,
					revision: revisionText === null || revisionText === "" ? null : revision,
					contentHash: null,
				},
				reason: args.reason,
			});
			return {
				text: result.ok ? JSON.stringify(result.receipt, null, 2) : "",
				errors: result.errors,
				warnings: [],
				exitCode: result.ok ? 0 : 1,
				...(result.code ? { code: result.code } : {}),
			};
		},
		query: (args) => {
			const targetRoot = resolveTarget(args);
			const { buildGovernanceGraph, queryGraph } = require("./core/governance-graph");
			const { recordReadReceipt } = require("./core/projection-receipts");
			let graph;
			try {
				graph = buildGovernanceGraph(targetRoot);
			} catch (err) {
				// Fail closed: a corrupt Canonical Artifact store never yields
				// a partial graph — the typed artifact corruption code rides
				// the failure instead (F049 ticket 05, #222).
				const failure = readFailure(args, err, "AMBER_E_PROJECTION_DRIFT");
				return { ...failure.result, exitCode: failure.exitCode };
			}
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
			// The Governance Graph — the only graph projection (ADR-0021) —
			// rebuilds through the projection registry with the real graph
			// builder (F049 ticket 05, #222): context-page nodes plus one
			// node per committed Canonical Artifact revision and one typed
			// edge per resolved Trace. The receipt records the source
			// checkpoint, the rule and schema versions, the result hash, and
			// protocol provenance; the build is read-only and fails closed on
			// a corrupt artifact store (never a partial projection).
			if (type === "governance-graph") {
				const { governanceGraphFromState } = require("./core/governance-graph");
				const { ARTIFACT_GRAPH_RULE_VERSION } = require("./core/artifact-graph-projection");
				const { TRACE_REGISTRY_VERSION } = require("./core/canonical-artifact-contracts");
				const ruleVersions = {
					artifactGraph: ARTIFACT_GRAPH_RULE_VERSION,
					traceContract: TRACE_REGISTRY_VERSION,
				};
				const built = rebuildProjection(
					targetRoot,
					type,
					(state) => {
						const graph = governanceGraphFromState(state);
						return {
							projection: type,
							ruleVersions,
							graphHash: graph.sourceHash,
							nodes: graph.nodes,
							edges: graph.edges,
						};
					},
					{ manifestFields: { projection_rule_versions: ruleVersions } },
				);
				return {
					text: built.ok ? JSON.stringify(built.manifest, null, 2) : "",
					errors: built.errors,
					warnings: [],
					exitCode: built.ok ? 0 : 1,
					...(built.code ? { code: built.code } : {}),
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
				// Full-review follow-up finding 3: propagate the typed failure
				// code into the CLI result envelope like rebuild/query do — the
				// code must be machine-readable at the envelope seam, not only
				// inside the JSON text payload.
				...(status.code ? { code: status.code } : {}),
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
