"use strict";

// F065 H0 — Harness Contract CLI surface (ADR-0100): admit/inspect through the
// command dispatcher seam. Tests assert externally observable behavior:
// JSON result shapes, exit codes, stable AMBER_E_* codes, Snapshot Hash
// determinism, immutability, and fail-closed reads. No test writes state into
// the repository-root .amber (suite leak guard) — every case uses its own
// temporary target directory.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { dispatch } = require("../../scripts/lib/command-dispatcher");
const { DEFAULT_COMMANDS } = require("../../scripts/lib/command-registry");
const { canonicalHashOf } = require("../../scripts/lib/core/registry-ledger");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-"));
}

function minimalContract(overrides = {}) {
	return {
		apiVersion: "amber.dev/v1",
		kind: "HarnessContract",
		metadata: { id: "coding-task", version: "1", ...(overrides.metadata || {}) },
		agent: { id: "worker", role: "implementation", ...(overrides.agent || {}) },
		governance: { policy: "default-safe", ...(overrides.governance || {}) },
	};
}

function writeContract(dir, contract, name = "contract.json") {
	const file = path.join(dir, name);
	fs.writeFileSync(file, JSON.stringify(contract, null, 2), "utf8");
	return file;
}

function admitArgs(target, file, json = true) {
	return { target, file, json, _: ["admit"] };
}

function inspectArgs(target, flags, json = true) {
	return { target, json, ...flags, _: ["inspect"] };
}

