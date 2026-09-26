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
const { listWorktrees, removeWorktree } = require("../../scripts/lib/worktree-manager");
const {
	compareBoundaries,
	CODE_ALREADY_PREPARED,
	CODE_ALREADY_RELEASED,
	CODE_RUN_TERMINAL,
} = require("../../scripts/lib/harness/execution-adapter");
const { executeInPreparedWorkspace } = require("../../scripts/lib/core/execution-domain-adapter");
const { createWorktree } = require("../../scripts/lib/worktree-manager");
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

async function admitViaCli(target, file) {
	return await dispatch("harness", { target, file, json: true, _: ["execution", "admit"] });
}

async function executionContractAdmitted(target) {
	await admitViaCli(target, writeContract(target, contractBody()));
}

// Byte-level whole-target snapshot: file bytes plus directory entries (empty
// directories included). F078 uses this to prove the explicit terminate
// refusal performs zero target reads-with-repair and zero writes/deletions.
function targetTreeBytes(target) {
	const rows = [];
	const walk = (dir) => {
		for (const entry of fs
			.readdirSync(dir, { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name))) {
			const full = path.join(dir, entry.name);
			const relative = path.relative(target, full).replaceAll("\\", "/");
			if (entry.isDirectory()) {
				rows.push(`${relative}/`);
				walk(full);
			} else {
				rows.push(`${relative}=${fs.readFileSync(full).toString("base64")}`);
			}
		}
	};
	walk(target);
	return rows;
}

async function prepareLocalRun(target, runId) {
	const admitted = await admitViaCli(
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
	assert.equal(admitted.exitCode, 0);
	const harnessFile = path.join(target, "harness-contract.json");
	fs.writeFileSync(
		harnessFile,
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "HarnessContract",
			metadata: { id: "harness-exec", version: "1" },
			agent: { id: "worker", role: "implementation" },
			governance: { policy: "default-safe" },
		}),
		"utf8",
	);
	assert.equal(
		await dispatch("harness", { target, file: harnessFile, json: true, _: ["admit"] }).exitCode,
		0,
	);
	assert.equal(
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: runId,
			_: ["start"],
		}).exitCode,
		0,
	);
	const prepared = await dispatch("harness", {
		target,
		json: true,
		contract: "exec-local",
		run: runId,
		_: ["execution", "prepare"],
	});
	assert.equal(prepared.exitCode, 0);
	assert.ok(fs.existsSync(prepared.result.record.effective.workspace.path));
	return prepared.result.record;
}

