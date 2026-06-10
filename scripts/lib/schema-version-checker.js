"use strict";

const path = require("path");
const fs = require("fs");

const packageJson = JSON.parse(
	fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8"),
);
const SCHEMA_VERSION = packageJson.version;
const SUPPORTED_VERSIONS = [SCHEMA_VERSION];

function checkSchemaVersion(manifest) {
	if (!manifest.schemaVersion) {
		return {
			valid: false,
			error:
				"Schema version missing. Run 'harness migrate' to upgrade this session.",
		};
	}

	if (!SUPPORTED_VERSIONS.includes(manifest.schemaVersion)) {
		return {
			valid: false,
			error: `Unsupported schema version: ${manifest.schemaVersion}. Supported versions: ${SUPPORTED_VERSIONS.join(", ")}. Run 'harness migrate' to upgrade.`,
		};
	}

	return { valid: true };
}

module.exports = { checkSchemaVersion, SUPPORTED_VERSIONS, SCHEMA_VERSION };
