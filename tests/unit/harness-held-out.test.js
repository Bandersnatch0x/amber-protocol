"use strict";

// R-ET-4 (0174): held-out eval-set binding and the leak-check backstop.
// Each test owns a fresh target so immutable ledgers and receipt identity do
// not depend on test order.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { loadoutsDir } = require("../../scripts/lib/core/context-loadout");
const { writePage, regenerateIndex } = require("../../scripts/lib/core/context-store");
const { emitHarnessEvent, readRunEvents } = require("../../scripts/lib/harness/event-ledger");
const { validateRun, listReceipts } = require("../../scripts/lib/harness/validation-core");

function tmpTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-harness-held-out-"));
}

function cleanup(target) {
	fs.rmSync(target, { recursive: true, force: true });
}

function admitAndStart(target, runId) {
	const { dispatch } = require("../../scripts/lib/command-dispatcher");
	const contractFile = path.join(target, "contract.json");
	fs.writeFileSync(
		contractFile,
		JSON.stringify({
			apiVersion: "amber.dev/v1",
			kind: "HarnessContract",
			metadata: { id: "coding-task", version: "1" },
			agent: { id: "worker", role: "implementation" },
			governance: { policy: "default-safe" },
		}),
		"utf8",
	);
	const admitted = dispatch("harness", { target, file: contractFile, json: true, _: ["admit"] });
	assert.equal(admitted.exitCode, 0, admitted.result.errors?.join("; ") || admitted.result.text);
	const started = dispatch("harness", {
		target,
		json: true,
		contract: "coding-task",
		agent: "worker",
		run: runId,
		_: ["start"],
	});
	assert.equal(started.exitCode, 0, started.result.errors?.join("; ") || started.result.text);
}

function admitEvalSet(target, identity, body) {
	const admitted = admitArtifact(target, { type: "eval-set", identity, body });
	assert.equal(admitted.ok, true, admitted.errors?.join("; "));
	return { pin: { identity, revision: admitted.receipt.revision }, receipt: admitted.receipt };
}

function admitEvalResult(target, identity = "eval-result/held-out-suite") {
	const definitionIdentity = "eval/held-out-suite";
	const definition = admitArtifact(target, {
		type: "eval",
		identity: definitionIdentity,
		body: "# Held-out suite definition\n",
	});
	assert.equal(definition.ok, true, definition.errors?.join("; "));
	const result = admitArtifact(target, {
		type: "eval-result",
		identity,
		body: "# Held-out suite result\n",
		extensions: {
			evalResult: {
				definition: { identity: definitionIdentity, revision: 1 },
				result: { overall: "pass" },
			},
		},
	});
	assert.equal(result.ok, true, result.errors?.join("; "));
	return { identity, revision: 1 };
}

function pageWithNeedle(target, pageId, needle) {
	const ref = `src/${pageId}.js`;
	const source = path.join(target, ref);
	fs.mkdirSync(path.dirname(source), { recursive: true });
	fs.writeFileSync(source, "const page = true;\n", "utf8");
	const { hashFile } = require("../../scripts/lib/core/context-hash");
	const hashes = hashFile(source);
	writePage(target, {
		schemaVersion: "1.0.0",
		pageId,
		title: pageId,
		sources: {
			s1: {
				kind: "code",
				ref,
				rawHash: hashes.rawHash,
				normHash: hashes.normHash,
				mutable: true,
			},
		},
		blocks: [{ type: "prose", sources: ["s1"], text: needle }],
	});
	regenerateIndex(target);
}

function scopeLoadoutToPage(target, runId, pageId) {
	const dir = loadoutsDir(target);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, `${runId}.json`),
		JSON.stringify({ firewall: { runId }, pages: { [pageId]: {} } }),
		"utf8",
	);
}

function scopeLoadoutToPageWithTopLevelRunId(target, runId, pageId) {
	const dir = loadoutsDir(target);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, `${runId}-top-level.json`),
		JSON.stringify({ runId, pages: { [pageId]: {} } }),
		"utf8",
	);
}

function eventCount(target, runId) {
	return readRunEvents(target, runId).length;
}

