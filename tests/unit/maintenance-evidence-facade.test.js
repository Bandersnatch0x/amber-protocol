"use strict";

// F014-M1: focused Maintenance evidence facade.
// Covers empty, valid, duplicate, bounded, corrupt, unreadable, and mixed
// fixtures; asserts no Team Distribution dependency and no blocking errors.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { evidence } = require("../../scripts/lib/maintenance");

function makeTempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-ev-"));
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

function writeEvidence(targetRoot, taskId, contents) {
	const dir = path.join(targetRoot, ".amber", "executions", taskId);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "evidence.json"), contents, "utf8");
	return path.join(dir, "evidence.json");
}

function validProposal(taskId, assertion) {
	return JSON.stringify({
		taskId,
		regressionProposal: { status: "proposed", assertion },
		traceReplay: { traceInput: "secret-trace-abc", agentConfig: "cfg" },
	});
}

describe("maintenance evidence facade", () => {
	it("absent executions source is a complete empty result without warnings", () => {
		const tmp = makeTempTarget();
		try {
			const out = evidence(tmp);
			assert.equal(out.availability, "complete");
			assert.deepEqual(out.warnings, []);
			assert.deepEqual(out.errors, []);
			assert.deepEqual(out.regressionProposals, []);
			assert.deepEqual(out.evolution.findings, []);
			assert.deepEqual(out.evolution.significant, []);
		} finally {
			cleanup(tmp);
		}
	});

	it("absent .amber dir entirely is a complete empty result", () => {
		const tmp = makeTempTarget();
		try {
			const out = evidence(tmp);
			assert.equal(out.availability, "complete");
			assert.deepEqual(out.warnings, []);
		} finally {
			cleanup(tmp);
		}
	});

	it("retains valid proposals with deterministic ordering", () => {
		const tmp = makeTempTarget();
		try {
			writeEvidence(tmp, "task-b", validProposal("task-b", "assert-b"));
			writeEvidence(tmp, "task-a", validProposal("task-a", "assert-a"));
			const out = evidence(tmp);
			assert.equal(out.availability, "complete");
			assert.deepEqual(
				out.regressionProposals.map((p) => p.taskId),
				["task-a", "task-b"],
			);
			assert.deepEqual(out.warnings, []);
		} finally {
			cleanup(tmp);
		}
	});

	it("dedupes identical taskId+assertion pairs", () => {
		const tmp = makeTempTarget();
		try {
			writeEvidence(tmp, "task-x", validProposal("task-x", "same-assert"));
			writeEvidence(tmp, "task-x-copy", validProposal("task-x", "same-assert"));
			const out = evidence(tmp);
			assert.equal(out.availability, "complete");
			assert.equal(out.regressionProposals.length, 1);
		} finally {
			cleanup(tmp);
		}
	});

	it("bounds proposals at 50", () => {
		const tmp = makeTempTarget();
		try {
			for (let i = 0; i < 60; i += 1) {
				const taskId = `task-${String(i).padStart(2, "0")}`;
				writeEvidence(tmp, taskId, validProposal(taskId, `assert-${i}`));
			}
			const out = evidence(tmp);
			assert.equal(out.availability, "complete");
			assert.equal(out.regressionProposals.length, 50);
		} finally {
			cleanup(tmp);
		}
	});

	it("command-only evidence is normal, not corruption", () => {
		const tmp = makeTempTarget();
		try {
			writeEvidence(tmp, "cmd-only", JSON.stringify({ commands: ["npm test"] }));
			const out = evidence(tmp);
			assert.equal(out.availability, "complete");
			assert.deepEqual(out.warnings, []);
			assert.deepEqual(out.regressionProposals, []);
		} finally {
			cleanup(tmp);
		}
	});

	it("mixed valid and corrupt records retain valid data, mark partial, warn redacted", () => {
		const tmp = makeTempTarget();
		try {
			writeEvidence(tmp, "good", validProposal("good", "must not regress"));
			writeEvidence(tmp, "broken", "{ not valid json");
			const out = evidence(tmp);
			assert.equal(out.availability, "partial");
			assert.deepEqual(
				out.regressionProposals.map((p) => p.taskId),
				["good"],
			);
			assert.equal(out.warnings.length, 1);
			assert.match(out.warnings[0], /\.amber[\\/]executions[\\/]broken[\\/]evidence\.json/);
			assert.ok(!out.warnings[0].includes("not valid json"));
			// partial is warning-only, never an error
			assert.deepEqual(out.errors, []);
		} finally {
			cleanup(tmp);
		}
	});

	it("JSON null and scalar bodies are corruption, not silent skips", () => {
		const tmp = makeTempTarget();
		try {
			writeEvidence(tmp, "null-body", "null");
			writeEvidence(tmp, "scalar", "42");
			const out = evidence(tmp);
			assert.equal(out.availability, "partial");
			assert.equal(out.warnings.length, 2);
			assert.deepEqual(out.regressionProposals, []);
		} finally {
			cleanup(tmp);
		}
	});

	it("warnings never include raw trace input or proposal assertions", () => {
		const tmp = makeTempTarget();
		try {
			writeEvidence(tmp, "leaky", "{ broken trace secret-trace-abc");
			const out = evidence(tmp);
			assert.equal(out.availability, "partial");
			for (const warning of out.warnings) {
				assert.ok(!warning.includes("secret-trace-abc"));
				assert.ok(!warning.includes("secret"));
			}
		} finally {
			cleanup(tmp);
		}
	});

	it("does not require Team Distribution registry state", () => {
		const tmp = makeTempTarget();
		try {
			// No .amber/team, no registry — evidence must still work.
			writeEvidence(tmp, "good", validProposal("good", "assert"));
			const out = evidence(tmp);
			assert.equal(out.availability, "complete");
			assert.deepEqual(out.errors, []);
			assert.equal(out.regressionProposals.length, 1);
		} finally {
			cleanup(tmp);
		}
	});

	it("evolution findings retain significance semantics", () => {
		const tmp = makeTempTarget();
		try {
			const wikiDir = path.join(tmp, "docs", "wiki", "engineering");
			fs.mkdirSync(wikiDir, { recursive: true });
			fs.writeFileSync(
				path.join(wikiDir, "harness-evolution.md"),
				"Finding: flaky continue\nFinding: flaky continue\nFinding: one-off\n",
				"utf8",
			);
			const out = evidence(tmp);
			assert.equal(out.availability, "complete");
			assert.deepEqual(
				out.evolution.significant.map((f) => f.finding),
				["flaky continue"],
			);
		} finally {
			cleanup(tmp);
		}
	});

	it("facade outcome has stable envelope keys", () => {
		const tmp = makeTempTarget();
		try {
			const out = evidence(tmp);
			assert.deepEqual(Object.keys(out).sort(), [
				"availability",
				"errors",
				"evolution",
				"regressionProposals",
				"target",
				"warnings",
			]);
		} finally {
			cleanup(tmp);
		}
	});
});
