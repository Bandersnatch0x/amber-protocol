"use strict";

// Shared source handling for the context layer (ADR-0009 D5/D5a): ref-range
// parsing, span extraction, and the mechanical source-health check used by both
// the ingest gate and verify. One implementation so MISSING/STALE/TAMPERED
// semantics cannot drift between the two callers.

const fs = require("node:fs");
const path = require("node:path");

const { hashFile, sha256 } = require("./context-hash");
const { getEntry } = require("./error-catalog");

const RANGE_RE = /^(.+)#L(\d+)(?:-L(\d+))?$/;

/** Strip the "#Lx-Ly" fragment from a ref so it can be resolved on disk. */
function stripRange(ref) {
	const m = String(ref || "").match(RANGE_RE);
	return m ? m[1] : String(ref || "");
}

/** Parse "#Lx-Ly" into { fromLine, toLine } (1-based inclusive); nulls when absent. */
function parseRange(ref) {
	const m = String(ref || "").match(RANGE_RE);
	if (m) return { fromLine: Number(m[2]), toLine: m[3] ? Number(m[3]) : Number(m[2]) };
	return { fromLine: null, toLine: null };
}

/** Extract the cited span of a file's content; whole content when no range. */
function extractSpan(content, ref) {
	const { fromLine, toLine } = parseRange(ref);
	if (!fromLine) return content;
	return content.split("\n").slice(fromLine - 1, toLine).join("\n");
}

function finding(code, detail, pageId, sid) {
	const entry = getEntry(code);
	return { code, title: entry ? entry.title : code, detail, pageId, sid: sid || null };
}

/**
 * Mechanical health check of a page's sources against disk (ADR-0009 D8).
 *
 * - mutable source missing            -> MISSING (blocking)
 * - mutable normHash mismatch         -> STALE (blocking)
 * - immutable source changed vs live  -> TAMPERED (blocking)
 * - immutable source gone             -> MISSING (informational — page stands on its excerpt)
 * - embedded excerpt re-hash mismatch -> TAMPERED (page-file corruption, D5a outcome 1)
 *
 * @returns {{ findings: Array, blocked: boolean }}
 */
function checkSourceHealth(targetRoot, sources, pageId = null) {
	const findings = [];
	let blocked = false;
	for (const [sid, src] of Object.entries(sources || {})) {
		const full = path.resolve(targetRoot, stripRange(src.ref));
		if (src.mutable) {
			if (!fs.existsSync(full)) {
				blocked = true;
				findings.push(finding("AMBER_E_CONTEXT_SOURCE_MISSING", `mutable source ${src.ref} is missing`, pageId, sid));
				continue;
			}
			const current = hashFile(full);
			if (current.normHash !== src.normHash) {
				blocked = true;
				findings.push(finding("AMBER_E_CONTEXT_SOURCE_STALE", `source ${src.ref} changed (normHash mismatch)`, pageId, sid));
			}
			continue;
		}

		// Immutable: D5a outcome 1 — the embedded excerpt must match its own
		// recorded hash. Checked first so page-file corruption is caught even
		// when the live source is gone.
		if (src.excerpt && src.excerptHash && sha256(src.excerpt) !== src.excerptHash) {
			blocked = true;
			findings.push(finding("AMBER_E_CONTEXT_SOURCE_TAMPERED", `embedded excerpt of ${src.ref} fails its own hash — page file may be corrupted`, pageId, sid));
			continue;
		}
		if (!fs.existsSync(full)) {
			// D5a outcome 3: source gone; page stands on its snapshot.
			findings.push(finding("AMBER_E_CONTEXT_SOURCE_MISSING", `immutable source ${src.ref} is gone; page stands on its excerpt`, pageId, sid));
			continue;
		}
		// D5a outcome 2: live source, when present, must match the excerpt.
		const live = extractSpan(fs.readFileSync(full, "utf8"), src.ref);
		if (src.excerptHash && sha256(live) !== src.excerptHash) {
			blocked = true;
			findings.push(finding("AMBER_E_CONTEXT_SOURCE_TAMPERED", `immutable source ${src.ref} no longer matches the excerpt`, pageId, sid));
		}
	}
	return { findings, blocked };
}

module.exports = { stripRange, parseRange, extractSpan, checkSourceHealth, finding };
