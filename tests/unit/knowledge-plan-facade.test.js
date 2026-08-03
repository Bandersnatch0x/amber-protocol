"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	inspect,
	report,
	validate,
	scaffold,
	build,
	plan,
} = require("../../scripts/lib/knowledge-plan");

function makeTempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-kp-facade-"));
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
	const filePath = path.join(planDir, "knowledge-plan.json");
	fs.writeFileSync(filePath, JSON.stringify(p, null, 2), "utf8");
	return filePath;
}

function writeYamlPlan(targetRoot, yamlBody) {
	const planDir = path.join(targetRoot, "docs", "wiki");
	fs.mkdirSync(planDir, { recursive: true });
	const filePath = path.join(planDir, "knowledge-plan.yaml");
	fs.writeFileSync(filePath, yamlBody, "utf8");
	return filePath;
}

const VALID_MINIMAL = {
	schemaVersion: "1.0.0",
	knowledgePlan: {
		template: "architecture",
		notes: [{ text: "high signal" }],
		documents: [{ title: "Core", goal: "Describe core" }],
	},
	knowledgeCards: [{ id: "c1", text: "card text", tags: ["t"] }],
};

describe("knowledge-plan facade: inspect", () => {
	it("returns found:false for missing plan", () => {
		const tmp = makeTempTarget();
		try {
			const res = inspect(tmp);
			assert.equal(res.found, false);
			assert.equal(res.plan, null);
			assert.equal(res.errors.length, 0);
			assert.equal(res.source, null);
		} finally {
			cleanup(tmp);
		}
	});

	it("loads a valid JSON plan", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const res = inspect(tmp);
			assert.equal(res.found, true);
			assert.equal(res.errors.length, 0);
			assert.ok(res.plan);
			assert.equal(res.plan.knowledgeCards[0].text, "card text");
			assert.ok(String(res.source).endsWith("knowledge-plan.json"));
		} finally {
			cleanup(tmp);
		}
	});

	it("loads a valid YAML plan", () => {
		const tmp = makeTempTarget();
		try {
			writeYamlPlan(
				tmp,
				[
					'schemaVersion: "1.0.0"',
					"knowledgePlan:",
					'  template: "architecture"',
					"  notes:",
					'    - text: "yaml note"',
					"  documents:",
					'    - title: "Doc"',
					'      goal: "G"',
					"knowledgeCards: []",
					"",
				].join("\n"),
			);
			const res = inspect(tmp);
			assert.equal(res.found, true);
			assert.equal(res.errors.length, 0);
			assert.equal(res.plan.knowledgePlan.notes[0].text, "yaml note");
			assert.ok(String(res.source).endsWith("knowledge-plan.yaml"));
		} finally {
			cleanup(tmp);
		}
	});

	it("prefers JSON over YAML (lookup precedence)", () => {
		const tmp = makeTempTarget();
		try {
			writeYamlPlan(
				tmp,
				[
					'schemaVersion: "1.0.0"',
					"knowledgePlan:",
					'  template: "architecture"',
					"  notes: []",
					"  documents:",
					'    - title: "Yaml Only"',
					'      goal: "g"',
					"knowledgeCards: []",
					"",
				].join("\n"),
			);
			writeJsonPlan(tmp, {
				schemaVersion: "1.0.0",
				knowledgePlan: {
					template: "architecture",
					notes: [{ text: "from-json" }],
					documents: [{ title: "Json Wins", goal: "g" }],
				},
				knowledgeCards: [],
			});
			const res = inspect(tmp);
			assert.equal(res.found, true);
			assert.equal(res.errors.length, 0);
			assert.equal(res.plan.knowledgePlan.notes[0].text, "from-json");
			assert.ok(String(res.source).endsWith("knowledge-plan.json"));
		} finally {
			cleanup(tmp);
		}
	});

	it("falls back to .amber/knowledge-plan.yaml", () => {
		const tmp = makeTempTarget();
		try {
			const amberDir = path.join(tmp, ".amber");
			fs.mkdirSync(amberDir, { recursive: true });
			fs.writeFileSync(
				path.join(amberDir, "knowledge-plan.yaml"),
				[
					'schemaVersion: "1.0.0"',
					"knowledgePlan:",
					'  template: "architecture"',
					"  notes: []",
					"  documents:",
					'    - title: "Amber Fallback"',
					'      goal: "g"',
					"knowledgeCards: []",
					"",
				].join("\n"),
				"utf8",
			);
			const res = inspect(tmp);
			assert.equal(res.found, true);
			assert.equal(res.errors.length, 0);
			assert.equal(res.plan.knowledgePlan.documents[0].title, "Amber Fallback");
		} finally {
			cleanup(tmp);
		}
	});

	it("reports parse failures for corrupt JSON", () => {
		const tmp = makeTempTarget();
		try {
			const planDir = path.join(tmp, "docs", "wiki");
			fs.mkdirSync(planDir, { recursive: true });
			fs.writeFileSync(path.join(planDir, "knowledge-plan.json"), "{ not valid json", "utf8");
			const res = inspect(tmp);
			assert.equal(res.found, true);
			assert.equal(res.plan, null);
			assert.ok(res.errors.length > 0);
			assert.ok(res.errors[0].includes("Failed to read or parse"));
		} finally {
			cleanup(tmp);
		}
	});

	it("reports schema failures for invalid plan shape", () => {
		const tmp = makeTempTarget();
		try {
			const planDir = path.join(tmp, "docs", "wiki");
			fs.mkdirSync(planDir, { recursive: true });
			// Missing required knowledgePlan / schemaVersion
			fs.writeFileSync(
				path.join(planDir, "knowledge-plan.json"),
				JSON.stringify({ version: 1 }),
				"utf8",
			);
			const res = inspect(tmp);
			assert.equal(res.found, true);
			assert.ok(res.plan);
			assert.ok(res.errors.length > 0);
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan facade: report", () => {
	it("summarizes missing plan", () => {
		const tmp = makeTempTarget();
		try {
			const rep = report(tmp);
			assert.equal(rep.planFound, false);
			assert.ok(rep.summary.includes("No knowledge-plan.json"));
			assert.equal(rep.plan, null);
			assert.deepEqual(rep.knowledgeCards, []);
		} finally {
			cleanup(tmp);
		}
	});

	it("includes coverage and cards for a valid plan", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const rep = report(tmp);
			assert.equal(rep.planFound, true);
			assert.ok(rep.coverage);
			assert.equal(typeof rep.coverage.total, "number");
			assert.equal(rep.coverage.total, 1);
			assert.equal(rep.knowledgeCards.length, 1);
			assert.ok(rep.summary.includes("knowledge cards"));
			assert.equal(rep.plan.template, "architecture");
			assert.deepEqual(rep.plan.notes, ["high signal"]);
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan facade: validate", () => {
	it("valid:true when no plan present (no errors)", () => {
		const tmp = makeTempTarget();
		try {
			const res = validate(tmp);
			assert.equal(res.found, false);
			assert.equal(res.valid, true);
			assert.equal(res.errors.length, 0);
		} finally {
			cleanup(tmp);
		}
	});

	it("valid:true for a legal plan", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const res = validate(tmp);
			assert.equal(res.found, true);
			assert.equal(res.valid, true);
			assert.equal(res.errors.length, 0);
		} finally {
			cleanup(tmp);
		}
	});

	it("valid:false for schema-invalid plan", () => {
		const tmp = makeTempTarget();
		try {
			const planDir = path.join(tmp, "docs", "wiki");
			fs.mkdirSync(planDir, { recursive: true });
			fs.writeFileSync(
				path.join(planDir, "knowledge-plan.json"),
				JSON.stringify({ version: 1 }),
				"utf8",
			);
			const res = validate(tmp);
			assert.equal(res.found, true);
			assert.equal(res.valid, false);
			assert.ok(res.errors.length > 0);
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan facade: scaffold", () => {
	it("creates knowledge-plan.json by default", () => {
		const tmp = makeTempTarget();
		try {
			const res = scaffold(tmp, { dryRun: false });
			assert.ok(Array.isArray(res.created));
			assert.ok(res.created.some((p) => p.replace(/\\/g, "/").endsWith("docs/wiki/knowledge-plan.json")));
			assert.ok(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge-plan.json")));
			assert.equal(res.errors.length, 0);
		} finally {
			cleanup(tmp);
		}
	});

	it("creates knowledge-plan.yaml when yaml option is set", () => {
		const tmp = makeTempTarget();
		try {
			const res = scaffold(tmp, { dryRun: false, yaml: true });
			assert.ok(res.created.some((p) => p.replace(/\\/g, "/").endsWith("docs/wiki/knowledge-plan.yaml")));
			assert.ok(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge-plan.yaml")));
			assert.equal(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge-plan.json")), false);
		} finally {
			cleanup(tmp);
		}
	});

	it("is idempotent: second run skips existing", () => {
		const tmp = makeTempTarget();
		try {
			const r1 = scaffold(tmp, { dryRun: false });
			assert.ok(r1.created.length > 0);
			const r2 = scaffold(tmp, { dryRun: false });
			assert.equal(r2.created.length, 0);
			assert.ok(r2.skipped.length >= r1.created.length);
		} finally {
			cleanup(tmp);
		}
	});

	it("dryRun does not write files", () => {
		const tmp = makeTempTarget();
		try {
			const res = scaffold(tmp, { dryRun: true });
			assert.ok(res.created.length > 0);
			assert.equal(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge-plan.json")), false);
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan facade: build", () => {
	it("materializes knowledge pages from a plan", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, {
				schemaVersion: "1.0.0",
				knowledgePlan: {
					template: "architecture",
					notes: [{ text: "n" }],
					documents: [{ title: "Doc A", goal: "g" }],
				},
				knowledgeCards: [{ id: "c1", text: "card" }],
			});
			const res = build(tmp, { dryRun: false });
			assert.ok(res.created.length > 0);
			assert.ok(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge", "index.md")));
			assert.ok(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge", "doc-a", "doc-a.md")));
			assert.ok(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge", "knowledge-cards.md")));
			assert.equal(res.errors.length, 0);
		} finally {
			cleanup(tmp);
		}
	});

	it("is idempotent on repeated runs", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, {
				schemaVersion: "1.0.0",
				knowledgePlan: {
					template: "architecture",
					notes: [],
					documents: [{ title: "D", goal: "g" }],
				},
				knowledgeCards: [],
			});
			const r1 = build(tmp, { dryRun: false });
			assert.ok(r1.created.length > 0);
			const r2 = build(tmp, { dryRun: false });
			assert.equal(r2.created.length, 0);
			assert.ok(r2.skipped.length >= r1.created.length);
		} finally {
			cleanup(tmp);
		}
	});

	it("dryRun does not write knowledge tree", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, {
				schemaVersion: "1.0.0",
				knowledgePlan: {
					template: "architecture",
					notes: [],
					documents: [{ title: "D", goal: "g" }],
				},
				knowledgeCards: [{ text: "c" }],
			});
			const before = fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge"));
			const res = build(tmp, { dryRun: true });
			const after = fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge"));
			assert.equal(before, false);
			assert.equal(after, false);
			assert.ok(res.created.length > 0);
		} finally {
			cleanup(tmp);
		}
	});

	it("errors when no plan is present", () => {
		const tmp = makeTempTarget();
		try {
			const res = build(tmp, { dryRun: false });
			assert.ok(res.errors.length > 0);
			assert.ok(res.errors[0].includes("No valid knowledge plan"));
			assert.equal(res.created.length, 0);
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan facade: plan", () => {
	it("writes a yaml proposal when no plan exists", () => {
		const tmp = makeTempTarget();
		try {
			// Minimal package.json so inspection can seed a note
			fs.writeFileSync(
				path.join(tmp, "package.json"),
				JSON.stringify({ name: "fixture-pkg", description: "test fixture", type: "commonjs" }),
				"utf8",
			);
			const res = plan(tmp, { dryRun: false });
			assert.ok(res.created.length > 0 || res.wouldWrite);
			assert.ok(res.suggestedPlan);
			assert.ok(Array.isArray(res.suggestedPlan.knowledgePlan.documents));
			assert.ok(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge-plan.yaml")));
			assert.ok(typeof res.inspectionSummary === "string");
		} finally {
			cleanup(tmp);
		}
	});

	it("skips existing plan unless force is set", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const r1 = plan(tmp, { dryRun: false });
			// JSON plan counts as existing; without force should skip yaml write
			assert.equal(r1.existing, true);
			assert.ok(r1.skipped.length > 0);
			assert.equal(r1.created.length, 0);

			const r2 = plan(tmp, { dryRun: false, force: true });
			assert.ok(r2.created.length > 0);
			assert.ok(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge-plan.yaml")));
		} finally {
			cleanup(tmp);
		}
	});

	it("dryRun does not write proposal", () => {
		const tmp = makeTempTarget();
		try {
			const res = plan(tmp, { dryRun: true });
			assert.equal(res.wouldWrite, false);
			assert.equal(res.created.length, 0);
			assert.equal(fs.existsSync(path.join(tmp, "docs", "wiki", "knowledge-plan.yaml")), false);
			assert.ok(res.suggestedPlan);
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan facade: no console I/O", () => {
	it("inspect/report/validate/scaffold/build/plan do not write to stdout or stderr", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const origLog = console.log;
			const origError = console.error;
			const origWarn = console.warn;
			let wrote = false;
			const trap = () => {
				wrote = true;
			};
			console.log = trap;
			console.error = trap;
			console.warn = trap;
			try {
				inspect(tmp);
				report(tmp);
				validate(tmp);
				scaffold(tmp, { dryRun: true });
				build(tmp, { dryRun: true });
				plan(tmp, { dryRun: true });
			} finally {
				console.log = origLog;
				console.error = origError;
				console.warn = origWarn;
			}
			assert.equal(wrote, false);
		} finally {
			cleanup(tmp);
		}
	});
});
