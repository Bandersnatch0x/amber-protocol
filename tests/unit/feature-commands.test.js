"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const {
	addFeature,
	recordFeatureEvidence,
	recordFeaturePaths,
	runFeatureAction,
} = require("../../scripts/lib/feature-commands");
const { localIsoDate } = require("../../scripts/lib/core/text-utils");

function tmpDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-feat-"));
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({ features: [] }, null, 2) + "\n",
	);
	return dir;
}

function readFeatures(dir) {
	return JSON.parse(fs.readFileSync(path.join(dir, "feature_list.json"), "utf8"));
}

test("addFeature stores paths array from comma-separated string", () => {
	const dir = tmpDir();
	const r = addFeature(dir, { id: "F10", title: "T", paths: "src/a,src/b" });
	assert.deepStrictEqual(r.feature.paths, ["src/a", "src/b"]);
});

test("addFeature omits paths when not provided", () => {
	const dir = tmpDir();
	const r = addFeature(dir, { id: "F11", title: "T" });
	assert.strictEqual("paths" in r.feature, false);
});

test("addFeature stores user_visible_behavior from --behavior (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, {
		id: "F12",
		title: "T",
		area: "core",
		behavior: "User sees a clear result.",
	});
	assert.strictEqual(r.feature.user_visible_behavior, "User sees a clear result.");
	assert.deepStrictEqual(r.errors, []);
});

test("addFeature stores verification array from repeatable --verify (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, {
		id: "F13",
		title: "T",
		area: "core",
		behavior: "User sees X.",
		verify: ["npm test", "npm run build"],
	});
	assert.deepStrictEqual(r.feature.verification, ["npm test", "npm run build"]);
	assert.deepStrictEqual(r.errors, []);
	assert.deepStrictEqual(r.warnings, []);
});

test("addFeature accepts comma-separated --verify string (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, {
		id: "F14",
		title: "T",
		area: "core",
		behavior: "User sees X.",
		verify: "npm test,npm run build",
	});
	assert.deepStrictEqual(r.feature.verification, ["npm test", "npm run build"]);
});

test("addFeature warns when fields doctor requires are missing (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, { id: "F15", title: "T", area: "core" });
	const joined = (r.warnings || []).join(" ");
	assert.ok(
		joined.includes("--behavior"),
		`expected warning to mention --behavior, got: ${joined}`,
	);
	assert.ok(joined.includes("--verify"), `expected warning to mention --verify, got: ${joined}`);
});

test("addFeature produces a doctor-valid feature when all flags are passed (#75)", () => {
	const dir = tmpDir();
	const r = addFeature(dir, {
		id: "F16",
		title: "T",
		area: "core",
		behavior: "User sees X.",
		verify: ["npm test"],
	});
	assert.deepStrictEqual(r.warnings, []);
	const { validateFeatureListData } = require("../../scripts/lib/core/validators");
	const v = validateFeatureListData({ features: [r.feature] });
	assert.deepStrictEqual(v.errors, []);
});

// ── recordFeaturePaths (`amber feature paths`, F024/#121) ────────────────────

test("recordFeaturePaths appends new paths after existing ones, order preserved (#121)", () => {
	const dir = tmpDir();
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify(
			{ features: [{ id: "F20", title: "T", status: "passing", evidence: [], paths: ["src/a"] }] },
			null,
			2,
		) + "\n",
	);
	const r = recordFeaturePaths(dir, {
		feature: "F20",
		paths: ["src/new.js, docs/specs/x.md", "src/last.js"],
	});
	assert.deepStrictEqual(r.errors, []);
	assert.deepStrictEqual(r.added, ["src/new.js", "docs/specs/x.md", "src/last.js"]);
	assert.deepStrictEqual(readFeatures(dir).features[0].paths, [
		"src/a",
		"src/new.js",
		"docs/specs/x.md",
		"src/last.js",
	]);
});

test("recordFeaturePaths creates the paths array when absent (#121)", () => {
	const dir = tmpDir();
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify(
			{ features: [{ id: "F21", title: "T", status: "passing", evidence: [] }] },
			null,
			2,
		) + "\n",
	);
	const r = recordFeaturePaths(dir, { feature: "F21", paths: ["src/first.js"] });
	assert.deepStrictEqual(r.errors, []);
	assert.deepStrictEqual(readFeatures(dir).features[0].paths, ["src/first.js"]);
});

