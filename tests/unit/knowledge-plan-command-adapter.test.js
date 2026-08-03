"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	knowledgeDispatch,
	isKnowledgeReadAction,
} = require("../../scripts/lib/knowledge-plan/adapters/command");
const {
	renderInspectText,
	renderReportText,
} = require("../../scripts/lib/knowledge-plan/adapters/renderers");

function makeTempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-kp-cmd-"));
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
}

const VALID_MINIMAL = {
	schemaVersion: "1.0.0",
	knowledgePlan: {
		template: "architecture",
		notes: [{ text: "note-one" }],
		documents: [{ title: "Sample Doc", goal: "goal text" }],
	},
	knowledgeCards: [{ id: "c1", text: "card body", tags: ["alpha"] }],
};

function captureBypass(dispatchResult) {
	const lines = [];
	const origLog = console.log;
	console.log = (...args) => {
		lines.push(args.map(String).join(" "));
	};
	try {
		assert.equal(typeof dispatchResult.onBypass, "function");
		dispatchResult.onBypass();
	} finally {
		console.log = origLog;
	}
	return lines.join("\n");
}

describe("knowledge-plan command adapter: action mapping", () => {
	it("recognizes only inspect/report/validate as read actions", () => {
		assert.equal(isKnowledgeReadAction("inspect"), true);
		assert.equal(isKnowledgeReadAction("report"), true);
		assert.equal(isKnowledgeReadAction("validate"), true);
		assert.equal(isKnowledgeReadAction("scaffold"), false);
		assert.equal(isKnowledgeReadAction("plan"), false);
		assert.equal(isKnowledgeReadAction("build"), false);
		assert.equal(isKnowledgeReadAction(undefined), false);
	});

	it("returns unknown read-action error for unsupported action", () => {
		const out = knowledgeDispatch("explode", { target: "." });
		assert.ok(Array.isArray(out.result.errors));
		assert.ok(out.result.errors[0].includes("Unknown knowledge read action"));
		assert.ok(out.result.errors[0].includes("inspect, report, validate"));
	});
});

describe("knowledge-plan command adapter: inspect", () => {
	it("returns structured result and bypassPrint when not --json", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const out = knowledgeDispatch("inspect", { target: tmp });
			assert.equal(out.result.found, true);
			assert.ok(out.result.plan);
			assert.equal(out.bypassPrint, true);
			assert.equal(typeof out.onBypass, "function");
			const text = captureBypass(out);
			assert.ok(text.includes("note-one"));
			assert.ok(text.includes("Sample Doc"));
			// Pretty JSON plan dump (operator-visible inspect fact)
			const parsed = JSON.parse(text);
			assert.equal(parsed.knowledgePlan.notes[0].text, "note-one");
		} finally {
			cleanup(tmp);
		}
	});

	it("does not bypass when --json (envelope path)", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const out = knowledgeDispatch("inspect", { target: tmp, json: true });
			assert.equal(out.bypassPrint, false);
			assert.equal(out.result.found, true);
		} finally {
			cleanup(tmp);
		}
	});

	it("renders missing-plan message on bypass", () => {
		const tmp = makeTempTarget();
		try {
			const out = knowledgeDispatch("inspect", { target: tmp });
			assert.equal(out.result.found, false);
			const text = captureBypass(out);
			assert.equal(text, "No knowledge-plan.json found.");
		} finally {
			cleanup(tmp);
		}
	});

	it("renders parse errors on bypass", () => {
		const tmp = makeTempTarget();
		try {
			const planDir = path.join(tmp, "docs", "wiki");
			fs.mkdirSync(planDir, { recursive: true });
			fs.writeFileSync(path.join(planDir, "knowledge-plan.json"), "{ broken", "utf8");
			const out = knowledgeDispatch("inspect", { target: tmp });
			assert.equal(out.result.found, true);
			assert.ok(out.result.errors.length > 0);
			const text = captureBypass(out);
			assert.ok(text.includes("Failed to read or parse"));
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan command adapter: report", () => {
	it("returns structured report and human text on bypass", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const out = knowledgeDispatch("report", { target: tmp });
			assert.equal(out.result.planFound, true);
			assert.ok(out.result.summary.includes("knowledge cards"));
			assert.equal(out.bypassPrint, true);
			const text = captureBypass(out);
			assert.ok(text.includes("Knowledge Plan Report"));
			assert.ok(text.includes("Sample Doc"));
			assert.ok(text.includes("note-one"));
			assert.ok(text.includes("card body"));
			assert.ok(text.includes("[missing]") || text.includes("[present]"));
		} finally {
			cleanup(tmp);
		}
	});

	it("human text for missing plan matches historical wording", () => {
		const tmp = makeTempTarget();
		try {
			const out = knowledgeDispatch("report", { target: tmp });
			assert.equal(out.result.planFound, false);
			const text = captureBypass(out);
			assert.ok(text.includes("No knowledge-plan.json present."));
			assert.ok(text.includes("amber wiki knowledge plan"));
		} finally {
			cleanup(tmp);
		}
	});

	it("json mode keeps structured result without bypass", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const out = knowledgeDispatch("report", { target: tmp, json: true });
			assert.equal(out.bypassPrint, false);
			assert.equal(out.result.planFound, true);
			assert.ok(out.result.coverage);
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan command adapter: validate", () => {
	it("returns envelope keys target/found/valid/errors/warnings", () => {
		const tmp = makeTempTarget();
		try {
			writeJsonPlan(tmp, VALID_MINIMAL);
			const out = knowledgeDispatch("validate", { target: tmp });
			assert.equal(out.bypassPrint, undefined);
			assert.equal(out.result.found, true);
			assert.equal(out.result.valid, true);
			assert.ok(Array.isArray(out.result.errors));
			assert.ok(Array.isArray(out.result.warnings));
			assert.ok(typeof out.result.target === "string");
		} finally {
			cleanup(tmp);
		}
	});

	it("marks invalid schema as valid:false", () => {
		const tmp = makeTempTarget();
		try {
			const planDir = path.join(tmp, "docs", "wiki");
			fs.mkdirSync(planDir, { recursive: true });
			fs.writeFileSync(
				path.join(planDir, "knowledge-plan.json"),
				JSON.stringify({ version: 1 }),
				"utf8",
			);
			const out = knowledgeDispatch("validate", { target: tmp });
			assert.equal(out.result.found, true);
			assert.equal(out.result.valid, false);
			assert.ok(out.result.errors.length > 0);
		} finally {
			cleanup(tmp);
		}
	});
});

describe("knowledge-plan renderers", () => {
	it("renderInspectText pretty-prints a found plan", () => {
		const text = renderInspectText({
			found: true,
			plan: { schemaVersion: "1.0.0", hello: "world" },
			errors: [],
		});
		assert.equal(text, JSON.stringify({ schemaVersion: "1.0.0", hello: "world" }, null, 2));
	});

	it("renderReportText includes report header", () => {
		const text = renderReportText({
			target: "/tmp/x",
			planFound: false,
			errors: [],
			warnings: [],
			plan: null,
			knowledgeCards: [],
			coverage: null,
			summary: "No knowledge-plan.json found.",
		});
		assert.ok(text.startsWith("Knowledge Plan Report — "));
		assert.ok(text.includes("No knowledge-plan.json present."));
	});
});
