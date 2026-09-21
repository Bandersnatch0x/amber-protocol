import assert from "node:assert/strict";
import { test } from "node:test";
import { executeApprovedCommand, requestApproval } from "../src/approval-bridge.ts";
import type { ApprovalRequiredPayload } from "../src/types.ts";

const payload: ApprovalRequiredPayload = {
	approvalRequired: true,
	command: "amber session start --goal x --target /repo",
	commandArgv: ["amber", "session", "start", "--goal", "x", "--target", "/repo"],
	hint: "Action requires explicit approval.",
};

test("y approves", async () => {
	const { approved } = await requestApproval(payload, async () => true, "amber.session.start");
	assert.equal(approved, true);
});

test("n denies", async () => {
	const { approved } = await requestApproval(payload, async () => false);
	assert.equal(approved, false);
});

test("missing askFn never silently approves", async () => {
	const { approved } = await requestApproval(payload);
	assert.equal(approved, false);
});

test("executeApprovedCommand fail-closed without commandArgv", async () => {
	const result = await executeApprovedCommand({ approvalRequired: true }, { amberRoot: "/tmp" });
	assert.equal((result.parsed as { executed?: boolean }).executed, false);
	assert.equal((result.parsed as { approved?: boolean }).approved, true);
	assert.match(String((result.parsed as { error?: string }).error), /commandArgv/);
});

test("executeApprovedCommand rewrites amber argv through runFn", async () => {
	let seen: { bin: string; args: string[] } | undefined;
	const result = await executeApprovedCommand(payload, {
		amberRoot: "/amber",
		nodeBin: "/usr/bin/node",
		runFn: async (bin, args) => {
			seen = { bin, args };
			return { stdout: "Session created: abc-123", stderr: "", code: 0 };
		},
	});
	assert.equal(seen?.bin, "/usr/bin/node");
	assert.equal(seen?.args[0], "/amber/scripts/amber.js");
	assert.deepEqual(seen?.args.slice(1), ["session", "start", "--goal", "x", "--target", "/repo"]);
	assert.equal(result.isError, false);
	assert.match(result.content?.[0]?.text ?? "", /Session created/);
});
