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
