const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { SCHEMA_VERSION } = require("./schema-version-checker");

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

module.exports = { createManifest, validateManifest };
