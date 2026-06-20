const Ajv = require("ajv");
const fs = require("fs");
const path = require("path");

const schemaPath = path.join(__dirname, "../../schemas/route.schema.json");
let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (e) {
  throw new Error(
    `Failed to load route schema from ${schemaPath}: ${e.message}. ` +
    "Re-run 'node scripts/amber.js init' to restore missing schema files.",
  );
}

const ajv = new Ajv();
const validate = ajv.compile(schema);

function validateRoute(routeData) {
	const valid = validate(routeData);
	if (!valid) {
		return {
			valid: false,
			errors: validate.errors.map((e) => `${e.instancePath} ${e.message}`),
		};
	}
	return { valid: true, errors: [] };
}

module.exports = validateRoute;
