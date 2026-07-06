const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { SCHEMA_VERSION } = require("./schema-version-checker");
const { writeJson } = require("./core/fs-utils");

const schemaPath = path.join(
	__dirname,
	"../../schemas/session-manifest.schema.json",
);
let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (e) {
  throw new Error(
    `Failed to load session manifest schema from ${schemaPath}: ${e.message}. ` +
    "Re-run 'node scripts/amber.js init' to restore missing schema files.",
  );
}

const ajv = new Ajv();
addFormats(ajv);
const validate = ajv.compile(schema);

function createManifest({ route, goal, budget }) {
	const now = new Date().toISOString();
	return {
		sessionId: crypto.randomUUID(),
		schemaVersion: SCHEMA_VERSION,
		createdAt: now,
		updatedAt: now,
		route,
		goal,
		status: "created",
		completedStages: [],
		...(budget != null && { budget: { total: budget, used: 0 } }),
	};
}

function validateManifest(manifest) {
	const valid = validate(manifest);
	if (!valid) {
		return {
			valid: false,
			errors: validate.errors.map((e) => `${e.instancePath} ${e.message}`),
		};
	}
	return { valid: true, errors: [] };
}

// Read one session manifest by its session directory. Returns
// { manifest, sessionDir, manifestPath } on success,
// { manifest: null, sessionDir, manifestPath, corrupt: true } when the file is
// present but unparseable (half-written), or null when absent.
function readSessionManifest(sessionDir) {
	const manifestPath = path.join(sessionDir, "manifest.json");
	if (!fs.existsSync(manifestPath)) {
		return null;
	}
	try {
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		return { manifest, sessionDir, manifestPath };
	} catch {
		return { manifest: null, sessionDir, manifestPath, corrupt: true };
	}
}

// Enumerate every session manifest under sessionsDir, newest first. Corrupt
// manifests are skipped so one bad file cannot crash enumeration. [] when the
// dir is absent or empty.
function readAllSessionManifests(sessionsDir) {
	if (!fs.existsSync(sessionsDir)) {
		return [];
	}
	return fs
		.readdirSync(sessionsDir)
		.filter((name) => fs.existsSync(path.join(sessionsDir, name, "manifest.json")))
		.map((name) => {
			try {
				return JSON.parse(
					fs.readFileSync(path.join(sessionsDir, name, "manifest.json"), "utf8"),
				);
			} catch {
				return null;
			}
		})
		.filter(Boolean)
		.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Persist a session manifest, stamping updatedAt immutably. Replaces the
// hand-rolled `fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))`
// that 5 call sites used (bypassing writeJson). Does not mutate the input.
// Returns the persisted manifest.
function writeSessionManifest(sessionDir, manifest) {
	const persisted = { ...manifest, updatedAt: new Date().toISOString() };
	writeJson(path.join(sessionDir, "manifest.json"), persisted);
	return persisted;
}

module.exports = {
	createManifest,
	validateManifest,
	readSessionManifest,
	readAllSessionManifests,
	writeSessionManifest,
};
