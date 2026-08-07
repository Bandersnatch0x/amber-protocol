"use strict";

// `amber context` command adapter: option mapping, aliases, unknown-action
// guidance, and human rendering for the context layer (ADR-0009).

const path = require("node:path");

const { resolveTarget } = require("../../core/fs-utils");
const { createRequest } = require("../../core/context-request");
const { ingestPayload } = require("../../core/context-ingest");
const { verifyPages } = require("../../core/context-verify");
const { refreshPages } = require("../../core/context-refresh");
const { computeStats } = require("../../core/context-stats");
const {
	listPages,
	readPage,
	deletePage,
	regenerateIndex,
} = require("../../core/context-store");

const ACTIONS = ["request", "ingest", "verify", "list", "show", "refresh", "stats", "delete", "load"];

function errResult(action, message) {
	return { result: { target: undefined, errors: [message], warnings: [] }, exitCode: 1, bypassPrint: false };
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
	if (pages.length === 0) return "No context pages. Create one with `amber context request --page <id>`.";
	const lines = ["pageId                    title                         blocks  sources  status"];
	for (const p of pages) {
		lines.push(
			`${p.pageId.padEnd(26)} ${(p.title || "").slice(0, 26).padEnd(28)} ${String(p.blockCount || 0).padStart(6)} ${String(p.sourceCount || 0).padStart(8)}  ${(statusMap[p.pageId] || "ok")}`,
		);
	}
	return lines.join("\n");
}

function renderVerify(result) {
	const lines = [];
	const { summary, pages } = result;
	lines.push(`context pages: ${summary.total} (ok ${summary.ok}, stale ${summary.stale}, tampered ${summary.tampered}, obsolete ${summary.obsolete}, orphaned ${summary.orphaned})`);
	for (const p of pages) {
		if (p.status === "ok") continue;
		lines.push(`  [${p.status}] ${p.pageId}`);
		for (const f of p.findings) lines.push(`    ${f.code}: ${f.detail}`);
	}
	if (lines.length === 1) lines.push("  all pages healthy");
	return lines.join("\n");
}

function renderStats(stats) {
	const lines = [];
	lines.push(`requests: ${stats.requests.total} (explicit ${stats.requests.byTrigger.explicit || 0}, source-change ${stats.requests.byTrigger["source-change"] || 0})`);
	const windowLabel = stats.window ? ` (window: last ${stats.window} events)` : " (lifetime)";
	lines.push(`ingests: ${stats.ingests.total} (accepted ${stats.ingests.accepted}, rejected ${stats.ingests.rejected}, no-change ${stats.ingests.noChange})${windowLabel}`);
	if (stats.ingests.passRate !== null) lines.push(`pass rate: ${(stats.ingests.passRate * 100).toFixed(1)}%`);
	if (stats.ingests.noChangeRate !== null) lines.push(`no-change rate: ${(stats.ingests.noChangeRate * 100).toFixed(1)}%`);
	if (stats.filterRate !== null) lines.push(`raw-only filter rate: ${(stats.filterRate * 100).toFixed(1)}% (${stats.rawOnlyChanges} cosmetic changes absorbed)`);
	if (stats.unknownShare !== null) lines.push(`unknown-block share: ${(stats.unknownShare * 100).toFixed(1)}%`);
	if (stats.meanSourcesPerBlock !== null) lines.push(`mean sources per block: ${stats.meanSourcesPerBlock}`);
	const codes = Object.entries(stats.errorCodes);
	if (codes.length > 0) {
		lines.push("rejected by code:");
		for (const [code, n] of codes) lines.push(`  ${code}: ${n}`);
	}
	return lines.join("\n");
}

