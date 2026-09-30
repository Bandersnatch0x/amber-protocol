"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

const {
	parseConventional,
	hasBreakingFooter,
	groupCommits,
	formatReleaseSection,
	getPackageVersion,
	updateChangelogFile,
	generateChangelog,
} = require("../../scripts/changelog");

function makeTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-changelog-"));
}

function writeTempPackage(dir, version) {
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name: "amber-protocol", version }),
	);
}

function writeTempChangelog(dir, initial = "") {
	const content =
		initial ||
		`# Changelog

All notable changes...

## [1.3.2] - 2026-07-13

### Fixed
- something previous
`;
	fs.writeFileSync(path.join(dir, "CHANGELOG.md"), content);
}

test("parseConventional handles standard types, scopes, and breaking", () => {
	assert.deepEqual(parseConventional("feat: add foo"), {
		type: "feat",
		scope: null,
		breaking: false,
		subject: "add foo",
	});
	assert.deepEqual(parseConventional("fix(release): terminal assertion (#46)"), {
		type: "fix",
		scope: "release",
		breaking: false,
		subject: "terminal assertion (#46)",
	});
	assert.deepEqual(parseConventional("feat(api)!: breaking change"), {
		type: "feat",
		scope: "api",
		breaking: true,
		subject: "breaking change",
	});
	assert.deepEqual(parseConventional("chore(deps): bump foo"), {
		type: "chore",
		scope: "deps",
		breaking: false,
		subject: "bump foo",
	});
	// non-conventional falls to other
	assert.deepEqual(parseConventional("random commit message"), {
		type: "other",
		scope: null,
		breaking: false,
		subject: "random commit message",
	});
});

test("extractReference pulls (#123) from subject or body", () => {
	// indirect: exercised via groupCommits below
});

test("hasBreakingFooter detects the BREAKING CHANGE footer in either form", () => {
	assert.equal(hasBreakingFooter("BREAKING CHANGE: drops old API"), true);
	assert.equal(hasBreakingFooter("BREAKING-CHANGE: behavior altered"), true);
	// footer must be at a line start
	assert.equal(hasBreakingFooter("see BREAKING CHANGE: maybe"), false);
	// prose body without the footer token does not trigger
	assert.equal(hasBreakingFooter("This breaks nothing in the public API."), false);
	assert.equal(hasBreakingFooter(""), false);
});

test("parseConventional flags breaking via body footer, not just subject", () => {
	// clean subject + body footer => breaking (#52)
	assert.equal(parseConventional("feat: add foo", "BREAKING CHANGE: drops old API").breaking, true);
	// hyphen-variant footer
	assert.equal(parseConventional("fix: patch", "BREAKING-CHANGE: behavior altered").breaking, true);
	// prose body without footer syntax => NOT breaking (no false trigger)
	assert.equal(
		parseConventional("feat: add foo", "This breaks nothing in the public API.").breaking,
		false,
	);
	// single-arg call (no body) still works as before
	assert.equal(parseConventional("feat: add foo").breaking, false);
	assert.equal(parseConventional("feat!: x").breaking, true);
});

test("parseConventional does NOT flag breaking on a descriptive subject mentioning BREAKING", () => {
	// v1.3.3 dogfood: "detect BREAKING CHANGE in footer" is a description, not
	// a breaking marker — only `!` or a body footer signals breaking.
	assert.equal(
		parseConventional("feat(changelog): detect BREAKING CHANGE in commit body footer (#52)")
			.breaking,
		false,
	);
	assert.equal(parseConventional("fix: handle BREAKING changes").breaking, false);
	// `!` still wins even if the subject also mentions breaking
	assert.equal(parseConventional("feat(api)!: BREAKING change to API").breaking, true);
});

test("groupCommits maps types to sections and preserves refs + scopes", () => {
	const commits = [
		{ subject: "feat: new governance lifecycle", body: "" },
		{ subject: "fix(policy): harden verify (#40)", body: "" },
		{ subject: "docs: update release process", body: "See (#47)" },
		{ subject: "refactor(lib): extract pipeline", body: "" },
		{ subject: "feat(api)!: new flag", body: "" },
		{ subject: "feat: new endpoint", body: "BREAKING CHANGE: removed v1\n\nLong explanation." },
	];
	const g = groupCommits(commits);
	assert.ok(g.Added.length >= 1);
	assert.ok(g.Fixed.some((e) => e.includes("harden verify") && e.includes("#40")));
	assert.ok(g.Changed.some((e) => e.includes("update release process") && e.includes("#47")));
	assert.ok(g.Changed.some((e) => e.includes("**BREAKING**")));
	// body-footer breaking (clean subject, footer in body) lands in Changed with the marker (#52)
	assert.ok(
		g.Changed.some((e) => e.includes("**BREAKING**") && e.includes("new endpoint")),
		"body-footer breaking commit must be marked BREAKING in Changed",
	);
});

