"use strict";

// SCHEMA_VERSION is the data-contract version for session manifests. It is
// intentionally decoupled from package.json's version: release-candidate bumps
// (e.g. rc.1 -> rc.2) do not change the manifest format, so the contract stays
// fixed until the format itself changes. Keep this value in sync with the
// `schemaVersion` const in schemas/session-manifest.schema.json.
const SCHEMA_VERSION = "1.0.0-rc.1";
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
