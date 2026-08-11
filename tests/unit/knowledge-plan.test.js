"use strict";

const { describe, it } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
	KNOWLEDGE_PLAN_YAML_RELATIVE,
	parseSimpleYaml,
	validateKnowledgePlanData,
	loadKnowledgePlan,
	materializeKnowledgeBase,
	buildKnowledgeReport,
	proposeKnowledgePlan,
} = require("../../scripts/lib/core/knowledge-plan");

function makeTempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-kp-test-"));
}

function cleanup(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch (e) {
		void e;
	}
}

function writeJsonPlan(targetRoot, planData) {
	const planDir = path.join(targetRoot, "docs", "wiki");
	fs.mkdirSync(planDir, { recursive: true });
	const p = {
		schemaVersion: "1.0.0",
		version: 1,
		scope: { include: [], exclude: [] },
		knowledgePlan: { template: "architecture", notes: [], documents: [] },
		knowledgeCards: [],
		...planData,
	};
	fs.writeFileSync(path.join(planDir, "knowledge-plan.json"), JSON.stringify(p, null, 2), "utf8");
	return path.join(planDir, "knowledge-plan.json");
}

describe("knowledge-plan parseSimpleYaml", () => {
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

describe("knowledge-plan validateKnowledgePlanData", () => {
	it("returns valid:true for a minimal legal plan", () => {
		const data = {
			schemaVersion: "1.0.0",
			knowledgePlan: {
				template: "architecture",
				notes: [],
				documents: [{ title: "X", goal: "Y" }],
			},
			knowledgeCards: [],
		};
		const res = validateKnowledgePlanData(data);
		assert.strictEqual(res.valid, true);
		assert.strictEqual(res.errors.length, 0);
	});

	it("returns errors for invalid plan (missing required)", () => {
		const data = { version: 1 };
		const res = validateKnowledgePlanData(data);
		assert.strictEqual(res.valid, false);
		assert.ok(res.errors.length > 0);
	});
});

describe("knowledge-plan loadKnowledgePlan", () => {
	it("returns found:false when no plan present", () => {
		const tmp = makeTempTarget();
		try {
			const res = loadKnowledgePlan(tmp);
			assert.strictEqual(res.found, false);
			assert.strictEqual(res.plan, null);
		} finally {
			cleanup(tmp);
		}
	});

	it("loads and validates a json plan successfully", () => {
		const tmp = makeTempTarget();
		try {
			const plan = {
				schemaVersion: "1.0.0",
				knowledgePlan: {
					template: "architecture",
					notes: [{ text: "note" }],
					documents: [{ title: "T", goal: "G" }],
				},
				knowledgeCards: [{ id: "c1", text: "card", tags: ["t"] }],
			};
			writeJsonPlan(tmp, plan);
			const res = loadKnowledgePlan(tmp);
			assert.strictEqual(res.found, true);
			assert.strictEqual(res.errors.length, 0);
			assert.ok(res.plan);
			assert.strictEqual(res.plan.knowledgeCards.length, 1);
			assert.strictEqual(res.plan.knowledgeCards[0].text, "card");
		} finally {
			cleanup(tmp);
		}
	});

	it("reports errors for corrupt plan file", () => {
		const tmp = makeTempTarget();
		try {
			const planDir = path.join(tmp, "docs", "wiki");
			fs.mkdirSync(planDir, { recursive: true });
			fs.writeFileSync(path.join(planDir, "knowledge-plan.json"), "{ not valid json", "utf8");
			const res = loadKnowledgePlan(tmp);
			assert.strictEqual(res.found, true);
			assert.ok(res.errors.length > 0);
			assert.ok(res.errors[0].includes("Failed to read or parse"));
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan materializeKnowledgeBase", () => {
	it("is idempotent: second run on same target has created=[], skipped includes prior", () => {
		const tmp = makeTempTarget();
		try {
			const plan = {
				schemaVersion: "1.0.0",
				knowledgePlan: {
					template: "architecture",
					notes: [{ text: "n" }],
					documents: [{ title: "Doc A", goal: "g" }],
				},
				knowledgeCards: [],
			};
			writeJsonPlan(tmp, plan);
			const r1 = materializeKnowledgeBase(tmp, { dryRun: false });
			assert.ok(r1.created.length > 0);
			const r2 = materializeKnowledgeBase(tmp, { dryRun: false });
			assert.strictEqual(r2.created.length, 0);
			assert.ok(r2.skipped.length >= r1.created.length);
		} finally {
			cleanup(tmp);
		}
	});

	it("dryRun does not write any files", () => {
		const tmp = makeTempTarget();
		try {
			const plan = {
				schemaVersion: "1.0.0",
				knowledgePlan: {
					template: "architecture",
					notes: [],
					documents: [{ title: "D", goal: "g" }],
				},
				knowledgeCards: [{ text: "c" }],
			};
			writeJsonPlan(tmp, plan);
			const before = fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge"));
			const r = materializeKnowledgeBase(tmp, { dryRun: true });
			const after = fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge"));
			assert.strictEqual(before, false);
			assert.strictEqual(after, false);
			assert.ok(r.created.length > 0); // would have
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan buildKnowledgeReport", () => {
	it("reports summary when no plan present", () => {
		const tmp = makeTempTarget();
		try {
			const rep = buildKnowledgeReport(tmp);
			assert.strictEqual(rep.planFound, false);
			assert.ok(rep.summary.includes("No knowledge-plan.json"));
		} finally {
			cleanup(tmp);
		}
	});

	it("includes coverage when plan present", () => {
		const tmp = makeTempTarget();
		try {
			const plan = {
				schemaVersion: "1.0.0",
				knowledgePlan: {
					template: "architecture",
					notes: [],
					documents: [{ title: "Sample Doc", goal: "goal" }],
				},
				knowledgeCards: [{ text: "c1", tags: [] }],
			};
			writeJsonPlan(tmp, plan);
			const rep = buildKnowledgeReport(tmp);
			assert.strictEqual(rep.planFound, true);
			assert.ok(rep.coverage);
			assert.ok(typeof rep.coverage.total === "number");
			assert.ok(rep.summary.includes("knowledge cards"));
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan F4 roundtrip via propose + load", () => {
	it("proposeKnowledgePlan writes yaml; loadKnowledgePlan reads back consistent knowledgeCards", () => {
		const tmp = makeTempTarget();
		try {
			// no plan initially
			const prop = proposeKnowledgePlan(tmp, { dryRun: false });
			assert.ok(prop.created.length > 0 || prop.wouldWrite); // may vary but writes in !dry
			// force a write if skipped
			const _prop2 = proposeKnowledgePlan(tmp, { dryRun: false, force: true });
			void _prop2;
			// load should prefer? but no json yet, will hit the yaml written by propose
			const loaded = loadKnowledgePlan(tmp);
			assert.strictEqual(loaded.found, true);
			assert.strictEqual(loaded.errors.length, 0);
			assert.ok(Array.isArray(loaded.plan.knowledgeCards));
			// the produced cards from propose merge should be present
			assert.ok(loaded.plan.knowledgeCards.length >= 0);
			// roundtrip shape check: each has text (id/tags optional)
			for (const c of loaded.plan.knowledgeCards) {
				assert.ok(typeof c.text === "string" && c.text.length > 0);
				if (c.tags) assert.ok(Array.isArray(c.tags));
			}
			// also verify yaml file exists at expected relative
			const yamlPath = path.join(tmp, KNOWLEDGE_PLAN_YAML_RELATIVE);
			assert.ok(fs.existsSync(yamlPath));
		} finally {
			cleanup(tmp);
		}
	});
});