test("admit validates the schema, freezes a snapshot hash, and stores the admitted bytes", () => {
	const target = tmpTarget();
	try {
		const file = writeContract(target, minimalContract());
		const { result, exitCode } = dispatch("harness", admitArgs(target, file));
		assert.equal(exitCode, 0);
		assert.equal(result.errors.length, 0);
		assert.match(result.snapshotHash, /^sha256:[0-9a-f]{64}$/);
		assert.equal(result.idempotent, false);
		assert.ok(fs.existsSync(result.contractFile), "admitted bytes must be stored");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("byte-identical re-admission is idempotent and keeps the original admission time", () => {
	const target = tmpTarget();
	try {
		const file = writeContract(target, minimalContract());
		const first = dispatch("harness", admitArgs(target, file));
		const second = dispatch("harness", admitArgs(target, file));
		assert.equal(second.exitCode, 0);
		assert.equal(second.result.idempotent, true);
		assert.equal(second.result.snapshotHash, first.result.snapshotHash);
		assert.equal(second.result.admittedAt, first.result.admittedAt);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("re-admitting a changed document under an admitted id refuses as immutable", () => {
	const target = tmpTarget();
	try {
		const file = writeContract(target, minimalContract());
		dispatch("harness", admitArgs(target, file));
		fs.writeFileSync(
			file,
			JSON.stringify(minimalContract({ metadata: { id: "coding-task", version: "2" } }), null, 2),
			"utf8",
		);
		const { result, exitCode } = dispatch("harness", admitArgs(target, file));
		assert.equal(exitCode, 1);
		assert.equal(result.code, "AMBER_E_HARNESS_CONTRACT_IMMUTABLE");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a contract missing a required section fails schema validation with a stable code", () => {
	const target = tmpTarget();
	try {
		const broken = minimalContract();
		delete broken.agent;
		const file = writeContract(target, broken, "broken.json");
		const { result, exitCode } = dispatch("harness", admitArgs(target, file));
		assert.equal(exitCode, 1);
		assert.equal(result.code, "AMBER_E_INVALID_ARG");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("inspect re-derives the snapshot hash and a corrupted record fails closed", () => {
	const target = tmpTarget();
	try {
		const file = writeContract(target, minimalContract());
		const admitted = dispatch("harness", admitArgs(target, file));
		const shown = dispatch("harness", inspectArgs(target, { contract: "coding-task" }));
		assert.equal(shown.exitCode, 0);
		assert.equal(shown.result.snapshotHash, admitted.result.snapshotHash);

		const stored = JSON.parse(fs.readFileSync(admitted.result.contractFile, "utf8"));
		stored.contract.agent.role = "tampered";
		fs.writeFileSync(admitted.result.contractFile, JSON.stringify(stored, null, "\t"), "utf8");
		const corrupt = dispatch("harness", inspectArgs(target, { contract: "coding-task" }));
		assert.equal(corrupt.exitCode, 1);
		assert.equal(corrupt.result.code, "AMBER_E_HARNESS_CONTRACT_CORRUPT");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("inspect --all lists admitted contracts; an unknown id refuses with a stable code", () => {
	const target = tmpTarget();
	try {
		writeContract(target, minimalContract());
		writeContract(
			target,
			minimalContract({ metadata: { id: "review-task", version: "1" } }),
			"second.json",
		);
		dispatch("harness", admitArgs(target, path.join(target, "contract.json")));
		dispatch("harness", admitArgs(target, path.join(target, "second.json")));

		const listed = dispatch("harness", inspectArgs(target, { all: true }));
		assert.equal(listed.exitCode, 0);
		assert.equal(listed.result.contracts.length, 2);

		const missing = dispatch("harness", inspectArgs(target, { contract: "no-such-contract" }));
		assert.equal(missing.exitCode, 1);
		assert.equal(missing.result.code, "AMBER_E_HARNESS_CONTRACT_NOT_FOUND");
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("a tampered contract shows as a tombstone in the list and refuses its single read (T3)", () => {
	const target = tmpTarget();
	try {
		const file = writeContract(target, minimalContract());
		const admitted = dispatch("harness", admitArgs(target, file));
		const stored = JSON.parse(fs.readFileSync(admitted.result.contractFile, "utf8"));
		stored.contract.agent.role = "tampered";
		fs.writeFileSync(admitted.result.contractFile, JSON.stringify(stored, null, "\t"), "utf8");

		// Single read refuses closed; the list flags the tombstone and never
		// presents the stale snapshot as admitted.
		const corruptRead = dispatch("harness", inspectArgs(target, { contract: "coding-task" }));
		assert.equal(corruptRead.exitCode, 1);
		assert.equal(corruptRead.result.code, "AMBER_E_HARNESS_CONTRACT_CORRUPT");

		const listed = dispatch("harness", inspectArgs(target, { all: true }));
		assert.equal(listed.result.contracts.length, 1);
		assert.equal(listed.result.contracts[0].corrupt, true);
		assert.equal(listed.result.contracts[0].snapshotHash, null);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("the snapshot hash is canonical: key order does not change the identity", () => {
	const a = { kind: "HarnessContract", metadata: { id: "x", version: "1" } };
	const b = { metadata: { version: "1", id: "x" }, kind: "HarnessContract" };
	assert.equal(canonicalHashOf(a), canonicalHashOf(b));
});

test("admit without --file and inspect without --contract fail with guidance", () => {
	const target = tmpTarget();
	try {
		const noFile = dispatch("harness", { target, json: true, _: ["admit"] });
		assert.equal(noFile.exitCode, 1);
		assert.ok(/--file is required/.test(noFile.result.errors[0]));

		const noContract = dispatch("harness", { target, json: true, _: ["inspect"] });
		assert.equal(noContract.exitCode, 1);
		assert.match(noContract.result.errors[0], /--contract <id>|--all/);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// The dispatcher validates a group's second-level verb (ADR-0108). A bare
// group name and a bogus verb must both answer with that group's own guidance —
// the wording moved out of the handlers, so it needs a test that would notice a
// silent change of text or of envelope.
test("an unknown second-level verb answers with that group's own guidance", () => {
	const target = tmpTarget();
	try {
		const cases = [
			["tool", "harness tool requires admit, list, inspect, or check."],
			["context", "harness context requires admit, list, inspect, check, or revoke."],
			["checkpoint", "harness checkpoint requires capture, list, verify, or inspect."],
			["attempt", "harness attempt requires list or inspect."],
			["policy", "harness policy requires check."],
		];
		for (const [group, expected] of cases) {
			for (const argv of [[group], [group, "bogus"]]) {
				const result = dispatch("harness", { target, json: false, _: argv });
				assert.equal(result.exitCode, 1, `${argv.join(" ")} must fail`);
				assert.ok(
					result.result.errors[0].startsWith(expected),
					`${argv.join(" ")}: got ${result.result.errors[0]}`,
				);
				// The group refusal is an ordinary handler body: it renders through
				// the same print path a handler's own invalidArg takes.
				assert.equal(result.bypassPrint, true);
			}
		}
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

// ADR-0108: harness errors go through core/error-catalog's typedError, so the
// message carries the catalog's [CODE] → fix: suffix. A local `new Error(...)`
// would silently drop it again.
test("a harness error message carries the catalog remedy", () => {
	const target = tmpTarget();
	try {
		const result = dispatch("harness", {
			target,
			json: false,
			run: "no-such-run",
			_: ["status"],
		});
		assert.equal(result.exitCode, 1);
		assert.equal(result.result.code, "AMBER_E_HARNESS_RUN_NOT_FOUND");
		assert.match(result.result.errors[0], /\[AMBER_E_HARNESS_RUN_NOT_FOUND\] → fix: /);
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
	}
});

test("harness is expert tier: callable, registered, but off the default help surface", () => {
	assert.ok(DEFAULT_COMMANDS.includes("audit"), "default surface sanity");
	assert.equal(DEFAULT_COMMANDS.includes("harness"), false);
	assert.ok(DEFAULT_COMMANDS.length === 7, "the seven-verb surface must not grow");
});
