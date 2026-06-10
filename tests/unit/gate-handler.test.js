const { describe, it } = require("node:test");
const assert = require("assert");
const { Readable } = require("stream");
const {
	checkGate,
	createGateContext,
} = require("../../scripts/lib/gate-handler");

describe("Gate Handler", () => {
	it("auto gate with budget OK passes", async () => {
		const gate = { id: "g1", type: "auto", condition: { budgetOk: true } };
		const context = { budget: { used: 100, total: 1000 } };
		const result = await checkGate(gate, context);
		assert.strictEqual(result.passed, true);
	});

	it("auto gate with budget exceeded fails", async () => {
		const gate = { id: "g2", type: "auto", condition: { budgetOk: false } };
		const context = { budget: { used: 1000, total: 1000 } };
		const result = await checkGate(gate, context);
		assert.strictEqual(result.passed, false);
	});

	it("user-approval gate with yes input passes", async () => {
		const gate = { id: "g3", type: "user-approval", description: "Continue?" };
		const input = Readable.from(["yes\n"]);
		const result = await checkGate(gate, {}, { input });
		assert.strictEqual(result.passed, true);
	});

	it("user-approval gate with no input fails", async () => {
		const gate = { id: "g4", type: "user-approval", description: "Continue?" };
		const input = Readable.from(["no\n"]);
		const result = await checkGate(gate, {}, { input });
		assert.strictEqual(result.passed, false);
	});

	it("step-confirm gate with y input passes", async () => {
		const gate = { id: "g5", type: "step-confirm", description: "Proceed?" };
		const input = Readable.from(["y\n"]);
		const result = await checkGate(gate, {}, { input });
		assert.strictEqual(result.passed, true);
	});

	it("unknown gate type returns failure", async () => {
		const gate = { id: "g6", type: "frobnicate" };
		const result = await checkGate(gate, {});
		assert.strictEqual(result.passed, false);
		assert.ok(result.error);
	});
});

describe("createGateContext", () => {
	it("extracts budget from manifest", () => {
		const manifest = { budget: { used: 500, total: 2000 } };
		const ctx = createGateContext(manifest);
		assert.strictEqual(ctx.budget.used, 500);
		assert.strictEqual(ctx.budget.total, 2000);
	});

	it("defaults budget when missing", () => {
		const ctx = createGateContext({});
		assert.strictEqual(ctx.budget.used, 0);
		assert.strictEqual(ctx.budget.total, Infinity);
	});
});
