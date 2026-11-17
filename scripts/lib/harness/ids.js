"use strict";

// Path-safe identifier mapping shared by the harness cores.
//
// This character set is a security boundary: it decides which run/tool/session
// ids can land on a filename. Keep it single-sourced — twelve copies used to
// drift silently (issues/0204).
//
// `..` is NOT rejected: dots are in the allowlist. Changing that is a separate
// decision.
function safeId(id) {
	return String(id).replace(/[^A-Za-z0-9._-]/g, "-");
}

module.exports = { safeId };
