"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	TEMPLATE_ROOT,
} = require("./constants");

const {
	pathExists,
	relativeSlash,
	resolveTarget,
	walkFiles,
} = require("./fs-utils");

const {
	validateWiki,
} = require("./validators");

function listTemplateFiles(templateRoot = TEMPLATE_ROOT) {
	return walkFiles(templateRoot).map((filePath) => ({
		source: filePath,
		relativePath: relativeSlash(templateRoot, filePath),
	}));
}

function copyTemplateFiles(targetRoot, items, options = {}) {
	const dryRun = Boolean(options.dryRun);
	const created = [];
	const skipped = [];

	for (const item of items) {
		const destination = path.join(targetRoot, item.relativePath);
		if (pathExists(destination)) {
			skipped.push(item.relativePath);
			continue;
		}

		created.push(item.relativePath);
		if (!dryRun) {
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.copyFileSync(item.source, destination);
		}
	}

	return { created, skipped };
}

function scaffoldHarness(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const templateRoot = options.templateRoot || TEMPLATE_ROOT;
	const result = copyTemplateFiles(
		targetRoot,
		listTemplateFiles(templateRoot),
		options,
	);

	return {
		target: targetRoot,
		created: result.created,
		skipped: result.skipped,
	};
}

function scaffoldWiki(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const wikiTemplateRoot = path.join(TEMPLATE_ROOT, "docs", "wiki");
	const items = listTemplateFiles(wikiTemplateRoot).map((item) => ({
		source: item.source,
		relativePath: path.join("docs", "wiki", item.relativePath),
	}));
	const result = copyTemplateFiles(targetRoot, items, options);
	const validation = options.dryRun
		? { errors: [], warnings: [] }
		: validateWiki(targetRoot);

	return {
		target: targetRoot,
		created: result.created,
		skipped: result.skipped,
		errors: validation.errors,
		warnings: validation.warnings,
	};
}

module.exports = {
	listTemplateFiles,
	copyTemplateFiles,
	scaffoldHarness,
	scaffoldWiki,
};
