"use strict";

const SCHEMA_VERSION = "1.0.0";
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
