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

const { sha256 } = require("./context-hash");
const fs = require("node:fs");
const path = require("node:path");
const { readCanonicalPages } = require("./context-store");
const { governanceGraphSource, governanceGraphCheckpoint } = require("./governance-graph");
const { statePathForCreate } = require("../state-dir-resolver");

const PROJECTION_TYPES = Object.freeze([
	"governance-graph",
	"knowledge-base",
	"visualization-workbench",
]);
const SCHEMA_VERSION = "1.0.0";
const AMBER_PROTOCOL_VERSION = require(
	path.resolve(__dirname, "..", "..", "..", "package.json"),
).version;

// Projections (#158 Stage 4, post-rename state kind): manifests never existed
// under .harness, so reads and creates both target the canonical dir (see the
// note in organization-audit.js).
function projectionsDir(targetRoot) {
	return statePathForCreate(targetRoot, "projections");
}

function projectionManifestPath(targetRoot, projectionType) {
	return path.join(projectionsDir(targetRoot), `${projectionType}.json`);
}

// Per-projection canonical source collectors (F049 ticket 05, #222; ADR-0021
// #2: the Governance Graph's registry and sources may be extended for 2.0
// types). The Governance Graph — the only graph projection — derives from
// context pages AND committed Canonical Artifact revisions, so its source
// state and drift checkpoint cover both. The other projections stay
// page-derived. The artifact half is read through the strictly read-only
// verification seam listArtifactRevisions, so a corrupt store makes the
// source unreadable (fail closed) rather than the projection partial.
const PROJECTION_SOURCES = Object.freeze({
	"governance-graph": (targetRoot) => {
		const source = governanceGraphSource(targetRoot);
		return {
			...source,
			checkpoint: governanceGraphCheckpoint(source),
		};
	},
});

/**
 * Collect canonical artifacts a projection is built from.
 * Default: context pages under .amber/context/pages/. Projections with a
 * registered source collector (PROJECTION_SOURCES) derive their state and
 * checkpoint from it instead.
 * @param {string} targetRoot - Repository root.
 * @param {string} [projectionType] - One of PROJECTION_TYPES.
 * @returns {{artifacts: Array<object>, checkpoint: string}}
 */
