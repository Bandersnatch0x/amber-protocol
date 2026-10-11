"use strict";

const { describe, it } = require("node:test");
const assert = require("assert");

const { parseSimpleYaml } = require("../../scripts/lib/core/simple-yaml");

describe("parseSimpleYaml", () => {
	it("parses basic key-value", () => {
		const y = 'schemaVersion: "1.0.0"\nversion: 3\nfoo: bar';
		const p = parseSimpleYaml(y);
		assert.strictEqual(p.schemaVersion, "1.0.0");
		assert.strictEqual(p.version, 3); // we coerce simple integers for schema
		assert.strictEqual(p.foo, "bar");
	});

	it("parses lists (- items) of scalars and objects", () => {
		const y = 'items:\n  - "a"\n  - b\nobjs:\n  - title: "T1"\n    goal: "G1"\n  - title: "T2"';
		const p = parseSimpleYaml(y);
		assert.deepStrictEqual(p.items, ["a", "b"]);
		assert.strictEqual(p.objs.length, 2);
		assert.strictEqual(p.objs[0].title, "T1");
		assert.strictEqual(p.objs[1].title, "T2");
	});

	it("parses nested objects", () => {
		const y = 'knowledgePlan:\n  template: "arch"\n  notes:\n    - text: "n1"';
		const p = parseSimpleYaml(y);
		assert.ok(p.knowledgePlan);
		assert.strictEqual(p.knowledgePlan.template, "arch");
		assert.strictEqual(p.knowledgePlan.notes[0].text, "n1");
	});

	it("handles quoted values", () => {
		const y = "k: \"val with space\"\nq: 'single'";
		const p = parseSimpleYaml(y);
		assert.strictEqual(p.k, "val with space");
		assert.strictEqual(p.q, "single");
	});
});
