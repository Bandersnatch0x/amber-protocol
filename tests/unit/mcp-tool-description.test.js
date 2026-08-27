"use strict";

// Public composer used by MCP tools/list (F018) and by the F058 suite.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { composeMcpToolDescription } = require("../../scripts/lib/mcp-tool-description");

test("MCP composer binds description to goal, mode, and approver only", () => {
	const description = composeMcpToolDescription({
		goal: "Read the current state of a session without mutating anything.",
		mode: "dry-run",
		governance: { approver: ["system"] },
	});
	assert.equal(
		description,
		"Read the current state of a session without mutating anything. Mode: dry-run. Approver: system.",
	);
});
