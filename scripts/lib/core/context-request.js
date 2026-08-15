"use strict";

// Distillation contract generation (ADR-0009 D2/D4). `amber context request`
// never calls a model: it scans evidence, bundles hash-bearing sources, and
// writes a fully-specified contract the host agent executes. `amber context
// ingest` is the gate that judges the result.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { localIsoDate } = require("./text-utils");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const { hashFile, sha256 } = require("./context-hash");
const { requestsDir, appendEvent } = require("./context-store");
const { resolvePathWithin } = require("./fs-utils");
const { KNOWLEDGE_KINDS, normalizePageIds } = require("./context-knowledge");

const SCHEMA_VERSION = "1.2.0";
const PAGE_SCHEMA = "schemas/context-page.schema.json";

// Immutable source roots: content that must not change. Cited spans are
// snapshotted into the contract/page as excerpts (ADR-0009 D5a).
const IMMUTABLE_PREFIXES = [".amber", "docs/adr", "docs/decisions"];

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
let requestValidate = null;
function validateRequestSchema(request) {
	if (!requestValidate) {
		const schemaPath = path.join(
			__dirname,
			"..",
			"..",
			"..",
			"schemas",
			"context-request.schema.json",
		);
		requestValidate = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
	}
	if (requestValidate(request)) return { valid: true, errors: [] };
	return {
		valid: false,
		errors: requestValidate.errors
			.slice(0, 5)
			.map((e) => `request schema: ${e.instancePath || "/"} ${e.message}`),
	};
}

function isImmutable(ref) {
	const normalized = ref.replace(/\\/g, "/");
	return IMMUTABLE_PREFIXES.some((p) => normalized.startsWith(`${p}/`) || normalized === p);
}

// Parse ".amber/sessions/s/ledger.jsonl#L12-L48" into { ref, fromLine, toLine }.
const RANGE_RE = /^(.+)#L(\d+)(?:-L(\d+))?$/;

function parseRef(spec) {
	const raw = typeof spec === "string" ? spec : spec && spec.ref;
	if (!raw || typeof raw !== "string") return null;
	const m = raw.match(RANGE_RE);
	if (m) {
		return { ref: m[1], fromLine: Number(m[2]), toLine: m[3] ? Number(m[3]) : Number(m[2]) };
	}
	return { ref: raw, fromLine: null, toLine: null };
}

function extractLines(content, fromLine, toLine) {
	if (!fromLine) return content;
	const lines = content.split("\n");
	// 1-based inclusive
	return lines.slice(fromLine - 1, toLine).join("\n");
}

/** Hash a single source spec against disk. Returns null (with error) when the ref is missing. */
function bundleSource(targetRoot, spec) {
	const parsed = parseRef(spec);
	if (!parsed) return null;
	const raw = typeof spec === "string" ? spec : spec && spec.ref;
	const full = resolvePathWithin(targetRoot, parsed.ref, { label: "Context source" });
	if (!fs.existsSync(full)) return null;

	const mutable = !isImmutable(parsed.ref);
	const content = fs.readFileSync(full, "utf8");

	if (mutable) {
		const { rawHash, normHash } = hashFile(full);
		return { kind: kindOf(parsed.ref), ref: raw, rawHash, normHash, mutable: true };
	}

	// Immutable: snapshot the cited span; the full ref (including #Lx-Ly) is
	// kept so ingest/verify can re-extract the same span.
	const excerpt = extractLines(content, parsed.fromLine, parsed.toLine);
	return {
		kind: kindOf(parsed.ref),
		ref: raw,
		rawHash: sha256(content),
		mutable: false,
		excerpt,
		excerptHash: sha256(excerpt),
	};
}

function kindOf(ref) {
	const normalized = ref.replace(/\\/g, "/");
	if (normalized.includes("/adr/") || /^adr-/.test(path.basename(normalized))) return "adr";
	if (normalized.includes("ledger.jsonl")) return "ledger";
	if (normalized.includes("/sessions/")) return "session";
	const ext = path.extname(normalized).toLowerCase();
	if (ext === ".md" || ext === ".markdown") return "doc";
	if (ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".ts") return "code";
	if (ext === ".json") return "config";
	return "file";
}

