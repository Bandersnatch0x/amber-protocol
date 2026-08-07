"use strict";

// The ingest gate (ADR-0009 D2/D8): Amber judges the agent's distillation
// output and accepts or refuses it. Everything here is mechanical and
// deterministic — schema (ajv), citation completeness, source existence, and
// hash freshness. A payload is bound to its request: the page id must match,
// and every cited source must carry the same hashes the request bundled, so an
// agent cannot self-bless fresh hashes and defeat the staleness gate.
// `no-change` is a valid outcome that rebases hashes without touching content.

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const { loadRequest } = require("./context-request");
const { checkSourceHealth, finding, stripRange } = require("./context-sources");
const {
	writePage,
	regenerateIndex,
	appendEvent,
	readPage,
} = require("./context-store");

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

let pageValidate = null;
function getPageValidator() {
	if (pageValidate) return pageValidate;
	const schemaPath = path.join(__dirname, "..", "..", "..", "schemas", "context-page.schema.json");
	pageValidate = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
	return pageValidate;
}

/**
 * Verify that every source id referenced by blocks exists in the sources map.
 * CLAIM_UNCITED fires for blocks citing ids the page never declares.
 */
function checkCitations(page) {
	const missing = [];
	for (const block of page.blocks || []) {
		for (const sid of block.sources || []) {
			if (!page.sources || !page.sources[sid]) missing.push(sid);
		}
	}
	return missing;
}

/**
 * Bind the payload to its request: pageId must match, and every payload source
 * must be one the request bundled, with identical hashes. When the request
 * declares a target.scope, any payload scope must be a subset of it (an agent
 * cannot self-grant a scope the request never authorized). Returns blocking
 * findings when violated.
 */
function checkRequestBinding(targetRoot, request, payload) {
	const findings = [];
	const reqSources = new Map((request.sources || []).map((s) => [s.ref, s]));

	if (payload.pageId !== request.target.pageId) {
		findings.push(finding("AMBER_E_CONTEXT_SCHEMA_INVALID", `payload pageId "${payload.pageId}" does not match request target "${request.target.pageId}"`, payload.pageId));
		return { findings, blocked: true };
	}

	// Scope binding (ADR-0010 D5): payload scope ⊆ request target.scope.
	const reqScope = request.target && Array.isArray(request.target.scope) ? request.target.scope : [];
	if (reqScope.length > 0 && Array.isArray(payload.scope) && payload.scope.length > 0) {
		const allowed = new Set(reqScope);
		for (const id of payload.scope) {
			if (!allowed.has(id)) {
				findings.push(finding("AMBER_E_CONTEXT_SCHEMA_INVALID", `payload scope "${id}" was not declared by the request target.scope`, payload.pageId));
			}
		}
	}

	for (const [, src] of Object.entries(payload.sources || {})) {
		const bundled = reqSources.get(src.ref);
		if (!bundled) {
			findings.push(finding("AMBER_E_CONTEXT_SCHEMA_INVALID", `payload source ${src.ref} was not bundled by the request`, payload.pageId));
			continue;
		}
		if (bundled.mutable && (src.rawHash !== bundled.rawHash || src.normHash !== bundled.normHash)) {
			findings.push(finding("AMBER_E_CONTEXT_SOURCE_STALE", `payload re-bundled source ${src.ref} with fresh hashes — re-run the request`, payload.pageId));
		}
		if (!bundled.mutable && (src.excerptHash !== bundled.excerptHash || src.excerpt !== bundled.excerpt)) {
			findings.push(finding("AMBER_E_CONTEXT_SOURCE_TAMPERED", `payload altered the excerpt of ${src.ref}`, payload.pageId));
		}
	}
	return { findings, blocked: findings.length > 0 };
}

/**
 * Ingest agent output for a request.
 * @param {string} targetRoot
 * @param {{ requestId?: string, payloadPath?: string, payload?: object }} opts
 */
