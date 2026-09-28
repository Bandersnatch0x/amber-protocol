"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const pkg = require("../../package.json");
const {
	CLI_VERSION,
	AMBER_CONTROLLED_CONTENT_FILES,
	AMBER_STATE_FILES,
} = require("../../scripts/lib/core/constants");

test("CLI_VERSION tracks package.json", () => {
	assert.equal(CLI_VERSION, pkg.version);
});

test("AMBER_CONTROLLED_CONTENT_FILES holds the reference docs (no starters)", () => {
	assert.ok(AMBER_CONTROLLED_CONTENT_FILES.has("docs/wiki/glossary.md"));
	assert.ok(AMBER_CONTROLLED_CONTENT_FILES.has("docs/wiki/index.md"));
	assert.ok(AMBER_CONTROLLED_CONTENT_FILES.has("docs/wiki/agent/amber.md"));
	assert.ok(AMBER_CONTROLLED_CONTENT_FILES.has("clean-state-checklist.md"));
	// Project-authored starters are NOT controlled.
	assert.ok(!AMBER_CONTROLLED_CONTENT_FILES.has("AGENTS.md"));
	assert.ok(!AMBER_CONTROLLED_CONTENT_FILES.has("feature_list.json"));
	assert.ok(!AMBER_CONTROLLED_CONTENT_FILES.has("docs/wiki/engineering/verification.md"));
});

test("AMBER_STATE_FILES holds runtime state, never overwritten", () => {
	// Canonical location (issues/0156).
	assert.ok(AMBER_STATE_FILES.has(".amber/continuous-improvement/state.json"));
	// Legacy pre-0156 location stays in the set so provenance still tiers an
	// already-installed repo's old-location file as `state` (backward compat).
	assert.ok(AMBER_STATE_FILES.has(".workflow/continuous-improvement/state.json"));
});