/** Most recent session ledger for automatic evidence bundling. */
function findLatestLedger(targetRoot) {
	const sessionsRoot = path.join(targetRoot, ".amber", "sessions");
	if (!fs.existsSync(sessionsRoot)) return null;
	let best = null;
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name === "ledger.jsonl") {
				const stat = fs.statSync(full);
				if (!best || stat.mtimeMs > best.mtimeMs)
					best = { full, rel: path.relative(targetRoot, full), mtimeMs: stat.mtimeMs };
			}
		}
	};
	walk(sessionsRoot);
	return best;
}

/**
 * Bundle sources for a request. When `sourceSpecs` is empty, auto-bundles the
 * most recent session ledger (immutable excerpt).
 * @returns {{ sources: Array, errors: Array }}
 */
function bundleSources(targetRoot, sourceSpecs = []) {
	const specs = Array.isArray(sourceSpecs) ? sourceSpecs : [sourceSpecs];
	let list = specs;
	if (list.length === 0) {
		const ledger = findLatestLedger(targetRoot);
		if (ledger) {
			const lines = fs.readFileSync(ledger.full, "utf8").split("\n").length;
			list = [{ ref: `${ledger.rel}#L1-L${lines}` }];
		}
	}
	const sources = [];
	const errors = [];
	for (const spec of list) {
		let bundled;
		try {
			bundled = bundleSource(targetRoot, spec);
		} catch (error) {
			errors.push(error.message || String(error));
			continue;
		}
		if (bundled) sources.push(bundled);
		else {
			const parsed = parseRef(spec);
			errors.push(`source not found: ${parsed ? parsed.ref : String(spec)}`);
		}
	}
	return { sources, errors };
}

const ACCEPTANCE = [
	{ check: "schema", code: "AMBER_E_CONTEXT_SCHEMA_INVALID" },
	{ check: "citations", code: "AMBER_E_CONTEXT_CLAIM_UNCITED" },
	{ check: "sources-present", code: "AMBER_E_CONTEXT_SOURCE_MISSING" },
	{ check: "sources-fresh", code: "AMBER_E_CONTEXT_SOURCE_STALE" },
	{ check: "immutable-intact", code: "AMBER_E_CONTEXT_SOURCE_TAMPERED" },
];

const DEFAULT_INSTRUCTIONS =
	"Extract claims about the target topic from the listed sources. Every block must cite at " +
	"least one source id declared in the sources map. Anything the sources do not cover must be " +
	'written as a type:"unknown" block — never invent a citation or a fact. Do not introduce new ' +
	"facts beyond the sources. Return a payload matching the output schema exactly.";

