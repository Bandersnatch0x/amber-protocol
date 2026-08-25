"use strict";

// `amber context` command adapter: option mapping, aliases, unknown-action
// guidance, and human rendering for the context layer (ADR-0009).

const path = require("node:path");

const { resolveTarget } = require("../../core/fs-utils");
const { defineCommand } = require("../../subcommand-dispatcher");
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

function requestBody(args, targetRoot) {
	const pageId = args.page;
	if (!pageId) {
		return {
			target: undefined,
			errors: ["context request requires --page <id> (kebab-case)."],
			warnings: [],
			bypassPrint: false,
		};
	}
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
			errors: created.errors,
			warnings: [],
			bypassPrint: false,
		};
	}
	return {
		text: renderRequest(created.request, created.requestPath),
		errors: [],
		warnings: [],
	};
}

function ingestBody(args, targetRoot) {
	const requestId = args.request || args.requestId;
	const payloadPath = args.payload;
	if (!payloadPath) {
		return {
			target: undefined,
			errors: ["context ingest requires --payload <file.json> (the agent's distilled output)."],
			warnings: [],
			bypassPrint: false,
		};
	}
	const result = ingestPayload(targetRoot, { requestId, payloadPath });
	if (result.accepted) {
		return {
			text:
				result.outcome === "no-change"
					? `no-change accepted for ${result.pageId}; source hashes rebased.`
					: `accepted ${result.pageId} (${result.findings.length} informational findings).`,
			errors: [],
			warnings: result.findings.map((f) => `${f.code}: ${f.detail}`),
			pageId: result.pageId,
			outcome: result.outcome,
		};
	}
	return {
		errors: result.errors,
		warnings: result.findings.map((f) => `${f.code}: ${f.detail}`),
		code: result.code,
		pageId: result.pageId,
		bypassPrint: false,
	};
}

// F039 carve-out: this branch keeps its hand-rolled envelope. Both JSON paths
// spread verifyPages()/verifyLoadoutFile() results whose top-level `ok` is a
// payload field (pinned on the wire), but defineCommand treats `ok` as a
// control field and strips it — the same inexpressibility that stopped the
// knowledge-plan migration in slice 3.
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

function loadBody(args, targetRoot) {
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
			errors: result.errors.map((e) => `${e.code}: ${e.detail}`),
			warnings: [],
			code: result.errors[0].code,
			bypassPrint: false,
		};
	}
	if (args.json) {
		return {
			loadout: result.loadout,
			loadoutPath: result.loadoutPath,
			errors: [],
			warnings: [],
			bypassPrint: false,
		};
	}
	return {
		text: renderLoadout(result.loadout, result.loadoutPath),
		errors: [],
		warnings: [],
		loadoutPath: result.loadoutPath,
	};
}

function previewBody(args, targetRoot) {
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
			errors: result.errors.map((error) => `${error.code}: ${error.detail}`),
			warnings: result.warnings,
			code: result.errors[0].code,
			bypassPrint: false,
		};
	}
	return {
		loadout: result.loadout,
		text: JSON.stringify(result.loadout, null, 2),
		errors: [],
		warnings: result.warnings,
	};
}

function listBody(args, targetRoot) {
	const verify = verifyPages(targetRoot);
	if (!verify.ok) {
		return {
			code: verify.code,
			errors: [`${verify.code}: ${verify.detail}`],
			warnings: [],
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
		text: renderList(pages, statusMap),
		errors: [],
		warnings: [],
	};
}

function showBody(args, targetRoot) {
	const pageId = args.page;
	if (!pageId) {
		return {
			target: undefined,
			errors: ["context show requires --page <id>."],
			warnings: [],
			bypassPrint: false,
		};
	}
	const page = readPage(targetRoot, pageId);
	if (!page) {
		return {
			target: undefined,
			errors: [`page not found: ${pageId}`],
			warnings: [],
			bypassPrint: false,
		};
	}
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
		text: lines.join("\n"),
		errors: [],
		warnings: [],
	};
}

function refreshBody(args, targetRoot) {
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
		text,
		errors: result.errors,
		warnings: [],
	};
}

function statsBody(args, targetRoot) {
	const stats = computeStats(targetRoot, {
		window: args.window ? Number(args.window) : undefined,
		knowledgeKind: args.knowledgeKind,
	});
	return {
		text: renderStats(stats),
		errors: [],
		warnings: [],
	};
}

function deleteBody(args, targetRoot) {
	const pageId = args.page;
	if (!pageId) {
		return {
			target: undefined,
			errors: ["context delete requires --page <id>."],
			warnings: [],
			bypassPrint: false,
		};
	}
	const page = readPage(targetRoot, pageId);
	if (page) {
		const knowledge = describeKnowledge(targetRoot, page);
		if (knowledge.supersedes.length > 0 || knowledge.supersededBy.length > 0) {
			return {
				target: undefined,
				errors: [`Context Page ${pageId} participates in supersession and cannot be deleted`],
				warnings: [],
				bypassPrint: false,
			};
		}
	}
	const removed = deletePage(targetRoot, pageId);
	return {
		text: removed ? `deleted ${pageId}` : `page not found: ${pageId}`,
		errors: removed ? [] : [`page not found: ${pageId}`],
		warnings: [],
	};
}

