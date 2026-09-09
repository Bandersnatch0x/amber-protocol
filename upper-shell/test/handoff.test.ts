import assert from "node:assert/strict";
import { test } from "node:test";
import { runHandoff } from "../src/handoff.ts";

test("runHandoff does not throw when child fails", async () => {
	const result = await runHandoff({
		amberRoot: "/missing-amber",
		target: "/repo",
		runFn: async () => {
			throw new Error("spawn ENOENT");
		},
	});
	assert.equal(result.bundle.ok, false);
	assert.equal(result.validate.ok, false);
	assert.match(result.bundle.stderr, /ENOENT/);
});

test("runHandoff records non-zero exits without throwing", async () => {
	const calls: string[][] = [];
	const result = await runHandoff({
		amberRoot: "/amber",
		target: "/repo",
		nodeBin: "node",
		runFn: async (_bin, args) => {
			calls.push(args);
			return { stdout: "", stderr: "no session", code: 1 };
		},
	});
	assert.equal(result.bundle.ok, false);
	assert.equal(result.validate.ok, false);
	assert.equal(calls.length, 2);
	assert.ok(calls[0].includes("bundle"));
	assert.ok(calls[1].includes("validate"));
});
