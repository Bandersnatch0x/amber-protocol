"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveTarget, readJsonSafe } = require("./core/fs-utils");
const { codedError } = require("./core/error-catalog");

const COMPLETE_STATUSES = new Set(["passing", "accepted", "done"]);

// C1 — a feature must not claim completion without evidence.
function checkFeatureEvidence(targetRoot) {
	const flPath = path.join(targetRoot, "feature_list.json");
	const { value } = readJsonSafe(flPath);
	if (!value || typeof value !== "object" || !Array.isArray(value.features)) return [];
	const findings = [];
	for (const f of value.features) {
		if (!f || typeof f !== "object") continue;
		const hasEvidence = Array.isArray(f.evidence) && f.evidence.length > 0;
		if (COMPLETE_STATUSES.has(f.status) && !hasEvidence) {
			findings.push(
				codedError(
					"AMBER_E_FEATURE_NO_EVIDENCE",
					`Feature ${f.id || "?"} is "${f.status}" but has no evidence`,
				),
			);
		}
	}
	return findings;
}

function checkGovernance(target, { warnOnly = false } = {}) {
	const targetRoot = resolveTarget(target);
	const findings = checkFeatureEvidence(targetRoot);

	const errors = [];
	const warnings = [];
	if (findings.length > 0) {
		const bucket = warnOnly ? warnings : errors;
		bucket.push(
			codedError(
				"AMBER_E_HOOK_PRECOMMIT_BLOCKED",
				`${findings.length} governance check(s) failed`,
			),
		);
		for (const f of findings) bucket.push(f);
	}
	return { target: targetRoot, errors, warnings };
}

module.exports = { checkGovernance };
