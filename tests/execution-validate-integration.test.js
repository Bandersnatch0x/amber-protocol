"use strict";

const assert = require("node:assert/strict");
const { validateIntegration } = require("../scripts/lib/core/execution-validator");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const test = require("node:test");

test("validateIntegration - integration with undeclared network calls warns", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-integration-test-"));
	const integrationPath = path.join(tempDir, "integration.json");
	const integration = {
		name: "example-integration",
		endpoints: [{ url: "https://api.example.com/data", method: "GET" }],
	};
	fs.writeFileSync(integrationPath, JSON.stringify(integration, null, 2));

	const result = validateIntegration(integrationPath);

	assert.strictEqual(result.valid, true);
	assert.ok(result.sideEffects.includes("network_call"));
	assert.ok(result.warnings.includes("Side effects detected but not declared in config"));

	fs.rmSync(tempDir, { recursive: true, force: true });
});

test("validateIntegration - valid integration with declared side effects has no errors", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-integration-test-"));
	const integrationPath = path.join(tempDir, "integration.json");
	const integration = {
		name: "example-integration",
		sideEffects: ["network_call"],
		endpoints: [{ url: "https://api.example.com/data", method: "GET" }],
	};
	fs.writeFileSync(integrationPath, JSON.stringify(integration, null, 2));

	const result = validateIntegration(integrationPath);

	assert.strictEqual(result.valid, true);
	assert.ok(result.sideEffects.includes("network_call"));
	assert.strictEqual(result.warnings.length, 0);

	fs.rmSync(tempDir, { recursive: true, force: true });
});

test("validateIntegration - JSON null body returns invalid instead of throwing", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-integration-test-"));
	const integrationPath = path.join(tempDir, "null.json");
	fs.writeFileSync(integrationPath, "null");

	const result = validateIntegration(integrationPath, { explain: true });

	assert.strictEqual(result.valid, false);
	assert.ok(result.warnings.some((w) => w.includes("must be a JSON object")));
	assert.ok(result.explanation.includes("does not contain a JSON object"));

	fs.rmSync(tempDir, { recursive: true, force: true });
});
