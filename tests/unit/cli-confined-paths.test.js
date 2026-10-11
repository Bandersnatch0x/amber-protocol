const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const L = require("../../scripts/lib/core/loop-ledger");
const { run } = require("../../scripts/amber");

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
