const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const schemaPath = path.join(
	__dirname,
	"../../schemas/session-manifest.schema.json",
);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv();
addFormats(ajv);
const validate = ajv.compile(schema);

function createManifest({ route, goal, budget }) {
	const now = new Date().toISOString();
	return {
		sessionId: crypto.randomUUID(),
		schemaVersion: "1.0.0",
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
