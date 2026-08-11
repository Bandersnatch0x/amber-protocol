"use strict";

// Coverage for buildMigrationAssistant — the migration-readiness signal in
// `maintenance inspect`. Its branching (`needed` when the profile differs OR the
// installed version is behind the latest) was untested. A real lock is created
// via install; a custom registry drives each comparison branch.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { installTeamDistribution } = require("../scripts/lib/core/team");
const { buildMigrationAssistant } = require("../scripts/lib/core/maintenance");

const ROOT = path.resolve(__dirname, "..");
const REGISTRY = path.join(ROOT, "registry", "amber-protocol.registry.json");
const DEFAULT_PROFILE = "profiles/default.profile.json";

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "migration-assistant-"));
}

function installed() {
	const target = tempTarget();
	installTeamDistribution(target, { registry: REGISTRY, version: "1.0.0" });
	return target;
}

test("migration is needed (with an install command) when no team is installed", () => {
	const result = buildMigrationAssistant(tempTarget(), {
		versions: { "2.0.0": { profile: DEFAULT_PROFILE } },
	});
	assert.equal(result.needed, true);
	assert.match(result.reason, /not installed/i);
	assert.match(result.nextCommand, /team install .*2\.0\.0/);
});

test("no migration is needed at the latest version with a matching profile", () => {
	const result = buildMigrationAssistant(installed(), {
		versions: { "1.0.0": { profile: DEFAULT_PROFILE } },
	});
	assert.equal(result.needed, false);
	assert.equal(result.currentProfile, DEFAULT_PROFILE);
});

test("migration is needed when the installed version is behind the latest", () => {
	const result = buildMigrationAssistant(installed(), {
		versions: {
			"1.0.0": { profile: DEFAULT_PROFILE },
			"2.0.0": { profile: DEFAULT_PROFILE },
		},
	});
	assert.equal(result.needed, true);
});

test("migration is needed when the latest profile differs from the installed one", () => {
	const result = buildMigrationAssistant(installed(), {
		versions: { "1.0.0": { profile: "profiles/other.profile.json" } },
	});
	assert.equal(result.needed, true);
	assert.equal(result.currentProfile, DEFAULT_PROFILE);
	assert.equal(result.targetProfile, "profiles/other.profile.json");
});