test("execution contracts admit immutably; bad prefixes refuse in core", async () => {
	const target = tmpTarget("contract");
	try {
		const first = await admitViaCli(target, writeContract(target, contractBody()));
		assert.equal(first.exitCode, 0);
		assert.match(first.result.snapshotHash, /^sha256:[0-9a-f]{64}$/);
		const identical = await admitViaCli(
			target,
			writeContract(target, contractBody(), "again.json"),
		);
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
		const traversal = await dispatch("harness", {
			target,
			file: "bad.json",
			json: true,
			_: ["execution", "admit"],
		});
		assert.equal(traversal.exitCode, 1);
		assert.match(traversal.result.errors[0], /repo-relative posix prefix/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("the git-worktree adapter prepares a real workspace and reports the effective boundary", async () => {
	const target = tmpTarget("worktree");
	try {
		initRepo(target);
		await executionContractAdmitted(target);
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
		await dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-exec-1",
			_: ["start"],
		});

		const { result, exitCode } = await dispatch("harness", {
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

		const second = await dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-exec-1",
			_: ["execution", "prepare"],
		});
		assert.equal(second.exitCode, 1);
		assert.equal(second.result.code, CODE_ALREADY_PREPARED);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("the local adapter prepares the bounded root without touching git", async () => {
	const target = tmpTarget("local");
	try {
		await admitViaCli(
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
		const { result, exitCode } = await dispatch("harness", {
			target,
			json: true,
			contract: "exec-local",
			run: "run-local-1",
			_: ["execution", "prepare"],
		});
		assert.equal(exitCode, 0);
		assert.equal(result.record.effective.workspace.type, "local");
		// F070 H2b: the main checkout is never the default cwd of a prepared
		// run (§31) — local prepares a bounded scratch root under the state area.
		const wsPath = result.record.effective.workspace.path;
		assert.notEqual(wsPath, target);
		assert.ok(fs.existsSync(wsPath), "the bounded scratch root exists on disk");
		assert.ok(
			wsPath.replace(/\\/g, "/").includes(".amber/harness/workspaces/run-local-1"),
			"the bounded root lives under the harness state area",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("execution terminate is an explicit zero-write refusal, not cancel+release disguised as kill", async () => {
	const target = tmpTarget("terminate-refusal");
	try {
		const runId = "run-terminate-1";
		const prepared = await prepareLocalRun(target, runId);
		const workspace = prepared.effective.workspace.path;
		const before = targetTreeBytes(target);
		const refused = await dispatch("harness", {
			target,
			json: true,
			run: runId,
			_: ["execution", "terminate"],
		});
		assert.equal(refused.exitCode, 1);
		assert.equal(refused.result.code, "AMBER_E_INVALID_ARG");
		const message = refused.result.errors.join("\n");
		assert.match(message, /explicit refusal/);
		assert.match(message, /harness execution cancel --run <id> --decision/);
		assert.match(message, /harness execution handles/);
		assert.match(message, /harness advance --run <id> --to cancelled/);
		assert.match(message, /runner execution abort --request-hash/);
		assert.match(message, /harness execution release --run <id>/);
		assert.match(message, /BLOCK posture/);
		assert.deepEqual(
			targetTreeBytes(target),
			before,
			"refusal changes no target byte or directory",
		);
		assert.ok(fs.existsSync(workspace), "refusal never releases the prepared workspace");

		// Capability absence is target-independent: a missing id and no id at all
		// return the same semantic refusal, not RUN_NOT_FOUND / required-flag.
		for (const args of [
			{ run: "run-missing", _: ["execution", "terminate"] },
			{ _: ["execution", "terminate"] },
		]) {
			const snapshot = targetTreeBytes(target);
			const result = await dispatch("harness", { target, json: true, ...args });
			assert.equal(result.exitCode, 1);
			assert.equal(result.result.code, "AMBER_E_INVALID_ARG");
			assert.match(result.result.errors.join("\n"), /explicit refusal/);
			assert.doesNotMatch(result.result.errors.join("\n"), /not found|required/);
			assert.deepEqual(targetTreeBytes(target), snapshot);
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("raw CLI routes execution terminate to the explicit refusal, not unknown action", async () => {
	const target = tmpTarget("terminate-rawcli");
	try {
		const cli = path.join(__dirname, "..", "..", "scripts", "amber.js");
		for (const argv of [["--run", "run-any"], []]) {
			const before = targetTreeBytes(target);
			const result = spawnSync(
				process.execPath,
				[cli, "harness", "execution", "terminate", ...argv, "--target", target, "--json"],
				{ encoding: "utf8" },
			);
			assert.equal(result.status, 1);
			assert.match(result.stdout, /AMBER_E_INVALID_ARG/);
			assert.match(result.stdout, /explicit refusal/);
			assert.match(result.stdout, /harness execution cancel/);
			assert.doesNotMatch(result.stdout, /requires admit, list, inspect/);
			assert.deepEqual(targetTreeBytes(target), before);
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("executeInPreparedWorkspace runs in the prepared path and creates no worktree", async () => {
	const target = tmpTarget("prepared-seam");
	try {
		initRepo(target);
		const prepared = createWorktree(target, "h2b-prepared-1");
		assert.equal(prepared.success, true);
		const before = listWorktrees(target);
		const mutation = `node -e "require('fs').writeFileSync('prepared-mut.txt','x')"`;
		const { result, error } = await executeInPreparedWorkspace(prepared.path, mutation, 1, {});
		assert.equal(error, undefined);
		assert.equal(result.exitCode, 0, JSON.stringify(result));
		assert.ok(fs.existsSync(path.join(prepared.path, "prepared-mut.txt")), "mutates the workspace");
		assert.equal(
			fs.existsSync(path.join(target, "prepared-mut.txt")),
			false,
			"main checkout clean",
		);
		assert.deepEqual(listWorktrees(target), before, "no worktree created or auto-removed");
		removeWorktree(target, "h2b-prepared-1");
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("the §13 fold: ok, violation, and unevaluated are deterministic", async () => {
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

test("evaluate records the comparison, integrates the run, and BLOCKs on violation", async () => {
	const target = tmpTarget("evaluate");
	try {
		initRepo(target);
		await executionContractAdmitted(target);
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
		await dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-block-1",
			_: ["start"],
		});
		await dispatch("harness", {
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
		const { result, exitCode } = await dispatch("harness", {
			target,
			json: true,
			run: "run-block-1",
			file: "observed.json",
			_: ["execution", "evaluate"],
		});
		assert.equal(exitCode, 0);
		assert.equal(result.comparison.verdict, "violation");

		const shown = await dispatch("harness", {
			target,
			json: true,
			run: "run-block-1",
			_: ["execution", "inspect"],
		});
		assert.equal(shown.result.record.comparison.verdict, "violation");
		assert.equal(shown.result.record.effective.workspace.type, "git-worktree");
		assert.equal(shown.result.record.contractSnapshotHash.length > 0, true);

		// The run carries the boundary and is BLOCKed out of proceeding.
		const status = await dispatch("harness", {
			target,
			json: true,
			run: "run-block-1",
			_: ["status"],
		});
		assert.equal(status.result.run.execution.contract, "exec-coding");
		assert.equal(status.result.run.state, "cancelled");
		assert.match(status.result.run.stateHistory.at(-1).reason || "", /boundary violation/);
		const events = readRunEvents(target, "run-block-1").map((event) => event.kind);
		assert.ok(events.includes("execution.failed"), "the BLOCK posture lands on the trail");

		// F070 H2b: observed growth replaces the H2a one-shot refusal. A
		// second, identical evaluation is idempotent (appends nothing).
		const again = await dispatch("harness", {
			target,
			json: true,
			run: "run-block-1",
			file: "observed.json",
			_: ["execution", "evaluate"],
		});
		assert.equal(again.exitCode, 0);
		assert.equal(again.result.appended, 0);
		assert.equal(again.result.comparison.verdict, "violation");
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("an unevaluated evaluation records the verdict without inventing ok", async () => {
	const target = tmpTarget("uneval");
	try {
		initRepo(target);
		await executionContractAdmitted(target);
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
		await dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-uneval-1",
			_: ["start"],
		});
		await dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-uneval-1",
			_: ["execution", "prepare"],
		});
		const { result } = await dispatch("harness", {
			target,
			json: true,
			run: "run-uneval-1",
			_: ["execution", "evaluate"],
		});
		assert.equal(result.comparison.verdict, "unevaluated");
		const status = await dispatch("harness", {
			target,
			json: true,
			run: "run-uneval-1",
			_: ["status"],
		});
		assert.equal(status.result.run.state, "created", "no invented progression");
		const events = readRunEvents(target, "run-uneval-1").map((event) => event.kind);
		assert.equal(events.includes("execution.failed"), false);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// F070 H2b — the §40 gate as a live run: prepare a real worktree, execute one
// governed named command inside it (four gates on the governed ledger), let
// the run's own observation append the mutation entry, and watch a violating
// second attempt BLOCK the run from the run's own trail.
test("a governed attempt in the prepared workspace observes its mutations and recomputes the fold", async () => {
	const target = tmpTarget("h2b-run");
	try {
		initRepo(target);
		// Declared write prefix: src/ only. The mutating command touches src/.
		await executionContractAdmitted(target);
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
		await dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-h2b-1",
			_: ["start"],
		});
		await dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-h2b-1",
			_: ["execution", "prepare"],
		});
		// The run must be admitted before it runs (admitted→running on advance).
		const admission = ["identity", "contract", "policy", "context", "execution", "approval"].map(
			(name) => `${name}:fixture#${name}`,
		);
		const admitted = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-1",
			to: "admitted",
			checks: admission,
			_: ["advance"],
		});
		assert.equal(admitted.exitCode, 0, JSON.stringify(admitted.errors || admitted.result));
		const running = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-1",
			to: "running",
			_: ["advance"],
		});
		assert.equal(running.exitCode, 0, JSON.stringify(running.errors || running.result));

		// The closed named command: writes inside src/ (declared write prefix).
		const rulesPath = path.join(target, ".amber", "governance", "rules.json");
		fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
		const mutation = `node -e "require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/h2b.txt','x')"`;
		fs.writeFileSync(
			rulesPath,
			JSON.stringify({
				schemaVersion: 1,
				defaultAction: "deny",
				confidence_gating: {
					enabled: true,
					byRule: { "h2b-write-src": "high" },
					defaultConfidence: "low",
				},
				rules: [{ id: "h2b-write-src", action: "allow", match: "exact", pattern: mutation }],
			}),
			"utf8",
		);
		// The run's governed ledger needs one unconsumed approval.
		const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
		appendLedgerRecord(path.join(target, ".amber", "loops", "run-h2b-1", "ledger.jsonl"), {
			kind: "approved",
			approvalKey: "run-h2b-1:approval",
		});

		const attempt1 = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-1",
			commandId: "h2b-write-src",
			_: ["execution", "run"],
		});
		assert.equal(attempt1.exitCode, 0, JSON.stringify(attempt1.result));
		// note: defineCommand strips the control field `ok` from the payload —
		// the attempt's presence (attemptId) is the success marker here.
		assert.ok(attempt1.result.attemptId);
		assert.equal(attempt1.result.observedEntry.kind, "mutation");
		assert.match(attempt1.result.observedEntry.source, /^governed-ledger:run-h2b-1#att-/);
		assert.ok(
			// porcelain reports a fully-new directory as "?? src/" — the raw
			// observed fact; the prefix fold handles both forms.
			attempt1.result.observedEntry.paths.some((p) => p.replace(/\\/g, "/").startsWith("src/")),
			"the run's own observation sees the mutation",
		);
		assert.equal(attempt1.result.comparison.verdict, "ok", "declared write prefix holds");

		// The mutation landed in the prepared worktree; the main checkout is clean.
		const record = JSON.parse(
			fs.readFileSync(
				path.join(target, ".amber", "harness", "executions", "run-h2b-1.json"),
				"utf8",
			),
		);
		assert.ok(fs.existsSync(path.join(record.effective.workspace.path, "src", "h2b.txt")));
		assert.equal(fs.existsSync(path.join(target, "src", "h2b.txt")), false);

		// Release removes the workspace as a recorded step; a second release refuses.
		const released = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-1",
			_: ["execution", "release"],
		});
		assert.equal(released.exitCode, 0);
		assert.ok(released.result.releasedAt);
		assert.equal(fs.existsSync(record.effective.workspace.path), false, "worktree removed");
		const again = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-1",
			_: ["execution", "release"],
		});
		assert.equal(again.exitCode, 1);
		assert.equal(again.result.code, CODE_ALREADY_RELEASED);
		// A released workspace never executes again.
		const afterRelease = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-1",
			commandId: "h2b-write-src",
			_: ["execution", "run"],
		});
		assert.equal(afterRelease.exitCode, 1);
		assert.equal(afterRelease.result.code, CODE_ALREADY_RELEASED);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("a violating governed attempt BLOCKs the run from its own observation", async () => {
	const target = tmpTarget("h2b-violate");
	try {
		initRepo(target);
		await executionContractAdmitted(target);
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
		await dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-h2b-2",
			_: ["start"],
		});
		await dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-h2b-2",
			_: ["execution", "prepare"],
		});
		const admission = ["identity", "contract", "policy", "context", "execution", "approval"].map(
			(name) => `${name}:fixture#${name}`,
		);
		const admitted = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-2",
			to: "admitted",
			checks: admission,
			_: ["advance"],
		});
		assert.equal(admitted.exitCode, 0, JSON.stringify(admitted.errors || admitted.result));
		const running = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-2",
			to: "running",
			_: ["advance"],
		});
		assert.equal(running.exitCode, 0, JSON.stringify(running.errors || running.result));

		// The closed named command writes OUTSIDE every declared write prefix.
		const rulesPath = path.join(target, ".amber", "governance", "rules.json");
		fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
		const violation = `node -e "require('fs').writeFileSync('outside.txt','x')"`;
		fs.writeFileSync(
			rulesPath,
			JSON.stringify({
				schemaVersion: 1,
				defaultAction: "deny",
				confidence_gating: {
					enabled: true,
					byRule: { "h2b-write-outside": "high" },
					defaultConfidence: "low",
				},
				rules: [{ id: "h2b-write-outside", action: "allow", match: "exact", pattern: violation }],
			}),
			"utf8",
		);
		const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
		appendLedgerRecord(path.join(target, ".amber", "loops", "run-h2b-2", "ledger.jsonl"), {
			kind: "approved",
			approvalKey: "run-h2b-2:approval",
		});

		const attempt = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-2",
			commandId: "h2b-write-outside",
			_: ["execution", "run"],
		});
		assert.equal(attempt.exitCode, 0, JSON.stringify(attempt.result));
		assert.equal(attempt.result.comparison.verdict, "violation");
		assert.ok(attempt.result.comparison.findings.some((f) => f.kind === "outside-declared-write"));

		const status = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-2",
			_: ["status"],
		});
		assert.equal(status.result.run.state, "blocked", "BLOCK posture from the run's own trail");
		const events = readRunEvents(target, "run-h2b-2").map((event) => event.kind);
		assert.ok(events.includes("execution.failed"));

		// A blocked run never executes (human recovery first); the command is refused.
		const refused = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-2",
			commandId: "h2b-write-outside",
			_: ["execution", "run"],
		});
		assert.equal(refused.exitCode, 1);
		assert.equal(refused.result.code, CODE_RUN_TERMINAL);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// Review-driven coverage (stage-7 standards axis): a command that EXECUTES but
// exits non-zero is a completed governed attempt — its mutations are still
// observed and folded, and the failure rides the result instead of masquerading
// as a gate refusal.
test("a failing command still observes and folds; the failure rides the result", async () => {
	const target = tmpTarget("h2b-failcmd");
	try {
		initRepo(target);
		await executionContractAdmitted(target);
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
		await dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-h2b-3",
			_: ["start"],
		});
		await dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-h2b-3",
			_: ["execution", "prepare"],
		});
		const rulesPath = path.join(target, ".amber", "governance", "rules.json");
		fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
		const failing = `node -e "process.exit(3)"`;
		fs.writeFileSync(
			rulesPath,
			JSON.stringify({
				schemaVersion: 1,
				defaultAction: "deny",
				confidence_gating: {
					enabled: true,
					byRule: { "h2b-fail": "high" },
					defaultConfidence: "low",
				},
				rules: [{ id: "h2b-fail", action: "allow", match: "exact", pattern: failing }],
			}),
			"utf8",
		);
		const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
		appendLedgerRecord(path.join(target, ".amber", "loops", "run-h2b-3", "ledger.jsonl"), {
			kind: "approved",
			approvalKey: "run-h2b-3:approval",
		});
		const attempt = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-3",
			commandId: "h2b-fail",
			_: ["execution", "run"],
		});
		assert.equal(attempt.exitCode, 1, "a failed command reports non-zero");
		assert.ok(attempt.result.observedEntry, "the attempt was still observed");
		assert.equal(attempt.result.comparison.verdict, "ok", "the fold ran over the attempt");
		assert.ok(attempt.result.errors.length > 0, "the command failure is reported");
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("a gate refusal fails closed: refused result, non-zero exit, no observation", async () => {
	const target = tmpTarget("h2b-refusal");
	try {
		initRepo(target);
		await executionContractAdmitted(target);
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
		await dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-h2b-4",
			_: ["start"],
		});
		await dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-h2b-4",
			_: ["execution", "prepare"],
		});
		// The closed rule exists, but the run's ledger has NO unconsumed approval.
		const rulesPath = path.join(target, ".amber", "governance", "rules.json");
		fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
		fs.writeFileSync(
			rulesPath,
			JSON.stringify({
				schemaVersion: 1,
				defaultAction: "deny",
				confidence_gating: {
					enabled: true,
					byRule: { "h2b-ok": "high" },
					defaultConfidence: "low",
				},
				rules: [
					{
						id: "h2b-ok",
						action: "allow",
						match: "exact",
						pattern: `node -e "require('fs').writeFileSync('src/never.txt','x')"`,
					},
				],
			}),
			"utf8",
		);
		const attempt = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-4",
			commandId: "h2b-ok",
			_: ["execution", "run"],
		});
		assert.equal(attempt.exitCode, 1);
		assert.equal(attempt.result.refused, true);
		assert.ok(attempt.result.errors.length > 0, "the gate's refusal is surfaced");
		const record = JSON.parse(
			fs.readFileSync(
				path.join(target, ".amber", "harness", "executions", "run-h2b-4.json"),
				"utf8",
			),
		);
		assert.equal(record.observed, undefined, "a refused attempt observes nothing");
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

