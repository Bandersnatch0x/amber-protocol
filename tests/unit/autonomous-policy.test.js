const { describe, it } = require("node:test");
const assert = require("assert");
const { loadPolicy, shouldAutoApproveGate, getRetryConfig } = require("../../scripts/lib/autonomous-policy");

describe("autonomous-policy", () => {
  it("should load default policy", () => {
    const policy = loadPolicy();
    assert.ok(policy);
    assert.strictEqual(policy.gates.auto, "approve");
  });

  it("should auto-approve gate based on policy", () => {
    const policy = { gates: { "user-approval": "approve", "step-confirm": "skip" } };
    assert.strictEqual(shouldAutoApproveGate("user-approval", policy), true);
    assert.strictEqual(shouldAutoApproveGate("step-confirm", policy), false);
    assert.strictEqual(shouldAutoApproveGate("unknown", policy), false);
  });

  it("should return retry config", () => {
    const policy = { retry: { maxAttempts: 3, backoffMs: [1000, 5000, 15000] } };
    const config = getRetryConfig(policy);
    assert.strictEqual(config.maxAttempts, 3);
    assert.strictEqual(config.backoffMs.length, 3);
  });
});
