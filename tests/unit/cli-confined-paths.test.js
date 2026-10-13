const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const L = require("../../scripts/lib/core/loop-ledger");
const { run } = require("../../scripts/amber");
const { REQUIRED_BUNDLE_FILES } = require("../../scripts/lib/core/handoff-layout");

// The path-confinement sweep routes CLI-supplied paths through
// resolvePathWithin. These are the last seams it reached: the places where a
// flag value was joined to the target root and handed straight to the
// filesystem. A refusal must land before any byte is written or read outside
// the target, so each case asserts the escape is both refused and inert.
function tempDir(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-confine-${label}-`));
}

test("ledger export refuses an --out that escapes the target and writes nothing", async () => {
	const target = tempDir("ledger");
	const outside = tempDir("ledger-out");
	const outsidePath = path.join(outside, "ledger.json");
	try {
		await assert.rejects(
			() =>
				run([
					"ledger",
					"export",
					"--target",
					target,
					"--out",
					"../ledger-out-x/ledger.json",
					"--yes",
				]),
			/outside the target root/,
		);
		assert.equal(fs.existsSync(outsidePath), false, "the refusal precedes the write");
		await assert.rejects(
			() => run(["ledger", "export", "--target", target, "--out", outsidePath, "--yes"]),
			/outside the target root/,
		);
		assert.equal(fs.existsSync(outsidePath), false, "an absolute escape is inert too");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("ledger export refuses a symlinked --out destination", async () => {
	const target = tempDir("link");
	const outside = tempDir("link-out");
	const outsidePath = path.join(outside, "ledger.json");
	const linkPath = path.join(target, "ledger.json");
	fs.writeFileSync(outsidePath, "original\n");
	try {
		fs.symlinkSync(outsidePath, linkPath);
		await assert.rejects(
			() => run(["ledger", "export", "--target", target, "--out", "ledger.json", "--yes"]),
			/outside the target root/,
		);
		assert.equal(fs.readFileSync(outsidePath, "utf8"), "original\n", "symlink target untouched");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("ledger export still writes an in-target --out (the guard is not a blanket refusal)", async () => {
	const target = tempDir("inwrite");
	const ledgerDir = path.join(target, ".amber", "sessions", "S1");
	fs.mkdirSync(ledgerDir, { recursive: true });
	L.appendLedgerRecord(path.join(ledgerDir, "ledger.jsonl"), {
		kind: "approved",
		approvalKey: "a1",
	});
	try {
		// A relative --out under the root is the supported shape; the handler does
		// not create parent directories, so this control stays root-relative.
		const code = await run([
			"ledger",
			"export",
			"--target",
			target,
			"--out",
			"ledger-export.json",
			"--yes",
		]);
		assert.equal(code, 0);
		assert.match(fs.readFileSync(path.join(target, "ledger-export.json"), "utf8"), /approved/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// Three surfaces resolve their destination against --target and used to accept any
// value, so a governed artifact landed outside the repository the command named.
test("wiki export refuses an --output-dir that escapes the target and writes nothing", async () => {
	const target = tempDir("wiki-export");
	const outside = tempDir("wiki-export-out");
	const dest = path.join(outside, "bundle");
	try {
		await run(["init", "--target", target, "--yes"]);
		await assert.rejects(
			() => run(["wiki", "export", "--target", target, "--output-dir", dest]),
			/outside the target root/,
		);
		assert.equal(fs.existsSync(dest), false, "the refusal precedes the mkdir");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("handoff bundle refuses an --output-dir that escapes the target", async () => {
	const target = tempDir("bundle-dir");
	const outside = tempDir("bundle-dir-out");
	const dest = path.join(outside, "hb");
	try {
		await run(["init", "--target", target, "--yes"]);
		await assert.rejects(
			() => run(["handoff", "bundle", "--target", target, "--output-dir", dest]),
			/outside the target root/,
		);
		assert.equal(fs.existsSync(dest), false, "no bundle bytes outside the target");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

// The report body is guarded, so the refusal is a result error rather than a throw.
test("governance report refuses an --output that escapes the target", async () => {
	const { governanceDispatch } = require("../../scripts/lib/governance-commands");
	const target = tempDir("gov-report");
	const outside = tempDir("gov-report-out");
	const dest = path.join(outside, "report.md");
	try {
		await run(["init", "--target", target, "--yes"]);
		const result = governanceDispatch("report", target, { output: dest });
		assert.match(
			(result.errors || []).join("\n"),
			/outside the target root/,
			"the escape is refused with a named label",
		);
		assert.equal(fs.existsSync(dest), false, "the refusal precedes the write");
		const inside = governanceDispatch("report", target, { output: "governance-report.md" });
		assert.deepEqual(inside.errors || [], [], "an in-target destination still works");
		assert.ok(
			fs.existsSync(path.join(target, "governance-report.md")),
			"the guard is not a blanket refusal",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("governance report refuses an --output hard-linked outside the target", async (t) => {
	const { governanceDispatch } = require("../../scripts/lib/governance-commands");
	const target = tempDir("gov-leaf");
	const outside = tempDir("gov-leaf-out");
	const victim = path.join(outside, "victim.md");
	const leaf = path.join(target, "report.md");
	try {
		await run(["init", "--target", target, "--yes"]);
		fs.writeFileSync(victim, "user outside\n");
		try {
			fs.linkSync(victim, leaf);
		} catch (error) {
			return t.skip(`hard link creation unavailable: ${error.code}`);
		}
		const result = governanceDispatch("report", target, { output: "report.md" });
		assert.match(
			(result.errors || []).join("\n"),
			/hard-linked/,
			"the shared inode is refused with a named label",
		);
		assert.equal(fs.readFileSync(victim, "utf8"), "user outside\n", "the refusal changes no bytes");
		assert.equal(fs.statSync(leaf).nlink, 2, "the destination is left as the shared link");
		assert.equal(
			await run(["governance", "report", "--target", target, "--output", "report.md", "--yes"]),
			1,
			"the CLI surfaces the refusal as an error exit",
		);
		assert.equal(fs.readFileSync(victim, "utf8"), "user outside\n", "the CLI exit is inert");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

// The docs claim a link to a single in-target file is written through, so that is pinned here
// rather than left as an untested sentence: the referent's bytes are replaced, no refusal.
test("governance report writes through an --output link to one in-target file", async (t) => {
	const { governanceDispatch } = require("../../scripts/lib/governance-commands");
	const target = tempDir("gov-through");
	const referent = path.join(target, "shared.md");
	try {
		await run(["init", "--target", target, "--yes"]);
		fs.writeFileSync(referent, "old\n");
		try {
			fs.symlinkSync(referent, path.join(target, "report.md"), "file");
		} catch (error) {
			return t.skip(`symlink creation unavailable: ${error.code}`);
		}
		const result = governanceDispatch("report", target, { output: "report.md" });
		assert.deepEqual(result.errors || [], [], "the documented write-through is not refused");
		assert.match(
			fs.readFileSync(referent, "utf8"),
			/^# Amber Governance Report/,
			"the referent received the report bytes",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("workflow assess refuses an --output-dir leaf hard-linked outside the target", async (t) => {
	const { workflowDispatch } = require("../../scripts/lib/workflow-assessment/adapters/command");
	const target = tempDir("assess-leaf");
	const outside = tempDir("assess-leaf-out");
	const victim = path.join(outside, "victim.json");
	const leaf = path.join(target, "wout", "workflow-assessment.json");
	try {
		await run(["init", "--target", target, "--yes"]);
		fs.writeFileSync(victim, "user outside\n");
		const outputDir = path.join(target, "wout");
		fs.mkdirSync(outputDir, { recursive: true });
		try {
			fs.linkSync(victim, leaf);
		} catch (error) {
			return t.skip(`hard link creation unavailable: ${error.code}`);
		}
		const result = workflowDispatch("assess", target, { target, outputDir: "wout" });
		assert.match(
			(result.errors || []).join("\n"),
			/hard-linked/,
			"the shared inode is refused with a named label, not a wrong-reason exit",
		);
		assert.equal(fs.readFileSync(victim, "utf8"), "user outside\n", "the refusal changes no bytes");
		assert.equal(fs.statSync(leaf).nlink, 2, "the destination is left as the shared link");
		assert.equal(
			await run(["workflow", "assess", "--target", target, "--output-dir", "wout"]),
			1,
			"the CLI surfaces the refusal as an error exit",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

// workflow assess confines its output file to --output-dir, so unlike the other three surfaces it
// refuses a link whose referent stays inside the target. Pinned: the docs name this exception.
test("workflow assess refuses an --output-dir link to a file outside that directory", async (t) => {
	const target = tempDir("assess-dir-scope");
	const referent = path.join(target, "shared.json");
	try {
		await run(["init", "--target", target, "--yes"]);
		fs.writeFileSync(referent, "OLD\n");
		const outputDir = path.join(target, "wout");
		fs.mkdirSync(outputDir, { recursive: true });
		try {
			fs.symlinkSync(referent, path.join(outputDir, "workflow-assessment.json"), "file");
		} catch (error) {
			return t.skip(`symlink creation unavailable: ${error.code}`);
		}
		assert.equal(
			await run(["workflow", "assess", "--target", target, "--output-dir", "wout"]),
			1,
			"the in-target referent outside the output directory is refused",
		);
		assert.equal(fs.readFileSync(referent, "utf8"), "OLD\n", "the refusal changes no bytes");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

const rootOutputCases = [
	{
		command: ["wiki", "export"],
		flag: "--output-dir",
		files: ["index.md", "okf.json", "graph.html"],
		defaultDir: ["docs", "okf-bundle"],
	},
	{
		command: ["handoff", "bundle"],
		flag: "--output-dir",
		files: ["README.md", "manifest.json"],
		defaultDir: [".amber", "handoff", "latest"],
	},
	{ command: ["handoff", "bundle"], flag: "--bundle-dir", files: ["README.md", "manifest.json"] },
	{
		command: ["workflow", "assess"],
		flag: "--output-dir",
		files: ["workflow-assessment.json"],
		guarded: true,
	},
	{
		command: ["governance", "report"],
		flag: "--output",
		files: ["report.md"],
		guarded: true,
		// This flag names a file, not a directory, and the typed mutation needs approval.
		leafOutput: true,
		extraArgs: ["--yes"],
	},
];

for (const {
	command,
	flag,
	files,
	guarded,
	defaultDir,
	leafOutput,
	extraArgs,
} of rootOutputCases) {
	test(
		command.join(" ") +
			" refuses " +
			flag +
			" resolving to the repository root without changing user files",
		async () => {
			const target = tempDir("root-output");
			const argvFor = (output) => [
				...command,
				"--target",
				target,
				flag,
				output,
				...(extraArgs || []),
			];
			try {
				assert.equal(await run(["init", "--target", target, "--yes"]), 0);
				for (const name of files) fs.writeFileSync(path.join(target, name), "user:" + name);
				const rootLink = path.join(target, "root-link");
				fs.symlinkSync(target, rootLink, process.platform === "win32" ? "junction" : "dir");
				const before = fs.readdirSync(target).sort();
				for (const output of [".", target, "nested/..", "root-link"]) {
					const argv = argvFor(output);
					if (guarded) assert.equal(await run(argv), 1);
					else await assert.rejects(() => run(argv), /outside the target root/);
					for (const name of files) {
						assert.equal(fs.readFileSync(path.join(target, name), "utf8"), "user:" + name);
					}
					assert.deepEqual(fs.readdirSync(target).sort(), before, "refusal leaves no export files");
				}
				if (defaultDir) {
					const destination = path.join(target, ...defaultDir);
					fs.mkdirSync(path.dirname(destination), { recursive: true });
					fs.symlinkSync(target, destination, process.platform === "win32" ? "junction" : "dir");
					await assert.rejects(
						() => run([...command, "--target", target]),
						/outside the target root/,
					);
					for (const name of files) {
						assert.equal(fs.readFileSync(path.join(target, name), "utf8"), "user:" + name);
					}
				}
				for (const output of ["exports", path.join(target, "absolute-export")]) {
					const destination = leafOutput ? path.join(output, files[0]) : output;
					assert.equal(await run(argvFor(destination)), 0);
					assert.ok(
						fs.existsSync(
							leafOutput
								? path.resolve(target, destination)
								: path.resolve(target, output, files[0]),
						),
					);
				}
			} finally {
				fs.rmSync(target, { recursive: true, force: true });
			}
		},
	);
}

test("handoff validate can read an existing root bundle without changing it", async () => {
	const target = tempDir("root-bundle-input");
	try {
		assert.equal(await run(["init", "--target", target, "--yes"]), 0);
		assert.equal(
			await run(["handoff", "bundle", "--target", target, "--output-dir", "exports"]),
			0,
		);
		for (const name of REQUIRED_BUNDLE_FILES) {
			fs.copyFileSync(path.join(target, "exports", name), path.join(target, name));
		}
		const before = fs.readdirSync(target).sort();
		const contents = REQUIRED_BUNDLE_FILES.map((name) =>
			fs.readFileSync(path.join(target, name), "utf8"),
		);
		assert.equal(await run(["handoff", "validate", "--target", target, "--bundle-dir", "."]), 0);
		assert.deepEqual(fs.readdirSync(target).sort(), before);
		assert.deepEqual(
			REQUIRED_BUNDLE_FILES.map((name) => fs.readFileSync(path.join(target, name), "utf8")),
			contents,
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("execution readiness refuses a --plan outside the target", async () => {
	const target = tempDir("plan");
	const outside = tempDir("plan-out");
	try {
		fs.writeFileSync(path.join(outside, "F001.md"), "# plan\n");
		await assert.rejects(
			() =>
				run([
					"execution",
					"readiness",
					"--target",
					target,
					"--plan",
					path.join(outside, "F001.md"),
				]),
			/outside the target root/,
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});
