import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../src/index.ts";

test("parseArgs reads flags", () => {
	const args = parseArgs([
		"--target",
		"/repo",
		"--objective",
		"do it",
		"--max-turns",
		"3",
		"--agent-id",
		"bot",
	]);
	assert.equal(args.target, "/repo");
	assert.equal(args.objective, "do it");
	assert.equal(args.maxTurns, 3);
	assert.equal(args.agentId, "bot");
});
