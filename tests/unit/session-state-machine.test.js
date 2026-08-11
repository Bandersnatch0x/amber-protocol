const { describe, it } = require("node:test");
const assert = require("assert");
const { SessionStateMachine, STATES } = require("../../scripts/lib/session-state-machine");

describe("SessionStateMachine", () => {
	it("starts in created state", () => {
		const sm = new SessionStateMachine();
		assert.strictEqual(sm.currentState, STATES.CREATED);
	});

	it("allows created → routed transition", () => {
		const sm = new SessionStateMachine();
		const result = sm.transition(STATES.ROUTED);
		assert.strictEqual(result.success, true);
		assert.strictEqual(sm.currentState, STATES.ROUTED);
	});

	it("allows routed → executing transition", () => {
		const sm = new SessionStateMachine();
		sm.transition(STATES.ROUTED);
		const result = sm.transition(STATES.EXECUTING);
		assert.strictEqual(result.success, true);
		assert.strictEqual(sm.currentState, STATES.EXECUTING);
	});

	it("allows executing → paused transition", () => {
		const sm = new SessionStateMachine();
		sm.transition(STATES.ROUTED);
		sm.transition(STATES.EXECUTING);
		const result = sm.transition(STATES.PAUSED);
		assert.strictEqual(result.success, true);
	});

	it("allows paused → executing transition (resume)", () => {
		const sm = new SessionStateMachine();
		sm.transition(STATES.ROUTED);
		sm.transition(STATES.EXECUTING);
		sm.transition(STATES.PAUSED);
		const result = sm.transition(STATES.EXECUTING);
		assert.strictEqual(result.success, true);
	});

	it("allows executing → completed transition", () => {
		const sm = new SessionStateMachine();
		sm.transition(STATES.ROUTED);
		sm.transition(STATES.EXECUTING);
		const result = sm.transition(STATES.COMPLETED);
		assert.strictEqual(result.success, true);
	});

	it("rejects created → executing (missing routed)", () => {
		const sm = new SessionStateMachine();
		const result = sm.transition(STATES.EXECUTING);
		assert.strictEqual(result.success, false);
		assert.ok(result.error.includes("Cannot transition"));
	});

	it("rejects completed → executing (final state)", () => {
		const sm = new SessionStateMachine();
		sm.transition(STATES.ROUTED);
		sm.transition(STATES.EXECUTING);
		sm.transition(STATES.COMPLETED);
		const result = sm.transition(STATES.EXECUTING);
		assert.strictEqual(result.success, false);
	});

	it("allows any state → failed transition", () => {
		const sm = new SessionStateMachine();
		const result = sm.transition(STATES.FAILED);
		assert.strictEqual(result.success, true);
		assert.strictEqual(sm.currentState, STATES.FAILED);
	});

	it("allows any state → aborted transition", () => {
		const sm = new SessionStateMachine();
		sm.transition(STATES.ROUTED);
		const result = sm.transition(STATES.ABORTED);
		assert.strictEqual(result.success, true);
	});

	it("returns timeline event type for each transition", () => {
		const sm = new SessionStateMachine();
		const result = sm.transition(STATES.ROUTED);
		assert.ok(result.event);
		assert.strictEqual(result.event.type, "route_selected");
	});

	it("includes fromState in the result", () => {
		const sm = new SessionStateMachine();
		const result = sm.transition(STATES.ROUTED);
		assert.strictEqual(result.fromState, STATES.CREATED);
		assert.strictEqual(result.toState, STATES.ROUTED);
	});
});
