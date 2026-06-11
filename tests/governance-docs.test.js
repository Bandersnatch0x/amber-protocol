"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createGovernanceDocs } = require("../scripts/lib/governance-commands");

describe("governance docs", () => {
	let tmpDir;

	before(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "governance-test-"));
	});

	after(() => {
		if (tmpDir && fs.existsSync(tmpDir)) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("empty repo → creates 3 files", () => {
		const result = createGovernanceDocs(tmpDir);

		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.created.length, 3);
		assert.ok(result.created.every(p => p.includes('.amber\\governance\\')));
		assert.ok(result.created.some(p => p.endsWith('POLICY.md')));
		assert.ok(result.created.some(p => p.endsWith('BOUNDARIES.md')));
		assert.ok(result.created.some(p => p.endsWith('AUDIT_LOG.md')));
		assert.strictEqual(result.skipped.length, 0);

		assert.ok(fs.existsSync(path.join(tmpDir, '.amber', 'governance', 'POLICY.md')));
		assert.ok(fs.existsSync(path.join(tmpDir, '.amber', 'governance', 'BOUNDARIES.md')));
		assert.ok(fs.existsSync(path.join(tmpDir, '.amber', 'governance', 'AUDIT_LOG.md')));
	});

	it("re-run → skips existing files", () => {
		const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "governance-test2-"));

		try {
			const firstRun = createGovernanceDocs(tmpDir2);
			assert.strictEqual(firstRun.created.length, 3);

			const secondRun = createGovernanceDocs(tmpDir2);
			assert.strictEqual(secondRun.errors.length, 0);
			assert.strictEqual(secondRun.created.length, 0);
			assert.strictEqual(secondRun.skipped.length, 3);
			assert.ok(secondRun.skipped.every(p => p.includes('.amber\\governance\\')));
			assert.ok(secondRun.skipped.some(p => p.endsWith('POLICY.md')));
			assert.ok(secondRun.skipped.some(p => p.endsWith('BOUNDARIES.md')));
			assert.ok(secondRun.skipped.some(p => p.endsWith('AUDIT_LOG.md')));
		} finally {
			fs.rmSync(tmpDir2, { recursive: true, force: true });
		}
	});
});
