"use strict";

const path = require("node:path");

const { MINIMUM_HARNESS_FILES } = require("./constants");

const { pathExists, resolveTarget } = require("./fs-utils");

function classifyTarget(target) {
	const targetRoot = resolveTarget(target);
	const evidence = [];

	if (
		pathExists(path.join(targetRoot, "SPEC.md")) &&
		pathExists(path.join(targetRoot, "ROADMAP.md")) &&
		pathExists(path.join(targetRoot, "scripts", "amber.js")) &&
		pathExists(path.join(targetRoot, "templates"))
	) {
		evidence.push("SPEC.md", "ROADMAP.md", "scripts/amber.js", "templates/");
		return { type: "product-repo", evidence };
	}

	for (const relativePath of MINIMUM_HARNESS_FILES) {
		if (pathExists(path.join(targetRoot, relativePath))) {
			evidence.push(relativePath);
		}
	}

	if (evidence.length > 0) {
		return { type: "harnessed-target-repo", evidence };
	}

	return { type: "unharnessed-target-repo", evidence };
}

module.exports = {
	classifyTarget,
};