test("recordFeaturePaths skips exact duplicates as a byte-identical no-op with visible text (#121)", () => {
	const dir = tmpDir();
	const feature = {
		id: "F22",
		title: "T",
		status: "passing",
		evidence: [],
		paths: ["src/a", "docs/specs/keep.md"],
	};
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({ features: [feature] }, null, 2) + "\n",
	);
	const before = fs.readFileSync(path.join(dir, "feature_list.json"), "utf8");
	const r = runFeatureAction("paths", dir, {
		feature: "F22",
		paths: ["src/a", "docs/specs/keep.md"],
	});
	assert.deepStrictEqual(r.errors, []);
	assert.match(r.text, /already booked/);
	assert.match(r.text, /Skipped as duplicates: 2/);
	assert.match(r.text, /Total booked paths: 2/);
	assert.strictEqual(
		fs.readFileSync(path.join(dir, "feature_list.json"), "utf8"),
		before,
		"all-duplicate re-run writes nothing",
	);
});

test("recordFeaturePaths without --path is a read-only inspection listing current paths (#121)", () => {
	const dir = tmpDir();
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify(
			{
				features: [
					{ id: "F23", title: "T", status: "passing", evidence: [], paths: ["src/a", "src/b"] },
				],
			},
			null,
			2,
		) + "\n",
	);
	const before = fs.readFileSync(path.join(dir, "feature_list.json"), "utf8");
	const r = runFeatureAction("paths", dir, { feature: "F23" });
	assert.deepStrictEqual(r.errors, []);
	assert.deepStrictEqual(r.warnings, []);
	assert.match(r.text, /Paths for F23 \(2\):/);
	assert.match(r.text, /- src\/a/);
	assert.match(r.text, /- src\/b/);
	assert.strictEqual(
		fs.readFileSync(path.join(dir, "feature_list.json"), "utf8"),
		before,
		"inspection writes nothing",
	);
});

test("recordFeaturePaths inspection for a feature with no paths yet is visible text, not an error (#121)", () => {
	const dir = tmpDir();
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify(
			{ features: [{ id: "F24", title: "T", status: "passing", evidence: [] }] },
			null,
			2,
		) + "\n",
	);
	const r = runFeatureAction("paths", dir, { feature: "F24" });
	assert.deepStrictEqual(r.errors, []);
	assert.match(r.text, /No paths booked for feature: F24/);
});

test("recordFeaturePaths errors on a nonexistent feature and leaves the file byte-identical (#121)", () => {
	const dir = tmpDir();
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify(
			{ features: [{ id: "F25", title: "T", status: "passing", evidence: [] }] },
			null,
			2,
		) + "\n",
	);
	const before = fs.readFileSync(path.join(dir, "feature_list.json"), "utf8");
	const r = recordFeaturePaths(dir, { feature: "F404", paths: ["src/x.js"] });
	assert.ok(r.errors.length > 0);
	assert.match(r.errors.join("\n"), /F404/);
	assert.strictEqual(fs.readFileSync(path.join(dir, "feature_list.json"), "utf8"), before);
});

test("recordFeaturePaths requires --feature (#121)", () => {
	const dir = tmpDir();
	const r = recordFeaturePaths(dir, { paths: ["src/x.js"] });
	assert.ok(r.errors.length > 0);
	assert.match(r.errors.join("\n"), /requires --feature/);
});

test("recordFeaturePaths error results render no text (no booking summary beside an ERROR) (#121)", () => {
	const dir = tmpDir();
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify(
			{ features: [{ id: "F30", title: "T", status: "passing", evidence: [] }] },
			null,
			2,
		) + "\n",
	);
	const ghost = runFeatureAction("paths", dir, { feature: "F404", paths: ["src/x.js"] });
	assert.ok(ghost.errors.length > 0);
	assert.strictEqual(ghost.text, "");
	const noId = runFeatureAction("paths", dir, { paths: ["src/x.js"] });
	assert.ok(noId.errors.length > 0);
	assert.strictEqual(noId.text, "");
});

test("recordFeaturePaths booking text names the feature, added/skipped counts, and total (#121)", () => {
	const dir = tmpDir();
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify(
			{
				features: [{ id: "F26", title: "T", status: "passing", evidence: [], paths: ["src/a"] }],
			},
			null,
			2,
		) + "\n",
	);
	const r = runFeatureAction("paths", dir, { feature: "F26", paths: ["src/new.js", "src/a"] });
	assert.deepStrictEqual(r.errors, []);
	assert.match(r.text, /Paths booked for feature: F26/);
	assert.match(r.text, /Added: src\/new\.js \(1\)/);
	assert.match(r.text, /Skipped as duplicates: 1/);
	assert.match(r.text, /Total booked paths: 2/);
});

test("recordFeaturePaths keeps feature_list.json valid under the repo's own validator after booking (#121)", () => {
	const dir = tmpDir();
	addFeature(dir, {
		id: "F27",
		title: "T",
		area: "core",
		behavior: "User sees X.",
		verify: ["npm test"],
	});
	const { validateFeatureListData } = require("../../scripts/lib/core/validators");
	assert.deepStrictEqual(validateFeatureListData(readFeatures(dir)).errors, []);
	const r = recordFeaturePaths(dir, {
		feature: "F27",
		paths: ["src/index.js, schemas/route.schema.json"],
	});
	assert.deepStrictEqual(r.errors, []);
	assert.deepStrictEqual(
		validateFeatureListData(readFeatures(dir)).errors,
		[],
		"booking must not break validate-feature-list rules",
	);
});

