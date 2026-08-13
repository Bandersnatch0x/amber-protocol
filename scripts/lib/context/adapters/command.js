"use strict";

// `amber context` command adapter: option mapping, aliases, unknown-action
// guidance, and human rendering for the context layer (ADR-0009).

const path = require("node:path");

const { resolveTarget } = require("../../core/fs-utils");
const {
	createRequest,
	ingestPayload,
	verifyPages,
	refreshPages,
	computeStats,
	listPages,
	readPage,
	deletePage,
	describeKnowledge,
	previewLoadout,
	buildLoadout,
	verifyLoadoutFile,
	projectionStatus,
	rebuildProjection,
	runBenchmark,
	importSourceBundle,
	retentionReport,
} = require("../index");
const { ACTIONS, resolveContextAction } = require("../action-registry");

function errResult(message) {
	return {
		result: { target: undefined, errors: [message], warnings: [] },
		exitCode: 1,
		bypassPrint: false,
	};
}

function unknownAction(actual) {
	return {
		result: {
			errors: [`unknown context action: ${actual}. Expected one of: ${ACTIONS.join(", ")}`],
			warnings: [],
		},
		exitCode: 1,
		bypassPrint: false,
	};
}

function renderRequest(req, requestPath) {
	const lines = [
		`Request ${req.requestId} -> page "${req.target.pageId}"`,
		`  title:    ${req.target.title}`,
		`  reason:   ${req.target.reason || "explicit"}`,
		`  sources:  ${req.sources.length} (${req.sources.filter((s) => s.mutable).length} mutable)`,
		`  schema:   ${req.contract.outputSchema}`,
		`  written:  ${requestPath}`,
		"",
		"  Execute this contract with your agent, then:",
		`    amber context ingest --target <repo> --request ${req.requestId} --payload <file.json>`,
	];
	return lines.join("\n");
}

function renderList(pages, statusMap) {
	if (pages.length === 0)
		return "No context pages. Create one with `amber context request --page <id>`.";
	const lines = [
		"pageId                    title                         kind                 lifecycle   assurance             verified at               blocks  sources  status",
	];
	for (const p of pages) {
		const assurance = `${p.assurance.confidence || "-"}/${p.assurance.maturity || "-"}`;
		lines.push(
			`${p.pageId.padEnd(26)} ${(p.title || "").slice(0, 26).padEnd(28)} ${(p.knowledgeKind || "unspecified").padEnd(20)} ${(p.lifecycle || "current").padEnd(11)} ${assurance.padEnd(21)} ${(p.assurance.verifiedAt || "-").padEnd(25)} ${String(p.blockCount || 0).padStart(6)} ${String(p.sourceCount || 0).padStart(8)}  ${statusMap[p.pageId] || "ok"}`,
		);
	}
	return lines.join("\n");
}

function renderVerify(result) {
	if (result.ok === false) {
		return `context projection unavailable: ${result.code}: ${result.detail}`;
	}
	const lines = [];
	const { summary, pages } = result;
	lines.push(
		`context pages: ${summary.total} (ok ${summary.ok}, stale ${summary.stale}, tampered ${summary.tampered}, obsolete ${summary.obsolete}, orphaned ${summary.orphaned})`,
	);
	for (const p of pages) {
		const assurance = `${p.assurance.confidence || "-"}/${p.assurance.maturity || "-"}`;
		lines.push(
			`  [${p.status}] ${p.pageId} (${p.knowledgeKind}, ${p.lifecycle}, assurance ${assurance}, verified ${p.assurance.verifiedAt || "unavailable"})`,
		);
		for (const f of p.findings) lines.push(`    ${f.code}: ${f.detail}`);
	}
	if (pages.length === 0) lines.push("  no accepted pages");
	return lines.join("\n");
}

