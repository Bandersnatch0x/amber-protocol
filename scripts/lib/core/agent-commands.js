"use strict";

function stripQuotes(value) {
	const t = String(value).trim();
	if (
		(t.startsWith('"') && t.endsWith('"')) ||
		(t.startsWith("'") && t.endsWith("'"))
	) {
		return t.slice(1, -1);
	}
	return t;
}

function parseSkillFrontmatter(markdown) {
	const text = String(markdown || "");
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) {
		return null;
	}
	const lines = match[1].split(/\r?\n/);
	const result = { name: null, description: null, amber: null };
	for (const line of lines) {
		const nameMatch = line.match(/^name:\s*(.+?)\s*$/);
		if (nameMatch) {
			result.name = stripQuotes(nameMatch[1]);
			continue;
		}
		const descMatch = line.match(/^description:\s*(.+?)\s*$/);
		if (descMatch) {
			result.description = stripQuotes(descMatch[1]);
			continue;
		}
		const amberMatch = line.match(/^x-amber-json:\s*(.+?)\s*$/);
		if (amberMatch) {
			try {
				result.amber = JSON.parse(amberMatch[1]);
			} catch (error) {
				throw new Error(
					`Invalid x-amber-json in frontmatter: ${error.message}`,
				);
			}
		}
	}
	return result;
}

module.exports = {
	parseSkillFrontmatter,
};
