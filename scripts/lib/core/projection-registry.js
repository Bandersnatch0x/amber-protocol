"use strict";

/**
 * Rebuildable read-only projection framework (#158 Stage 4).
 *
 * Projections (Governance Graph, Governed Knowledge Base, Visualization
 * Workbench) are derived from canonical Amber artifacts and are NEVER
 * canonical authority (baseline authority boundary 4; ADR-0019 D5).
 *
 * A projection is a manifest + output, both deterministic from canonical
 * state. `sourceHash` detects canonical drift; `outputHash` detects output
 * tampering. Projections are rebuildable — rebuild() regenerates from
 * canonical artifacts at any time.
 *
 * Field names follow ADR-0012 amendment E: `projection_type`,
 * `projection_version`, `rebuild_checkpoint`, plus the four versioning
 * fields (`amber_protocol_version`, `artifact_sequence`, `created_at`,
 * `artifact_type`).
 */

const crypto = require("node:crypto");
const { sha256 } = require("./context-hash");
const fs = require("node:fs");
const path = require("node:path");

const PROJECTION_TYPES = Object.freeze([
	"governance-graph",
	"knowledge-base",
	"visualization-workbench",
]);
const SCHEMA_VERSION = "1.0.0";
const AMBER_PROTOCOL_VERSION = require(
	path.resolve(__dirname, "..", "..", "..", "package.json"),
).version;

function projectionsDir(targetRoot) {
	return path.join(targetRoot, ".amber", "projections");
}

function projectionManifestPath(targetRoot, projectionType) {
	return path.join(projectionsDir(targetRoot), `${projectionType}.json`);
}

/**
 * Collect canonical artifacts a projection is built from.
 * Today: context pages under .amber/context/pages/.
 * @param {string} targetRoot - Repository root.
 * @returns {{artifacts: Array<object>, checkpoint: string}}
 */
function canonicalState(targetRoot) {
	const pagesDir = path.join(targetRoot, ".amber", "context", "pages");
	const artifacts = [];
	if (fs.existsSync(pagesDir)) {
		for (const name of fs
			.readdirSync(pagesDir)
			.filter((f) => f.endsWith(".json"))
			.sort()) {
			try {
				artifacts.push(JSON.parse(fs.readFileSync(path.join(pagesDir, name), "utf8")));
			} catch {
				// skip unreadable pages; they are not canonical evidence
			}
		}
	}
	const canonicalJson = JSON.stringify(artifacts);
	return { artifacts, checkpoint: sha256(canonicalJson) };
}

/**
 * Validate a projection manifest against the projection schema.
 * @param {object} manifest - The manifest to validate.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateProjectionManifest(manifest) {
	const errors = [];
	if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
		return { valid: false, errors: ["manifest must be an object"] };
	}
	for (const field of [
		"schemaVersion",
		"projectionId",
		"projection_type",
		"projection_version",
		"rebuild_checkpoint",
		"sourceHash",
		"outputHash",
	]) {
		if (!(field in manifest)) {
			errors.push(`missing required field "${field}"`);
		}
	}
	if (manifest.schemaVersion && manifest.schemaVersion !== SCHEMA_VERSION) {
		errors.push(
			`unsupported schemaVersion "${manifest.schemaVersion}" (expected "${SCHEMA_VERSION}")`,
		);
	}
	if (manifest.projection_type && !PROJECTION_TYPES.includes(manifest.projection_type)) {
		errors.push(`unknown projection_type "${manifest.projection_type}"`);
	}
	if (manifest.projectionId && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(manifest.projectionId)) {
		errors.push(`projectionId "${manifest.projectionId}" must be kebab-case`);
	}
	if (
		manifest.projection_version !== undefined &&
		(!Number.isInteger(manifest.projection_version) || manifest.projection_version < 1)
	) {
		errors.push("projection_version must be an integer >= 1");
	}
	for (const field of ["sourceHash", "outputHash"]) {
		if (manifest[field] !== undefined && !/^sha256:[0-9a-f]{64}$/.test(manifest[field])) {
			errors.push(`${field} must be sha256:<64 hex>`);
		}
	}
	// ADR-0012 versioning fields are optional and, when present, must be sane.
	if (
		manifest.artifact_sequence !== undefined &&
		(!Number.isInteger(manifest.artifact_sequence) || manifest.artifact_sequence < 0)
	) {
		errors.push("artifact_sequence must be an integer >= 0");
	}
	if (
		manifest.amber_protocol_version !== undefined &&
		typeof manifest.amber_protocol_version !== "string"
	) {
		errors.push("amber_protocol_version must be a string");
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Build a projection output from canonical state via a builder function.
 * @param {string} targetRoot - Repository root.
 * @param {string} projectionType - One of PROJECTION_TYPES.
 * @param {(state: {artifacts: Array<object>, checkpoint: string}) => object} builder
 * @returns {{ok: boolean, manifest: object|null, output: string|null, errors: string[]}}
 */
