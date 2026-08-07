"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	sha256,
	normalizeForHash,
	hashFile,
	hashText,
} = require("../../scripts/lib/core/context-hash");

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

describe("sha256", () => {
	it("returns the sha256: prefixed hex digest", () => {
		const h = sha256("hello");
		assert.match(h, SHA256_RE);
		// sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
		assert.equal(h, "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
	});

	it("is deterministic", () => {
		assert.equal(sha256("same input"), sha256("same input"));
	});
});

describe("normalizeForHash (.js)", () => {
	it("strips // line comments and /* */ block comments", () => {
		const code = "const x = 1; // trailing\n/* block\ncomment */ const y = 2;";
		const norm = normalizeForHash(code, ".js");
		assert.ok(!norm.includes("trailing"));
		assert.ok(!norm.includes("block"));
		assert.ok(norm.includes("const x = 1;"));
		assert.ok(norm.includes("const y = 2;"));
	});

	it("does not strip // inside string literals", () => {
		const code = 'const url = "https://example.com/path";';
		const norm = normalizeForHash(code, ".js");
		assert.ok(norm.includes("https://example.com/path"));
	});

	it("collapses whitespace", () => {
		const a = "const x = 1;\nconst   y = 2;";
		const b = "  const x = 1;  \n\n  const y = 2;";
		assert.equal(normalizeForHash(a, ".js"), normalizeForHash(b, ".js"));
	});
});

describe("normalizeForHash (.md)", () => {
	it("strips HTML comments and collapses blank runs", () => {
		const a = "# Title\n\n<!-- stale -->\n\nBody paragraph.";
		const b = "# Title\n\nBody paragraph.";
		assert.equal(normalizeForHash(a, ".md"), normalizeForHash(b, ".md"));
	});
});

describe("normalizeForHash (.json)", () => {
	it("is independent of key order and whitespace", () => {
		const a = JSON.stringify({ b: 1, a: [1, 2], nested: { z: true } });
		const b = JSON.stringify({ nested: { z: true }, a: [1, 2], b: 1 }, null, 2);
		assert.equal(normalizeForHash(a, ".json"), normalizeForHash(b, ".json"));
	});
});

describe("normalizeForHash (other)", () => {
	it("collapses whitespace only", () => {
		const a = "line one\n\nline two";
		const b = "line one\nline two";
		assert.equal(normalizeForHash(a, ".txt"), normalizeForHash(b, ".txt"));
	});
});

describe("hashFile", () => {
	it("computes raw and normalized hashes for a js file", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-hash-"));
		try {
			const p = path.join(dir, "mod.js");
			fs.writeFileSync(p, "const x = 1; // comment\n", "utf8");
			const raw = hashFile(p);
			assert.match(raw.rawHash, SHA256_RE);
			assert.match(raw.normHash, SHA256_RE);
			assert.notEqual(raw.rawHash, raw.normHash);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("raw differs on comment-only change but normalized does not", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-hash-"));
		try {
			const p = path.join(dir, "mod.js");
			fs.writeFileSync(p, "const x = 1; // v1\n", "utf8");
			const before = hashFile(p);
			fs.writeFileSync(p, "const x = 1; // v2 changed comment\n", "utf8");
			const after = hashFile(p);
			assert.notEqual(before.rawHash, after.rawHash);
			assert.equal(before.normHash, after.normHash);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("hashText", () => {
	it("hashes raw text without a path hint", () => {
		const h = hashText("some raw text");
		assert.match(h, SHA256_RE);
	});
});
