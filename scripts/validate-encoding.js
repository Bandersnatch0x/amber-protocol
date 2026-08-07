#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TEXT_EXTENSIONS = new Set([
	".cjs",
	".css",
	".html",
	".js",
	".json",
	".md",
	".mjs",
	".toml",
	".ts",
	".tsx",
	".txt",
	".yaml",
	".yml",
]);
const MOJIBAKE_PATTERNS = [
	0xfffd, 0x00e2, 0x9210, 0x922b, 0x9241, 0x9242, 0x951b, 0x7ee0, 0x6d63, 0x6d93, 0x93b4, 0x59af,
	0x7039, 0x9429, 0x95c2,
].map((codePoint) => String.fromCodePoint(codePoint));

function trackedFiles(root = ROOT) {
	const result = spawnSync("git", ["ls-files"], {
		cwd: root,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || "git ls-files failed");
	}
	return result.stdout
		.split(/\r?\n/)
		.filter(Boolean)
		.filter((filePath) => fs.existsSync(path.join(root, filePath)));
}

function isTextFile(filePath) {
	return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function findEncodingFindings(filePath, text) {
	const findings = [];
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		for (const pattern of MOJIBAKE_PATTERNS) {
			if (line.includes(pattern)) {
				findings.push({
					file: filePath,
					line: index + 1,
					pattern,
				});
			}
		}
	}
	return findings;
}

function main() {
	const findings = [];
	for (const filePath of trackedFiles()) {
		if (!isTextFile(filePath)) {
			continue;
		}
		const absolutePath = path.join(ROOT, filePath);
		const text = fs.readFileSync(absolutePath, "utf8");
		findings.push(...findEncodingFindings(filePath, text));
	}

	if (findings.length > 0) {
		console.error("Encoding check failed:");
		for (const finding of findings) {
			console.error(
				`- ${finding.file}:${finding.line} contains ${JSON.stringify(finding.pattern)}`,
			);
		}
		process.exit(1);
	}

	console.log("Encoding check passed.");
}

if (require.main === module) {
	main();
}

module.exports = {
	findEncodingFindings,
	trackedFiles,
};
