"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	resolveSessionFeature,
	readPlanFeature,
} = require("../../scripts/lib/core/feature-attribution");
const { mkTarget, writeJson } = require("../helpers/harness");

test("readPlanFeature returns the feature named in the plan header", () => {
	const dir = mkTarget("plan-feature");
	writeJson(dir, "docs/plans/F002-slice.md", {});
	const plan = path.join(dir, "docs", "plans", "F002-slice.md");
	fs.writeFileSync(plan, "# Plan\n\nFeature: F002\n\n## High Level Design\n\n- x\n");
	assert.equal(readPlanFeature(dir, "docs/plans/F002-slice.md"), "F002");
});

test("readPlanFeature returns null for a missing plan or missing header", () => {
	const dir = mkTarget("plan-null");
	assert.equal(readPlanFeature(dir, "docs/plans/nope.md"), null);
	writeJson(dir, "docs/plans/F001-slice.md", {});
	fs.writeFileSync(
		path.join(dir, "docs", "plans", "F001-slice.md"),
		"# Plan\n\nNo feature header here.\n",
	);
	assert.equal(readPlanFeature(dir, "docs/plans/F001-slice.md"), null);
});

test("resolveSessionFeature returns the session manifest's feature", () => {
	const dir = mkTarget("session-feature");
	// sessions live under the amber state dir (session-manifest layout)
	const sessionsDir = path.join(dir, ".amber", "sessions", "sess-1");
	fs.mkdirSync(sessionsDir, { recursive: true });
	fs.writeFileSync(
		path.join(sessionsDir, "manifest.json"),
		JSON.stringify({
			sessionId: "sess-1",
			schemaVersion: "1.0.0",
			createdAt: "2026-08-01T00:00:00Z",
			updatedAt: "2026-08-01T00:00:00Z",
			route: { id: "feature-standard", version: "1.0.0" },
			goal: "x",
			feature: "F002",
			status: "created",
			completedStages: [],
		}),
	);
	assert.equal(resolveSessionFeature(dir, "sess-1"), "F002");
});

test("resolveSessionFeature returns null for an unknown session", () => {
	const dir = mkTarget("session-null");
	assert.equal(resolveSessionFeature(dir, "no-such-session"), null);
});
