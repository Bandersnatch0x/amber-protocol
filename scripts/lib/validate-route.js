const { compileSchema } = require("./core/schema-contract");

// Compiled at module scope so a broken schema install throws at require time,
// not on first validation.
const validate = compileSchema("route");

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