function canonicalState(targetRoot, projectionType) {
	// canonical evidence reader lives in context-store; projection registry
	// derives the deterministic checkpoint from the same page set
	const source = projectionType ? PROJECTION_SOURCES[projectionType] : undefined;
	if (source) return source(targetRoot);
	const artifacts = readCanonicalPages(targetRoot);
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
	// ADR-0012 amendment E reserved the trio as projection fields; manifests
	// written before the rename carried camelCase (projectionType/…). Accept
	// either spelling so legacy manifests keep validating (legacy artifacts
	// must continue to validate per ADR-0012 §1) — new manifests are written
	// snake_case only.
	const typeField =
		"projection_type" in manifest
			? "projection_type"
			: "projectionType" in manifest
				? "projectionType"
				: null;
	const versionField =
		"projection_version" in manifest
			? "projection_version"
			: "projectionVersion" in manifest
				? "projectionVersion"
				: null;
	const checkpointField =
		"rebuild_checkpoint" in manifest
			? "rebuild_checkpoint"
			: "rebuildCheckpoint" in manifest
				? "rebuildCheckpoint"
				: null;
	for (const field of ["schemaVersion", "projectionId", "sourceHash", "outputHash"]) {
		if (!(field in manifest)) {
			errors.push(`missing required field "${field}"`);
		}
	}
	for (const [field, resolved] of [
		["projection_type", typeField],
		["projection_version", versionField],
		["rebuild_checkpoint", checkpointField],
	]) {
		if (resolved === null) {
			errors.push(`missing required field "${field}"`);
		}
	}
	if (manifest.schemaVersion && manifest.schemaVersion !== SCHEMA_VERSION) {
		errors.push(
			`unsupported schemaVersion "${manifest.schemaVersion}" (expected "${SCHEMA_VERSION}")`,
		);
	}
	const projectionType = manifest[typeField];
	if (projectionType && !PROJECTION_TYPES.includes(projectionType)) {
		errors.push(`unknown projection_type "${projectionType}"`);
	}
	if (manifest.projectionId && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(manifest.projectionId)) {
		errors.push(`projectionId "${manifest.projectionId}" must be kebab-case`);
	}
	const projectionVersion = manifest[versionField];
	if (
		projectionVersion !== undefined &&
		(!Number.isInteger(projectionVersion) || projectionVersion < 1)
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
	// F049 ticket 05 (#222): rebuild receipts record the projection rule
	// versions they were built under. Optional and, when present, a map of
	// rule name → positive integer version.
	if (manifest.projection_rule_versions !== undefined) {
		const versions = manifest.projection_rule_versions;
		if (versions === null || typeof versions !== "object" || Array.isArray(versions)) {
			errors.push("projection_rule_versions must be an object of rule name → version");
		} else {
			for (const [rule, version] of Object.entries(versions)) {
				if (!Number.isInteger(version) || version < 1) {
					errors.push(`projection_rule_versions.${rule} must be an integer >= 1`);
				}
			}
		}
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Build a projection output from canonical state via a builder function.
 * @param {string} targetRoot - Repository root.
 * @param {string} projectionType - One of PROJECTION_TYPES.
 * @param {(state: {artifacts: Array<object>, checkpoint: string}) => object} builder
 * @param {object} [options]
 * @param {object|null} [options.manifestFields] - Extra receipt fields merged
 *        into the manifest (e.g. projection_rule_versions for the
 *        Governance Graph's artifact layer).
 * @returns {{ok: boolean, manifest: object|null, output: string|null, errors: string[], code: string|null}}
 */
function buildProjection(targetRoot, projectionType, builder, { manifestFields = null } = {}) {
	if (!PROJECTION_TYPES.includes(projectionType)) {
		return {
			ok: false,
			manifest: null,
			output: null,
			errors: [`unknown projection type "${projectionType}"`],
			code: null,
		};
	}
	try {
		const state = canonicalState(targetRoot, projectionType);
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
			...(manifestFields || {}),
		};
		const validation = validateProjectionManifest(manifest);
		if (!validation.valid) {
			return { ok: false, manifest: null, output: null, errors: validation.errors, code: null };
		}
		return { ok: true, manifest, output, errors: [], code: null };
	} catch (err) {
		// Fail closed, never partial: a source the projection cannot verify
		// (e.g. a corrupt Canonical Artifact store) fails the whole rebuild —
		// nothing is written and the typed code rides the result.
		return {
			ok: false,
			manifest: null,
			output: null,
			errors: [err.message],
			code: err.amberCode || null,
		};
	}
}

/**
 * Rebuild a projection: build output, write manifest + output.
 * @param {string} targetRoot - Repository root.
 * @param {string} projectionType - One of PROJECTION_TYPES.
 * @param {(state: object) => object} builder
 * @param {object} [options] - See buildProjection.
 * @returns {{ok: boolean, manifest: object|null, manifestPath: string|null, outputPath: string|null, errors: string[], code: string|null}}
 */
function rebuildProjection(targetRoot, projectionType, builder, options = {}) {
	const built = buildProjection(targetRoot, projectionType, builder, options);
	if (!built.ok) {
		return {
			ok: false,
			manifest: null,
			manifestPath: null,
			outputPath: null,
			errors: built.errors,
			code: built.code,
		};
	}
	const dir = projectionsDir(targetRoot);
	fs.mkdirSync(dir, { recursive: true });
	const manifestPath = projectionManifestPath(targetRoot, projectionType);
	const outputPath = path.join(dir, `${projectionType}.output.json`);
	fs.writeFileSync(manifestPath, JSON.stringify(built.manifest, null, 2) + "\n", "utf8");
	fs.writeFileSync(outputPath, built.output, "utf8");
	return {
		ok: true,
		manifest: built.manifest,
		manifestPath,
		outputPath,
		errors: [],
		code: null,
	};
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
	let state;
	try {
		state = canonicalState(targetRoot, projectionType);
	} catch (err) {
		// Fail closed: a source the status check cannot verify (e.g. a
		// corrupt Canonical Artifact store under the Governance Graph's
		// source) means the projection cannot be certified current — report
		// the typed failure, never a guessed "current".
		return {
			ok: false,
			code: err.amberCode || "AMBER_E_PROJECTION_DRIFT",
			detail: `canonical source unreadable: ${err.message}`,
			manifest,
		};
	}
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
	PROJECTION_SOURCES,
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
