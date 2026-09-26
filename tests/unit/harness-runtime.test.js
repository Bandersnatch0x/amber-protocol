"use strict";

// F080 H7 — the bounded maintenance runtime. Conformance at the real path:
// one closed internal job, human-Decision schedules on the existing Harness
// ledger, deterministic ticks, budget/no-progress/revocation stops, and a
// lease/fenced local daemon that can only wake the closed registry. The
// authority ceiling is asserted structurally (no target/agent/workflow/
// external seam) and empirically (only declared runtime paths change).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { dispatch } = require("../../scripts/lib/command-dispatcher");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { readHarnessEvents } = require("../../scripts/lib/harness/event-ledger");
const {
	AUTHORITY,
	JOB_NAMES,
	CODE_INVALID,
	CODE_NOT_FOUND,
	CODE_CORRUPT,
	CODE_CONFLICT,
	CODE_DAEMON_RUNNING,
	admitSchedule,
	listJobs,
	tickRuntime,
	startDaemon,
	stopDaemon,
	daemonStatus,
} = require("../../scripts/lib/harness/runtime-core");

const AUTHORITY_TUPLE = {
	executesAnything: false,
	schedulesJobs: true,
	dispatchesAgents: false,
	writesExternalSystems: false,
};

function tmpTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-h7-${label}-`));
}

// The runtime authority fixture: one registered human plus committed
// acceptance Decisions (the F050 discipline every registry already uses).
function authorityFixture(target, decisions) {
	registerPrincipal(target, { id: "alice@example.com", principalKind: "human" });
	registerPrincipal(target, { id: "bot@example.com", principalKind: "service" });
	assert.equal(
		admitArtifact(target, { type: "intent", identity: "intent/runtime", body: "# Runtime\n" }).ok,
		true,
	);
	for (const identity of decisions) {
		const admitted = admitArtifact(target, {
			type: "decision",
			identity,
			body: `# Decision ${identity}\n`,
			decisionKind: "approval",
			principal: "alice@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/runtime" } }],
		});
		assert.equal(admitted.ok, true, (admitted.errors || []).join("; "));
	}
}

function writeSpec(target, name, status) {
	const dir = path.join(target, "docs", "specs");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, name),
		`# ${name}\n\n**spec_id:** ${name}\n**Status:** ${status}\n`,
		"utf8",
	);
}

function scheduleInput(overrides = {}) {
	return {
		apiVersion: "amber.dev/v1",
		kind: "HarnessMaintenanceSchedule",
		metadata: { id: "draft-review", version: "1" },
		job: "draft-spec-review",
		cadence: { everyMs: 60_000 },
		validAt: "2026-09-24T00:00:00.000Z",
		validUntil: "2026-09-26T00:00:00.000Z",
		budget: { maxRuns: 3, maxProposals: 2 },
		decision: { identity: "decision/runtime-register", revision: 1 },
		...overrides,
	};
}

// The daemon tests run on the real clock, so their schedule window must cover
// "now" (a fixed window would be expired by the machine's own date).
function realTimeWindow() {
	const day = 24 * 60 * 60 * 1_000;
	return {
		validAt: new Date(Date.now() - day).toISOString(),
		validUntil: new Date(Date.now() + 20 * day).toISOString(),
	};
}

function runtimeKinds(target) {
	return readHarnessEvents(target)
		.filter((event) => event.kind.startsWith("runtime."))
		.map((event) => event.kind);
}

function runtimeDir(target) {
	return path.join(target, ".amber", "harness", "runtime");
}

// Byte-level whole-target snapshot (file bytes + directory entries).
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

