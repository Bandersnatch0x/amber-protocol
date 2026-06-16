const { describe, it } = require("node:test");
const assert = require("assert");
const {
	parseSkillFrontmatter,
} = require("../../scripts/lib/core/agent-commands");

describe("parseSkillFrontmatter", () => {
	it("parses name, description, and x-amber-json", () => {
		const md = [
			"---",
			"name: amber-init",
			"description: Install the scaffold.",
			'x-amber-json: {"command":"node scripts/amber.js init --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-init"}',
			"---",
			"",
			"# Body",
		].join("\n");
		const result = parseSkillFrontmatter(md);
		assert.strictEqual(result.name, "amber-init");
		assert.strictEqual(result.description, "Install the scaffold.");
		assert.strictEqual(
			result.amber.command,
			"node scripts/amber.js init --target {{target}}",
		);
		assert.strictEqual(result.amber.args[0].name, "target");
		assert.strictEqual(result.amber.manualName, "amber-init");
	});

	it("returns amber:null when x-amber-json is absent", () => {
		const md = ["---", "name: amber-x", "description: No amber.", "---"].join(
			"\n",
		);
		const result = parseSkillFrontmatter(md);
		assert.strictEqual(result.name, "amber-x");
		assert.strictEqual(result.amber, null);
	});

	it("returns null when there is no frontmatter", () => {
		assert.strictEqual(parseSkillFrontmatter("# just markdown"), null);
	});

	it("throws on invalid x-amber-json", () => {
		const md = ["---", "name: a", "x-amber-json: {not json}", "---"].join("\n");
		assert.throws(() => parseSkillFrontmatter(md), /x-amber-json/);
	});
});