function makeRequestId() {
	const ymd = localIsoDate();
	return `kd-${ymd}-${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Normalize a scope option into a deduped array of non-empty strings.
 * Accepts an array, a single string, or undefined; returns [] when empty.
 */
function normalizeScope(scope) {
	if (scope == null) return [];
	const list = Array.isArray(scope) ? scope : [scope];
	const seen = new Set();
	const out = [];
	for (const item of list) {
		if (typeof item !== "string") continue;
		const trimmed = item.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			out.push(trimmed);
		}
	}
	return out;
}

function validateRequestInput(targetRoot, opts) {
	const pageId = opts.pageId;
	const errors = [];
	if (!pageId || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pageId)) {
		errors.push(`invalid pageId: ${pageId} (kebab-case required)`);
	}
	if (opts.knowledgeKind != null && !KNOWLEDGE_KINDS.includes(opts.knowledgeKind)) {
		errors.push(`invalid knowledgeKind: ${opts.knowledgeKind}`);
	}
	const supersedes = normalizePageIds(opts.supersedes);
	const supersedesInputCount = Array.isArray(opts.supersedes)
		? opts.supersedes.length
		: opts.supersedes
			? 1
			: 0;
	if (supersedes.length !== supersedesInputCount) {
		errors.push("supersedes must contain unique Context Page identifiers");
	}
	for (const predecessor of supersedes) {
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(predecessor)) {
			errors.push(`invalid supersedes pageId: ${predecessor}`);
		}
		if (predecessor === pageId) errors.push(`Context Page ${pageId} cannot supersede itself`);
	}
	if (errors.length === 0 && !opts.force && latestRequestForPage(targetRoot, pageId)) {
		errors.push(`open request already exists for page "${pageId}" (use --force to supersede)`);
	}
	const bundled = bundleSources(targetRoot, opts.sources);
	for (const error of bundled.errors) errors.push(`bundle: ${error}`);
	if (bundled.sources.length === 0) errors.push("no sources bundled — nothing to distil");
	return { pageId, title: opts.title || pageId, sources: bundled.sources, errors };
}

function buildRequest(opts, input) {
	const scope = normalizeScope(opts.scope);
	const target = {
		pageId: input.pageId,
		title: input.title,
		reason: opts.reason || "explicit",
	};
	if (scope.length > 0) target.scope = scope;
	if (opts.knowledgeKind) target.knowledgeKind = opts.knowledgeKind;
	const supersedes = normalizePageIds(opts.supersedes);
	if (supersedes.length > 0) target.supersedes = supersedes;
	return {
		schemaVersion: SCHEMA_VERSION,
		requestId: makeRequestId(),
		createdAt: new Date().toISOString(),
		target,
		sources: input.sources,
		contract: {
			outputSchema: PAGE_SCHEMA,
			instructions: DEFAULT_INSTRUCTIONS,
			constraints: {
				maxWords: opts.maxWords || 800,
				requireCitationPerClaim: true,
				forbidNewFacts: true,
			},
		},
		acceptance: ACCEPTANCE,
	};
}

function persistRequest(targetRoot, request) {
	const dir = requestsDir(targetRoot);
	fs.mkdirSync(dir, { recursive: true });
	const requestPath = path.join(dir, `${request.requestId}.json`);
	fs.writeFileSync(requestPath, JSON.stringify(request, null, 2) + "\n", "utf8");
	appendEvent(targetRoot, {
		kind: "request-created",
		requestId: request.requestId,
		pageId: request.target.pageId,
		trigger: request.target.reason,
		sourceCount: request.sources.length,
	});
	return requestPath;
}

/**
 * Create a distillation contract.
 * @param {string} targetRoot
 * @param {{ pageId: string, title?: string, reason?: string, sources?: Array, force?: boolean, scope?: string[]|string }} opts
 */
function createRequest(targetRoot, opts = {}) {
	const input = validateRequestInput(targetRoot, opts);
	if (input.errors.length > 0) {
		return { requestId: null, requestPath: null, errors: input.errors, warnings: [] };
	}
	const request = buildRequest(opts, input);
	const requestValidation = validateRequestSchema(request);
	if (requestValidation.errors.length > 0) {
		return { requestId: null, requestPath: null, errors: requestValidation.errors, warnings: [] };
	}
	const requestPath = persistRequest(targetRoot, request);
	return { requestId: request.requestId, requestPath, errors: [], warnings: [], request };
}

/** Load a request by id, or null. */
function loadRequest(targetRoot, requestId) {
	if (!requestId || !/^[a-z0-9-]+$/.test(requestId)) return null;
	const file = path.join(requestsDir(targetRoot), `${requestId}.json`);
	if (!fs.existsSync(file)) return null;
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

/** Newest open request targeting a page (requests are never deleted on ingest). */
function latestRequestForPage(targetRoot, pageId) {
	const dir = requestsDir(targetRoot);
	if (!fs.existsSync(dir)) return null;
	const files = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.map((f) => ({ name: f, mtimeMs: fs.statSync(path.join(dir, f)).mtimeMs }))
		.sort((a, b) => b.mtimeMs - a.mtimeMs) // newest first
		.map((f) => f.name);
	for (const f of files) {
		try {
			const req = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
			if (req.target && req.target.pageId === pageId) return req;
		} catch {
			/* skip malformed */
		}
	}
	return null;
}

module.exports = {
	SCHEMA_VERSION,
	PAGE_SCHEMA,
	bundleSources,
	bundleSource,
	createRequest,
	loadRequest,
	latestRequestForPage,
	isImmutable,
	parseRef,
};
