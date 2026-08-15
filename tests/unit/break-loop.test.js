"use strict";

// F025 dedicated suite: break-loop post-mortem scaffold.
//
// Covers the single-source module (taxonomy, menu, sections), the scaffold
// writer (naming, header, no-overwrite refusal, argument guards), the
// validator (placeholders, ids, write-back record, verification, containment),
// the `amber break-loop` CLI surface end-to-end, and the command-registry
// wiring. Taxonomy and menu ids are compared against the exported constants —
// never hardcoded — so this suite anchors the single-source contract.

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
	BREAK_LOOP_DIR,
	PLACEHOLDER_PATTERN,
	ROOT_CAUSE_CATEGORIES,
	PREVENTION_MECHANISMS,
	POSTMORTEM_SECTIONS,
	scaffoldPostMortem,
	validatePostMortem,
} = require("../../scripts/lib/core/break-loop");
const { COMMANDS, DEFAULT_COMMANDS, COMMAND_TIERS } = require("../../scripts/lib/command-registry");

const roots = [];

function makeRoot(prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	roots.push(dir);
	return dir;
}

function postMortemDir(root) {
	return path.join(root, ...BREAK_LOOP_DIR.split("/"));
}

function listPostMortems(root) {
	const dir = postMortemDir(root);
	return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

after(() => {
	for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

// ── Single-source shape ──────────────────────────────────────────────────────

describe("break-loop single source", () => {
	it("defines exactly five root-cause categories with ids and one-line descriptions", () => {
		assert.equal(ROOT_CAUSE_CATEGORIES.length, 5);
		for (const category of ROOT_CAUSE_CATEGORIES) {
			assert.match(category.id, /^[a-z-]+$/);
			assert.equal(typeof category.description, "string");
			assert.ok(category.description.length > 10);
		}
		assert.equal(new Set(ROOT_CAUSE_CATEGORIES.map((c) => c.id)).size, 5, "ids unique");
	});

	it("defines exactly four prevention mechanisms, each with a write-back surface", () => {
		assert.equal(PREVENTION_MECHANISMS.length, 4);
		for (const mechanism of PREVENTION_MECHANISMS) {
			assert.match(mechanism.id, /^[a-z-]+$/);
			assert.equal(typeof mechanism.description, "string");
			assert.ok(mechanism.surface && mechanism.surface.length > 0);
		}
		assert.equal(new Set(PREVENTION_MECHANISMS.map((m) => m.id)).size, 4, "ids unique");
	});

	it("defines the six template sections with titles and guidance", () => {
		assert.deepEqual(
			POSTMORTEM_SECTIONS.map((section) => section.title),
			[
				"Symptom & evidence",
				"Recurrence & why previous fixes failed",
				"Root-cause classification",
				"Prevention mechanism",
				"Write-back record",
				"Verification",
			],
		);
		for (const section of POSTMORTEM_SECTIONS) {
			assert.ok(section.guidance.length > 10, `${section.title} has guidance`);
			assert.match(section.placeholder, /^<fill: .+>$/, `${section.title} placeholder marker`);
		}
	});
});

// ── Scaffold ─────────────────────────────────────────────────────────────────

describe("scaffoldPostMortem", () => {
	it("creates the file at the expected date+slug path with the header and every id rendered", () => {
		const root = makeRoot("amber-bl-scaffold-");
		const title = "Evidence dates drift UTC vs local";
		const r = scaffoldPostMortem(root, { issue: 118, title, recurrence: 2 });
		assert.deepEqual(r.errors, [], `errors: ${r.errors.join("; ")}`);
		assert.deepEqual(r.warnings, []);
		assert.ok(r.path, "returns the written path");

		// Filename: <localIsoDate>-<slugify(title)>.md — day-crossing-safe check.
		const files = listPostMortems(root);
		assert.equal(files.length, 1, "exactly one file scaffolded");
		assert.match(files[0], /^\d{4}-\d{2}-\d{2}-Evidence-dates-drift-UTC-vs-local\.md$/);
		assert.equal(fs.existsSync(r.path), true, "returned path exists on disk");

		const text = fs.readFileSync(r.path, "utf8");
		// Header front-matter: Issue / Title / Recurrence / Date.
		assert.match(text, /^Issue: 118$/m);
		assert.match(text, /^Title: Evidence dates drift UTC vs local$/m);
		assert.match(text, /^Recurrence: 2$/m);
		assert.match(text, /^Date: \d{4}-\d{2}-\d{2}$/m);
		// All six section titles, from the exported constants.
		for (const section of POSTMORTEM_SECTIONS) {
			assert.ok(text.includes(`## ${section.title}`), `section ${section.title} present`);
		}
		// Every category and mechanism id rendered from the single source.
		for (const category of ROOT_CAUSE_CATEGORIES) {
			assert.ok(text.includes(category.id), `category ${category.id} listed`);
			assert.ok(text.includes(category.description), `category ${category.id} description`);
		}
		for (const mechanism of PREVENTION_MECHANISMS) {
			assert.ok(text.includes(mechanism.id), `mechanism ${mechanism.id} listed`);
			assert.ok(text.includes(mechanism.surface), `mechanism ${mechanism.id} surface named`);
		}
		// The success text points at the validate command.
		assert.match(r.text, /break-loop validate/);
	});

	it("refuses to overwrite: the second scaffold errors naming the file and leaves it byte-identical", () => {
		const root = makeRoot("amber-bl-overwrite-");
		const args = { issue: 7, title: "Same class again", recurrence: 3 };
		assert.deepEqual(scaffoldPostMortem(root, args).errors, []);
		const first = listPostMortems(root);
		const bytes = fs.readFileSync(path.join(postMortemDir(root), first[0]), "utf8");

		const second = scaffoldPostMortem(root, args);
		assert.equal(second.errors.length, 1);
		assert.match(second.errors[0], /refusing to overwrite/i);
		assert.ok(
			second.errors[0].includes(first[0]),
			`error names the existing file: ${second.errors[0]}`,
		);
		assert.equal(listPostMortems(root).length, 1, "no duplicate scaffolded");
		assert.equal(fs.readFileSync(path.join(postMortemDir(root), first[0]), "utf8"), bytes);
	});

	it("recurrence below 2 is a visible error and nothing is written", () => {
		const root = makeRoot("amber-bl-rec1-");
		for (const recurrence of [1, 0, -2]) {
			const r = scaffoldPostMortem(root, { issue: 1, title: "t", recurrence });
			assert.equal(r.errors.length, 1, `recurrence ${recurrence} errors`);
			assert.match(r.errors.join("\n"), /--recurrence <n> with n >= 2/);
			assert.match(r.errors.join("\n"), /never auto-detects/i);
		}
		// Non-integers are refused the same way.
		for (const recurrence of ["two", 2.5, "2abc", ""]) {
			const r = scaffoldPostMortem(root, { issue: 1, title: "t", recurrence });
			assert.equal(r.errors.length, 1, `recurrence ${JSON.stringify(recurrence)} errors`);
		}
		assert.equal(fs.existsSync(postMortemDir(root)), false, "nothing written");
	});

	it("missing title (and missing issue) are visible errors and nothing is written", () => {
		const root = makeRoot("amber-bl-title-");
		const noTitle = scaffoldPostMortem(root, { issue: 5, recurrence: 2 });
		assert.equal(noTitle.errors.length, 1);
		assert.match(noTitle.errors[0], /requires --title/);
		assert.equal(fs.existsSync(postMortemDir(root)), false, "nothing written");

		const noIssue = scaffoldPostMortem(root, { title: "t", recurrence: 2 });
		assert.equal(noIssue.errors.length, 1);
		assert.match(noIssue.errors[0], /requires --issue/);
		assert.equal(fs.existsSync(postMortemDir(root)), false, "nothing written");
	});
});

// ── Validate ─────────────────────────────────────────────────────────────────

// Build a filled post-mortem by replacing the template's own placeholders —
// the same mechanical fill an operator performs, expressed against the
// scaffolded text so the test cannot drift from the template.
function fillPostMortem(text, overrides = {}) {
	const primary = overrides.primary ?? "cross-layer-drift";
	const secondary = overrides.secondary ?? "none";
	const mechanism = overrides.mechanism ?? "contract-and-anchor";
	const surface = overrides.surface ?? "docs/specs/2026-08-15-break-loop.md";
	const anchor = overrides.anchor ?? "tests/unit/break-loop.test.js anchors the marker";
	const command = overrides.command ?? "node --test tests/unit/break-loop.test.js — 0 failed";

	let filled = text;
	filled = filled.split("<fill: category id or none>").join(secondary);
	filled = filled.split("<fill: category id>").join(primary);
	filled = filled.split("<fill: mechanism id>").join(mechanism);
	filled = filled.split("<fill: path of the knowledge surface written>").join(surface);
	filled = filled.split("<fill: test file and case that anchors the rule>").join(anchor);
	filled = filled.split("<fill: runnable command plus the output it must show>").join(command);
	filled = filled.replace(/<fill:[^>]*>/g, overrides.leftover ?? "filled in by hand");
	return filled;
}

function scaffoldedFile(root, args = { issue: 118, title: "Loop returns", recurrence: 2 }) {
	const r = scaffoldPostMortem(root, args);
	assert.deepEqual(r.errors, []);
	return r.path;
}

describe("validatePostMortem", () => {
	it("the raw scaffold fails, with errors naming every unfilled section", () => {
		const root = makeRoot("amber-bl-raw-");
		const file = scaffoldedFile(root);
		const relative = path.relative(root, file).split(path.sep).join("/");
		const r = validatePostMortem(root, { file: relative });
		assert.equal(r.valid, false);
		assert.ok(r.errors.length >= POSTMORTEM_SECTIONS.length, "one error per section at least");
		const joined = r.errors.join("\n");
		for (const section of POSTMORTEM_SECTIONS) {
			assert.match(joined, new RegExp(`Section ${section.title} still contains unfilled`));
		}
		assert.equal(PLACEHOLDER_PATTERN.test("<fill: x>"), true, "marker pattern sanity");
	});

	it("a bogus primary category id errors listing the valid ids", () => {
		const root = makeRoot("amber-bl-bogus-");
		const file = scaffoldedFile(root);
		fs.writeFileSync(
			file,
			fillPostMortem(fs.readFileSync(file, "utf8"), { primary: "made-up-category" }),
		);
		const r = validatePostMortem(root, { file: path.relative(root, file) });
		assert.equal(r.valid, false);
		const joined = r.errors.join("\n");
		assert.match(joined, /Primary must name exactly one category id/);
		for (const category of ROOT_CAUSE_CATEGORIES) {
			assert.ok(joined.includes(category.id), `valid id ${category.id} listed in the error`);
		}
	});

	it("two primary ids (and a bogus mechanism) are refused the same way", () => {
		const root = makeRoot("amber-bl-two-");
		const file = scaffoldedFile(root);
		const raw = fs.readFileSync(file, "utf8");
		fs.writeFileSync(file, fillPostMortem(raw, { primary: "missing-contract verification-gap" }));
		let r = validatePostMortem(root, { file: path.relative(root, file) });
		assert.equal(r.valid, false);
		assert.match(r.errors.join("\n"), /Primary must name exactly one category id/);

		fs.writeFileSync(file, fillPostMortem(raw, { mechanism: "magic-wand" }));
		r = validatePostMortem(root, { file: path.relative(root, file) });
		assert.equal(r.valid, false);
		assert.match(r.errors.join("\n"), /Mechanism must name exactly one mechanism id/);
		for (const mechanism of PREVENTION_MECHANISMS) {
			assert.ok(
				r.errors.join("\n").includes(mechanism.id),
				`valid mechanism ${mechanism.id} listed`,
			);
		}
	});

	it("a completely filled post-mortem passes and the summary names category, mechanism, and surface", () => {
		const root = makeRoot("amber-bl-pass-");
		const file = scaffoldedFile(root, { issue: 122, title: "Filled loop", recurrence: 2 });
		fs.writeFileSync(
			file,
			fillPostMortem(fs.readFileSync(file, "utf8"), {
				primary: "verification-gap",
				secondary: "implicit-assumption",
				mechanism: "parity-guard",
				surface: "tests/unit/command-registry-parity.test.js",
				anchor: "PUBLIC_COMMAND_ORDER parity walk",
				command: "node --test tests/unit/command-registry-parity.test.js — 0 failed",
			}),
		);
		const r = validatePostMortem(root, { file: path.relative(root, file) });
		assert.deepEqual(r.errors, [], `errors: ${r.errors.join("; ")}`);
		assert.equal(r.valid, true);
		assert.equal(r.primary, "verification-gap");
		assert.equal(r.secondary, "implicit-assumption");
		assert.equal(r.mechanism, "parity-guard");
		assert.match(r.text, /passed validation/);
		assert.match(r.text, /verification-gap/);
		assert.match(r.text, /parity-guard/);
		assert.match(r.text, /tests\/unit\/command-registry-parity.test.js/);
	});

	it("a filled post-mortem without a runnable verification command fails", () => {
		const root = makeRoot("amber-bl-nocmd-");
		const file = scaffoldedFile(root);
		fs.writeFileSync(
			file,
			fillPostMortem(fs.readFileSync(file, "utf8"), {
				command: "the operator promises it works",
			}),
		);
		const r = validatePostMortem(root, { file: path.relative(root, file) });
		assert.equal(r.valid, false);
		assert.match(r.errors.join("\n"), /Verification must include a runnable command line/);
	});

	it("a file outside the target root is refused (containment)", () => {
		const root = makeRoot("amber-bl-escape-");
		const outside = makeRoot("amber-bl-escape-other-");
		fs.writeFileSync(path.join(outside, "post-mortem.md"), "# not yours\n");
		const absolute = path.join(outside, "post-mortem.md");
		const r = validatePostMortem(root, { file: absolute });
		assert.equal(r.valid, false);
		assert.match(r.errors.join("\n"), /outside the target root/);

		const rel = validatePostMortem(root, { file: "../../elsewhere/post-mortem.md" });
		assert.equal(rel.valid, false);
		assert.match(rel.errors.join("\n"), /outside the target root/);
	});

	it("a missing file (and a missing --file) is a visible error", () => {
		const root = makeRoot("amber-bl-missing-");
		const missing = validatePostMortem(root, { file: "docs/quality/break-loops/nope.md" });
		assert.equal(missing.valid, false);
		assert.match(missing.errors.join("\n"), /missing: docs\/quality\/break-loops\/nope\.md/);

		const noFlag = validatePostMortem(root, {});
		assert.equal(noFlag.valid, false);
		assert.match(noFlag.errors.join("\n"), /requires --file/);
	});

	it("a dropped section is reported as missing", () => {
		const root = makeRoot("amber-bl-dropsec-");
		const file = scaffoldedFile(root);
		const filled = fillPostMortem(fs.readFileSync(file, "utf8"));
		// Remove the Verification section entirely.
		const withoutVerification = filled.replace(/## Verification[\s\S]*$/, "").trimEnd();
		fs.writeFileSync(file, withoutVerification);
		const r = validatePostMortem(root, { file: path.relative(root, file) });
		assert.equal(r.valid, false);
		assert.match(r.errors.join("\n"), /must include a non-empty Verification section/);
	});
});

// ── CLI end-to-end ───────────────────────────────────────────────────────────

const CLI = path.join(__dirname, "..", "..", "scripts", "amber.js");

function runCli(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: __dirname,
		encoding: "utf8",
		env: { ...process.env },
	});
}

describe("amber break-loop (CLI)", () => {
	it("scaffold exits 0 and creates the file; validate fails on the raw scaffold", () => {
		const root = makeRoot("amber-bl-cli-");
		const r = runCli([
			"break-loop",
			"--target",
			root,
			"--issue",
			"1",
			"--title",
			"x",
			"--recurrence",
			"2",
		]);
		assert.equal(r.status, 0, `stderr: ${r.stderr}`);
		assert.match(r.stdout, /Break-loop post-mortem scaffolded:/);
		const files = listPostMortems(root);
		assert.equal(files.length, 1);
		assert.match(files[0], /^\d{4}-\d{2}-\d{2}-x\.md$/);

		const v = runCli([
			"break-loop",
			"validate",
			"--target",
			root,
			"--file",
			`${BREAK_LOOP_DIR}/${files[0]}`,
		]);
		assert.equal(v.status, 1);
		assert.match(v.stdout, /still contains unfilled placeholder markers/);
	});

	it("--recurrence 1 exits 1 with the visible guard error and writes nothing", () => {
		const root = makeRoot("amber-bl-cli-rec-");
		const r = runCli([
			"break-loop",
			"--target",
			root,
			"--issue",
			"1",
			"--title",
			"x",
			"--recurrence",
			"1",
		]);
		assert.equal(r.status, 1);
		assert.match(r.stdout, /--recurrence <n> with n >= 2/);
		assert.equal(fs.existsSync(postMortemDir(root)), false, "nothing written");
	});

	it("a filled post-mortem validates green through the CLI, and --json emits the envelope", () => {
		const root = makeRoot("amber-bl-cli-pass-");
		const { path: scaffolded, errors } = scaffoldPostMortem(root, {
			issue: 9,
			title: "cli loop",
			recurrence: 2,
		});
		assert.deepEqual(errors, []);
		fs.writeFileSync(scaffolded, fillPostMortem(fs.readFileSync(scaffolded, "utf8")));
		const relative = path.relative(root, scaffolded).split(path.sep).join("/");

		const v = runCli(["break-loop", "validate", "--target", root, "--file", relative]);
		assert.equal(v.status, 0, `stdout: ${v.stdout}`);
		assert.match(v.stdout, /Post-mortem passed validation/);

		const j = runCli(["break-loop", "validate", "--target", root, "--file", relative, "--json"]);
		assert.equal(j.status, 0, `stderr: ${j.stderr}`);
		const envelope = JSON.parse(j.stdout);
		assert.equal(envelope.valid, true);
		assert.equal(envelope.primary, "cross-layer-drift");
		assert.equal(envelope.mechanism, "contract-and-anchor");
		assert.deepEqual(envelope.errors, []);
	});

	it("--help documents the taxonomy and the prevention-mechanism menu from the single source", () => {
		const r = runCli(["break-loop", "--help"]);
		assert.equal(r.status, 0);
		const help = r.stdout;
		assert.match(help, /Root-cause taxonomy/);
		assert.match(help, /Prevention-mechanism menu/);
		assert.match(help, /write-back surface/);
		for (const category of ROOT_CAUSE_CATEGORIES) {
			assert.ok(help.includes(category.id), `help lists ${category.id}`);
		}
		for (const mechanism of PREVENTION_MECHANISMS) {
			assert.ok(help.includes(mechanism.id), `help lists ${mechanism.id}`);
			assert.ok(help.includes(mechanism.surface), `help names ${mechanism.id} surface`);
		}
		assert.match(help, /--recurrence <n>\s+How many times the class has come back/);
		assert.match(
			help,
			/--issue <n>\s+Reference number of the recurring issue, required to scaffold/,
		);
	});

	it("amber --help lists break-loop, and the registry places it next to learnings at tier core", () => {
		const r = runCli(["--help"]);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /break-loop/);

		assert.ok(COMMANDS.includes("break-loop"));
		assert.equal(COMMANDS.indexOf("break-loop"), COMMANDS.indexOf("learnings") + 1);
		assert.equal(COMMAND_TIERS["break-loop"], "core");
		assert.ok(DEFAULT_COMMANDS.includes("break-loop"), "tier core → visible in default help");
	});
});

// Review fixes (Standards axis): blank bullet values, slug-less titles,
// vacuous write-back tokens, and typo'd subactions.
describe("break-loop review-hardening", () => {
	it("a blank bullet value no longer steals the next line and greenwashes validate", () => {
		const root = makeRoot("amber-bl-blank-");
		const r1 = scaffoldPostMortem(root, { issue: "9", title: "Blank bullet", recurrence: 2 });
		assert.deepEqual(r1.errors, []);
		const file = r1.path;
		let content = fillPostMortem(fs.readFileSync(file, "utf8"), {
			primary: "verification-gap",
			mechanism: "checklist-item",
		});
		// Blank Primary / blank Surface followed by later lines: pre-fix these
		// validated by capturing the neighbor line.
		content = content
			.replace(/- Primary:.*$/m, "- Primary:")
			.replace(/- Surface:.*$/m, "- Surface:");
		fs.writeFileSync(file, content);
		const bad = validatePostMortem(root, { file });
		assert.ok(bad.errors.length > 0, "blank values must not pass");
		assert.match(bad.errors.join("\n"), /Primary/);
		assert.match(bad.errors.join("\n"), /Surface/);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("vacuous surface/anchor tokens are rejected", () => {
		const root = makeRoot("amber-bl-vac-");
		const r1 = scaffoldPostMortem(root, { issue: "9", title: "Vacuous tokens", recurrence: 2 });
		const file = r1.path;
		let content = fillPostMortem(fs.readFileSync(file, "utf8"), {
			surface: "TBD",
			anchor: "none",
		});
		fs.writeFileSync(file, content);
		const bad = validatePostMortem(root, { file });
		assert.match(bad.errors.join("\n"), /not a placeholder word/);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("a title without an ASCII letter or digit is refused at scaffold", () => {
		const root = makeRoot("amber-bl-slug-");
		const r = scaffoldPostMortem(root, { issue: "9", title: "证据日期", recurrence: 2 });
		assert.ok(r.errors.length > 0);
		assert.match(r.errors.join("\n"), /ASCII letter or digit/);
		assert.equal(
			fs.existsSync(path.join(root, "docs", "quality", "break-loops")),
			false,
			"nothing written on refusal",
		);
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("an unrecognized subaction is an unknownAction, not a silent scaffold", () => {
		const root = makeRoot("amber-bl-typo-");
		try {
			const r = runCli(["break-loop", "validat", "--target", root, "--file", "x.md"]);
			assert.equal(r.status, 1);
			assert.match(r.stdout, /break-loop requires/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