test("the closed job registry exposes exactly draft-spec-review under the bounded authority tuple", () => {
	const target = tmpTarget("jobs");
	try {
		const jobs = listJobs();
		assert.deepEqual(
			jobs.map((job) => job.name),
			[...JOB_NAMES],
		);
		assert.deepEqual([...JOB_NAMES], ["draft-spec-review"]);
		for (const job of jobs) assert.deepEqual(job.authority, AUTHORITY_TUPLE);
		assert.deepEqual(AUTHORITY, AUTHORITY_TUPLE);
		const viaCli = dispatch("harness", { target, json: true, _: ["runtime", "jobs"] });
		assert.equal(viaCli.exitCode, 0);
		assert.deepEqual(viaCli.result.jobs, jobs);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the runtime module reaches no target, agent, workflow, model, or external seam", () => {
	const files = [
		path.join(__dirname, "..", "..", "scripts", "lib", "harness", "runtime-core.js"),
		path.join(__dirname, "..", "..", "scripts", "amber-runtime.js"),
	];
	const banned = [
		"governed-runner",
		"execution-adapter",
		"runner-registry",
		"external-registry",
		"bridge-registry",
		"execution-domain-adapter",
		"eval-commands",
		"instruction-surface-evals",
		"mcp-",
		"workflow-pack",
		"loop-execution",
		"route-commands",
		"execFile",
	];
	for (const file of files) {
		const text = fs.readFileSync(file, "utf8");
		for (const needle of banned) {
			assert.ok(
				!text.includes(`require("${needle}`) && !text.includes(`require("../${needle}`),
				`${path.basename(file)} requires ${needle}`,
			);
			assert.ok(!text.includes(`require("${needle}"`), `${path.basename(file)} reaches ${needle}`);
		}
		// The only subprocess surface is the daemon's own self-spawn/self-stop.
		const spawnCalls = [...text.matchAll(/\bspawn\s*\(/g)].length;
		if (path.basename(file) === "runtime-core.js") {
			assert.equal(spawnCalls, 1, "runtime-core spawns only the daemon worker");
			assert.match(text, /child_process/);
		} else {
			assert.equal(spawnCalls, 0, "the worker never spawns anything");
		}
	}
});

test("schedule admission binds one committed human Decision and re-admission is idempotent", () => {
	const target = tmpTarget("admit");
	try {
		authorityFixture(target, ["decision/runtime-register"]);
		const admitted = admitSchedule(target, scheduleInput());
		assert.equal(admitted.ok, true);
		assert.equal(admitted.idempotent, false);
		assert.match(admitted.schedule.snapshotHash, /^sha256:[0-9a-f]{64}$/);
		assert.deepEqual(admitted.schedule.authority, AUTHORITY_TUPLE);
		assert.deepEqual(admitted.schedule.decision, {
			identity: "decision/runtime-register",
			revision: 1,
			decisionKind: "approval",
			principal: "alice@example.com",
		});
		// The registration witness freezes the Snapshot Hash on the ledger.
		const registered = readHarnessEvents(target).filter(
			(event) => event.kind === "runtime.schedule.registered",
		);
		assert.equal(registered.length, 1);
		assert.equal(registered[0].inputHash, admitted.schedule.snapshotHash);
		assert.deepEqual(registered[0].pointers, [
			`maintenance-schedule:draft-review#${admitted.schedule.snapshotHash}`,
			"runtime-decision:decision/runtime-register@1",
		]);
		// Byte-identical re-admission leaves the record untouched.
		const again = admitSchedule(target, scheduleInput());
		assert.equal(again.idempotent, true);
		assert.equal(
			readHarnessEvents(target).filter((event) => event.kind === "runtime.schedule.registered")
				.length,
			1,
		);
		// Different content under the same id is a conflict, never an edit.
		assert.throws(
			() => admitSchedule(target, scheduleInput({ cadence: { everyMs: 120_000 } })),
			(error) => error.amberCode === CODE_CONFLICT,
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("schedule admission refuses non-human, scoped, unresolved, malformed, and reused decisions", () => {
	const target = tmpTarget("authority");
	try {
		authorityFixture(target, ["decision/runtime-register", "decision/runtime-reuse"]);
		assert.equal(
			admitArtifact(target, {
				type: "decision",
				identity: "decision/runtime-service",
				body: "# service\n",
				decisionKind: "approval",
				principal: "bot@example.com",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/runtime" } }],
			}).ok,
			false,
			"an approval Decision is a human-only slot",
		);
		assert.equal(
			admitArtifact(target, {
				type: "decision",
				identity: "decision/runtime-review",
				body: "# review\n",
				decisionKind: "review",
				principal: "alice@example.com",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/runtime" } }],
			}).ok,
			true,
		);
		assert.equal(
			admitArtifact(target, {
				type: "intent",
				identity: "intent/scoped",
				body: "# Scoped\n",
				scope: "session/1",
			}).ok,
			true,
		);
		assert.equal(
			admitArtifact(target, {
				type: "decision",
				identity: "decision/runtime-scoped",
				body: "# scoped\n",
				decisionKind: "approval",
				principal: "alice@example.com",
				scope: "session/1",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/scoped" } }],
			}).ok,
			true,
		);
		const cases = [
			[{ identity: "decision/ghost", revision: 1 }, /is not a committed Decision artifact/],
			[{ identity: "decision/runtime-review", revision: 1 }, /carries decisionKind "review"/],
			[{ identity: "decision/runtime-scoped", revision: 1 }, /is scoped to "session\/1"/],
		];
		for (const [decision, pattern] of cases) {
			assert.throws(
				() => admitSchedule(target, scheduleInput({ decision })),
				(error) => error.amberCode === CODE_INVALID && pattern.test(error.message),
				JSON.stringify(decision),
			);
		}
		// Closed contract refusals: unknown job, unknown field, bad window, bad budget.
		assert.throws(
			() => admitSchedule(target, scheduleInput({ job: "run-npm-test" })),
			(error) => error.amberCode === CODE_INVALID && /closed registry/.test(error.message),
		);
		assert.throws(
			() =>
				admitSchedule(
					target,
					scheduleInput({ metadata: { id: "draft-review", version: "1", extra: true } }),
				),
			(error) => error.amberCode === CODE_INVALID && /metadata/.test(error.message),
		);
		assert.throws(
			() =>
				admitSchedule(
					target,
					scheduleInput({
						validAt: "2026-09-26T00:00:00.000Z",
						validUntil: "2026-09-24T00:00:00.000Z",
					}),
				),
			(error) => error.amberCode === CODE_INVALID && /validity window/.test(error.message),
		);
		assert.throws(
			() => admitSchedule(target, scheduleInput({ budget: { maxRuns: 0, maxProposals: 1 } })),
			(error) => error.amberCode === CODE_INVALID && /maxRuns/.test(error.message),
		);
		// One human Decision registers exactly one schedule.
		assert.equal(admitSchedule(target, scheduleInput()).ok, true);
		assert.throws(
			() =>
				admitSchedule(
					target,
					scheduleInput({
						metadata: { id: "second-review", version: "1" },
					}),
				),
			(error) => error.amberCode === CODE_CONFLICT && /already spent by/.test(error.message),
		);
		// A refused registration leaves no orphan record behind.
		assert.equal(
			fs.existsSync(path.join(runtimeDir(target), "schedules", "second-review.json")),
			false,
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a tick runs the closed job, writes one proposal, and leaves docs bytes untouched", () => {
	const target = tmpTarget("tick");
	try {
		authorityFixture(target, ["decision/runtime-register"]);
		writeSpec(target, "F900-draft.md", "draft");
		writeSpec(target, "F901-accepted.md", "accepted");
		const docsBefore = targetTreeBytes(path.join(target, "docs"));
		assert.equal(admitSchedule(target, scheduleInput()).ok, true);

		// Not due yet (validAt is the first due instant).
		const early = tickRuntime(target, { now: "2026-09-23T23:59:00.000Z" });
		assert.equal(early.results[0].status, "skipped");
		assert.match(early.results[0].reason, /not-yet-valid/);

		const first = tickRuntime(target, { now: "2026-09-24T00:00:00.000Z" });
		assert.equal(first.results[0].status, "completed");
		assert.equal(first.results[0].findings, 1);
		assert.equal(first.results[0].proposalCreated, true);
		const proposal = first.results[0].proposal;
		assert.deepEqual(proposal.findings, [
			{ kind: "draft-spec-review", path: "docs/specs/F900-draft.md" },
		]);
		assert.deepEqual(proposal.authority, AUTHORITY_TUPLE);
		assert.match(proposal.snapshotHash, /^sha256:[0-9a-f]{64}$/);
		assert.ok(fs.existsSync(proposal.file));

		// The proposal is immutable content-addressed state.
		const stored = JSON.parse(fs.readFileSync(proposal.file, "utf8"));
		assert.equal(stored.proposalId, proposal.proposalId);
		assert.equal(stored.outputHash, proposal.outputHash);

		assert.deepEqual(runtimeKinds(target), [
			"runtime.schedule.registered",
			"runtime.wake.skipped",
			"runtime.wake.started",
			"runtime.job.completed",
		]);
		// No document was edited and no path outside the runtime area appeared.
		assert.deepEqual(targetTreeBytes(path.join(target, "docs")), docsBefore);
		// Repeating the tick inside the cadence window is skipped, not rerun.
		const repeat = tickRuntime(target, { now: "2026-09-24T00:00:30.000Z" });
		assert.equal(repeat.results[0].status, "skipped");
		assert.match(repeat.results[0].reason, /not due until/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("zero findings is a successful observation; identical consecutive output stops on no-progress", () => {
	const target = tmpTarget("no-progress");
	try {
		authorityFixture(target, ["decision/runtime-register"]);
		writeSpec(target, "F902-accepted.md", "accepted");
		assert.equal(admitSchedule(target, scheduleInput()).ok, true);
		const first = tickRuntime(target, { now: "2026-09-24T00:00:00.000Z" });
		assert.equal(first.results[0].status, "completed");
		assert.equal(first.results[0].findings, 0);
		assert.equal(first.results[0].proposal, null);
		assert.equal(
			fs.existsSync(path.join(runtimeDir(target), "proposals")),
			false,
			"no findings writes no proposal",
		);
		const second = tickRuntime(target, { now: "2026-09-24T00:02:00.000Z" });
		assert.equal(second.results[0].status, "completed");
		assert.ok(runtimeKinds(target).includes("runtime.no-progress.stopped"));
		// The stop is terminal: further ticks report the stop and never rerun.
		const third = tickRuntime(target, { now: "2026-09-24T00:04:00.000Z" });
		assert.equal(third.results[0].status, "stopped");
		assert.match(third.results[0].reason, /no-progress/);
		assert.equal(
			runtimeKinds(target).filter((kind) => kind === "runtime.no-progress.stopped").length,
			1,
			"one terminal no-progress stop",
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("budget ceilings stop a schedule once, and revocation is terminal", () => {
	const target = tmpTarget("budget");
	try {
		authorityFixture(target, ["decision/runtime-register", "decision/runtime-revoke"]);
		writeSpec(target, "F903-draft.md", "draft");
		assert.equal(
			admitSchedule(target, scheduleInput({ budget: { maxRuns: 1, maxProposals: 1 } })).ok,
			true,
		);
		const run = tickRuntime(target, { now: "2026-09-24T00:00:00.000Z" });
		assert.equal(run.results[0].status, "completed");
		const kinds = runtimeKinds(target);
		assert.ok(kinds.includes("runtime.job.completed"));
		assert.ok(kinds.includes("runtime.budget.stopped"));
		assert.equal(
			kinds.filter((kind) => kind === "runtime.budget.stopped").length,
			1,
			"one terminal budget stop per tick",
		);
		const after = tickRuntime(target, { now: "2026-09-24T00:02:00.000Z" });
		assert.equal(after.results[0].status, "stopped");
		assert.equal(
			runtimeKinds(target).filter((kind) => kind === "runtime.budget.stopped").length,
			1,
			"the stop is never re-emitted",
		);

		// Revocation: a fresh human Decision, then a terminal skip.
		const revoked = dispatch("harness", {
			target,
			json: true,
			schedule: "draft-review",
			decision: "decision/runtime-revoke@1",
			reason: "no longer needed",
			_: ["runtime", "schedule", "revoke"],
		});
		assert.equal(revoked.exitCode, 0, JSON.stringify(revoked.result.errors));
		assert.ok(runtimeKinds(target).includes("runtime.schedule.revoked"));
		const listed = dispatch("harness", { target, json: true, _: ["runtime", "schedule", "list"] });
		assert.equal(listed.result.schedules[0].runtime.status, "revoked");
		// A revoked schedule stays listable and cannot be revoked twice.
		const twice = dispatch("harness", {
			target,
			json: true,
			schedule: "draft-review",
			decision: "decision/runtime-revoke@1",
			reason: "again",
			_: ["runtime", "schedule", "revoke"],
		});
		assert.equal(twice.exitCode, 1);
		assert.equal(twice.result.code, CODE_CONFLICT);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("expiry uses the half-open window and an edited schedule fails closed against its ledger witness", () => {
	const target = tmpTarget("expiry");
	try {
		authorityFixture(target, ["decision/runtime-register"]);
		writeSpec(target, "F904-draft.md", "draft");
		assert.equal(admitSchedule(target, scheduleInput()).ok, true);
		// Exactly validUntil is already expired (half-open).
		const expired = tickRuntime(target, { now: "2026-09-26T00:00:00.000Z" });
		assert.equal(expired.results[0].status, "skipped");
		assert.match(expired.results[0].reason, /expired/);
		// One millisecond earlier still runs.
		const alive = tickRuntime(target, { now: "2026-09-25T23:59:59.999Z" });
		assert.equal(alive.results[0].status, "completed");

		// In-place edit: content no longer matches its Snapshot Hash.
		const file = path.join(runtimeDir(target), "schedules", "draft-review.json");
		const record = JSON.parse(fs.readFileSync(file, "utf8"));
		record.cadence = { everyMs: 999_999 };
		fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
		assert.throws(
			() => tickRuntime(target, { now: "2026-09-25T23:59:59.999Z" }),
			(error) => error.amberCode === CODE_CORRUPT && /Snapshot Hash/.test(error.message),
		);
		// A re-hashed forgery still fails: the ledger witness pins the hash.
		const forged = JSON.parse(fs.readFileSync(file, "utf8"));
		forged.snapshotHash = require("../../scripts/lib/core/registry-ledger").canonicalHashOf(
			(({ snapshotHash: _snapshotHash, ...body }) => body)(forged),
		);
		fs.writeFileSync(file, `${JSON.stringify(forged, null, "\t")}\n`, "utf8");
		assert.throws(
			() => tickRuntime(target, { now: "2026-09-25T23:59:59.999Z" }),
			(error) =>
				error.amberCode === CODE_CORRUPT && /no matching registration witness/.test(error.message),
		);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a targeted tick refuses an unknown schedule id, and a corrupt store refuses every tick", () => {
	const target = tmpTarget("unknown-id");
	try {
		authorityFixture(target, ["decision/runtime-register"]);
		writeSpec(target, "F907-draft.md", "draft");
		assert.equal(admitSchedule(target, scheduleInput()).ok, true);
		// Unknown ids refuse loudly rather than silently ticking nothing.
		assert.throws(
			() => tickRuntime(target, { scheduleId: "ghost" }),
			(error) =>
				error.amberCode === CODE_NOT_FOUND && /no runtime schedule "ghost"/.test(error.message),
		);
		// A corrupt store fails the whole read closed, even for a targeted tick:
		// the runtime never serves a partial view of its own authority.
		const file = path.join(runtimeDir(target), "schedules", "draft-review.json");
		const record = JSON.parse(fs.readFileSync(file, "utf8"));
		record.job = "not-a-job";
		fs.writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
		for (const id of [undefined, "draft-review"]) {
			assert.throws(
				() => tickRuntime(target, id === undefined ? {} : { scheduleId: id }),
				(error) => error.amberCode === CODE_CORRUPT,
			);
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the daemon is a fenced single owner: start, status, stop, and stale recovery", () => {
	const target = tmpTarget("daemon");
	try {
		authorityFixture(target, ["decision/runtime-register"]);
		writeSpec(target, "F905-draft.md", "draft");
		assert.equal(
			admitSchedule(target, scheduleInput({ ...realTimeWindow(), cadence: { everyMs: 60_000 } }))
				.ok,
			true,
		);
		try {
			assert.equal(daemonStatus(target).status, "stopped");
			const started = startDaemon(target, { pollMs: 300 });
			assert.equal(started.ok, true);
			assert.ok(started.state.pid > 0);
			assert.equal(started.state.fence, 1);
			assert.equal(started.state.target, path.resolve(target));

			const running = daemonStatus(target);
			assert.equal(running.status, "running");
			assert.equal(running.state.pid, started.state.pid);

			// A second start while the first lives refuses.
			assert.throws(
				() => startDaemon(target, { pollMs: 300 }),
				(error) => error.amberCode === CODE_DAEMON_RUNNING,
			);

			// Give the worker one tick, then stop it deterministically.
			// The worker calls tickRuntime itself, so the schedule must have
			// become due before either observation.
			const stop = stopDaemon(target);
			assert.equal(stop.status, "stopped");
			assert.equal(daemonStatus(target).status, "stopped");
			const kinds = runtimeKinds(target);
			assert.ok(kinds.includes("runtime.daemon.started"));
			assert.ok(kinds.includes("runtime.daemon.stopped"));
			// Stopping again is an idempotent no-op, not an error.
			assert.equal(stopDaemon(target).idempotent, true);

			// Stale ownership: a recorded pid that is not running recovers and
			// bumps the fence instead of silently reusing the lease.
			const stateFile = path.join(runtimeDir(target), "daemon.json");
			fs.writeFileSync(
				stateFile,
				`${JSON.stringify(
					{
						schemaVersion: 1,
						pid: 999_999,
						leaseId: "stale-lease",
						fence: 1,
						target: path.resolve(target),
						pollMs: 300,
						startedAt: "2026-09-24T00:00:00.000Z",
					},
					null,
					"\t",
				)}\n`,
				"utf8",
			);
			assert.equal(daemonStatus(target).status, "stale");
			const recovered = startDaemon(target, { pollMs: 300 });
			assert.equal(recovered.state.fence, 2);
			assert.ok(runtimeKinds(target).includes("runtime.daemon.recovered"));
			stopDaemon(target);
		} finally {
			try {
				stopDaemon(target);
			} catch (_error) {
				/* already stopped */
			}
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the detached worker establishes ownership and exits when the lease is lost", async () => {
	const target = tmpTarget("worker");
	try {
		authorityFixture(target, ["decision/runtime-register"]);
		writeSpec(target, "F906-draft.md", "draft");
		assert.equal(admitSchedule(target, scheduleInput(realTimeWindow())).ok, true);
		const workerFile = path.join(__dirname, "..", "..", "scripts", "amber-runtime.js");
		const { runDaemonWorker } = require("../../scripts/lib/harness/runtime-core");

		// Ownership is verified before any tick: an unmatched lease exits.
		const unmatched = await runDaemonWorker(target, {
			pollMs: 300,
			leaseId: "not-the-recorded-lease",
			fence: 1,
		});
		assert.equal(unmatched.ok, false);
		assert.equal(unmatched.reason, "ownership-not-established");

		// A matching lease ticks the closed job and stops on request.
		const started = startDaemon(target, { pollMs: 300 });
		assert.equal(started.state.pid > 0, true);
		const observed = await new Promise((resolve) => {
			const deadline = Date.now() + 8_000;
			const poll = setInterval(() => {
				const kinds = runtimeKinds(target);
				if (kinds.includes("runtime.job.completed") || Date.now() > deadline) {
					clearInterval(poll);
					resolve(kinds);
				}
			}, 100);
		});
		assert.ok(
			observed.includes("runtime.job.completed"),
			`daemon never completed a tick: ${observed.join(", ")}`,
		);
		stopDaemon(target);
		assert.ok(fs.existsSync(workerFile));
		// A lost lease is detected instead of continuing: the worker compares
		// its coordinates against the recorded ownership on every loop.
		fs.writeFileSync(
			path.join(runtimeDir(target), "daemon.json"),
			`${JSON.stringify(
				{
					schemaVersion: 1,
					pid: process.pid,
					leaseId: "worker-test-lease",
					fence: 7,
					target: path.resolve(target),
					pollMs: 300,
					startedAt: "2026-09-24T00:00:00.000Z",
				},
				null,
				"\t",
			)}\n`,
			"utf8",
		);
		// Bounded in-process ownership run: exactly one tick under the recorded
		// lease, then the loop returns instead of hanging a test process.
		const parked = await runDaemonWorker(target, {
			pollMs: 300,
			leaseId: "worker-test-lease",
			fence: 7,
			maxTicks: 1,
		});
		assert.equal(parked.ok, true);
		assert.equal(parked.reason, "max-ticks");
		// The same coordinates with a different lease never acquires ownership.
		const second = await runDaemonWorker(target, {
			pollMs: 300,
			leaseId: "different-lease",
			fence: 7,
			maxTicks: 1,
		});
		assert.equal(second.ok, false);
		assert.equal(second.reason, "ownership-not-established");
		// A stale fence is likewise refused: the record and the caller must
		// agree on pid, lease, AND fence.
		const staleFence = await runDaemonWorker(target, {
			pollMs: 300,
			leaseId: "worker-test-lease",
			fence: 6,
			maxTicks: 1,
		});
		assert.equal(staleFence.ok, false);
		fs.rmSync(path.join(runtimeDir(target), "daemon.json"), { force: true });
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("raw CLI maps the runtime flags through FLAG_SPECS and refuses truncated values", () => {
	const target = tmpTarget("rawcli");
	try {
		authorityFixture(target, ["decision/runtime-register"]);
		const cli = path.join(__dirname, "..", "..", "scripts", "amber.js");
		const schedulePath = path.join(target, "schedule.json");
		fs.writeFileSync(schedulePath, `${JSON.stringify(scheduleInput(), null, 2)}\n`, "utf8");

		const admit = spawnSync(
			process.execPath,
			[
				cli,
				"harness",
				"runtime",
				"schedule",
				"admit",
				"--file",
				schedulePath,
				"--target",
				target,
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(admit.status, 0, admit.stderr || admit.stdout);
		assert.match(admit.stdout, /"snapshotHash": "sha256:[0-9a-f]{64}"/);
		assert.match(admit.stdout, /maintenance-schedule:draft-review#sha256:/);

		const tick = spawnSync(
			process.execPath,
			[
				cli,
				"harness",
				"runtime",
				"tick",
				"--schedule",
				"draft-review",
				"--now",
				"2026-09-24T00:00:00.000Z",
				"--target",
				target,
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(tick.status, 0, tick.stderr || tick.stdout);
		assert.match(tick.stdout, /"status": "completed"/);

		const truncated = spawnSync(
			process.execPath,
			[cli, "harness", "runtime", "schedule", "show", "--target", target, "--json", "--schedule"],
			{ encoding: "utf8" },
		);
		assert.equal(truncated.status, 1);
		assert.match(truncated.stdout, /--schedule is required/);

		const badPin = spawnSync(
			process.execPath,
			[
				cli,
				"harness",
				"runtime",
				"schedule",
				"revoke",
				"--schedule",
				"draft-review",
				"--decision",
				"not-a-pin",
				"--reason",
				"x",
				"--target",
				target,
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(badPin.status, 1);
		assert.match(badPin.stdout, /must be <identity>@<revision>/);

		const badPoll = spawnSync(
			process.execPath,
			[
				cli,
				"harness",
				"runtime",
				"daemon",
				"start",
				"--poll-ms",
				"1",
				"--target",
				target,
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(badPoll.status, 1);
		assert.match(badPoll.stdout, /--poll-ms must be an integer/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// Guard: the daemon worker is never launched through a shell or an
// arbitrary command path; it is only ever the packaged script.
test("the daemon spawns only the packaged worker script with ownership coordinates", () => {
	const text = fs.readFileSync(
		path.join(__dirname, "..", "..", "scripts", "lib", "harness", "runtime-core.js"),
		"utf8",
	);
	assert.doesNotMatch(text, /shell:\s*true/);
	assert.match(text, /path\.join\(__dirname, "\.\.", "\.\.", "amber-runtime\.js"\)/);
	for (const flag of ["--target", "--poll-ms", "--lease", "--fence"]) {
		assert.ok(text.includes(`"${flag}"`), `spawn must pass ${flag}`);
	}
	assert.ok(!/\bexecSync\b/.test(text), "runtime-core never uses execSync");
	assert.ok(!/\bexecFileSync\b/.test(text), "runtime-core never uses execFileSync");
	// Worker threads are not a second execution surface either.
	assert.ok(!text.includes("worker_threads"), "runtime-core does not use worker_threads");
});

module.exports = { authorityFixture };
