"use strict";

// Normalize external text before it enters Context excerpts (issues/0185).
// Strips zero-width and bidi control characters that can hide prompt
// payloads from redaction/rule matching, then applies Unicode NFKC so
// visually equivalent confusables collapse to their plain forms.

const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

function normalizeExternalText(text) {
	if (typeof text !== "string") {
		return "";
	}
	return text.replace(INVISIBLE_CHARS, "").normalize("NFKC");
}

module.exports = { normalizeExternalText };
