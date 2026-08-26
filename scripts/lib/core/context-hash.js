"use strict";

// Dual-hash support for the amber context layer (ADR-0009 D5/D5a).
//
// Every referenced source carries a raw hash. Mutable sources additionally
// carry a normalized hash computed after stripping comments and whitespace, so
// that formatting passes and typo fixes do not raise refresh requests. The
// normalizer is deliberately regex/state-machine level — no parser — because a
// parser would be a new dependency (forbidden by ADR-0009 D2).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** sha256 of a UTF-8 string, prefixed "sha256:" for self-describing hashes. */
function sha256(text) {
	return `sha256:${sha256Hex(text)}`;
}

/** Raw hex sha256 of a UTF-8 string — the seam for fingerprints and chain
 * hashes that are compared, not displayed (architecture review #6). */
function sha256Hex(text) {
	return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// Strip comments and whitespace from JavaScript source without parsing string
// contents. Single-line and block comments are removed; string/template
// literals are kept verbatim so that `const url = "https://x"` survives.
function stripJsComments(code) {
	const out = [];
	let i = 0;
	let state = "code"; // code | lineComment | blockComment | sq | dq | tq
	const n = code.length;
	while (i < n) {
		const c = code[i];
		const next = code[i + 1];
		switch (state) {
			case "code":
				if (c === "/" && next === "/") {
					state = "lineComment";
					i += 2;
				} else if (c === "/" && next === "*") {
					state = "blockComment";
					i += 2;
				} else if (c === "'") {
					state = "sq";
					out.push(c);
					i += 1;
				} else if (c === '"') {
					state = "dq";
					out.push(c);
					i += 1;
				} else if (c === "`") {
					state = "tq";
					out.push(c);
					i += 1;
				} else {
					out.push(c);
					i += 1;
				}
				break;
			case "lineComment":
				if (c === "\n") {
					state = "code";
					out.push(c);
				}
				i += 1;
				break;
			case "blockComment":
				if (c === "*" && next === "/") {
					state = "code";
					i += 2;
				} else {
					i += 1;
				}
				break;
			case "sq":
				out.push(c);
				if (c === "\\") {
					out.push(next);
					i += 2;
				} else if (c === "'") {
					state = "code";
					i += 1;
				} else {
					i += 1;
				}
				break;
			case "dq":
				out.push(c);
				if (c === "\\") {
					out.push(next);
					i += 2;
				} else if (c === '"') {
					state = "code";
					i += 1;
				} else {
					i += 1;
				}
				break;
			case "tq":
				out.push(c);
				if (c === "\\") {
					out.push(next);
					i += 2;
				} else if (c === "`") {
					state = "code";
					i += 1;
				} else {
					i += 1;
				}
				break;
		}
	}
	return out.join("");
}

function stripMdComments(text) {
	return text.replace(/<!--[\s\S]*?-->/g, "");
}

// Deterministic canonical JSON: sorted keys, no insignificant whitespace.
function canonicalJson(json) {
	const recurse = (value) => {
		if (Array.isArray(value)) return `[${value.map(recurse).join(",")}]`;
		if (value !== null && typeof value === "object") {
			const keys = Object.keys(value).sort();
			return `{${keys.map((k) => `${JSON.stringify(k)}:${recurse(value[k])}`).join(",")}}`;
		}
		return JSON.stringify(value);
	};
	return recurse(JSON.parse(json));
}

function collapseWhitespace(text) {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Normalize source text for hash comparison.
 * @param {string} text  raw file content
 * @param {string} ext   file extension with or without leading dot (e.g. "js", ".md", "json")
 * @returns {string} normalized text
 */
function normalizeForHash(text, ext) {
	const extNorm = String(ext || "")
		.replace(/^\./, "")
		.toLowerCase();
	let t = text;
	if (extNorm === "js" || extNorm === "mjs" || extNorm === "cjs") {
		t = stripJsComments(t);
	} else if (extNorm === "md" || extNorm === "markdown") {
		t = stripMdComments(t);
	} else if (extNorm === "json") {
		return collapseWhitespace(canonicalJson(t));
	}
	return collapseWhitespace(t);
}

function extOf(filePath) {
	return path.extname(filePath).toLowerCase().replace(/^\./, "") || "";
}

/**
 * Hash a file on disk.
 * @returns {{ rawHash: string, normHash: string, normalized: string }}
 */
function hashFile(filePath) {
	const content = fs.readFileSync(filePath, "utf8");
	const ext = extOf(filePath);
	const rawHash = sha256(content);
	const normalized = normalizeForHash(content, ext);
	return { rawHash, normHash: sha256(normalized), normalized };
}

/** Hash a raw text blob with the same prefix convention. */
function hashText(text) {
	return sha256(text);
}

/** Convenience: both hashes for an in-memory string with a given extension. */
function hashSource(text, ext) {
	const rawHash = sha256(text);
	const normalized = normalizeForHash(text, ext || "");
	return { rawHash, normHash: sha256(normalized), normalized };
}

module.exports = {
	sha256,
	sha256Hex,
	normalizeForHash,
	hashFile,
	hashText,
	hashSource,
	canonicalJson,
};