test("held-out leaks on the events surface reject without echoing the needle", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-event";
		const needle = "held-out event content";
		const set = admitEvalSet(target, "eval-set/held-out-a", `short\n${needle}\n`);
		admitAndStart(target, runId);
		emitHarnessEvent(target, {
			kind: "run.created",
			schemaVersion: 1,
			at: "2026-10-20T00:00:00.000Z",
			runId,
			actor: "worker",
			reason: needle,
		});
		const { receipt } = validateRun(target, { runId, heldOut: set.pin });
		const evaluation = receipt.checks.find((check) => check.name === "eval");
		assert.equal(receipt.result.status, "rejected");
		assert.equal(evaluation.status, "fail");
		assert.equal(evaluation.pointer, "eval-set/eval-set/held-out-a@1");
		assert.equal(receipt.heldOut.leak.status, "fail");
		const finding = receipt.heldOut.leak.findings.find((item) => item.surface === "event");
		assert.ok(finding);
		assert.match(finding.pointer, /^event:/);
		assert.equal(JSON.stringify(receipt).includes(needle), false);
	} finally {
		cleanup(target);
	}
});

test("held-out leaks on the pages surface reject through a run-scoped loadout", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-page";
		const pageId = "held-page";
		const needle = "held-out page content";
		const set = admitEvalSet(target, "eval-set/held-out-pages", `unrelated\n${needle}\n`);
		admitAndStart(target, runId);
		pageWithNeedle(target, pageId, needle);
		scopeLoadoutToPage(target, runId, pageId);
		const { receipt } = validateRun(target, { runId, heldOut: set.pin });
		assert.equal(receipt.heldOut.leak.status, "fail");
		assert.ok(
			receipt.heldOut.leak.findings.some(
				(finding) => finding.surface === "page" && finding.pointer === `page:${pageId}`,
			),
		);
	} finally {
		cleanup(target);
	}
});

test("quoted held-out needles are detected on the events surface", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-quoted-event";
		const needle = 'held-out event says "quoted"';
		const set = admitEvalSet(target, "eval-set/held-out-quoted", `padding line\n${needle}\n`);
		admitAndStart(target, runId);
		emitHarnessEvent(target, {
			kind: "run.created",
			schemaVersion: 1,
			at: "2026-10-20T00:00:00.000Z",
			runId,
			actor: "worker",
			reason: needle,
		});
		const { receipt } = validateRun(target, { runId, heldOut: set.pin });
		assert.equal(receipt.heldOut.leak.status, "fail");
		assert.ok(receipt.heldOut.leak.findings.some((finding) => finding.surface === "event"));
	} finally {
		cleanup(target);
	}
});

test("a clean held-out set passes its leak check but cannot claim a suite verdict", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-clean";
		const set = admitEvalSet(target, "eval-set/held-out-clean", "clean held-out content\n");
		admitAndStart(target, runId);
		const { receipt } = validateRun(target, { runId, heldOut: set.pin });
		assert.equal(receipt.heldOut.set.identity, set.pin.identity);
		assert.equal(receipt.heldOut.set.revision, set.pin.revision);
		assert.equal(receipt.heldOut.set.contentHash, set.receipt.contentHash);
		assert.equal(receipt.heldOut.leak.status, "pass");
		assert.equal(receipt.heldOut.leak.scanned.events > 0, true);
		assert.equal(receipt.heldOut.leak.scanned.pages, 0);
		const evaluation = receipt.checks.find((check) => check.name === "eval");
		assert.equal(evaluation.status, "not-run");
		assert.match(evaluation.detail, /no eval-result is bound/);
		assert.equal(receipt.result.status, "accepted");
		assert.equal(receipt.verdict, "incomplete");
	} finally {
		cleanup(target);
	}
});

test("held-out receipt records page scan coverage", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-page-coverage";
		const pageId = "held-page-coverage";
		const set = admitEvalSet(
			target,
			"eval-set/held-out-page-coverage",
			"clean held-out page content\n",
		);
		admitAndStart(target, runId);
		pageWithNeedle(target, pageId, "accessible page content");
		scopeLoadoutToPageWithTopLevelRunId(target, runId, pageId);
		const { receipt } = validateRun(target, { runId, heldOut: set.pin });
		assert.equal(receipt.heldOut.leak.status, "pass");
		assert.equal(receipt.heldOut.leak.scanned.pages, 1);
	} finally {
		cleanup(target);
	}
});

test("a self-referential held-out line stays stable across validation", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-self";
		const identity = "eval-set/held-out-self";
		const set = admitEvalSet(target, identity, `${identity}\n`);
		admitAndStart(target, runId);
		const first = validateRun(target, { runId, heldOut: set.pin });
		const second = validateRun(target, { runId, heldOut: set.pin });
		assert.equal(first.receipt.heldOut.leak.status, "pass");
		assert.equal(second.receipt.heldOut.leak.status, "pass");
		assert.equal(second.receipt.receiptId, first.receipt.receiptId);
		assert.equal(listReceipts(target, { runId }).length, 1);
	} finally {
		cleanup(target);
	}
});

