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
const { resolvePathWithin } = require("./fs-utils");
const { writePage, regenerateIndex, appendEvent, readPage } = require("./context-store");

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
		findings.push(
			finding(
				"AMBER_E_CONTEXT_REQUEST_MISMATCH",
				`payload pageId "${payload.pageId}" does not match request target "${request.target.pageId}"`,
				payload.pageId,
			),
		);
		return { findings, blocked: true };
	}

	// Scope binding (ADR-0010 D5): payload scope ⊆ request target.scope.
	const reqScope =
		request.target && Array.isArray(request.target.scope) ? request.target.scope : [];
	if (Array.isArray(payload.scope) && payload.scope.length > 0) {
		const allowed = new Set(reqScope);
		for (const id of payload.scope) {
			if (!allowed.has(id)) {
				findings.push(
					finding(
						"AMBER_E_CONTEXT_REQUEST_MISMATCH",
						`payload scope "${id}" was not declared by the request target.scope`,
						payload.pageId,
					),
				);
			}
		}
	}

	for (const [, src] of Object.entries(payload.sources || {})) {
		const bundled = reqSources.get(src.ref);
		if (!bundled) {
			findings.push(
				finding(
					"AMBER_E_CONTEXT_REQUEST_MISMATCH",
					`payload source ${src.ref} was not bundled by the request`,
					payload.pageId,
				),
			);
			continue;
		}
		if (bundled.mutable && (src.rawHash !== bundled.rawHash || src.normHash !== bundled.normHash)) {
			findings.push(
				finding(
					"AMBER_E_CONTEXT_SOURCE_STALE",
					`payload re-bundled source ${src.ref} with fresh hashes — re-run the request`,
					payload.pageId,
				),
			);
		}
		if (
			!bundled.mutable &&
			(src.excerptHash !== bundled.excerptHash || src.excerpt !== bundled.excerpt)
		) {
			findings.push(
				finding(
					"AMBER_E_CONTEXT_SOURCE_TAMPERED",
					`payload altered the excerpt of ${src.ref}`,
					payload.pageId,
				),
			);
		}
	}
	return { findings, blocked: findings.length > 0 };
}

function rebaseNoChangeSources(targetRoot, request, existing, pageId) {
	const requested = new Map((request.sources || []).map((source) => [source.ref, source]));
	const rebased = { ...existing, sources: { ...existing.sources } };
	const findings = [];
	let changed = false;

	for (const [sid, source] of Object.entries(rebased.sources)) {
		let current = null;
		if (source.mutable) {
			let full;
			try {
				full = resolvePathWithin(targetRoot, stripRange(source.ref), {
					label: "Context source",
				});
			} catch (error) {
				findings.push(
					finding("AMBER_E_CONTEXT_SOURCE_MISSING", error.message || String(error), pageId, sid),
				);
				continue;
			}
			if (!fs.existsSync(full)) {
				findings.push(
					finding(
						"AMBER_E_CONTEXT_SOURCE_MISSING",
						`mutable source ${source.ref} is missing`,
						pageId,
						sid,
					),
				);
				continue;
			}
			const { hashFile } = require("./context-hash");
			current = hashFile(full);
		}

		const bundled = requested.get(source.ref);
		if (!bundled) {
			findings.push(
				finding(
					"AMBER_E_CONTEXT_REQUEST_MISMATCH",
					`persisted source ${source.ref} was not bundled by the request`,
					pageId,
					sid,
				),
			);
			continue;
		}
		if (!source.mutable) {
			if (source.excerptHash !== bundled.excerptHash || source.excerpt !== bundled.excerpt) {
				findings.push(
					finding(
						"AMBER_E_CONTEXT_SOURCE_TAMPERED",
						`request excerpt does not match persisted source ${source.ref}`,
						pageId,
						sid,
					),
				);
			}
			continue;
		}
		if (current.rawHash !== bundled.rawHash || current.normHash !== bundled.normHash) {
			findings.push(
				finding(
					"AMBER_E_CONTEXT_SOURCE_STALE",
					`mutable source ${source.ref} changed after the request`,
					pageId,
					sid,
				),
			);
			continue;
		}
		rebased.sources[sid] = { ...source, rawHash: current.rawHash, normHash: current.normHash };
		changed = true;
	}

	return { rebased, changed, findings, blocked: findings.length > 0 };
}

function inputRejection(code, errors) {
	return {
		accepted: false,
		outcome: "rejected",
		code,
		errors,
		findings: [],
		pageId: null,
	};
}

function resolveIngestInput(targetRoot, opts) {
	if (!opts.requestId) {
		return { error: inputRejection("AMBER_E_CONTEXT_REQUEST_MISSING", ["request id is required"]) };
	}
	const request = loadRequest(targetRoot, opts.requestId);
	if (!request) {
		return {
			error: inputRejection("AMBER_E_CONTEXT_REQUEST_MISSING", [
				`request not found: ${opts.requestId}`,
			]),
		};
	}
	if (request.requestId !== opts.requestId) {
		return {
			error: inputRejection("AMBER_E_CONTEXT_REQUEST_MISMATCH", [
				"request id does not match the persisted contract",
			]),
		};
	}
	let payload = opts.payload;
	if (!payload && opts.payloadPath) {
		try {
			const payloadPath = resolvePathWithin(targetRoot, opts.payloadPath, {
				label: "Context payload file",
			});
			payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
		} catch (error) {
			return {
				error: inputRejection("AMBER_E_CONTEXT_SCHEMA_INVALID", [
					`payload unreadable: ${error.message}`,
				]),
			};
		}
	}
	if (!payload || typeof payload !== "object") {
		return { error: inputRejection("AMBER_E_CONTEXT_SCHEMA_INVALID", ["no payload"]) };
	}
	return { request, payload };
}