test("a local bounded-root workspace runs, observes by listing, and releases by deletion", async () => {
	const target = tmpTarget("h2b-local-run");
	try {
		initRepo(target);
		await admitViaCli(
			target,
			writeContract(
				target,
				contractBody({
					metadata: { id: "exec-local-run", version: "1" },
					workspace: { type: "local", base: "HEAD" },
					filesystem: { read: [], write: [], deny: [".amber"] },
				}),
				"local-run.json",
			),
		);
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
		await dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-h2b-5",
			_: ["start"],
		});
		const prepared = await dispatch("harness", {
			target,
			json: true,
			contract: "exec-local-run",
			run: "run-h2b-5",
			_: ["execution", "prepare"],
		});
		const boundedRoot = prepared.result.record.effective.workspace.path;
		assert.notEqual(boundedRoot, target);
		const rulesPath = path.join(target, ".amber", "governance", "rules.json");
		fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
		const mutation = `node -e "require('fs').writeFileSync('local-artifact.txt','x')"`;
		fs.writeFileSync(
			rulesPath,
			JSON.stringify({
				schemaVersion: 1,
				defaultAction: "deny",
				confidence_gating: {
					enabled: true,
					byRule: { "h2b-local": "high" },
					defaultConfidence: "low",
				},
				rules: [{ id: "h2b-local", action: "allow", match: "exact", pattern: mutation }],
			}),
			"utf8",
		);
		const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
		appendLedgerRecord(path.join(target, ".amber", "loops", "run-h2b-5", "ledger.jsonl"), {
			kind: "approved",
			approvalKey: "run-h2b-5:approval",
		});
		const attempt = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-5",
			commandId: "h2b-local",
			_: ["execution", "run"],
		});
		assert.equal(attempt.exitCode, 0, JSON.stringify(attempt.result));
		assert.equal(attempt.result.observedEntry.observedVia, "bounded-root-listing");
		assert.ok(
			attempt.result.observedEntry.paths.includes("local-artifact.txt"),
			"the listing sees the mutation",
		);
		assert.equal(attempt.result.comparison.verdict, "ok");
		assert.equal(fs.existsSync(path.join(boundedRoot, "local-artifact.txt")), true);
		assert.equal(
			fs.existsSync(path.join(target, "local-artifact.txt")),
			false,
			"main checkout clean",
		);

		const released = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-5",
			_: ["execution", "release"],
		});
		assert.equal(released.exitCode, 0, JSON.stringify(released.result));
		assert.equal(fs.existsSync(boundedRoot), false, "the bounded root is deleted on release");
		// A released record refuses evaluation (nothing new can be observed).
		const evaluated = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-5",
			_: ["execution", "evaluate"],
		});
		assert.equal(evaluated.exitCode, 1);
		assert.equal(evaluated.result.code, CODE_ALREADY_RELEASED);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// User Story 3 as a live sequence: two DISTINCT attempts accumulate into one
