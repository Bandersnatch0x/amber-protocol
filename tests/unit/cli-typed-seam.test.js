"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
	REGISTERED_ACTIONS,
	classifyCliInvocation,
	dispatchTypedInvocation,
	validateCliInvocation,
	validateTypedSeam,
} = require("../../scripts/lib/cli-typed-seam");

test("CLI typed seam validates the same Action registry at startup", () => {
	assert.ok(REGISTERED_ACTIONS.length >= 8);
});

test("CLI typed seam classifies read, write, and write-flag variants", () => {
	assert.deepEqual(classifyCliInvocation("session", { _: ["status"] }), {
		key: "session/status",
		effect: "read",
		approver: "system",
		directReadOnlyExec: true,
	});
	assert.deepEqual(classifyCliInvocation("session", { _: ["verify"] }), {
		key: "session/verify",
		effect: "write",
		approver: "system",
		directReadOnlyExec: false,
	});
	assert.equal(
		classifyCliInvocation("governance", { _: ["report"], output: "report.md" }).effect,
		"write",
	);
	assert.equal(classifyCliInvocation("doctor", {}), null);
});

test("CLI typed seam fails closed when an Action contract is corrupt", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-cli-seam-"));
	fs.writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ actionTypeId: "amber.bad" }));
	assert.throws(() => validateTypedSeam(dir), /CLI typed seam is invalid/);
});

test("CLI typed seam validates typed capability keys before dispatch", () => {
	assert.equal(validateCliInvocation("session", { _: ["status"] }).disposition, "typed");
	assert.equal(validateCliInvocation("session", { _: ["unknown"] }).disposition, "unmapped");
	assert.equal(validateCliInvocation("doctor", {}).disposition, "untyped");
});

test("CLI typed seam gates human mutations before invoking the handler", () => {
	let invoked = false;
	const blocked = dispatchTypedInvocation("context", { _: ["ingest"] }, () => {
		invoked = true;
		return { result: {} };
	});
	assert.equal(invoked, false);
	assert.equal(blocked.result.approvalRequired, true);
	assert.equal(blocked.result.executed, false);

	const allowed = dispatchTypedInvocation("context", { _: ["ingest"], confirm: true }, () => {
		invoked = true;
		return { result: { errors: [], warnings: [] } };
	});
	assert.equal(invoked, true);
	assert.equal(allowed.result.typedAction, "amber.context.ingest");
});

test("CLI typed seam requires explicit confirmation even in an interactive terminal", () => {
	const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
	Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
	try {
		let invoked = false;
		const response = dispatchTypedInvocation("context", { _: ["ingest"] }, () => {
			invoked = true;
			return { result: {} };
		});
		assert.equal(invoked, false);
		assert.equal(response.result.approvalRequired, true);
	} finally {
		if (descriptor) Object.defineProperty(process.stdin, "isTTY", descriptor);
		else delete process.stdin.isTTY;
	}
});

test("CLI typed seam executes reads and explicitly approved writes", () => {
	const cases = [
		["route", { _: ["list"] }],
		["session", { _: ["start"], confirm: true }],
	];
	for (const [command, args] of cases) {
		let invoked = false;
		const response = dispatchTypedInvocation(command, args, () => {
			invoked = true;
			return { result: { errors: [], warnings: [] } };
		});
		assert.equal(invoked, true);
		assert.match(response.result.typedAction, /^amber\./);
	}
});

test("CLI typed seam gates system-approved mutations until confirmation", () => {
	let invoked = false;
	const response = dispatchTypedInvocation("session", { _: ["start"] }, () => {
		invoked = true;
		return { result: {} };
	});
	assert.equal(invoked, false);
	assert.equal(response.result.approvalRequired, true);
});

test("CLI typed seam annotates asynchronous handler results", async () => {
	const response = await dispatchTypedInvocation("session", { _: ["status"] }, async () => ({
		result: { errors: [], warnings: [] },
	}));
	assert.equal(response.result.typedAction, "amber.session.status");
});
