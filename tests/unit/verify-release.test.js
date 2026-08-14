"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	stableTags,
	findUnpushedTags,
	findGhostTags,
	collectGhostReports,
} = require("../../scripts/verify-release");

test("stableTags keeps vX.Y.Z and drops prerelease/garbage refs", () => {
	assert.deepEqual(stableTags(["v1.0.0", "v1.0.0-rc.1", "v1.0.0^{}", "imgbot", "v2.10.3"]), [
		"v1.0.0",
		"v2.10.3",
	]);
});

// Regression #46: the actual v1.3.1 incident — tag created locally,
// never pushed, publish never fired.
test("findUnpushedTags flags a local-only tag (v1.3.1 incident)", () => {
	const local = ["v1.2.0", "v1.3.0", "v1.3.1", "v1.3.2"];
	const remote = ["v1.2.0", "v1.3.0", "v1.3.2"];
	assert.deepEqual(findUnpushedTags(local, remote), ["v1.3.1"]);
});

test("findUnpushedTags ignores prerelease-only local tags", () => {
	assert.deepEqual(findUnpushedTags(["v1.0.0-rc.1"], []), []);
});

test("findGhostTags flags a remote tag missing from the registry", () => {
	const remote = ["v1.3.0", "v1.3.1", "v1.3.2"];
	const registry = ["1.3.2", "1.3.0", "1.2.0", "1.1.0"];
	assert.deepEqual(findGhostTags(remote, registry), ["v1.3.1"]);
});

// v1.0.0/v1.0.1 predate the publish workflow — they must not be flagged,
// or the check is permanently red and gets ignored.
test("findGhostTags exempts tags older than the earliest published version", () => {
	const remote = ["v1.0.0", "v1.0.1", "v1.1.0", "v1.3.2"];
	const registry = ["1.3.2", "1.1.0"];
	assert.deepEqual(findGhostTags(remote, registry), []);
});

test("findGhostTags is clean when the registry is empty (pre-first-release)", () => {
	assert.deepEqual(findGhostTags(["v1.0.0"], []), []);
});

test("all-published state is clean on both surfaces", () => {
	const tags = ["v1.1.0", "v1.2.0", "v1.3.0", "v1.3.2"];
	assert.deepEqual(findUnpushedTags(tags, tags), []);
	assert.deepEqual(findGhostTags(tags, ["1.1.0", "1.2.0", "1.3.0", "1.3.2"]), []);
});

test("collectGhostReports flags a missing DSH version even when the main package exists", () => {
	assert.deepEqual(
		collectGhostReports(
			["v1.5.1", "v1.6.0"],
			[
				{ name: "amber-protocol", versions: ["1.5.1", "1.6.0"] },
				{ name: "dsh-amber-protocol", versions: ["1.5.1"] },
			],
		),
		[{ tag: "v1.6.0", package: "dsh-amber-protocol" }],
	);
});

test("collectGhostReports flags a missing main package even when DSH exists", () => {
	assert.deepEqual(
		collectGhostReports(
			["v1.6.0"],
			[
				{ name: "amber-protocol", versions: ["1.5.1"] },
				{ name: "dsh-amber-protocol", versions: ["1.5.1", "1.6.0"] },
			],
		),
		[{ tag: "v1.6.0", package: "amber-protocol" }],
	);
});

test("collectGhostReports is clean when both npmjs packages match the tag", () => {
	assert.deepEqual(
		collectGhostReports(
			["v1.6.0"],
			[
				{ name: "amber-protocol", versions: ["1.6.0"] },
				{ name: "dsh-amber-protocol", versions: ["1.6.0"] },
			],
		),
		[],
	);
});
