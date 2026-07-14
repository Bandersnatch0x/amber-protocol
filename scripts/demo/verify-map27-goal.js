#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const SCRATCH =
	process.env.GROK_SCRATCH ||
	"C:\\Users\\AMSTER~1\\AppData\\Local\\Temp\\grok-goal-7c8ace6dab20\\implementer";
const ROOT = path.resolve(__dirname, "..", "..");

fs.mkdirSync(SCRATCH, { recursive: true });

function sh(cmd) {
	return execSync(cmd, { encoding: "utf8" });
}

const results = { ok: true, checks: [] };

function check(name, pass, detail) {
	results.checks.push({ name, pass, detail });
	if (!pass) results.ok = false;
	console.log(pass ? "PASS" : "FAIL", name, detail || "");
}

// 1. No open 30-34 wayfinder
const open = JSON.parse(
	sh("gh issue list --repo Bandersnatch0x/amber-protocol --state open --json number,title,labels"),
);
fs.writeFileSync(path.join(SCRATCH, "open-map-tickets.json"), JSON.stringify(open, null, 2));
const openChildren = open.filter((i) => i.number >= 30 && i.number <= 34);
check("no open 30-34", openChildren.length === 0, JSON.stringify(openChildren));

// also 28-29 should be closed
const open28_34 = open.filter((i) => i.number >= 28 && i.number <= 34);
check("no open 28-34 children", open28_34.length === 0, JSON.stringify(open28_34.map((i) => i.number)));

// 2. Map decisions 28-34
const map = JSON.parse(sh("gh issue view 27 --repo Bandersnatch0x/amber-protocol --json body,state"));
fs.writeFileSync(path.join(SCRATCH, "map-27-decisions.md"), map.body);
for (const n of [28, 29, 30, 31, 32, 33, 34]) {
	check(`map links issues/${n}`, map.body.includes(`issues/${n}`), "");
}
check("map closed or open ok", true, map.state); // plan allows close after children

// 3. Issue 34 dual verdict
const i34 = sh("gh issue view 34 --repo Bandersnatch0x/amber-protocol --comments");
fs.writeFileSync(path.join(SCRATCH, "issue-34-resolution.md"), i34);
const hasLoop =
	/部分闭环/.test(i34) || /partial/i.test(i34);
const hasValue =
	/有合理价值但未验证/.test(i34) || /reasonable-but-unverified/i.test(i34);
check("34 has loop verdict 部分闭环", hasLoop, "");
check("34 has value verdict 有合理价值但未验证", hasValue, "");
check("34 has evidence language", /证据|evidence|反证|置信/i.test(i34), "");
check("34 grilling mentioned", /grilling|Grilling/i.test(i34), "");

// 4. Issue 33 pilot
const i33 = sh("gh issue view 33 --repo Bandersnatch0x/amber-protocol --comments");
fs.writeFileSync(path.join(SCRATCH, "issue-33-resolution.md"), i33);
check("33 mentions 2 repos", /2.{0,20}(repo|仓|仓库)|2-repo|2×10|2x10/i.test(i33), "");
check("33 mentions 10 tasks", /10.{0,20}(task|任务)/i.test(i33), "");
check(
	"33 measure classes",
	/复核|交接|Evidence|治理|净收益|review|handoff|governance|net/i.test(i33),
	"",
);
check("33 stop conditions", /停止|stop|Accept|Reject|accept|reject/i.test(i33), "");

// 5. git status — no scripts/lib product changes required; demo scripts ok under scripts/demo and docs/quality
const status = sh("git status --short");
fs.writeFileSync(path.join(SCRATCH, "git-status.txt"), status);
// any modified scripts/lib
const badLib = status
	.split(/\r?\n/)
	.filter((l) => /scripts[\\/]lib[\\/]/.test(l));
check("no scripts/lib product edits", badLib.length === 0, badLib.join(" | "));

// 6. assets index
const assets = [
	"docs/quality/user-journey-adoption-to-handoff.md",
	"docs/quality/e2e-governance-loop-verify.md",
	"docs/quality/e2e-governance-loop-verify.json",
	"docs/quality/governance-overhead-measure.md",
	"docs/quality/governance-overhead-measure.json",
	"docs/quality/external-adoption-evidence.md",
	"docs/quality/external-adoption-evidence.json",
	"docs/quality/baseline-net-value-comparison.md",
	"docs/quality/adjudication-loop-and-value.md",
	"docs/quality/adjudication-loop-and-value.json",
	"docs/quality/minimal-value-validation-pilot.md",
];
const index = [];
for (const a of assets) {
	const p = path.join(ROOT, a);
	const exists = fs.existsSync(p);
	index.push({ path: a, exists, bytes: exists ? fs.statSync(p).size : 0 });
	check(`asset ${a}`, exists, exists ? String(fs.statSync(p).size) : "missing");
}
fs.writeFileSync(path.join(SCRATCH, "assets-index.md"), index.map((i) => `- ${i.exists ? "OK" : "MISSING"} ${i.path} (${i.bytes})`).join("\n") + "\n");

// 7. adjudication JSON dual verdict
const adj = JSON.parse(
	fs.readFileSync(path.join(ROOT, "docs/quality/adjudication-loop-and-value.json"), "utf8"),
);
check("adjudication loopVerdict", adj.loopVerdict === "部分闭环", adj.loopVerdict);
check("adjudication valueVerdict", adj.valueVerdict === "有合理价值但未验证", adj.valueVerdict);
check("grillingPass", adj.grillingPass === true, String(adj.grillingPass));

fs.writeFileSync(path.join(SCRATCH, "verification-results.json"), JSON.stringify(results, null, 2));
console.log("\nOVERALL", results.ok ? "PASS" : "FAIL");
console.log("scratch", SCRATCH);
process.exit(results.ok ? 0 : 1);