test("recordFeaturePaths keeps feature_list.json Prettier-clean after booking (format:check contract)", () => {
	const dir = tmpDir();
	addFeature(dir, {
		id: "F28",
		title: "T",
		area: "core",
		behavior: "User sees X.",
		verify: ["npm test"],
	});
	const r = recordFeaturePaths(dir, { feature: "F28", paths: ["docs/specs/contract.md"] });
	assert.deepStrictEqual(r.errors, []);

	const listPath = path.join(dir, "feature_list.json");
	const after = fs.readFileSync(listPath, "utf8");
	assert.ok(after.endsWith("\n"), "trailing newline kept");
	assert.deepStrictEqual(readFeatures(dir).features[0].paths, ["docs/specs/contract.md"]);

	// The repo's CI contract is prettier --check on JSON files; run it for real.
	const prettier = spawnSync(
		process.execPath,
		[require.resolve("prettier/bin/prettier.cjs"), "--check", listPath.split(path.sep).join("/")],
		{ encoding: "utf8", cwd: path.join(__dirname, "..", "..") },
	);
	assert.equal(
		prettier.status,
		0,
		`booked file must be Prettier-clean: ${prettier.stdout}${prettier.stderr}`,
	);
	fs.rmSync(dir, { recursive: true, force: true });
});

// ── Local-day evidence stamping (F024/#118) ──────────────────────────────────

test("localIsoDate returns the LOCAL calendar day, not the UTC slice (#118)", () => {
	// Local Aug 15 00:30 in any UTC+ timezone is still Aug 14 in UTC.
	assert.equal(localIsoDate(new Date(2026, 7, 15, 0, 30)), "2026-08-15");
	// Local Aug 15 23:00 stays Aug 15 locally even where UTC has rolled over.
	assert.equal(localIsoDate(new Date(2026, 7, 15, 23, 0)), "2026-08-15");
	// Single-digit month/day are zero-padded.
	assert.equal(localIsoDate(new Date(2026, 2, 5, 12, 0)), "2026-03-05");
	// Timezone-independent oracle: en-CA locale renders local YYYY-MM-DD.
	for (const d of [new Date(2026, 7, 15, 0, 30), new Date(2026, 7, 15, 23, 0)]) {
		assert.equal(localIsoDate(d), d.toLocaleDateString("en-CA"));
	}
});

test("recordFeatureEvidence stamps the local calendar day (#118)", () => {
	const dir = tmpDir();
	addFeature(dir, { id: "F29", title: "T" });
	// Bracket the call: a slow write must not turn a midnight rollover into a
	// spurious mismatch against a single post-hoc reading.
	const before = localIsoDate();
	const r = recordFeatureEvidence(dir, { feature: "F29", command: "npm test", result: "pass" });
	const after = localIsoDate();
	assert.deepStrictEqual(r.errors, []);
	assert.match(r.entry.date, /^\d{4}-\d{2}-\d{2}$/, "date field keeps the YYYY-MM-DD shape");
	assert.ok(r.entry.date === before || r.entry.date === after, "stamped day is the local day");
	assert.equal(readFeatures(dir).features[0].evidence[0].date, r.entry.date);
});

test("feature add accepts the repeatable --path accumulator as an array (#121 regression)", () => {
	const dir = tmpDir();
	addFeature(dir, { id: "FPA", title: "T", paths: ["src/a.js", "src/b.js"] });
	assert.deepEqual(readFeatures(dir).features[0].paths, ["src/a.js", "src/b.js"]);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("feature add mixed --paths + --path keeps both spellings' values (#121 regression)", () => {
	// The CLI maps both flags onto one accumulator; neither may clobber the
	// other (the pre-fix accumulator reset a --paths string mid-argv).
	const { parseArgs } = require("../../scripts/lib/core/cli-output");
	const args = parseArgs([
		"feature",
		"add",
		"--id",
		"FPB",
		"--title",
		"T",
		"--paths",
		"src/keep.js",
		"--path",
		"src/added.js",
	]);
	assert.deepEqual(args.paths, ["src/keep.js", "src/added.js"]);

	const dir = tmpDir();
	addFeature(dir, { id: "FPB", title: "T", paths: args.paths });
	assert.deepEqual(readFeatures(dir).features[0].paths, ["src/keep.js", "src/added.js"]);
	fs.rmSync(dir, { recursive: true, force: true });
});
