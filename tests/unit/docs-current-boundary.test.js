"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const DOC_ROOT = path.join(ROOT, "docs");
const EXCLUDED_PARTS = new Set(["superpowers", "reviews"]);
const ALLOW_AUTONOMOUS_MODE = new Set([
	"docs/AUTONOMOUS_MODE_GUIDE.md",
	"docs/CLI_REFERENCE.md",
	"docs/TROUBLESHOOTING.md",
	"docs/adr/0002-v2-execution-scope.md",
	"docs/adr/0005-experimental-execution-removal.md",
	"docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md",
]);

function listMarkdown(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		const relParts = path.relative(DOC_ROOT, full).split(path.sep);
		if (relParts.some((part) => EXCLUDED_PARTS.has(part))) continue;
		if (entry.isDirectory()) files.push(...listMarkdown(full));
		else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
	}
	return files;
}

function rel(file) {
	return path.relative(ROOT, file).split(path.sep).join(path.posix.sep);
}

test("current docs do not advertise unsupported autonomous runtime commands", () => {
	const offenders = [];
	for (const file of listMarkdown(DOC_ROOT)) {
		const relative = rel(file);
		const text = fs.readFileSync(file, "utf8");
		if (!ALLOW_AUTONOMOUS_MODE.has(relative) && /--mode autonomous/.test(text)) {
			offenders.push(`${relative}: contains --mode autonomous`);
		}
		for (const pattern of [/amber\.js daemon (start|status|stop)/, /--checkpoint-interval/, /webhookUrl/, /"events"\s*:/]) {
			if (pattern.test(text)) offenders.push(`${relative}: matches ${pattern}`);
		}
	}
	assert.deepEqual(offenders, []);
});
