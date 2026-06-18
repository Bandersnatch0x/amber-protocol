"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { pathExists, readJson, readText } = require("./fs-utils");

// Deep module: the bundle -> artifact write pipeline shared by every
// single-file adoption artifact writer (decision-record, apply-plan,
// selected-files, next-actions). Each writer supplies a spec describing only
// what differs about its artifact; the repeated dance — resolve options,
// validate IO preconditions, load and parse the bundle manifest, then
// mkdir + write — lives here once.
//
// spec fields:
//   command           string   e.g. "adoption decision-record" (precondition messages)
//   outputExistsLabel string   noun for the "<label> already exists" message
//   emptyResult       (fields, errors, warnings) => errorResultObject
//   validate          optional (options) => string[]  extra precondition errors
//   build             (manifest, ctx) => record | null  domain logic only; push to
//                     ctx.errors / ctx.warnings as needed, return null to bail
//   render            (record) => string  (e.g. a composer renderX function)
//
// ctx passed to build:
//   bundleDir, outputPath, options, errors, warnings
//   readBundleFile(relativePath) => string  ("" when the file is absent)
function writeAdoptionBundleArtifact(options = {}, spec) {
	const {
		command,
		outputExistsLabel,
		emptyResult,
		validate,
		build,
		render,
	} = spec;

	const bundleDir = options.bundleDir ? path.resolve(options.bundleDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const errors = [];
	const warnings = [];

	if (!bundleDir) {
		errors.push(`${command} requires --bundle-dir.`);
	}
	if (!outputPath) {
		errors.push(`${command} requires --output.`);
	}
	if (typeof validate === "function") {
		errors.push(...validate(options));
	}
	if (
		bundleDir &&
		(!pathExists(bundleDir) || !fs.statSync(bundleDir).isDirectory())
	) {
		errors.push(`Bundle directory does not exist: ${bundleDir}`);
	}
	if (outputPath && pathExists(outputPath)) {
		errors.push(`${outputExistsLabel} already exists: ${outputPath}`);
	}
	if (errors.length > 0) {
		return emptyResult({ bundleDir, outputPath }, errors, warnings);
	}

	const manifestPath = path.join(bundleDir, "manifest.json");
	if (!pathExists(manifestPath)) {
		errors.push(`Bundle manifest is missing: ${manifestPath}`);
		return emptyResult({ bundleDir, outputPath }, errors, warnings);
	}

	let manifest;
	try {
		manifest = readJson(manifestPath);
	} catch (error) {
		errors.push(`Cannot read bundle manifest: ${error.message}`);
		return emptyResult({ bundleDir, outputPath }, errors, warnings);
	}

	const ctx = {
		bundleDir,
		outputPath,
		options,
		errors,
		warnings,
		readBundleFile(relativePath) {
			const filePath = path.join(bundleDir, relativePath);
			return pathExists(filePath) ? readText(filePath) : "";
		},
	};

	const record = build(manifest, ctx);
	if (errors.length > 0) {
		return emptyResult(
			{ target: manifest.target, bundleDir, outputPath },
			errors,
			warnings,
		);
	}

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, render(record));

	return record;
}

module.exports = {
	writeAdoptionBundleArtifact,
};
