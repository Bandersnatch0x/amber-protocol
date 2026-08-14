"use strict";

// Shared lockstep contract for a stable amber-protocol + dsh-amber-protocol
// release: the tag, root version, DSH version, and DSH's amber-protocol
// dependency lower bound must all describe the same X.Y.Z.

const fs = require("node:fs");
const path = require("node:path");

const STABLE_TAG = /^v\d+\.\d+\.\d+$/;

function validateReleaseVersions({ tag, rootVersion, dshVersion, dshDependency } = {}) {
	const errors = [];
	if (typeof tag !== "string" || !STABLE_TAG.test(tag)) {
		errors.push(`tag must be a stable vX.Y.Z ref, got ${JSON.stringify(tag)}`);
		return errors;
	}

	const expected = tag.slice(1);
	if (rootVersion !== expected) {
		errors.push(`root version ${JSON.stringify(rootVersion)} does not match tag ${tag}`);
	}
	if (dshVersion !== expected) {
		errors.push(`dsh version ${JSON.stringify(dshVersion)} does not match tag ${tag}`);
	}
	if (dshDependency !== `^${expected}`) {
		errors.push(
			`dsh amber-protocol dependency ${JSON.stringify(dshDependency)} does not match "^${expected}"`,
		);
	}
	return errors;
}

function loadReleaseVersions(root) {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	const dsh = JSON.parse(fs.readFileSync(path.join(root, "dsh", "package.json"), "utf8"));
	return {
		rootVersion: pkg.version,
		dshVersion: dsh.version,
		dshDependency: dsh.dependencies?.["amber-protocol"],
	};
}

function main(
	root = path.resolve(__dirname, ".."),
	tag = process.argv[2] || process.env.GITHUB_REF_NAME,
) {
	const errors = validateReleaseVersions({
		tag,
		...loadReleaseVersions(root),
	});
	if (errors.length === 0) {
		process.stdout.write(`release versions OK for ${tag}\n`);
		return 0;
	}
	for (const error of errors) {
		process.stderr.write(`${error}\n`);
	}
	return 1;
}

module.exports = { validateReleaseVersions, loadReleaseVersions, main };

if (require.main === module) {
	process.exit(main());
}
