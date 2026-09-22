"use strict";

// F068 H2a — Execution boundary (Harness v2 §13/§31): the DECLARED contract,
// the EFFECTIVE report from adapters that compose the one worktree seam, and
// the deterministic declared/effective/observed comparison whose violation is
// a BLOCK posture, never a silent continuation. GitWorktree fixtures run in
// real temporary git repositories.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { dispatch } = require("../../scripts/lib/command-dispatcher");
const { listWorktrees } = require("../../scripts/lib/worktree-manager");
const {
	compareBoundaries,
	CODE_ALREADY_PREPARED,
	CODE_ALREADY_EVALUATED,
} = require("../../scripts/lib/harness/execution-adapter");
const { readRunEvents } = require("../../scripts/lib/harness/event-ledger");

function tmpTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-harness-exec-${label}-`));
}

function git(cwd, args) {
	const run = spawnSync("git", args, { cwd, encoding: "utf8" });
	assert.equal(run.status, 0, `git ${args.join(" ")} failed: ${run.stderr || run.stdout}`);
	return run.stdout;
}

function initRepo(dir) {
	git(dir, ["init", "-b", "main"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "test"]);
	fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
	git(dir, ["add", "."]);
	git(dir, ["commit", "-m", "init"]);
}

function contractBody(overrides = {}) {
	return {
		apiVersion: "amber.dev/v1",
		kind: "ExecutionContract",
		metadata: { id: "exec-coding", version: "1" },
		workspace: { type: "git-worktree", base: "HEAD" },
		filesystem: { read: ["src"], write: ["src"], deny: [".amber", "secrets"] },
		network: { mode: "deny" },
		resources: { timeoutMinutes: 30, maxChildren: 8 },
		mutation: { mode: "isolated" },
		...overrides,
	};
}

function writeContract(target, body, name = "exec.json") {
	const file = path.join(target, name);
	fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
	return file;
}

function admitViaCli(target, file) {
	return dispatch("harness", { target, file, json: true, _: ["execution", "admit"] });
}

function executionContractAdmitted(target) {
	admitViaCli(target, writeContract(target, contractBody()));
}

test("execution contracts admit immutably; bad prefixes refuse in core", () => {
	const target = tmpTarget("contract");
	try {
		const first = admitViaCli(target, writeContract(target, contractBody()));
		assert.equal(first.exitCode, 0);
		assert.match(first.result.snapshotHash, /^sha256:[0-9a-f]{64}$/);
		const identical = admitViaCli(target, writeContract(target, contractBody(), "again.json"));
		assert.equal(identical.result.idempotent, true);

		fs.writeFileSync(
			writeContract(
				target,
				contractBody({ metadata: { id: "exec-bad", version: "1" } }),
				"bad.json",
			),
			JSON.stringify(
				contractBody({
					metadata: { id: "exec-bad", version: "1" },
					filesystem: { read: ["../outside"], write: [], deny: [] },
				}),
			),
			"utf8",
		);
		const traversal = dispatch("harness", {
			target,
			file: "bad.json",
			json: true,
			_: ["execution", "admit"],
		});
		assert.equal(traversal.exitCode, 1);
		assert.match(traversal.result.errors[0], /repo-relative posix prefix/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the git-worktree adapter prepares a real workspace and reports the effective boundary", () => {
	const target = tmpTarget("worktree");
	try {
		initRepo(target);
		executionContractAdmitted(target);
		const contractForRun = path.join(target, "contract2.json");
		fs.writeFileSync(
			contractForRun,
			JSON.stringify({
				apiVersion: "amber.dev/v1",
				kind: "HarnessContract",
				metadata: { id: "harness-exec", version: "1" },
				agent: { id: "worker", role: "implementation" },
				governance: { policy: "default-safe" },
			}),
			"utf8",
		);
		dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-exec-1",
			_: ["start"],
		});

		const { result, exitCode } = dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-exec-1",
			_: ["execution", "prepare"],
		});
		assert.equal(exitCode, 0);
		assert.equal(result.record.effective.workspace.type, "git-worktree");
		assert.equal(result.record.effective.network.mode, "deny", "defaults apply consistently");
		assert.ok(fs.existsSync(result.record.effective.workspace.path), "the worktree exists on disk");
		assert.ok(
			listWorktrees(target).some((p) => p.replace(/\\/g, "/").includes("run-exec-1")),
			"the adapter composes the one worktree seam",
		);

		const second = dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-exec-1",
			_: ["execution", "prepare"],
		});
		assert.equal(second.exitCode, 1);
		assert.equal(second.result.code, CODE_ALREADY_PREPARED);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the local adapter prepares the bounded root without touching git", () => {
	const target = tmpTarget("local");
	try {
		admitViaCli(
			target,
			writeContract(
				target,
				contractBody({
					metadata: { id: "exec-local", version: "1" },
					workspace: { type: "local", base: "HEAD" },
				}),
				"local.json",
			),
		);
		const { result, exitCode } = dispatch("harness", {
			target,
			json: true,
			contract: "exec-local",
			run: "run-local-1",
			_: ["execution", "prepare"],
		});
		assert.equal(exitCode, 0);
		assert.equal(result.record.effective.workspace.type, "local");
		assert.equal(result.record.effective.workspace.path, target);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the §13 fold: ok, violation, and unevaluated are deterministic", () => {
	const declared = contractBody();
	const effective = {
		workspace: { type: "git-worktree", path: "wt", base: "main", branch: "b" },
		filesystem: { read: ["src"], write: ["src"], deny: [".amber", "secrets"] },
		network: { mode: "deny" },
		resources: { timeoutMinutes: 30, maxChildren: 8 },
		mutation: { mode: "isolated" },
	};

	const ok = compareBoundaries(declared, effective, [
		{ kind: "mutation", paths: ["src/changes.patch"], source: "ledger#1" },
		{ kind: "refusal", paths: ["secrets/key"], source: "ledger#2" },
	]);
	assert.equal(ok.verdict, "ok");
	assert.ok(ok.findings.some((f) => f.severity === "info" && f.kind === "refusal-observed"));

	const denied = compareBoundaries(declared, effective, [
		{ kind: "mutation", paths: ["secrets/key"], source: "ledger#3" },
	]);
	assert.equal(denied.verdict, "violation");
	assert.ok(denied.findings.some((f) => f.kind === "denied-path-mutation"));

	const outside = compareBoundaries(declared, effective, [
		{ kind: "mutation", paths: ["docs/readme.md"], source: "ledger#4" },
	]);
	assert.equal(outside.verdict, "violation");
	assert.ok(outside.findings.some((f) => f.kind === "outside-declared-write"));

	const slow = compareBoundaries(declared, effective, [
		{ kind: "mutation", paths: ["src/a"], timeoutMinutes: 90, source: "ledger#5" },
	]);
	assert.equal(slow.verdict, "violation");
	assert.ok(slow.findings.some((f) => f.kind === "declared-timeout-exceeded"));

	const drift = compareBoundaries(declared, { ...effective, network: { mode: "allow" } }, [
		{ kind: "mutation", paths: ["src/a"], source: "ledger#6" },
	]);
	assert.equal(drift.verdict, "violation");
	assert.ok(drift.findings.some((f) => f.kind === "effective-deviates-from-declared"));

	const unevaluated = compareBoundaries(declared, effective, []);
	assert.equal(unevaluated.verdict, "unevaluated");
});

test("evaluate records the comparison, integrates the run, and BLOCKs on violation", () => {
	const target = tmpTarget("evaluate");
	try {
		initRepo(target);
		executionContractAdmitted(target);
		const contractForRun = path.join(target, "contract2.json");
		fs.writeFileSync(
			contractForRun,
			JSON.stringify({
				apiVersion: "amber.dev/v1",
				kind: "HarnessContract",
				metadata: { id: "harness-exec", version: "1" },
				agent: { id: "worker", role: "implementation" },
				governance: { policy: "default-safe" },
			}),
			"utf8",
		);
		dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-block-1",
			_: ["start"],
		});
		dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-block-1",
			_: ["execution", "prepare"],
		});

		// The violating observed trail: a mutation in a denied prefix.
		const observedFile = path.join(target, "observed.json");
		fs.writeFileSync(
			observedFile,
			JSON.stringify([{ kind: "mutation", paths: ["secrets/key"], source: "ledger#9" }]),
			"utf8",
		);
		const { result, exitCode } = dispatch("harness", {
			target,
			json: true,
			run: "run-block-1",
			file: "observed.json",
			_: ["execution", "evaluate"],
		});
		assert.equal(exitCode, 0);
		assert.equal(result.comparison.verdict, "violation");

		const shown = dispatch("harness", {
			target,
			json: true,
			run: "run-block-1",
			_: ["execution", "inspect"],
		});
		assert.equal(shown.result.record.comparison.verdict, "violation");
		assert.equal(shown.result.record.effective.workspace.type, "git-worktree");
		assert.equal(shown.result.record.contractSnapshotHash.length > 0, true);

		// The run carries the boundary and is BLOCKed out of proceeding.
		const status = dispatch("harness", { target, json: true, run: "run-block-1", _: ["status"] });
		assert.equal(status.result.run.execution.contract, "exec-coding");
		assert.equal(status.result.run.state, "cancelled");
		assert.match(status.result.run.stateHistory.at(-1).reason || "", /boundary violation/);
		const events = readRunEvents(target, "run-block-1").map((event) => event.kind);
		assert.ok(events.includes("execution.failed"), "the BLOCK posture lands on the trail");

		const again = dispatch("harness", {
			target,
			json: true,
			run: "run-block-1",
			file: "observed.json",
			_: ["execution", "evaluate"],
		});
		assert.equal(again.exitCode, 1);
		assert.equal(again.result.code, CODE_ALREADY_EVALUATED);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("an unevaluated evaluation records the verdict without inventing ok", () => {
	const target = tmpTarget("uneval");
	try {
		initRepo(target);
		executionContractAdmitted(target);
		const contractForRun = path.join(target, "contract2.json");
		fs.writeFileSync(
			contractForRun,
			JSON.stringify({
				apiVersion: "amber.dev/v1",
				kind: "HarnessContract",
				metadata: { id: "harness-exec", version: "1" },
				agent: { id: "worker", role: "implementation" },
				governance: { policy: "default-safe" },
			}),
			"utf8",
		);
		dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-uneval-1",
			_: ["start"],
		});
		dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-uneval-1",
			_: ["execution", "prepare"],
		});
		const { result } = dispatch("harness", {
			target,
			json: true,
			run: "run-uneval-1",
			_: ["execution", "evaluate"],
		});
		assert.equal(result.comparison.verdict, "unevaluated");
		const status = dispatch("harness", { target, json: true, run: "run-uneval-1", _: ["status"] });
		assert.equal(status.result.run.state, "created", "no invented progression");
		const events = readRunEvents(target, "run-uneval-1").map((event) => event.kind);
		assert.equal(events.includes("execution.failed"), false);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});
