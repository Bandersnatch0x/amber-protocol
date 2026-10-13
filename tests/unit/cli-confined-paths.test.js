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
];

for (const { command, flag, files, guarded, defaultDir } of rootOutputCases) {
	test(
		command.join(" ") +
			" refuses " +
			flag +
			" resolving to the repository root without changing user files",
		async () => {
			const target = tempDir("root-output");
			try {
				assert.equal(await run(["init", "--target", target, "--yes"]), 0);
				for (const name of files) fs.writeFileSync(path.join(target, name), "user:" + name);
				const rootLink = path.join(target, "root-link");
				fs.symlinkSync(target, rootLink, process.platform === "win32" ? "junction" : "dir");
				const before = fs.readdirSync(target).sort();
				for (const output of [".", target, "nested/..", "root-link"]) {
					const argv = [...command, "--target", target, flag, output];
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
					assert.equal(await run([...command, "--target", target, flag, output]), 0);
					assert.ok(fs.existsSync(path.resolve(target, output, files[0])));
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