function ingestPayload(targetRoot, opts = {}) {
	const request = opts.requestId ? loadRequest(targetRoot, opts.requestId) : null;
	if (opts.requestId && !request) {
		return {
			accepted: false,
			outcome: "rejected",
			code: "AMBER_E_CONTEXT_SOURCE_MISSING",
			errors: [`request not found: ${opts.requestId}`],
			findings: [],
			pageId: null,
		};
	}

	let payload = opts.payload;
	if (!payload && opts.payloadPath) {
		try {
			payload = JSON.parse(fs.readFileSync(opts.payloadPath, "utf8"));
		} catch (err) {
			return {
				accepted: false,
				outcome: "rejected",
				code: "AMBER_E_CONTEXT_SCHEMA_INVALID",
				errors: [`payload unreadable: ${err.message}`],
				findings: [],
				pageId: null,
			};
		}
	}
	if (!payload || typeof payload !== "object") {
		return {
			accepted: false,
			outcome: "rejected",
			code: "AMBER_E_CONTEXT_SCHEMA_INVALID",
			errors: ["no payload"],
			findings: [],
			pageId: null,
		};
	}

	const pageId = payload.pageId || (request && request.target.pageId);

	// ── no-change path ───────────────────────────────────────────────────────
	if (payload.outcome === "no-change") {
		const existing = readPage(targetRoot, pageId);
		if (!existing) {
			return {
				accepted: false,
				outcome: "rejected",
				code: "AMBER_E_CONTEXT_PAGE_OBSOLETE",
				errors: [`no-change but no existing page for "${pageId}"`],
				findings: [finding("AMBER_E_CONTEXT_PAGE_OBSOLETE", `no existing page for ${pageId}`, pageId)],
				pageId,
			};
		}
		// Rebase every mutable source hash to current disk state.
		const rebased = { ...existing, sources: { ...existing.sources } };
		let changed = false;
		for (const [sid, src] of Object.entries(rebased.sources)) {
			if (src.mutable) {
				const full = path.resolve(targetRoot, stripRange(src.ref));
				if (fs.existsSync(full)) {
					const { hashFile } = require("./context-hash");
					const current = hashFile(full);
					rebased.sources[sid] = { ...src, rawHash: current.rawHash, normHash: current.normHash };
					changed = true;
				}
			}
		}
		if (changed) writePage(targetRoot, rebased, { outcome: "no-change", requestId: opts.requestId });
		regenerateIndex(targetRoot, require("./context-verify").statusMap(targetRoot));
		appendEvent(targetRoot, { kind: "ingest", requestId: opts.requestId, pageId, outcome: "no-change", sourceCount: Object.keys(rebased.sources).length });
		return {
			accepted: true,
			outcome: "no-change",
			errors: [],
			findings: [finding("AMBER_E_CONTEXT_SOURCE_STALE", "agent judged the change does not affect this page; hashes rebased", pageId)],
			pageId,
			requestId: opts.requestId,
		};
	}

	// ── full page path ───────────────────────────────────────────────────────
	const validate = getPageValidator();
	if (!validate(payload)) {
		appendEvent(targetRoot, { kind: "ingest", requestId: opts.requestId, pageId, outcome: "rejected", code: "AMBER_E_CONTEXT_SCHEMA_INVALID" });
		return {
			accepted: false,
			outcome: "rejected",
			code: "AMBER_E_CONTEXT_SCHEMA_INVALID",
			errors: validate.errors.slice(0, 5).map((e) => `${e.instancePath || "/"} ${e.message}`),
			findings: [finding("AMBER_E_CONTEXT_SCHEMA_INVALID", "payload fails the page schema", pageId)],
			pageId,
			requestId: opts.requestId,
		};
	}

	if (request) {
		const binding = checkRequestBinding(targetRoot, request, payload);
		if (binding.blocked) {
			appendEvent(targetRoot, { kind: "ingest", requestId: opts.requestId, pageId, outcome: "rejected", code: binding.findings[0].code });
			return {
				accepted: false,
				outcome: "rejected",
				code: binding.findings[0].code,
				errors: binding.findings.map((f) => `${f.code}: ${f.detail}`),
				findings: binding.findings,
				pageId,
				requestId: opts.requestId,
			};
		}
	}

	const uncited = checkCitations(payload);
	if (uncited.length > 0) {
		appendEvent(targetRoot, { kind: "ingest", requestId: opts.requestId, pageId, outcome: "rejected", code: "AMBER_E_CONTEXT_CLAIM_UNCITED" });
		return {
			accepted: false,
			outcome: "rejected",
			code: "AMBER_E_CONTEXT_CLAIM_UNCITED",
			errors: [`blocks cite unknown source ids: ${uncited.join(", ")}`],
			findings: [finding("AMBER_E_CONTEXT_CLAIM_UNCITED", `unknown source ids: ${uncited.join(", ")}`, pageId)],
			pageId,
			requestId: opts.requestId,
		};
	}

	const { findings, blocked } = checkSourceHealth(targetRoot, payload.sources, pageId);
	if (blocked) {
		appendEvent(targetRoot, { kind: "ingest", requestId: opts.requestId, pageId, outcome: "rejected", code: findings[0].code });
		return {
			accepted: false,
			outcome: "rejected",
			code: findings[0].code,
			errors: findings.map((f) => `${f.code}: ${f.detail}`),
			findings,
			pageId,
			requestId: opts.requestId,
		};
	}

	// Accept: persist + regenerate index + emit event.
	writePage(targetRoot, payload, { outcome: "accepted", requestId: opts.requestId });
	regenerateIndex(targetRoot, require("./context-verify").statusMap(targetRoot));
	appendEvent(targetRoot, {
		kind: "ingest",
		requestId: opts.requestId,
		pageId,
		outcome: "accepted",
		blockCount: payload.blocks.length,
		sourceCount: Object.keys(payload.sources).length,
		unknownCount: payload.blocks.filter((b) => b.type === "unknown").length,
	});

	return {
		accepted: true,
		outcome: "accepted",
		errors: [],
		findings,
		pageId,
		requestId: opts.requestId,
		request,
	};
}

module.exports = { ingestPayload, checkCitations, checkRequestBinding };
