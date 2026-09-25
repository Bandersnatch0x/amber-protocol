"use strict";

// F079 — authority moves before runtime code. This suite pins the exact narrow
// exception: internal deterministic maintenance jobs may be scheduled, while
// target commands, agents, workflows, external effects, and existing Loop
// Contracts remain unscheduled. README positioning stays byte-identical until
// F080+F081 evidence reaches the separate §55 gate.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const README_HASH = "sha256:cbd25c1cf0757b88ee557db0f88b9698127ac294ed24c1043f5da6e53f482bbf";
const AUTHORITY_TUPLE = [
	"executesAnything=false",
	"schedulesJobs=true",
	"dispatchesAgents=false",
	"writesExternalSystems=false",
];

function sha256(text) {
	return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

test("F079 accepts ADR-0103 and keeps the bounded H7 authority consistent across boundary docs", () => {
	const adr = read("docs/adr/0103-bounded-live-runtime-and-cancellation-authority.md");
	assert.match(adr, /\*\*Status:\*\* Accepted/);
	for (const phrase of [
		"closed registry of deterministic Amber",
		"executesAnything: false",
		"schedulesJobs: true",
		"dispatchesAgents: false",
		"writesExternalSystems: false",
		"Cancellation grants **zero launch authority**",
		"Positioning stays unchanged pending evidence",
	]) {
		assert.match(adr, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}

	const charter = read("docs/TEAM_REPLICATION_CHARTER.md");
	for (const phrase of [
		"bounded maintenance runtime",
		...AUTHORITY_TUPLE,
		"既有 loop/workflow contract 继续 `schedulesJobs=false`",
		"owned persisted handle",
		"取消权不授予启动权",
		"§55 翻转需 H7+cancel 验收证据与独立 HITL",
	]) {
		assert.ok(charter.includes(phrase), `charter missing ${phrase}`);
	}
	assert.doesNotMatch(charter, /^4\. Always-on \/ cron \/ daemon 调度 loop$/m);

	const manual = read("docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md");
	const loop = read("docs/product/LOOP.md");
	const agents = read("AGENTS.md");
	for (const [label, text] of [
		["manual", manual],
		["LOOP", loop],
		["AGENTS", agents],
	]) {
		assert.match(text, /ADR-0103/iu, `${label} does not cite ADR-0103`);
		assert.match(
			text,
			/executesAnything(?::|=)\s*false/u,
			`${label} lacks the no-execution ceiling`,
		);
		assert.match(text, /schedulesJobs(?::|=)\s*true/u, `${label} lacks the bounded schedule bit`);
		assert.match(text, /dispatchesAgents(?::|=)\s*false/u, `${label} lacks the agent ceiling`);
		assert.match(
			text,
			/writesExternalSystems(?::|=)\s*false/u,
			`${label} lacks the external ceiling`,
		);
	}
});

test("F079 keeps every existing Loop Contract unscheduled and non-dispatching", () => {
	const packRoot = path.join(ROOT, "workflow-packs");
	const files = [];
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".json")) files.push(full);
		}
	};
	walk(packRoot);
	files.sort();
	let contracts = 0;
	for (const file of files) {
		const name = path.relative(packRoot, file).replaceAll("\\", "/");
		const pack = JSON.parse(fs.readFileSync(file, "utf8"));
		for (const contract of pack.loopContracts || []) {
			contracts += 1;
			assert.deepEqual(
				contract.execution,
				{
					executesAnything: false,
					schedulesJobs: false,
					dispatchesAgents: false,
					writesExternalSystems: false,
				},
				`${name}/${contract.id} crossed the H7 boundary`,
			);
		}
	}
	assert.ok(contracts > 0, "workflow-pack census found no Loop Contracts");
});

test("F079 changes authority without flipping README positioning", () => {
	const readme = read("README.md");
	assert.equal(sha256(readme), README_HASH);
	assert.doesNotMatch(readme, /Governed Agent Harness for real engineering systems/);
	assert.match(readme, /trusted control boundary|Trusted Continuation/i);
});

test("ADR-0003 and ADR-0005 keep target scheduling and deleted-runtime resurrection forbidden", () => {
	const execution = read("docs/adr/0003-governance-gated-execution.md");
	assert.match(execution, /bounded maintenance scheduling exception/);
	assert.match(execution, /cannot invoke[\s\S]*loop run --execute/);
	assert.match(execution, /Existing loop\/workflow contracts stay `schedulesJobs: false`/);

	const removal = read("docs/adr/0005-experimental-execution-removal.md");
	assert.match(removal, /H7 is new bounded code, never restoration/);
	assert.match(removal, /do not recover, copy, repair, or adapt/);
	assert.match(removal, /does not restore the old PID\/SIGTERM daemon design/);
});
