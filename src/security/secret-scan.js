"use strict";

/**
 * Secret scanner — detects hardcoded credentials, API keys, tokens, and passwords.
 */

// Patterns for common secret formats
const PATTERNS = [
	{
		type: "API Key",
		regex: /(?:api[_-]?key|apikey)\s*[:=]\s*["'`]([a-zA-Z0-9_-]{20,})["'`]/gi,
	},
	{
		type: "AWS Access Key",
		regex: /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
	},
	{
		type: "AWS Secret Key",
		regex: /["'`][A-Za-z0-9/+=]{40}["'`]\s*#.*secret/i,
	},
	{
		type: "GitHub Token",
		regex:
			/(?:gh[pousr]_[A-Za-z0-9_]{36,}|github[_-]?token\s*[:=]\s*["'`][A-Za-z0-9_]{20,}["'`])/gi,
	},
	{
		type: "JWT Token",
		regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
	},
	{
		type: "Password Assignment",
		regex:
			/(?:password|passwd|pwd|secret)\s*[:=]\s*["'`]([^"'\n]{6,})["'`](?!\s*\/\/(?:\s*eslint| biome))/gi,
	},
	{
		type: "Private Key",
		regex: /-----BEGIN (?:RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----/g,
	},
	{
		type: "Bearer Token",
		regex: /bearer\s+["'`]?([A-Za-z0-9_\-.]{20,})["'`]?/gi,
	},
];

/**
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{file: string, line: number, type: string, match: string}>}
 */
function scanForSecrets(files) {
	const findings = [];

	for (const file of files) {
		const lines = file.content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Skip pure comment lines for most patterns
			const isComment = /^\s*\/\/|^\s*#|^\s*\*/.test(line);

			for (const pattern of PATTERNS) {
				// Reset regex state
				pattern.regex.lastIndex = 0;

				let match;
				while ((match = pattern.regex.exec(line)) !== null) {
					// For password patterns in comments, skip
					if (isComment && pattern.type === "Password Assignment") {
						continue;
					}

					const matchedText = match[0];
					// Truncate long matches for readability
					const displayMatch =
						matchedText.length > 60 ? matchedText.slice(0, 57) + "..." : matchedText;

					findings.push({
						file: file.path,
						line: i + 1,
						type: pattern.type,
						match: displayMatch,
					});

					// Only report first match per line per pattern
					break;
				}
			}
		}
	}

	return findings;
}

module.exports = { scanForSecrets, PATTERNS };