function projectionBody(args, targetRoot, variant) {
	if (variant === "rebuild") {
		const rebuilt = rebuildProjection(targetRoot);
		return {
			text: `rebuilt context-index (${rebuilt.manifest.pageCount} page(s))`,
			errors: [],
			warnings: [],
			manifest: rebuilt.manifest,
		};
	}
	if (variant !== "status") {
		return {
			target: undefined,
			errors: ["context projection requires status or rebuild"],
			warnings: [],
			bypassPrint: false,
		};
	}
	const status = projectionStatus(targetRoot);
	if (!status.ok) {
		return {
			code: status.code,
			errors: [`${status.code}: ${status.detail}`],
			warnings: [],
			bypassPrint: false,
		};
	}
	return {
		text: `context-index: ${status.detail} (${status.manifest.pageCount} page(s))`,
		errors: [],
		warnings: [],
		manifest: status.manifest,
	};
}

function benchmarkBody(args, targetRoot) {
	if (!args.fixture) {
		return {
			target: undefined,
			errors: ["context benchmark requires --fixture <file>"],
			warnings: [],
			bypassPrint: false,
		};
	}
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
		text,
		code: result.code,
		report,
		errors: result.ok ? [] : [`${result.code}: ${result.detail}`],
		warnings: [],
		bypassPrint: !args.json && result.ok,
	};
}

function sourceAdapterBody(args, targetRoot) {
	if (!args.fixture) {
		return {
			target: undefined,
			errors: ["context source-adapter requires --fixture <file>"],
			warnings: [],
			bypassPrint: false,
		};
	}
	const imported = importSourceBundle(targetRoot, {
		fixture: args.fixture,
		enable: args.enable,
		allowTranscript: args.allowTranscript,
	});
	return {
		code: imported.code,
		bundle: imported.bundle,
		text: imported.ok
			? `Imported ${imported.bundle.sources.length} Source Bundle candidate(s) from ${imported.bundle.adapterId}`
			: "",
		errors: imported.ok ? [] : [`${imported.code}: ${imported.detail}`],
		warnings: [],
		bypassPrint: !args.json && imported.ok,
	};
}

function retentionBody(args, targetRoot) {
	const retained = retentionReport(targetRoot, {
		olderThanDays: args.olderThanDays == null ? undefined : Number(args.olderThanDays),
	});
	const report = retained.report;
	return {
		code: retained.code,
		report,
		text: report
			? `Context retention report: ${report.summary.eligible} candidate(s), ${report.summary.protected} protected artifact(s)`
			: "",
		errors: retained.ok ? [] : [`${retained.code}: ${retained.detail}`],
		warnings: [],
		bypassPrint: !args.json && retained.ok,
	};
}

// Error bodies that the legacy errResult pair shaped with `target: undefined`
// carry that key explicitly so the dispatcher's args.target prepend cannot
// resurrect a concrete target on the wire.
function contextDispatch(action, args = {}) {
	if (action === "verify") {
		return handleVerify(args, resolveTarget(args.target || "."));
	}
	const targetRoot = resolveTarget(args.target || ".");
	const dispatch = defineCommand({
		command: "context",
		actions: ACTIONS,
		aliases: {
			"projection-status": "projection",
			"projection-rebuild": "projection",
			source: "source-adapter",
		},
		handlers: {
			request: (a) => requestBody(a, targetRoot),
			ingest: (a) => ingestBody(a, targetRoot),
			list: (a) => listBody(a, targetRoot),
			show: (a) => showBody(a, targetRoot),
			refresh: (a) => refreshBody(a, targetRoot),
			stats: (a) => statsBody(a, targetRoot),
			delete: (a) => deleteBody(a, targetRoot),
			preview: (a) => previewBody(a, targetRoot),
			load: (a) => loadBody(a, targetRoot),
			// The projection variant (status/rebuild) rides the action-registry
			// resolution: alias actions pin it, the bare action reads it off _.
			projection: (a) => {
				const definition = resolveContextAction(action, a);
				return projectionBody(a, targetRoot, definition ? definition.variant : undefined);
			},
			benchmark: (a) => benchmarkBody(a, targetRoot),
			"source-adapter": (a) => sourceAdapterBody(a, targetRoot),
			retention: (a) => retentionBody(a, targetRoot),
		},
		unknown: () => ({
			target: undefined,
			errors: [`unknown context action: ${action}. Expected one of: ${ACTIONS.join(", ")}`],
			warnings: [],
		}),
	});
	return dispatch(action, args);
}

module.exports = {
	contextDispatch,
	ACTIONS,
	renderRequest,
	renderList,
	renderVerify,
	renderStats,
};