function renderStats(stats) {
	const lines = [];
	lines.push(
		`requests: ${stats.requests.total} (explicit ${stats.requests.byTrigger.explicit || 0}, source-change ${stats.requests.byTrigger["source-change"] || 0})`,
	);
	const windowLabel = stats.window ? ` (window: last ${stats.window} events)` : " (lifetime)";
	lines.push(
		`ingests: ${stats.ingests.total} (accepted ${stats.ingests.accepted}, rejected ${stats.ingests.rejected}, no-change ${stats.ingests.noChange})${windowLabel}`,
	);
	if (stats.ingests.passRate !== null)
		lines.push(`pass rate: ${(stats.ingests.passRate * 100).toFixed(1)}%`);
	if (stats.ingests.noChangeRate !== null)
		lines.push(`no-change rate: ${(stats.ingests.noChangeRate * 100).toFixed(1)}%`);
	if (stats.filterRate !== null)
		lines.push(
			`raw-only filter rate: ${(stats.filterRate * 100).toFixed(1)}% (${stats.rawOnlyChanges} cosmetic changes absorbed)`,
		);
	if (stats.unknownShare !== null)
		lines.push(`unknown-block share: ${(stats.unknownShare * 100).toFixed(1)}%`);
	if (stats.meanSourcesPerBlock !== null)
		lines.push(`mean sources per block: ${stats.meanSourcesPerBlock}`);
	if (stats.knowledgeKind) lines.push(`knowledge kind: ${stats.knowledgeKind}`);
	lines.push(`pages: ${stats.pages}`);
	lines.push(`lineage: current ${stats.lineage.current}, superseded ${stats.lineage.superseded}`);
	lines.push(`assurance verified: ${stats.assurance.verified}/${stats.pages}`);
	lines.push(
		`confidence: high ${stats.assurance.confidence.high}, medium ${stats.assurance.confidence.medium}, low ${stats.assurance.confidence.low}, unspecified ${stats.assurance.confidence.unspecified}`,
	);
	lines.push(
		`maturity: validated ${stats.assurance.maturity.validated}, reviewed ${stats.assurance.maturity.reviewed}, provisional ${stats.assurance.maturity.provisional}, unspecified ${stats.assurance.maturity.unspecified}`,
	);
	const codes = Object.entries(stats.errorCodes);
	if (codes.length > 0) {
		lines.push("rejected by code:");
		for (const [code, n] of codes) lines.push(`  ${code}: ${n}`);
	}
	return lines.join("\n");
}

