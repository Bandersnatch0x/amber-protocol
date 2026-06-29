"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { findEncodingFindings } = require("../../scripts/validate-encoding");

test("findEncodingFindings accepts valid UTF-8 Chinese text", () => {
	const text = "# 标题\n\n这是正常的中文文档。\n";

	assert.deepEqual(findEncodingFindings("docs/example.md", text), []);
});

test("findEncodingFindings flags common mojibake markers", () => {
	const mojibakeLeftQuote = String.fromCodePoint(0x9210);
	const mojibakeArrow = String.fromCodePoint(0x922b);
	const text = `# Title\n\nAmber ${mojibakeLeftQuote}?governance ${mojibakeArrow}?verification\n`;

	const findings = findEncodingFindings("docs/broken.md", text);

	assert.deepEqual(
		findings.map((finding) => ({
			file: finding.file,
			line: finding.line,
			pattern: finding.pattern,
		})),
		[
			{ file: "docs/broken.md", line: 3, pattern: mojibakeLeftQuote },
			{ file: "docs/broken.md", line: 3, pattern: mojibakeArrow },
		],
	);
});