// trail, and the final verdict spans both sources (attempt 2 BLOCKs the run).
test("a multi-attempt trail grows across attempts and the final verdict spans both", async () => {
	const target = tmpTarget("h2b-multi");
	try {
		initRepo(target);
		await executionContractAdmitted(target);
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
		await dispatch("harness", { target, file: contractForRun, json: true, _: ["admit"] });
		await dispatch("harness", {
			target,
			json: true,
			contract: "harness-exec",
			agent: "worker",
			run: "run-h2b-6",
			_: ["start"],
		});
		await dispatch("harness", {
			target,
			json: true,
			contract: "exec-coding",
			run: "run-h2b-6",
			_: ["execution", "prepare"],
		});
		const admission = ["identity", "contract", "policy", "context", "execution", "approval"].map(
			(name) => `${name}:fixture#${name}`,
		);
		const admitted = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-6",
			to: "admitted",
			checks: admission,
			_: ["advance"],
		});
		assert.equal(admitted.exitCode, 0);
		const running = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-6",
			to: "running",
			_: ["advance"],
		});
		assert.equal(running.exitCode, 0);

		const rulesPath = path.join(target, ".amber", "governance", "rules.json");
		fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
		const okMutation = `node -e "require('fs').mkdirSync('src',{recursive:true});require('fs').writeFileSync('src/one.txt','1')"`;
		const badMutation = `node -e "require('fs').writeFileSync('two.txt','2')"`;
		fs.writeFileSync(
			rulesPath,
			JSON.stringify({
				schemaVersion: 1,
				defaultAction: "deny",
				confidence_gating: {
					enabled: true,
					byRule: { "h2b-multi-ok": "high", "h2b-multi-bad": "high" },
					defaultConfidence: "low",
				},
				rules: [
					{ id: "h2b-multi-ok", action: "allow", match: "exact", pattern: okMutation },
					{ id: "h2b-multi-bad", action: "allow", match: "exact", pattern: badMutation },
				],
			}),
			"utf8",
		);
		const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
		const ledgerPath = path.join(target, ".amber", "loops", "run-h2b-6", "ledger.jsonl");
		appendLedgerRecord(ledgerPath, { kind: "approved", approvalKey: "run-h2b-6:approval-1" });
		const first = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-6",
			commandId: "h2b-multi-ok",
			_: ["execution", "run"],
		});
		assert.equal(first.exitCode, 0, JSON.stringify(first.result));
		assert.equal(first.result.comparison.verdict, "ok", "attempt 1 holds the declared prefix");

		// Attempt 2 consumes its OWN single-use approval (F052 fixture convention).
		appendLedgerRecord(ledgerPath, { kind: "approved", approvalKey: "run-h2b-6:approval-2" });
		const second = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-6",
			commandId: "h2b-multi-bad",
			_: ["execution", "run"],
		});
		assert.equal(second.exitCode, 0, JSON.stringify(second.result));
		assert.equal(second.result.comparison.verdict, "violation", "attempt 2 violates");
		assert.notEqual(second.result.attemptId, first.result.attemptId, "distinct attempts");

		const record = JSON.parse(
			fs.readFileSync(
				path.join(target, ".amber", "harness", "executions", "run-h2b-6.json"),
				"utf8",
			),
		);
		assert.equal(record.observed.entries.length, 2, "the trail spans both attempts");
		assert.equal(record.comparison.verdict, "violation", "the final verdict spans the trail");
		const status = await dispatch("harness", {
			target,
			json: true,
			run: "run-h2b-6",
			_: ["status"],
		});
		assert.equal(status.result.run.state, "blocked");
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

// Spec Testing Decision: flag mapping must be smoke-tested through the real
// CLI (the parseArgs FLAG_SPECS whitelist silently turns unregistered flags
// into positionals). Raw argv against the real scripts/amber.js process.
test("raw-CLI --command-id maps through FLAG_SPECS (missing flag vs unknown run)", async () => {
	const target = tmpTarget("h2b-rawcli");
	try {
		initRepo(target);
		const withoutFlag = spawnSync(
			process.execPath,
			[
				path.join(__dirname, "..", "..", "scripts", "amber.js"),
				"harness",
				"execution",
				"run",
				"--run",
				"run-x",
				"--target",
				target,
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(withoutFlag.status, 1);
		assert.match(withoutFlag.stdout, /--command-id is required/);
		const withFlag = spawnSync(
			process.execPath,
			[
				path.join(__dirname, "..", "..", "scripts", "amber.js"),
				"harness",
				"execution",
				"run",
				"--run",
				"run-x",
				"--command-id",
				"some-rule",
				"--target",
				target,
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(withFlag.status, 1);
		assert.match(withFlag.stdout, /no prepared execution for run/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});
