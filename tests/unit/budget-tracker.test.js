const { describe, it } = require("node:test");
const assert = require("assert");
const {
	BudgetTracker,
	estimateStageConsumption,
} = require("../../scripts/lib/budget-tracker");

describe("Budget Tracker", () => {
	it("initializes with total and used values", () => {
		const tracker = new BudgetTracker(1000, 100);
		assert.strictEqual(tracker.getUsed(), 100);
		assert.strictEqual(tracker.getTotal(), 1000);
		assert.strictEqual(tracker.getPercentage(), 10);
	});

	it("adds consumption and updates used", () => {
		const tracker = new BudgetTracker(1000, 0);
		tracker.addConsumption(100);
		assert.strictEqual(tracker.getUsed(), 100);
		tracker.addConsumption(50);
		assert.strictEqual(tracker.getUsed(), 150);
	});

	it("emits warning at 90% threshold", () => {
		const tracker = new BudgetTracker(1000, 850);
		const result = tracker.addConsumption(50);
		assert.strictEqual(result.warning, true);
		assert.strictEqual(result.exceeded, false);
		assert.strictEqual(tracker.getPercentage(), 90);
	});

	it("does not re-emit warning above 90%", () => {
		const tracker = new BudgetTracker(1000, 850);
		tracker.addConsumption(50); // triggers warning
		const result = tracker.addConsumption(10); // 910/1000 = 91%
		assert.strictEqual(result.warning, false);
		assert.strictEqual(result.exceeded, false);
	});

	it("emits exceeded at 100% threshold", () => {
		const tracker = new BudgetTracker(1000, 950);
		const result = tracker.addConsumption(50);
		assert.strictEqual(result.warning, false);
		assert.strictEqual(result.exceeded, true);
		assert.strictEqual(tracker.getPercentage(), 100);
	});

	it("estimates stage consumption based on type", () => {
		assert.strictEqual(estimateStageConsumption("capture"), 1000);
		assert.strictEqual(estimateStageConsumption("plan"), 2000);
		assert.strictEqual(estimateStageConsumption("implement"), 5000);
		assert.strictEqual(estimateStageConsumption("verify"), 500);
	});

	it("defaults unknown stage to 1000", () => {
		assert.strictEqual(estimateStageConsumption("unknown"), 1000);
	});

	it("serializes to JSON", () => {
		const tracker = new BudgetTracker(1000, 500);
		const json = tracker.toJSON();
		assert.strictEqual(json.total, 1000);
		assert.strictEqual(json.used, 500);
	});
});