test("groupCommits skips release-bookkeeping commits", () => {
	const commits = [
		{ subject: "chore: bump version to 1.6.0", body: "" },
		{ subject: "chore(release): v1.3.2", body: "" },
		{ subject: "chore: bump version to v2.0.0", body: "" },
		{ subject: "fix: real change", body: "" },
		// non-version chores still appear
		{ subject: "chore(deps): refresh dev tools", body: "" },
	];
	const g = groupCommits(commits);
	const flat = [...g.Added, ...g.Fixed, ...g.Changed, ...g.Other].join("\n");
	assert.ok(!/bump version to/.test(flat), "version bump chores must not be listed");
	assert.ok(!/v1\.3\.2/.test(flat), "release-cut chores must not be listed");
	assert.ok(g.Fixed.some((e) => e.includes("real change")));
	assert.ok(g.Changed.some((e) => e.includes("refresh dev tools")));
});

// Internal handles are how this repository talks to itself, and an unlinked
// `(F081)` is not something an outside reader can follow. Pull numbers are the
// citation the changelog convention promises — and the only one a reader can
// resolve without repository context — so they stay.
// A subject can carry more than one pull citation. Taking the first and stripping only
// the trailing one duplicated it and dropped the rest — the real subject
// `… fixture family M0 (#160) (#180)` rendered as `(#160) (#160)` (CHANGELOG.md:144).
test("groupCommits keeps every pull number and never duplicates one", () => {
	const g = groupCommits([
		{
			subject: "feat(fixtures): deterministic governance fixture family M0 (#160) (#180)",
			body: "",
		},
		{ subject: "fix(cli): a citation mid-sentence (#42) and prose after it", body: "" },
	]);
	const all = [...g.Added, ...g.Fixed, ...g.Changed, ...g.Other];
	const first = all.find((e) => e.includes("fixture family M0"));
	assert.match(first, /#160/);
	assert.match(first, /#180/, "the second citation survives");
	assert.equal((first.match(/#160/g) || []).length, 1, "the first is not duplicated");
	const second = all.find((e) => e.includes("citation mid-sentence"));
	assert.match(second, /#42/);
	assert.doesNotMatch(second, /\(#42\) and/, "the citation is not left inside the sentence");
});

// The two boundaries the rule is honest about rather than clever about.
test("groupCommits documents its handle-rule boundaries", () => {
	const g = groupCommits([
		{ subject: "fix(x): a nested parenthetical (see (F081)) stays", body: "" },
		{ subject: "fix(y): mixed (F081; the prose goes too)", body: "" },
	]);
	const all = [...g.Added, ...g.Fixed, ...g.Changed, ...g.Other].join("\n");
	assert.match(all, /nested parenthetical \(see \(F081\)\) stays/, "nesting is not guessed at");
	assert.ok(
		/\(F081; the prose goes too\)/.test(all) === false,
		"a handle-bearing parenthetical is dropped whole",
	);
});

test("groupCommits drops internal handles and keeps pull numbers", () => {
	const commits = [
		{ subject: "feat(harness): own governed-execution handles (F081)", body: "" },
		{ subject: "fix(web): re-anchor the contract (F063 #128)", body: "" },
		{ subject: "chore: migrate live state (issues/0156, closes 0153 D1)", body: "" },
		{ subject: "docs(adr): record the boundary (ADR-0019 D4)", body: "" },
		{ subject: "fix(cli): keep the sentence (not a citation)", body: "" },
		{ subject: "feat(api): new endpoint (#52)", body: "" },
	];
	const g = groupCommits(commits);
	const all = [...g.Added, ...g.Fixed, ...g.Changed, ...g.Other];
	const joined = all.join("\n");

	assert.ok(
		all.some((e) => e.includes("own governed-execution handles") && !e.includes("F081")),
		"a spec id is dropped",
	);
	assert.ok(
		all.some(
			(e) => e.includes("re-anchor the contract") && e.includes("#128") && !e.includes("F063"),
		),
		"the pull number survives while the spec id goes",
	);
	assert.ok(!/issues\/0156/.test(joined), "an issue path is dropped");
	assert.ok(!/ADR-0019/.test(joined), "an ADR handle is dropped");
	assert.ok(
		all.some((e) => e.includes("keep the sentence (not a citation)")),
		"a parenthetical that is not a citation is left alone",
	);
	assert.ok(
		all.some((e) => e.includes("new endpoint") && e.includes("#52")),
		"a pull-number citation is unchanged",
	);
});

test("formatReleaseSection produces Keep a Changelog style", () => {
	const groups = {
		Added: ["governance lifecycle"],
		Fixed: ["ghost tag detection (#46)"],
		Changed: ["**BREAKING** new surface"],
		Other: [],
	};
	const sec = formatReleaseSection("1.3.3", "2026-07-14", groups);
	assert.ok(sec.startsWith("## [1.3.3] - 2026-07-14"));
	assert.ok(sec.includes("### Added"));
	assert.ok(sec.includes("### Fixed"));
	assert.ok(sec.includes("### Changed"));
	assert.ok(sec.includes("**BREAKING**"));
	assert.ok(sec.includes("- governance lifecycle"));
	// headings are followed by a blank line so generated sections stay
	// inside Prettier's markdown format without post-processing
	assert.ok(sec.includes("### Added\n\n- governance lifecycle"));
});

test("getPackageVersion reads from a fixture", () => {
	const dir = makeTempDir();
	writeTempPackage(dir, "9.9.9");
	const v = getPackageVersion(dir);
	assert.equal(v, "9.9.9");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("updateChangelogFile inserts new top section and supports re-run replace (with explicit path)", () => {
	const dir = makeTempDir();
	writeTempChangelog(dir);
	const changelogPath = path.join(dir, "CHANGELOG.md");

	// simulate what generate would produce
	const sectionV133 = `## [1.3.3] - 2026-07-14

### Added
- automated changelog generator

### Fixed
- release verify ghost (#46)

`;

	updateChangelogFile("1.3.3", sectionV133, changelogPath);

	let content = fs.readFileSync(changelogPath, "utf8");
	assert.ok(content.includes("## [1.3.3] - 2026-07-14"));
	assert.ok(content.includes("automated changelog generator"));
	// original previous section still present
	assert.ok(content.includes("## [1.3.2]"));

	// re-run replace for same version (idempotent)
	const updatedSection = sectionV133.replace(
		"automated changelog generator",
		"zero-dep changelog script",
	);
	updateChangelogFile("1.3.3", updatedSection, changelogPath);
	content = fs.readFileSync(changelogPath, "utf8");
	assert.ok(content.includes("zero-dep changelog script"));
	// ensure only one 1.3.3 header
	const count = (content.match(/## \[1.3.3\]/g) || []).length;
	assert.equal(count, 1);

	fs.rmSync(dir, { recursive: true, force: true });
});

test("generateChangelog (dryRun) returns correct shape and does not mutate", () => {
	const dir = makeTempDir();
	writeTempPackage(dir, "1.3.3");
	writeTempChangelog(dir);

	// We cannot easily fake git history here without a real repo; exercise the non-git path
	// by calling format/group directly and verify generateChangelog shape.
	const res = generateChangelog({ root: dir, dryRun: true, version: "1.3.3" });
	assert.equal(res.version, "1.3.3");
	assert.ok("section" in res);
	assert.ok("groups" in res);
	assert.ok(typeof res.commitCount === "number");

	// changelog file untouched
	const before = fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8");
	assert.ok(!before.includes("1.3.3")); // we didn't insert because dry + may have no real commits

	fs.rmSync(dir, { recursive: true, force: true });
});

test("generateChangelog null-tag path (first release / tagless repo) returns full history with commitCount > 1", () => {
	const dir = makeTempDir();
	writeTempPackage(dir, "0.0.1");
	// deliberately no CHANGELOG.md write; dryRun will not touch fs for it

	// Real git fixture: multiple commits, ZERO stable tags -> exercises the null tag fix
	execSync("git init -q", { cwd: dir, stdio: ["ignore", "ignore", "ignore"] });
	execSync('git config user.email "test@example.com"', {
		cwd: dir,
		stdio: ["ignore", "ignore", "ignore"],
	});
	execSync('git config user.name "Test User"', { cwd: dir, stdio: ["ignore", "ignore", "ignore"] });

	fs.writeFileSync(path.join(dir, "file.txt"), "v1");
	execSync('git add file.txt && git commit -q -m "feat: first commit in tagless repo"', {
		cwd: dir,
		stdio: ["ignore", "ignore", "ignore"],
	});

	fs.writeFileSync(path.join(dir, "file.txt"), "v2");
	execSync('git add file.txt && git commit -q -m "fix: second commit (#53)"', {
		cwd: dir,
		stdio: ["ignore", "ignore", "ignore"],
	});

	fs.writeFileSync(path.join(dir, "file.txt"), "v3");
	execSync('git add file.txt && git commit -q -m "docs: third commit for full history test"', {
		cwd: dir,
		stdio: ["ignore", "ignore", "ignore"],
	});

	// verify fixture precondition: no v* tags
	const tagOut = execSync('git tag -l "v*"', {
		cwd: dir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
	assert.equal(tagOut, "", "precondition: fixture repo must have no stable tags");

	const res = generateChangelog({ root: dir, dryRun: true, version: "0.0.1" });
	assert.equal(res.version, "0.0.1");
	assert.equal(res.tag, null, "should have used null tag for first-release");
	assert.ok(
		res.commitCount > 1,
		`null-tag path must return >1 commits (full history), got ${res.commitCount}`,
	);
	// ensure at least the conventional messages from early history are present (not just HEAD)
	const flat = [
		...res.groups.Added,
		...res.groups.Fixed,
		...res.groups.Changed,
		...res.groups.Other,
	].join("\n");
	assert.ok(/first commit in tagless repo/.test(flat), "must include first commit (not just HEAD)");
	assert.ok(/second commit/.test(flat), "must include middle commit from full history");

	fs.rmSync(dir, { recursive: true, force: true });
});