test("an eval-result without a held-out set records leak status not-run, never pass", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-unbound";
		admitAndStart(target, runId);
		const result = admitEvalResult(target);
		const { receipt } = validateRun(target, { runId, evalResult: result });
		assert.equal(receipt.heldOut.set, null);
		assert.equal(receipt.heldOut.leak.status, "not-run");
		assert.equal(receipt.checks.find((check) => check.name === "eval").status, "pass");
		assert.notEqual(receipt.verdict, "pass");
	} finally {
		cleanup(target);
	}
});

test("harness eval --run lists the held-out eval-set pointer", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-eval-surface";
		const set = admitEvalSet(
			target,
			"eval-set/held-out-eval-surface",
			"clean eval surface content\n",
		);
		admitAndStart(target, runId);
		validateRun(target, { runId, heldOut: set.pin });
		const { dispatch } = require("../../scripts/lib/command-dispatcher");
		const listed = dispatch("harness", { target, json: true, run: runId, _: ["eval"] });
		assert.equal(listed.exitCode, 0, listed.result.errors?.join("; ") || listed.result.text);
		assert.ok(
			listed.result.evaluationPointers.includes(`eval-set/${set.pin.identity}@${set.pin.revision}`),
		);
	} finally {
		cleanup(target);
	}
});

test("neither eval flag leaves the legacy receipt without a heldOut key", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-neither";
		admitAndStart(target, runId);
		const { receipt } = validateRun(target, { runId });
		assert.equal("heldOut" in receipt, false);
	} finally {
		cleanup(target);
	}
});

test("binding different eval-set revisions produces different receipt identities", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-identity";
		admitAndStart(target, runId);
		const evalResult = admitEvalResult(target, "eval-result/held-out-identity");
		const firstSet = admitEvalSet(target, "eval-set/held-out-identity", "first held-out line\n");
		const secondAdmission = admitArtifact(target, {
			type: "eval-set",
			identity: firstSet.pin.identity,
			body: "second held-out line\n",
			supersedes: 1,
		});
		assert.equal(secondAdmission.ok, true, secondAdmission.errors?.join("; "));
		const secondSet = { identity: firstSet.pin.identity, revision: 2 };
		const first = validateRun(target, {
			runId,
			evalResult,
			heldOut: firstSet.pin,
		}).receipt;
		const second = validateRun(target, {
			runId,
			evalResult,
			heldOut: secondSet,
		}).receipt;
		assert.notEqual(first.receiptId, second.receiptId);
		assert.equal(listReceipts(target, { runId }).length, 2);
	} finally {
		cleanup(target);
	}
});

test("held-out refusals write no receipt and append no run event", () => {
	const malformedTarget = tmpTarget();
	try {
		const runId = "run-held-malformed";
		admitAndStart(malformedTarget, runId);
		const before = eventCount(malformedTarget, runId);
		const { dispatch } = require("../../scripts/lib/command-dispatcher");
		const refused = dispatch("harness", {
			target: malformedTarget,
			json: true,
			run: runId,
			heldOut: "not-a-pin",
			_: ["validate"],
		});
		assert.equal(refused.exitCode, 1);
		assert.equal(refused.result.code, "AMBER_E_INVALID_ARG");
		assert.equal(
			fs.existsSync(path.join(malformedTarget, ".amber", "harness", "validations")),
			false,
		);
		assert.equal(eventCount(malformedTarget, runId), before);
	} finally {
		cleanup(malformedTarget);
	}

	const unknownTarget = tmpTarget();
	try {
		const runId = "run-held-unknown";
		const set = admitEvalSet(unknownTarget, "eval-set/held-out-unknown", "unknown revision line\n");
		admitAndStart(unknownTarget, runId);
		const before = eventCount(unknownTarget, runId);
		assert.throws(
			() => validateRun(unknownTarget, { runId, heldOut: { ...set.pin, revision: 2 } }),
			(error) => error.amberCode === "AMBER_E_ARTIFACT_NOT_FOUND",
		);
		assert.equal(
			fs.existsSync(path.join(unknownTarget, ".amber", "harness", "validations")),
			false,
		);
		assert.equal(eventCount(unknownTarget, runId), before);
	} finally {
		cleanup(unknownTarget);
	}

	const undetectableTarget = tmpTarget();
	try {
		const runId = "run-held-undetectable";
		const set = admitEvalSet(undetectableTarget, "eval-set/held-out-short", "short\n tiny\n");
		admitAndStart(undetectableTarget, runId);
		const before = eventCount(undetectableTarget, runId);
		assert.throws(
			() => validateRun(undetectableTarget, { runId, heldOut: set.pin }),
			(error) => error.amberCode === "AMBER_E_INVALID_ARG",
		);
		assert.equal(
			fs.existsSync(path.join(undetectableTarget, ".amber", "harness", "validations")),
			false,
		);
		assert.equal(eventCount(undetectableTarget, runId), before);
	} finally {
		cleanup(undetectableTarget);
	}
});