function rejectFindings(context, findings, errors) {
	appendEvent(context.targetRoot, {
		kind: "ingest",
		requestId: context.requestId,
		pageId: context.pageId,
		outcome: "rejected",
		code: findings[0].code,
	});
	return {
		accepted: false,
		outcome: "rejected",
		code: findings[0].code,
		errors: errors || findings.map((item) => `${item.code}: ${item.detail}`),
		findings,
		pageId: context.pageId,
		requestId: context.requestId,
	};
}

function ingestNoChange(context) {
	const { targetRoot, request, requestId, pageId } = context;
	const existing = readPage(targetRoot, pageId);
	if (!existing) {
		return {
			accepted: false,
			outcome: "rejected",
			code: "AMBER_E_CONTEXT_PAGE_OBSOLETE",
			errors: [`no-change but no existing page for "${pageId}"`],
			findings: [
				finding("AMBER_E_CONTEXT_PAGE_OBSOLETE", `no existing page for ${pageId}`, pageId),
			],
			pageId,
		};
	}
	const sourceBinding = rebaseNoChangeSources(targetRoot, request, existing, pageId);
	if (sourceBinding.blocked) {
		return rejectFindings(context, sourceBinding.findings);
	}
	const { rebased, changed } = sourceBinding;
	if (changed) {
		writePage(targetRoot, rebased, { outcome: "no-change", requestId });
	} else {
		// writePage already regenerates the index; no-write path still refreshes status.
		regenerateIndex(targetRoot);
	}
	appendEvent(targetRoot, {
		kind: "ingest",
		requestId,
		pageId,
		outcome: "no-change",
		sourceCount: Object.keys(rebased.sources).length,
	});
	return {
		accepted: true,
		outcome: "no-change",
		errors: [],
		findings: [
			finding(
				"AMBER_E_CONTEXT_SOURCE_STALE",
				"agent judged the change does not affect this page; hashes rebased",
				pageId,
			),
		],
		pageId,
		requestId,
	};
}

function validateFullPage(context, payload) {
	const { targetRoot, request, pageId } = context;
	const validate = getPageValidator();
	if (!validate(payload)) {
		return {
			findings: [
				finding("AMBER_E_CONTEXT_SCHEMA_INVALID", "payload fails the page schema", pageId),
			],
			errors: validate.errors
				.slice(0, 5)
				.map((error) => `${error.instancePath || "/"} ${error.message}`),
		};
	}
	const binding = checkRequestBinding(targetRoot, request, payload);
	if (binding.blocked) return binding;
	const uncited = checkCitations(payload);
	if (uncited.length > 0) {
		return {
			findings: [
				finding(
					"AMBER_E_CONTEXT_CLAIM_UNCITED",
					`unknown source ids: ${uncited.join(", ")}`,
					pageId,
				),
			],
			errors: [`blocks cite unknown source ids: ${uncited.join(", ")}`],
		};
	}
	return checkSourceHealth(targetRoot, payload.sources, pageId);
}

function ingestFullPage(context, payload) {
	const { targetRoot, request, requestId, pageId } = context;
	const validation = validateFullPage(context, payload);
	if (validation.blocked || validation.errors) {
		return rejectFindings(context, validation.findings, validation.errors);
	}
	writePage(targetRoot, payload, { outcome: "accepted", requestId });
	appendEvent(targetRoot, {
		kind: "ingest",
		requestId,
		pageId,
		outcome: "accepted",
		blockCount: payload.blocks.length,
		sourceCount: Object.keys(payload.sources).length,
		unknownCount: payload.blocks.filter((block) => block.type === "unknown").length,
	});
	return {
		accepted: true,
		outcome: "accepted",
		errors: [],
		findings: validation.findings,
		pageId,
		requestId,
		request,
	};
}

/**
 * Ingest agent output for a request.
 * @param {string} targetRoot
 * @param {{ requestId?: string, payloadPath?: string, payload?: object }} opts
 */
function ingestPayload(targetRoot, opts = {}) {
	const input = resolveIngestInput(targetRoot, opts);
	if (input.error) return input.error;
	const { request, payload } = input;
	const pageId = payload.pageId || request.target.pageId;
	const context = { targetRoot, request, requestId: request.requestId, pageId };
	const earlyBinding =
		payload.outcome === "no-change"
			? checkRequestBinding(targetRoot, request, payload)
			: { findings: [], blocked: false };
	if (earlyBinding.blocked) {
		return rejectFindings(context, earlyBinding.findings);
	}

	// ── no-change path ───────────────────────────────────────────────────────
	if (payload.outcome === "no-change") {
		return ingestNoChange(context);
	}

	// ── full page path ───────────────────────────────────────────────────────
	return ingestFullPage(context, payload);
}

module.exports = { ingestPayload, checkCitations, checkRequestBinding };