function buildProjection(targetRoot, projectionType, builder) {
	if (!PROJECTION_TYPES.includes(projectionType)) {
		return {
			ok: false,
			manifest: null,
			output: null,
			errors: [`unknown projection type "${projectionType}"`],
		};
	}
	try {
		const state = canonicalState(targetRoot);
		const built = builder(state);
		const output = JSON.stringify(built, null, 2) + "\n";
		const manifest = {
			schemaVersion: SCHEMA_VERSION,
			projectionId: projectionType,
			projection_type: projectionType,
			projection_version: 1,
			rebuild_checkpoint: state.checkpoint,
			sourceHash: state.checkpoint,
			outputHash: sha256(output),
			// ADR-0012 versioning fields (optional, populated when writing)
			amber_protocol_version: AMBER_PROTOCOL_VERSION,
			artifact_sequence: 0,
			created_at: new Date().toISOString(),
			artifact_type: "projection-manifest",
			rebuiltAt: new Date().toISOString(),
		};
		const validation = validateProjectionManifest(manifest);
		if (!validation.valid) {
			return { ok: false, manifest: null, output: null, errors: validation.errors };
		}
		return { ok: true, manifest, output, errors: [] };
	} catch (err) {
		return { ok: false, manifest: null, output: null, errors: [err.message] };
	}
}

/**
 * Rebuild a projection: build output, write manifest + output.
 * @param {string} targetRoot - Repository root.
 * @param {string} projectionType - One of PROJECTION_TYPES.
 * @param {(state: object) => object} builder
 * @returns {{ok: boolean, manifest: object|null, manifestPath: string|null, outputPath: string|null, errors: string[]}}
 */
function rebuildProjection(targetRoot, projectionType, builder) {
	const built = buildProjection(targetRoot, projectionType, builder);
	if (!built.ok) {
		return {
			ok: false,
			manifest: null,
			manifestPath: null,
			outputPath: null,
			errors: built.errors,
		};
	}
	const dir = projectionsDir(targetRoot);
	fs.mkdirSync(dir, { recursive: true });
	const manifestPath = projectionManifestPath(targetRoot, projectionType);
	const outputPath = path.join(dir, `${projectionType}.output.json`);
	fs.writeFileSync(manifestPath, JSON.stringify(built.manifest, null, 2) + "\n", "utf8");
	fs.writeFileSync(outputPath, built.output, "utf8");
	return { ok: true, manifest: built.manifest, manifestPath, outputPath, errors: [] };
}

/**
 * Check a projection's status: missing, current, or drifted.
 * @param {string} targetRoot - Repository root.
 * @param {string} projectionType - One of PROJECTION_TYPES.
 * @returns {{ok: boolean, code: string|null, detail: string, manifest: object|null}}
 */
function projectionStatus(targetRoot, projectionType) {
	const manifestPath = projectionManifestPath(targetRoot, projectionType);
	if (!fs.existsSync(manifestPath)) {
		return {
			ok: false,
			code: "AMBER_E_PROJECTION_MISSING",
			detail: `projection ${projectionType} not built`,
			manifest: null,
		};
	}
	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch (err) {
		return {
			ok: false,
			code: "AMBER_E_PROJECTION_DRIFT",
			detail: `manifest unreadable: ${err.message}`,
			manifest: null,
		};
	}
	const validation = validateProjectionManifest(manifest);
	if (!validation.valid) {
		return {
			ok: false,
			code: "AMBER_E_PROJECTION_DRIFT",
			detail: validation.errors.join("; "),
			manifest,
		};
	}
	const state = canonicalState(targetRoot);
	if (manifest.sourceHash !== state.checkpoint) {
		return {
			ok: false,
			code: "AMBER_E_PROJECTION_DRIFT",
			detail: "canonical artifacts changed since rebuild",
			manifest,
		};
	}
	const outputPath = path.join(projectionsDir(targetRoot), `${projectionType}.output.json`);
	if (!fs.existsSync(outputPath)) {
		return {
			ok: false,
			code: "AMBER_E_PROJECTION_MISSING",
			detail: "projection output missing",
			manifest,
		};
	}
	const output = fs.readFileSync(outputPath, "utf8");
	if (manifest.outputHash !== sha256(output)) {
		return {
			ok: false,
			code: "AMBER_E_PROJECTION_DRIFT",
			detail: "projection output hash mismatch",
			manifest,
		};
	}
	return { ok: true, code: null, detail: "current", manifest };
}

module.exports = {
	PROJECTION_TYPES,
	SCHEMA_VERSION,
	AMBER_PROTOCOL_VERSION,
	projectionsDir,
	projectionManifestPath,
	canonicalState,
	sha256,
	validateProjectionManifest,
	buildProjection,
	rebuildProjection,
	projectionStatus,
};
