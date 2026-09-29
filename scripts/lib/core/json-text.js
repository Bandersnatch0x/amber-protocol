"use strict";

// Byte-faithful JSON edits — the shared seam for writers that must change a value
// without rewriting the document.
//
// Re-serializing with JSON.stringify normalizes formatting: it always expands
// arrays, and it cannot know the file's own indentation. The repository's format
// gate follows prettier, which reads indentation from the file and keeps a short
// array inline — so a full re-serialization fails the gate and turns a one-field
// change into a whole-file diff. Both of these happened:
//
//   - `version:sync` rewrote `"skills": ["./skills/"]` across three lines and
//     `format:check` rejected .claude-plugin/plugin.json on the release commit
//   - accepting a plan rewrote feature_list.json (3,200 lines) to record one
//     status change, with 2-space indentation in a tab-indented file
//
// Both helpers return null rather than guess, so a caller can fall back to a full
// serialization when the byte-level edit cannot be shown to be faithful.

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The indentation unit a JSON document already uses (tab or spaces). */
function detectIndent(text, fallback = "\t") {
	return String(text || "").match(/\n([\t ]+)"/)?.[1] || fallback;
}

/** Index just past the string literal starting at `start`, or -1 if unterminated. */
function endOfString(text, start) {
	let i = start + 1;
	while (i < text.length) {
		if (text[i] === "\\") {
			i += 2;
			continue;
		}
		if (text[i] === '"') return i + 1;
		i += 1;
	}
	return -1;
}

/**
 * Span (`{ open, close }`) of the innermost OBJECT containing `index`, or null.
 * Strings are skipped so a brace inside a value cannot unbalance the scan.
 */
function objectSpanContaining(text, index) {
	// Phase 1: find the innermost object still open as the scan passes `index`.
	const stack = [];
	let open = -1;
	let i = 0;
	while (i < text.length) {
		const char = text[i];
		if (char === '"') {
			const end = endOfString(text, i);
			if (end === -1) return null;
			i = end;
			continue;
		}
		if (char === "{" || char === "[") stack.push(i);
		else if (char === "}" || char === "]") stack.pop();
		i += 1;
		if (open === -1 && i > index) {
			for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
				if (text[stack[depth]] === "{" && stack[depth] < index) {
					open = stack[depth];
					break;
				}
			}
		}
	}
	if (open === -1) return null;

	// Phase 2: walk to the matching close brace.
	let braces = 0;
	i = open;
	while (i < text.length) {
		const char = text[i];
		if (char === '"') {
			const end = endOfString(text, i);
			if (end === -1) return null;
			i = end;
			continue;
		}
		if (char === "{") braces += 1;
		else if (char === "}") {
			braces -= 1;
			if (braces === 0) return { open, close: i };
		}
		i += 1;
	}
	return null;
}

function memberPattern(key) {
	// A JSON member value: string, number, boolean, or null. Arrays and objects
	// are deliberately excluded — replacing those wholesale is not a byte edit.
	return new RegExp(
		`("${escapeRegExp(key)}"\\s*:\\s*)(?:"(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?|true|false|null)`,
	);
}

/**
 * Whether the object text carries the key at all, whatever its value. Used to
 * refuse an INSERT when the key exists with a value `memberPattern` cannot
 * rewrite: appending a second `"key": …` would duplicate it, and the guard could
 * not tell, because JSON.parse keeps the LAST duplicate — the document would
 * verify as the intended one while carrying a key twice.
 */
function hasKey(text, key) {
	return new RegExp(`"${escapeRegExp(key)}"\\s*:`).test(text);
}

/** The last non-whitespace index in `text`, or -1. */
function lastContentIndex(text) {
	for (let i = text.length - 1; i >= 0; i -= 1) {
		if (!/\s/.test(text[i])) return i;
	}
	return -1;
}

/**
 * Rewrite only the named `fields` inside the object carrying
 * `identityKey: identityValue`. A missing field is inserted after the last member,
 * keeping the object's own indentation. Returns null unless the result parses back
 * to exactly `expected`.
 */
function patchObjectFields(text, { identityKey, identityValue, fields, expected }) {
	const identity = new RegExp(
		`"${escapeRegExp(identityKey)}"\\s*:\\s*"${escapeRegExp(identityValue)}"`,
	);
	const match = identity.exec(text);
	if (!match) return null;
	const span = objectSpanContaining(text, match.index);
	if (!span) return null;

	// Edit the object's OWN slice and reassemble once. Recomputing the slice from
	// the document on every field would use a stale `span`: a replacement changes
	// the text length, so the closing brace moves and the insertion point drifts.
	let inner = text.slice(span.open, span.close + 1);
	for (const [key, value] of Object.entries(fields)) {
		const member = memberPattern(key);
		if (member.test(inner)) {
			inner = inner.replace(member, (_whole, prefix) => prefix + JSON.stringify(value));
			continue;
		}
		// Insert after the last member, in the object's own layout — but never when the
		// key is already there with a value this helper will not rewrite.
		if (hasKey(inner, key)) return null;
		const body = inner.slice(0, -1); // the object without its closing brace
		const lastEnd = lastContentIndex(body);
		if (lastEnd === -1) return null;
		const lines = inner.split("\n");
		const closingIndent = (lines[lines.length - 1].match(/^[ \t]*/) || [""])[0];
		const unit = inner.includes("\n\t") ? "\t" : "  ";
		const insertion = inner.includes("\n")
			? `,\n${closingIndent}${unit}${JSON.stringify(key)}: ${JSON.stringify(value)}`
			: `, ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
		inner = body.slice(0, lastEnd + 1) + insertion + inner.slice(lastEnd + 1);
	}
	const patched = text.slice(0, span.open) + inner + text.slice(span.close + 1);

	if (!expected) return patched;
	try {
		if (JSON.stringify(JSON.parse(patched)) === JSON.stringify(expected)) return patched;
	} catch {
		/* unparseable result — fall through to null */
	}
	return null;
}

/** Collect the scalar values that differ between two documents, keyed by name. */
function changedScalars(before, after, acc = new Map()) {
	if (Array.isArray(before) && Array.isArray(after)) {
		after.forEach((value, index) => changedScalars(before[index], value, acc));
		return acc;
	}
	if (before && after && typeof before === "object" && typeof after === "object") {
		for (const key of Object.keys(after)) {
			const previous = before[key];
			const next = after[key];
			if (next && typeof next === "object") changedScalars(previous, next, acc);
			else if (previous !== next) acc.set(key, { from: previous, to: next });
		}
	}
	return acc;
}

/**
 * Patch every value that changed between `text` and `expected`, wherever the old
 * value appears. Used by version bumps, where the same field holds the same value
 * across the document. Falls back (null) unless the result matches `expected`.
 */
function patchValuesByKey(text, expected) {
	let patched = text;
	for (const [key, { from, to }] of changedScalars(JSON.parse(text), expected)) {
		const pattern = new RegExp(
			`("${escapeRegExp(key)}"\\s*:\\s*)${escapeRegExp(JSON.stringify(from))}`,
			"g",
		);
		patched = patched.replace(pattern, (_whole, prefix) => prefix + JSON.stringify(to));
	}
	try {
		if (JSON.stringify(JSON.parse(patched)) === JSON.stringify(expected)) return patched;
	} catch {
		/* unparseable result — fall through to null */
	}
	return null;
}

module.exports = { patchObjectFields, patchValuesByKey, detectIndent };
