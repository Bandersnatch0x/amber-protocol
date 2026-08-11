"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { canonicalJson, sha256 } = require("./context-hash");
const { indexPath, listPages, readPage } = require("./context-store");
const { renderContextIndex, validateContextIndex } = require("./context-index");
const { resolvePathWithin } = require("./fs-utils");

const SCHEMA_VERSION = "1.0.0";
const PROJECTION_ID = "context-index";

function projectionManifestPath(targetRoot) {
	return resolvePathWithin(
		targetRoot,
		path.join(".amber", "context", "projections", `${PROJECTION_ID}.json`),
		{ label: "Context projection manifest" },
	);
}

function authoritativeState(targetRoot) {
	const pages = listPages(targetRoot).map(({ pageId }) => readPage(targetRoot, pageId));
	return {
		pages,
		pageCount: pages.length,
		sourceHash: sha256(canonicalJson(JSON.stringify(pages))),
	};
}

function projectionFailure(code, detail) {
	return { ok: false, code, detail, manifest: null };
}

function readProjectionManifest(targetRoot) {
	const manifestPath = projectionManifestPath(targetRoot);
	if (!fs.existsSync(manifestPath)) {
		return projectionFailure(
			"AMBER_E_CONTEXT_PROJECTION_MISSING",
			`projection manifest is missing: ${path.relative(targetRoot, manifestPath)}`,
		);
	}
	try {
		return { ok: true, manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")) };
	} catch (error) {
		return projectionFailure(
			"AMBER_E_CONTEXT_PROJECTION_DRIFT",
			`projection manifest is unreadable: ${error.message}`,
		);
	}
}

function projectionStatus(targetRoot) {
	const loaded = readProjectionManifest(targetRoot);
	if (!loaded.ok) return loaded;
	const { manifest } = loaded;
	if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.projectionId !== PROJECTION_ID) {
		return projectionFailure(
			"AMBER_E_CONTEXT_PROJECTION_DRIFT",
			"projection manifest identity or schema version does not match",
		);
	}
	const state = authoritativeState(targetRoot);
	if (manifest.sourceHash !== state.sourceHash || manifest.pageCount !== state.pageCount) {
		return projectionFailure(
			"AMBER_E_CONTEXT_PROJECTION_DRIFT",
			"authoritative Context Pages changed since the projection was rebuilt",
		);
	}
	const outputPath = indexPath(targetRoot);
	if (!fs.existsSync(outputPath)) {
		return projectionFailure(
			"AMBER_E_CONTEXT_PROJECTION_MISSING",
			`projection output is missing: ${path.relative(targetRoot, outputPath)}`,
		);
	}
	const output = fs.readFileSync(outputPath, "utf8");
	const outputHash = sha256(output);
	if (manifest.outputHash !== outputHash) {
		return projectionFailure("AMBER_E_CONTEXT_PROJECTION_DRIFT", "projection output hash mismatch");
	}
	const completeness = validateContextIndex(state.pages, output);
	if (!completeness.ok) {
		return projectionFailure(
			"AMBER_E_CONTEXT_PROJECTION_DRIFT",
			`${completeness.detail}; output does not match authoritative Context Pages`,
		);
	}
	return { ok: true, code: null, detail: "current", manifest };
}

function rebuildProjection(targetRoot) {
	const state = authoritativeState(targetRoot);
	const output = renderContextIndex(targetRoot, state.pages);
	const outputPath = indexPath(targetRoot);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, output, "utf8");
	const manifest = {
		schemaVersion: SCHEMA_VERSION,
		projectionId: PROJECTION_ID,
		sourceHash: state.sourceHash,
		outputHash: sha256(output),
		pageCount: state.pageCount,
	};
	const manifestPath = projectionManifestPath(targetRoot);
	fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	return { ok: true, manifest, manifestPath, outputPath };
}

module.exports = {
	PROJECTION_ID,
	projectionManifestPath,
	projectionStatus,
	rebuildProjection,
};
