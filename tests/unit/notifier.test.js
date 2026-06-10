const { describe, it } = require("node:test");
const assert = require("assert");
const {
	sendNotification,
	formatNotification,
} = require("../../scripts/lib/notifier");

describe("notifier", () => {
	it("should format notification message", () => {
		const message = formatNotification("session_completed", {
			sessionId: "123",
			goal: "test",
		});
		assert.ok(message.subject);
		assert.ok(message.body);
		assert.ok(message.body.includes("123"));
	});

	it("should skip disabled notification channels", async () => {
		const config = { email: { enabled: false }, slack: { enabled: false } };
		const result = await sendNotification("session_completed", {}, config, {
			dryRun: true,
		});
		assert.strictEqual(result.sent, 0);
	});

	it("should format session_failed message", () => {
		const message = formatNotification("session_failed", {
			sessionId: "456",
			error: "test error",
		});
		assert.ok(message.subject.includes("failed"));
		assert.ok(message.body.includes("456"));
		assert.ok(message.body.includes("test error"));
	});

	it("should format budget_warning message", () => {
		const message = formatNotification("budget_warning", {
			sessionId: "789",
			percentage: 90,
			used: 9000,
			total: 10000,
		});
		assert.ok(message.subject.includes("warning"));
		assert.ok(message.body.includes("90%"));
	});
});