test("tampering heldOut leak status fails closed when receipts are read", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-tamper";
		const needle = "tampered held-out line";
		const set = admitEvalSet(target, "eval-set/held-out-tamper", needle);
		admitAndStart(target, runId);
		emitHarnessEvent(target, {
			kind: "run.created",
			schemaVersion: 1,
			at: "2026-10-20T00:00:00.000Z",
			runId,
			reason: needle,
		});
		const { receipt, receiptFile } = validateRun(target, { runId, heldOut: set.pin });
		const tampered = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
		tampered.heldOut.leak.status = "pass";
		fs.writeFileSync(receiptFile, JSON.stringify(tampered, null, "\t"), "utf8");
		assert.throws(
			() => listReceipts(target, { runId }),
			(error) =>
				error.amberCode === "AMBER_E_HARNESS_VALIDATION_CORRUPT" &&
				/heldOut\.leak pass requires no findings/.test(error.message),
		);
		assert.equal(receipt.heldOut.leak.findings.length > 0, true);
	} finally {
		cleanup(target);
	}
});

test("legacy held-out receipts remain readable without scan coverage", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-legacy-readable";
		const set = admitEvalSet(target, "eval-set/held-out-legacy-readable", "clean legacy line\n");
		admitAndStart(target, runId);
		const { receipt, receiptFile } = validateRun(target, { runId, heldOut: set.pin });
		const stored = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
		delete stored.heldOut.leak.scanned;
		fs.writeFileSync(receiptFile, JSON.stringify(stored, null, "\t"), "utf8");
		const listed = listReceipts(target, { runId });
		assert.equal(listed.length, 1);
		assert.equal(listed[0].receiptId, receipt.receiptId);
		assert.equal("scanned" in listed[0].heldOut.leak, false);
	} finally {
		cleanup(target);
	}
});

test("legacy-shaped held-out failures cannot claim a pass verdict", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-legacy-fail";
		const needle = "legacy held-out failure";
		const set = admitEvalSet(target, "eval-set/held-out-legacy-fail", needle);
		admitAndStart(target, runId);
		emitHarnessEvent(target, {
			kind: "run.created",
			schemaVersion: 1,
			at: "2026-10-20T00:00:00.000Z",
			runId,
			actor: "worker",
			reason: needle,
		});
		const { receiptFile } = validateRun(target, { runId, heldOut: set.pin });
		const stored = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
		delete stored.heldOut.leak.scanned;
		stored.verdict = "pass";
		fs.writeFileSync(receiptFile, JSON.stringify(stored, null, "\t"), "utf8");
		assert.throws(
			() => listReceipts(target, { runId }),
			(error) =>
				error.amberCode === "AMBER_E_HARNESS_VALIDATION_CORRUPT" &&
				/verdict "pass" disagrees/.test(error.message),
		);
	} finally {
		cleanup(target);
	}
});

test("new held-out receipts with scan coverage reject a forged pass verdict", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-new-strict";
		admitAndStart(target, runId);
		const evalResult = admitEvalResult(target, "eval-result/held-out-new-strict");
		const { receiptFile } = validateRun(target, { runId, evalResult });
		const stored = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
		stored.verdict = "pass";
		fs.writeFileSync(receiptFile, JSON.stringify(stored, null, "\t"), "utf8");
		assert.throws(
			() => listReceipts(target, { runId }),
			(error) =>
				error.amberCode === "AMBER_E_HARNESS_VALIDATION_CORRUPT" &&
				/verdict "pass" disagrees/.test(error.message),
		);
	} finally {
		cleanup(target);
	}
});

test("raw CLI accepts --held-out and returns the leak status", () => {
	const target = tmpTarget();
	try {
		const runId = "run-held-cli";
		const set = admitEvalSet(target, "eval-set/held-out-cli", "clean cli held-out line\n");
		admitAndStart(target, runId);
		const { spawnSync } = require("node:child_process");
		const cli = path.join(__dirname, "..", "..", "scripts", "amber.js");
		const result = spawnSync(
			process.execPath,
			[
				cli,
				"harness",
				"validate",
				"--run",
				runId,
				"--held-out",
				`${set.pin.identity}@${set.pin.revision}`,
				"--target",
				target,
				"--json",
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const output = JSON.parse(result.stdout);
		assert.equal(output.receipt.heldOut.leak.status, "pass");
	} finally {
		cleanup(target);
	}
});
