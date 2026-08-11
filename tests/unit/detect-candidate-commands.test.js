"use strict";

// Integration coverage for detectCandidateCommands — the filesystem-coupled
// evidence gatherer whose pure decision core (buildPythonCandidates) is unit
// tested separately. These exercise the disk-reading glue (which paths and
// file-content regexes trigger which candidates), where path/regex/order bugs
// would otherwise hide.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { detectCandidateCommands } = require("../../scripts/lib/core/audit");

const PYTHON_EVIDENCE = [{ source: "pyproject.toml", name: "python" }];

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "candidate-cmd-"));
}

function write(root, relativePath, content) {
	const full = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
}

test("returns no candidates when there is no python tooling evidence", () => {
	const root = tempTarget();
	write(root, "tests/test_app.py", "def test_ok():\n    assert True\n");
	// Even with a tests/ dir, no python evidence means no candidates.
	assert.deepEqual(detectCandidateCommands(root, []), []);
});

test("python evidence with no test files yields the default pytest candidate", () => {
	const root = tempTarget();
	const candidates = detectCandidateCommands(root, PYTHON_EVIDENCE);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].name, "pytest");
	assert.equal(candidates[0].source, "python tooling evidence");
	assert.match(candidates[0].reason, /no explicit verification command/i);
});

test("a tests/ directory labels the pytest candidate source as tests/", () => {
	const root = tempTarget();
	fs.mkdirSync(path.join(root, "tests"));
	const candidates = detectCandidateCommands(root, PYTHON_EVIDENCE);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].name, "pytest");
	assert.equal(candidates[0].source, "tests/");
});

test("a singular test/ directory also counts as a tests directory", () => {
	const root = tempTarget();
	fs.mkdirSync(path.join(root, "test"));
	const candidates = detectCandidateCommands(root, PYTHON_EVIDENCE);
	assert.equal(candidates[0].source, "tests/");
});

test("pytest.ini is recognised as pytest evidence without a tests directory", () => {
	const root = tempTarget();
	write(root, "pytest.ini", "[pytest]\n");
	const candidates = detectCandidateCommands(root, PYTHON_EVIDENCE);
	assert.equal(candidates[0].name, "pytest");
	assert.equal(candidates[0].source, "python tooling evidence");
});

test("requirements.txt with pytest and ruff yields both candidates", () => {
	const root = tempTarget();
	write(root, "requirements.txt", "pytest>=7.0\nruff==0.1.0\nrequests\n");
	const candidates = detectCandidateCommands(root, PYTHON_EVIDENCE);
	assert.deepEqual(
		candidates.map((c) => c.name),
		["pytest", "ruff"],
	);
	// No tests/ dir, so pytest is sourced from tooling evidence.
	assert.equal(candidates[0].source, "python tooling evidence");
});

test("pyproject.toml [tool.ruff] alone yields only the ruff candidate (no default pytest)", () => {
	const root = tempTarget();
	write(root, "pyproject.toml", "[tool.ruff]\nline-length = 100\n");
	const candidates = detectCandidateCommands(root, PYTHON_EVIDENCE);
	assert.deepEqual(
		candidates.map((c) => c.name),
		["ruff"],
	);
});

test("pyproject.toml [tool.pytest.ini_options] is recognised as pytest evidence", () => {
	const root = tempTarget();
	write(root, "pyproject.toml", '[tool.pytest.ini_options]\nminversion = "7.0"\n');
	const candidates = detectCandidateCommands(root, PYTHON_EVIDENCE);
	assert.equal(candidates[0].name, "pytest");
});

const GO_EVIDENCE = [{ source: "go.mod", name: "go" }];
const RUST_EVIDENCE = [{ source: "Cargo.toml", name: "rust" }];

test("go evidence yields a go test candidate sourced from go.mod", () => {
	const root = tempTarget();
	const candidates = detectCandidateCommands(root, GO_EVIDENCE);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].name, "go-test");
	assert.equal(candidates[0].command, "go test ./...");
	assert.equal(candidates[0].source, "go.mod");
	assert.equal(candidates[0].confidence, "candidate");
});

test("a wails.json alongside go.mod adds a wails build candidate", () => {
	const root = tempTarget();
	write(root, "wails.json", '{\n  "name": "app"\n}\n');
	const candidates = detectCandidateCommands(root, GO_EVIDENCE);
	assert.deepEqual(
		candidates.map((c) => c.name),
		["go-test", "wails-build"],
	);
	assert.equal(candidates[1].command, "wails build");
	assert.equal(candidates[1].source, "wails.json");
});

test("rust evidence yields a cargo test candidate sourced from Cargo.toml", () => {
	const root = tempTarget();
	const candidates = detectCandidateCommands(root, RUST_EVIDENCE);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].name, "cargo-test");
	assert.equal(candidates[0].command, "cargo test");
	assert.equal(candidates[0].source, "Cargo.toml");
	assert.equal(candidates[0].confidence, "candidate");
});

test("mixed go + python evidence accumulates candidates from both languages", () => {
	const root = tempTarget();
	const candidates = detectCandidateCommands(root, [...PYTHON_EVIDENCE, ...GO_EVIDENCE]);
	const names = candidates.map((c) => c.name);
	assert.ok(names.includes("pytest"));
	assert.ok(names.includes("go-test"));
});

// DETECTORS order is load-bearing (python → go → rust). The mixed-language
// test above only asserts membership; pin the sequence so a registry reorder
// cannot silently reshuffle the audit candidate list (grok L3 residual gap).
test("multi-language candidates preserve DETECTORS order: python before go before rust", () => {
	const root = tempTarget();
	// Feed evidence out of order — DETECTORS order, not input order, must win.
	const candidates = detectCandidateCommands(root, [
		...RUST_EVIDENCE,
		...GO_EVIDENCE,
		...PYTHON_EVIDENCE,
	]);
	const names = candidates.map((c) => c.name);
	const py = names.indexOf("pytest");
	const go = names.indexOf("go-test");
	const rust = names.indexOf("cargo-test");
	assert.ok(py >= 0 && go >= 0 && rust >= 0, `expected all three, got ${names.join(",")}`);
	assert.ok(py < go, `python must precede go (got ${names.join(",")})`);
	assert.ok(go < rust, `go must precede rust (got ${names.join(",")})`);
});
