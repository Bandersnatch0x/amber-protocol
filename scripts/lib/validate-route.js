const Ajv = require("ajv");
const fs = require("fs");
const path = require("path");

const schemaPath = path.join(__dirname, "../../schemas/route.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

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