function handleRequest(args, targetRoot) {
	const pageId = args.page;
	if (!pageId) return errResult("context request requires --page <id> (kebab-case).");
	const rawSources =
		args.sources ||
		(args.source ? (Array.isArray(args.source) ? args.source : [args.source]) : undefined);
	const created = createRequest(targetRoot, {
		pageId,
		title: args.title,
		reason: args.reason,
		sources: rawSources,
		scope: args.scope,
		force: Boolean(args.force),
		maxWords: args.maxWords ? Number(args.maxWords) : undefined,
		knowledgeKind: args.knowledgeKind,
		supersedes: args.supersedes,
	});
	if (created.errors.length > 0) {
		return {
			result: { target: args.target, errors: created.errors, warnings: [] },
			exitCode: 1,
			bypassPrint: false,
		};
	}
	return {
		result: {
			target: args.target,
			text: renderRequest(created.request, created.requestPath),
			errors: [],
			warnings: [],
		},
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function handleIngest(args, targetRoot) {
	const requestId = args.request || args.requestId;
	const payloadPath = args.payload;
	if (!payloadPath) {
		return errResult(
			"context ingest requires --payload <file.json> (the agent's distilled output).",
		);
	}
	const result = ingestPayload(targetRoot, { requestId, payloadPath });
	if (result.accepted) {
		return {
			result: {
				target: args.target,
				text:
					result.outcome === "no-change"
						? `no-change accepted for ${result.pageId}; source hashes rebased.`
						: `accepted ${result.pageId} (${result.findings.length} informational findings).`,
				errors: [],
				warnings: result.findings.map((f) => `${f.code}: ${f.detail}`),
				pageId: result.pageId,
				outcome: result.outcome,
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	return {
		result: {
			target: args.target,
			errors: result.errors,
			warnings: result.findings.map((f) => `${f.code}: ${f.detail}`),
			code: result.code,
			pageId: result.pageId,
		},
		exitCode: 1,
		bypassPrint: false,
	};
}

function handleVerify(args, targetRoot) {
	// Loadout re-verification (ADR-0010 D7): required-tier-only hash check.
	if (args.loadout) {
		const loadoutPath = path.resolve(targetRoot, args.loadout);
		const result = verifyLoadoutFile(targetRoot, loadoutPath);
		if (args.json) {
			return {
				result: { target: args.target, ...result, errors: [], warnings: [] },
				exitCode: result.ok ? 0 : 1,
				bypassPrint: false,
			};
		}
		const lines = [`loadout: ${args.loadout}`];
		if (result.ok) {
			lines.push("  required artifacts and required-tier pages fresh.");
		} else {
			for (const f of result.findings) lines.push(`  ${f.code}: ${f.detail}`);
		}
		return {
			result: {
				target: args.target,
				text: lines.join("\n"),
				errors: result.ok ? [] : result.findings.map((f) => f.detail),
				warnings: [],
			},
			exitCode: result.ok ? 0 : 1,
			bypassPrint: !args.json,
		};
	}

	const result = verifyPages(targetRoot);
	if (args.json) {
		return {
			result: {
				target: args.target,
				...result,
				errors: result.ok ? [] : [`${result.code}: ${result.detail}`],
				warnings: [],
			},
			exitCode: result.ok ? 0 : 1,
			bypassPrint: false,
		};
	}
	return {
		result: {
			target: args.target,
			code: result.code,
			text: renderVerify(result),
			errors: result.ok ? [] : [`${result.code}: ${result.detail}`],
			warnings: [],
		},
		exitCode: result.ok ? 0 : 1,
		bypassPrint: !args.json,
	};
}

function renderLoadout(loadout, loadoutPath) {
	const lines = [];
	const label = loadout.feature ? `${loadout.route} / ${loadout.feature}` : loadout.route;
	lines.push(`Loadout ${label} (budget ${loadout.budgetWords} words)`);
	lines.push(`  written:  ${loadoutPath}`);
	const requiredArtifacts = Array.isArray(loadout.artifacts?.required)
		? loadout.artifacts.required
		: [];
	lines.push(`  required artifacts: ${requiredArtifacts.length}`);
	for (const artifact of requiredArtifacts) {
		lines.push(`    - ${artifact.kind}: ${artifact.path}`);
	}
	lines.push(`  required pages: ${loadout.tiers.required.length}`);
	lines.push(`  priority: ${loadout.tiers.priority.length} page(s)`);
	lines.push(`  optional: ${loadout.tiers.optional.length} page(s)`);
	if (loadout.excluded.length > 0) {
		lines.push(`  excluded: ${loadout.excluded.length} page(s)`);
		for (const e of loadout.excluded.slice(0, 10)) lines.push(`    - ${e.pageId} (${e.reason})`);
		if (loadout.excluded.length > 10)
			lines.push(`    ... and ${loadout.excluded.length - 10} more`);
	}
	if (loadout.deltaSince) lines.push(`  delta since ${loadout.deltaSince}`);
	lines.push("");
	lines.push(
		"  Load it: point your agent at the file above; run `amber context verify --loadout <file>` right before loading (Required Artifacts and required-tier Pages).",
	);
	return lines.join("\n");
}

function handleLoad(args, targetRoot) {
	const result = buildLoadout(targetRoot, {
		route: args.route,
		feature: args.feature,
		budget: args.budget ? Number(args.budget) : undefined,
		since: args.since,
		// Repeatable --page pins pages into the required tier (D3 fail-fast
		// and D7 verify --loadout become reachable from the CLI).
		required: args.page ? (Array.isArray(args.page) ? args.page : [args.page]) : undefined,
		knowledgeKinds: args.knowledgeKind,
	});
	if (result.errors.length > 0) {
		return {
			result: {
				target: args.target,
				errors: result.errors.map((e) => `${e.code}: ${e.detail}`),
				warnings: [],
				code: result.errors[0].code,
			},
			exitCode: 1,
			bypassPrint: false,
		};
	}
	if (args.json) {
		return {
			result: {
				target: args.target,
				loadout: result.loadout,
				loadoutPath: result.loadoutPath,
				errors: [],
				warnings: [],
			},
			exitCode: 0,
			bypassPrint: false,
		};
	}
	return {
		result: {
			target: args.target,
			text: renderLoadout(result.loadout, result.loadoutPath),
			errors: [],
			warnings: [],
			loadoutPath: result.loadoutPath,
		},
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function handlePreview(args, targetRoot) {
	const result = previewLoadout(targetRoot, {
		route: args.route,
		feature: args.feature,
		budget: args.budget ? Number(args.budget) : undefined,
		since: args.since,
		required: args.page ? (Array.isArray(args.page) ? args.page : [args.page]) : undefined,
		knowledgeKinds: args.knowledgeKind,
	});
	if (result.errors.length > 0) {
		return {
			result: {
				target: args.target,
				errors: result.errors.map((error) => `${error.code}: ${error.detail}`),
				warnings: result.warnings,
				code: result.errors[0].code,
			},
			exitCode: 1,
			bypassPrint: false,
		};
	}
	return {
		result: {
			target: args.target,
			loadout: result.loadout,
			text: JSON.stringify(result.loadout, null, 2),
			errors: [],
			warnings: result.warnings,
		},
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function handleList(args, targetRoot) {
	const verify = verifyPages(targetRoot);
	if (!verify.ok) {
		return {
			result: {
				target: args.target,
				code: verify.code,
				errors: [`${verify.code}: ${verify.detail}`],
				warnings: [],
			},
			exitCode: 1,
			bypassPrint: false,
		};
	}
	const statusMap = {};
	for (const p of verify.pages) statusMap[p.pageId] = p.status;
	const pages = listPages(targetRoot)
		.map(({ pageId }) => {
			const v = verify.pages.find((x) => x.pageId === pageId);
			const page = readPage(targetRoot, pageId);
			return {
				...(v || { pageId, title: "", blockCount: 0, sourceCount: 0 }),
				...describeKnowledge(targetRoot, page),
				assurance: v ? v.assurance : { confidence: null, maturity: null, verifiedAt: null },
			};
		})
		.filter((page) => !args.knowledgeKind || page.knowledgeKind === args.knowledgeKind);
	return {
		result: { target: args.target, text: renderList(pages, statusMap), errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function handleShow(args, targetRoot) {
	const pageId = args.page;
	if (!pageId) return errResult("context show requires --page <id>.");
	const page = readPage(targetRoot, pageId);
	if (!page) return errResult(`page not found: ${pageId}`);
	const knowledge = describeKnowledge(targetRoot, page);
	const verified = verifyPages(targetRoot).pages.find((item) => item.pageId === pageId);
	const assurance = verified
		? verified.assurance
		: { confidence: null, maturity: null, verifiedAt: null };
	const lines = [
		`# ${page.title}`,
		`pageId: ${page.pageId}`,
		`knowledge kind: ${knowledge.knowledgeKind}`,
		`lifecycle: ${knowledge.lifecycle}`,
		`assurance: ${assurance.confidence || "-"}/${assurance.maturity || "-"}`,
		`mechanically verified at: ${assurance.verifiedAt || "unavailable"}`,
		...(knowledge.supersedes.length > 0 ? [`supersedes: ${knowledge.supersedes.join(", ")}`] : []),
		...(knowledge.supersededBy.length > 0
			? [`superseded by: ${knowledge.supersededBy.join(", ")}`]
			: []),
		"",
	];
	for (const [sid, src] of Object.entries(page.sources || {})) {
		lines.push(
			`source ${sid}: [${src.kind}] ${src.ref} (${src.mutable ? "mutable" : "immutable"})`,
		);
	}
	lines.push("");
	page.blocks.forEach((b) => {
		lines.push(`[${b.type}] ${b.text}`);
		lines.push(`  sources: ${b.sources.join(", ")}`);
	});
	return {
		result: { target: args.target, text: lines.join("\n"), errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function handleRefresh(args, targetRoot) {
	const result = refreshPages(targetRoot);
	const text = [
		result.requests.length > 0
			? `${result.requests.length} refresh request(s) generated:`
			: "no refresh requests needed",
		...result.requests.map(
			(r) => `  ${r.requestId} -> ${r.pageId} (changed: ${r.changedSources.join(", ")})`,
		),
		result.rawOnlyRebases.length > 0
			? `${result.rawOnlyRebases.length} cosmetic change(s) absorbed silently`
			: "",
		...result.errors.map((e) => `  error: ${e}`),
	]
		.filter(Boolean)
		.join("\n");
	return {
		result: { target: args.target, text, errors: result.errors, warnings: [] },
		exitCode: result.errors.length > 0 ? 1 : 0,
		bypassPrint: !args.json,
	};
}

function handleStats(args, targetRoot) {
	const stats = computeStats(targetRoot, {
		window: args.window ? Number(args.window) : undefined,
		knowledgeKind: args.knowledgeKind,
	});
	return {
		result: { target: args.target, text: renderStats(stats), errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function handleDelete(args, targetRoot) {
	const pageId = args.page;
	if (!pageId) return errResult("context delete requires --page <id>.");
	const page = readPage(targetRoot, pageId);
	if (page) {
		const knowledge = describeKnowledge(targetRoot, page);
		if (knowledge.supersedes.length > 0 || knowledge.supersededBy.length > 0) {
			return errResult(`Context Page ${pageId} participates in supersession and cannot be deleted`);
		}
	}
	const removed = deletePage(targetRoot, pageId);
	return {
		result: {
			target: args.target,
			text: removed ? `deleted ${pageId}` : `page not found: ${pageId}`,
			errors: removed ? [] : [`page not found: ${pageId}`],
			warnings: [],
		},
		exitCode: removed ? 0 : 1,
		bypassPrint: !args.json,
	};
}

function handleProjection(args, targetRoot, variant) {
	if (variant === "rebuild") {
		const rebuilt = rebuildProjection(targetRoot);
		return {
			result: {
				target: args.target,
				text: `rebuilt context-index (${rebuilt.manifest.pageCount} page(s))`,
				errors: [],
				warnings: [],
				manifest: rebuilt.manifest,
			},
			exitCode: 0,
			bypassPrint: !args.json,
		};
	}
	if (variant !== "status") {
		return errResult("context projection requires status or rebuild");
	}
	const status = projectionStatus(targetRoot);
	if (!status.ok) {
		return {
			result: {
				target: args.target,
				code: status.code,
				errors: [`${status.code}: ${status.detail}`],
				warnings: [],
			},
			exitCode: 1,
			bypassPrint: false,
		};
	}
	return {
		result: {
			target: args.target,
			text: `context-index: ${status.detail} (${status.manifest.pageCount} page(s))`,
			errors: [],
			warnings: [],
			manifest: status.manifest,
		},
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function handleBenchmark(args, targetRoot) {
	if (!args.fixture) return errResult("context benchmark requires --fixture <file>");
	const result = runBenchmark(targetRoot, { fixture: args.fixture, mode: args.mode });
	const report = result.report;
	const text = report
		? [
				`Context benchmark ${report.fixtureId}: ${report.passed ? "passed" : "failed"}`,
				`  expected-page recall: ${(report.metrics.expectedPageRecall * 100).toFixed(1)}%`,
				`  selection precision: ${(report.metrics.selectionPrecision * 100).toFixed(1)}%`,
				`  freshness exclusion: ${(report.metrics.freshnessExclusion * 100).toFixed(1)}%`,
				`  Required Artifact coverage: ${(report.metrics.requiredCoverage * 100).toFixed(1)}%`,
				`  stability: ${(report.metrics.stability * 100).toFixed(1)}%`,
			].join("\n")
		: "";
	return {
		result: {
			target: args.target,
			text,
			code: result.code,
			report,
			errors: result.ok ? [] : [`${result.code}: ${result.detail}`],
			warnings: [],
		},
		exitCode: result.ok ? 0 : 1,
		bypassPrint: !args.json && result.ok,
	};
}

function handleSourceAdapter(args, targetRoot) {
	if (!args.fixture) {
		return errResult("context source-adapter requires --fixture <file>");
	}
	const imported = importSourceBundle(targetRoot, {
		fixture: args.fixture,
		enable: args.enable,
		allowTranscript: args.allowTranscript,
	});
	return {
		result: {
			target: args.target,
			code: imported.code,
			bundle: imported.bundle,
			text: imported.ok
				? `Imported ${imported.bundle.sources.length} Source Bundle candidate(s) from ${imported.bundle.adapterId}`
				: "",
			errors: imported.ok ? [] : [`${imported.code}: ${imported.detail}`],
			warnings: [],
		},
		exitCode: imported.ok ? 0 : 1,
		bypassPrint: !args.json && imported.ok,
	};
}

function handleRetention(args, targetRoot) {
	const retained = retentionReport(targetRoot, {
		olderThanDays: args.olderThanDays == null ? undefined : Number(args.olderThanDays),
	});
	const report = retained.report;
	return {
		result: {
			target: args.target,
			code: retained.code,
			report,
			text: report
				? `Context retention report: ${report.summary.eligible} candidate(s), ${report.summary.protected} protected artifact(s)`
				: "",
			errors: retained.ok ? [] : [`${retained.code}: ${retained.detail}`],
			warnings: [],
		},
		exitCode: retained.ok ? 0 : 1,
		bypassPrint: !args.json && retained.ok,
	};
}

// Unified dispatch table: one handler per canonical action name, mirroring
// the action-registry DEFINITIONS. Replaces the former 14-branch if-chain;
// adding a context action now requires only a DEFINITIONS entry + a handler.
const HANDLERS = {
	request: handleRequest,
	ingest: handleIngest,
	verify: handleVerify,
	list: handleList,
	show: handleShow,
	refresh: handleRefresh,
	stats: handleStats,
	delete: handleDelete,
	preview: handlePreview,
	load: handleLoad,
	projection: (args, targetRoot, variant) => handleProjection(args, targetRoot, variant),
	benchmark: handleBenchmark,
	"source-adapter": handleSourceAdapter,
	retention: handleRetention,
};

function contextDispatch(action, args) {
	const definition = resolveContextAction(action, args);
	if (!definition) return unknownAction(action);
	const targetRoot = resolveTarget(args.target || ".");
	const handler = HANDLERS[definition.name];
	if (!handler) return unknownAction(action);
	// projection carries a variant (status/rebuild) the handler needs.
	return definition.variant
		? handler(args, targetRoot, definition.variant)
		: handler(args, targetRoot);
}

module.exports = {
	contextDispatch,
	ACTIONS,
	renderRequest,
	renderList,
	renderVerify,
	renderStats,
};