function handleRequest(args, targetRoot) {
	const pageId = args.page;
	if (!pageId) return errResult("request", "context request requires --page <id> (kebab-case).");
	const rawSources = args.sources || (args.source ? (Array.isArray(args.source) ? args.source : [args.source]) : undefined);
	const created = createRequest(targetRoot, {
		pageId,
		title: args.title,
		reason: args.reason,
		sources: rawSources,
		scope: args.scope,
		force: Boolean(args.force),
		maxWords: args.maxWords ? Number(args.maxWords) : undefined,
	});
	if (created.errors.length > 0) {
		return { result: { target: args.target, errors: created.errors, warnings: [] }, exitCode: 1, bypassPrint: false };
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
	if (!payloadPath && !args.json) {
		return errResult("ingest", "context ingest requires --payload <file.json> (the agent's distilled output).");
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
		const { verifyLoadoutFile } = require("../../core/context-loadout");
		const result = verifyLoadoutFile(targetRoot, loadoutPath);
		if (args.json) {
			return { result: { target: args.target, ...result, errors: [], warnings: [] }, exitCode: result.ok ? 0 : 1, bypassPrint: false };
		}
		const lines = [`loadout: ${args.loadout}`];
		if (result.ok) {
			lines.push("  required-tier pages fresh.");
		} else {
			for (const f of result.findings) lines.push(`  ${f.code}: ${f.detail}`);
		}
		return {
			result: { target: args.target, text: lines.join("\n"), errors: result.ok ? [] : result.findings.map((f) => f.detail), warnings: [] },
			exitCode: result.ok ? 0 : 1,
			bypassPrint: !args.json,
		};
	}

	const result = verifyPages(targetRoot);
	if (args.json) {
		return { result: { target: args.target, ...result, errors: [], warnings: [] }, exitCode: 0, bypassPrint: false };
	}
	return {
		result: { target: args.target, text: renderVerify(result), errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function renderLoadout(loadout, loadoutPath) {
	const lines = [];
	const label = loadout.feature ? `${loadout.route} / ${loadout.feature}` : loadout.route;
	lines.push(`Loadout ${label} (budget ${loadout.budgetWords} words)`);
	lines.push(`  written:  ${loadoutPath}`);
	lines.push(`  required: ${loadout.tiers.required.length} page(s)`);
	lines.push(`  priority: ${loadout.tiers.priority.length} page(s)`);
	lines.push(`  optional: ${loadout.tiers.optional.length} page(s)`);
	if (loadout.excluded.length > 0) {
		lines.push(`  excluded: ${loadout.excluded.length} page(s)`);
		for (const e of loadout.excluded.slice(0, 10)) lines.push(`    - ${e.pageId} (${e.reason})`);
		if (loadout.excluded.length > 10) lines.push(`    ... and ${loadout.excluded.length - 10} more`);
	}
	if (loadout.deltaSince) lines.push(`  delta since ${loadout.deltaSince}`);
	lines.push("");
	lines.push("  Load it: point your agent at the file above; run `amber context verify --loadout <file>` right before loading (required tier only).");
	return lines.join("\n");
}

function handleLoad(args, targetRoot) {
	const { buildLoadout } = require("../../core/context-loadout");
	const result = buildLoadout(targetRoot, {
		route: args.route,
		feature: args.feature,
		budget: args.budget ? Number(args.budget) : undefined,
		since: args.since,
		// Repeatable --page pins pages into the required tier (D3 fail-fast
		// and D7 verify --loadout become reachable from the CLI).
		required: args.page ? (Array.isArray(args.page) ? args.page : [args.page]) : undefined,
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
			result: { target: args.target, loadout: result.loadout, loadoutPath: result.loadoutPath, errors: [], warnings: [] },
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

function handleList(args, targetRoot) {
	const verify = verifyPages(targetRoot);
	const statusMap = {};
	for (const p of verify.pages) statusMap[p.pageId] = p.status;
	const pages = listPages(targetRoot).map(({ pageId }) => {
		const v = verify.pages.find((x) => x.pageId === pageId);
		return v || { pageId, title: "", blockCount: 0, sourceCount: 0 };
	});
	return {
		result: { target: args.target, text: renderList(pages, statusMap), errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function handleShow(args, targetRoot) {
	const pageId = args.page;
	if (!pageId) return errResult("show", "context show requires --page <id>.");
	const page = readPage(targetRoot, pageId);
	if (!page) return errResult("show", `page not found: ${pageId}`);
	const lines = [`# ${page.title}`, `pageId: ${page.pageId}`, ""];
	for (const [sid, src] of Object.entries(page.sources || {})) {
		lines.push(`source ${sid}: [${src.kind}] ${src.ref} (${src.mutable ? "mutable" : "immutable"})`);
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
		...result.requests.map((r) => `  ${r.requestId} -> ${r.pageId} (changed: ${r.changedSources.join(", ")})`),
		result.rawOnlyRebases.length > 0
			? `${result.rawOnlyRebases.length} cosmetic change(s) absorbed silently`
			: "",
		...result.errors.map((e) => `  error: ${e}`),
	].filter(Boolean).join("\n");
	return {
		result: { target: args.target, text, errors: result.errors, warnings: [] },
		exitCode: result.errors.length > 0 ? 1 : 0,
		bypassPrint: !args.json,
	};
}

function handleStats(args, targetRoot) {
	const stats = computeStats(targetRoot, {
		window: args.window ? Number(args.window) : undefined,
	});
	return {
		result: { target: args.target, text: renderStats(stats), errors: [], warnings: [] },
		exitCode: 0,
		bypassPrint: !args.json,
	};
}

function handleDelete(args, targetRoot) {
	const pageId = args.page;
	if (!pageId) return errResult("delete", "context delete requires --page <id>.");
	const removed = deletePage(targetRoot, pageId);
	regenerateIndex(targetRoot);
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

function contextDispatch(action, args) {
	const targetRoot = resolveTarget(args.target || ".");
	if (action === "request") return handleRequest(args, targetRoot);
	if (action === "ingest") return handleIngest(args, targetRoot);
	if (action === "verify") return handleVerify(args, targetRoot);
	if (action === "list") return handleList(args, targetRoot);
	if (action === "show") return handleShow(args, targetRoot);
	if (action === "refresh") return handleRefresh(args, targetRoot);
	if (action === "stats") return handleStats(args, targetRoot);
	if (action === "delete") return handleDelete(args, targetRoot);
	if (action === "load") return handleLoad(args, targetRoot);
	return unknownAction(action);
}

module.exports = {
	contextDispatch,
	ACTIONS,
	renderRequest,
	renderList,
	renderVerify,
	renderStats,
};
