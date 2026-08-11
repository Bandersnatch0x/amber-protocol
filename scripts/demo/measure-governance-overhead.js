#!/usr/bin/env node
"use strict";

/**
 * Measurement harness for wayfinder ticket:
 * "测量 Amber 的人工治理开销与重复录入"
 *
 * Times CLI governance steps and enumerates human-required operations for
 * bugfix-quick, feature-standard, and refactor-safe on a fresh git target.
 * Does not modify Amber product behavior.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AMBER = path.join(REPO_ROOT, "scripts", "amber.js");
const OUT_JSON = path.join(REPO_ROOT, "docs", "quality", "governance-overhead-measure.json");

const ROUTES = [
	{
		id: "bugfix-quick",
		featureId: "F-BUG",
		title: "Fix null guard",
		goal: "fix null guard on login",
		// gates from route file — inspect at runtime if needed
		approveGate: null, // resolve from route
	},
	{
		id: "feature-standard",
		featureId: "F-FEAT",
		title: "Add export button",
		goal: "implement export button",
		approveGate: "user-approval-implement",
	},
	{
		id: "refactor-safe",
		featureId: "F-REF",
		title: "Extract parser",
		goal: "refactor extract parser",
		approveGate: null,
	},
];

// Human judgment time estimates (seconds) for operations that cannot be automated
// without defeating governance intent. Mid-of-range for a familiar maintainer.
const HUMAN_JUDGMENT_S = {
	read_and_fill_plan_sections: 180, // 3 min: skim scaffold + write verification
	gate_confirm_after_read: 60, // 1 min: confirm plan
	session_approve_after_read: 45, // 45s: approve implement gate
	discover_gate_id_if_needed: 30, // when next does not name gate
	discover_session_complete_when_next_done: 45, // G1 recovery
	run_handoff_explicitly: 15, // know to run handoff
	review_complete_check_output: 20,
};

function runTimed(cwd, args) {
	const t0 = Date.now();
	const res = spawnSync(process.execPath, [AMBER, ...args], {
		cwd,
		encoding: "utf8",
		timeout: 120_000,
	});
	const ms = Date.now() - t0;
	return {
		args,
		ms,
		exitCode: res.status === null ? -1 : res.status,
		stdout: (res.stdout || "").trim(),
		stderr: (res.stderr || "").trim(),
	};
}

function git(cwd, args) {
	return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function ensurePlanReady(target, planRel) {
	const planPath = path.join(target, planRel);
	let c = fs.readFileSync(planPath, "utf8");
	const required = [
		"High Level Design",
		"Vertical Slices",
		"Resume Checkpoint",
		"Acceptance Criteria",
		"Verification",
		"Evidence Schema",
	];
	for (const section of required) {
		if (!new RegExp(`## ${section}\\n\\n- `).test(c)) {
			c = c.replace(
				new RegExp(`## ${section}\\n\\n`),
				`## ${section}\n\n- Filled for overhead measure (${section}).\n\n`,
			);
		}
	}
	if (!/- Resume Point:/i.test(c)) {
		c = c.replace(
			/## Resume Checkpoint\n\n/,
			"## Resume Checkpoint\n\n- Resume Point: measure\n- Blockers: none\n- Next Action: implement\n- Recovery Instructions: reopen\n\n",
		);
	}
	if (!/## Verification\n\n- /.test(c)) {
		c = c.replace(/## Verification\n\n/, "## Verification\n\n- Run npm test.\n\n");
	}
	fs.writeFileSync(planPath, c);
}

function loadRouteGates(routeId) {
	const p = path.join(REPO_ROOT, "routes", `${routeId}.route.json`);
	const j = JSON.parse(fs.readFileSync(p, "utf8"));
	const gates = Array.isArray(j.gates) ? j.gates : [];
	// Prefer implement/approve-style gate; else last gate; else first.
	const prefer =
		gates.find((g) => /implement|approve|merge/i.test(g.id)) || gates[gates.length - 1] || gates[0];
	return { gates, approveGate: prefer ? prefer.id : null };
}

function mkTarget(label) {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), `amber-oh-${label}-`));
	git(target, ["init"]);
	git(target, ["config", "user.email", "oh@amber.test"]);
	git(target, ["config", "user.name", "Overhead"]);
	fs.writeFileSync(
		path.join(target, "package.json"),
		JSON.stringify(
			{
				name: "oh-target",
				version: "0.0.0",
				private: true,
				scripts: { test: "node -e \"console.log('ok')\"" },
			},
			null,
			2,
		) + "\n",
	);
	fs.writeFileSync(path.join(target, "README.md"), `# ${label}\n`);
	git(target, ["add", "."]);
	git(target, ["commit", "-m", "init"]);
	return target;
}

function measureRoute(route) {
	const { gates, approveGate } = loadRouteGates(route.id);
	const gateId = route.approveGate || approveGate;
	const target = mkTarget(route.id);
	const steps = [];
	const humanOps = [];

	const rec = (name, kind, r, human) => {
		steps.push({
			name,
			kind, // cli | human | hybrid
			ms: r ? r.ms : 0,
			exitCode: r ? r.exitCode : null,
		});
		if (human) humanOps.push(human);
	};

	// Bootstrap once cost amortized — still record for first feature path
	let r = runTimed(target, ["init", "--target", "."]);
	rec("init", "cli", r, {
		id: "init_review_scaffold",
		label: "Skim init-created AGENTS/feature_list (first install only)",
		activeHuman: true,
		judgmentS: 60,
		repeatEntry: false,
		amortized: true,
	});

	r = runTimed(target, [
		"feature",
		"add",
		"--target",
		".",
		"--id",
		route.featureId,
		"--title",
		route.title,
		"--priority",
		"1",
		"--area",
		"measure",
	]);
	rec("feature add", "cli", r, {
		id: "feature_add",
		label: "Choose feature id/title",
		activeHuman: true,
		judgmentS: 30,
		repeatEntry: true, // title also in plan/session goal
	});

	r = runTimed(target, [
		"plan",
		"--target",
		".",
		"--feature",
		route.featureId,
		"--title",
		route.title,
	]);
	rec("plan scaffold", "cli", r, null);

	const plans = fs.readdirSync(path.join(target, "docs", "plans")).filter((f) => f.endsWith(".md"));
	const planRel = `docs/plans/${plans.find((f) => f.includes(route.featureId)) || plans[0]}`;
	const tFill0 = Date.now();
	ensurePlanReady(target, planRel);
	const fillMs = Date.now() - tFill0;
	rec(
		"fill plan sections (scripted stand-in)",
		"hybrid",
		{ ms: fillMs, exitCode: 0 },
		{
			id: "fill_plan",
			label: "Human fills Verification / design sections (generator leaves blanks)",
			activeHuman: true,
			judgmentS: HUMAN_JUDGMENT_S.read_and_fill_plan_sections,
			repeatEntry: true, // verification intent also on route + session verify command
		},
	);

	r = runTimed(target, ["gate", "--confirm", "--target", ".", "--plan", planRel]);
	rec("gate --confirm", "cli", r, {
		id: "plan_gate",
		label: "Human plan confirmation",
		activeHuman: true,
		judgmentS: HUMAN_JUDGMENT_S.gate_confirm_after_read,
		repeatEntry: false,
	});

	// work evidence
	fs.writeFileSync(path.join(target, `work-${route.id}.js`), "module.exports=1\n");
	git(target, ["add", "."]);
	git(target, ["commit", "-m", `work ${route.id}`]);

	r = runTimed(target, [
		"session",
		"start",
		"--target",
		".",
		"--goal",
		route.goal,
		"--feature",
		route.featureId,
		"--route",
		route.id,
		"--json",
	]);
	let sid;
	try {
		sid = JSON.parse(r.stdout).sessionId;
	} catch {
		const m = r.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
		sid = m && m[0];
	}
	rec("session start", "cli", r, {
		id: "session_start",
		label: "Choose goal/route/feature binding",
		activeHuman: true,
		judgmentS: 20,
		repeatEntry: true, // goal restates feature title
	});

	// next after start — document whether gate id is suggested
	const n1 = runTimed(target, ["next", "--target", ".", "--json"]);
	rec("next after start", "cli", n1, null);

	r = runTimed(target, [
		"session",
		"verify",
		"--session",
		sid,
		"--execute",
		"--command",
		"npm test",
		"--target",
		".",
	]);
	rec("session verify --execute", "cli", r, {
		id: "verify_execute",
		label: "Choose/allow verification command (policy-gated)",
		activeHuman: true,
		judgmentS: 15,
		repeatEntry: true, // same as plan Verification
	});

	// approve without gate first if multi-gate
	if (gates.length > 1) {
		const bad = runTimed(target, [
			"session",
			"approve",
			"--session",
			sid,
			"--yes",
			"--target",
			".",
		]);
		rec("approve without --gate (expect fail)", "cli", bad, {
			id: "discover_gate",
			label: "Discover correct --gate id (next often omits it)",
			activeHuman: true,
			judgmentS: HUMAN_JUDGMENT_S.discover_gate_id_if_needed,
			repeatEntry: false,
		});
	}

	r = runTimed(target, [
		"session",
		"approve",
		"--session",
		sid,
		"--gate",
		gateId,
		"--yes",
		"--target",
		".",
	]);
	rec("session approve", "cli", r, {
		id: "session_approve",
		label: "Human session gate approval",
		activeHuman: true,
		judgmentS: HUMAN_JUDGMENT_S.session_approve_after_read,
		repeatEntry: false,
	});

	const n2 = runTimed(target, ["next", "--target", ".", "--json"]);
	rec("next after approve", "cli", n2, {
		id: "follow_next_handoff",
		label: "Follow next → handoff (last-mile)",
		activeHuman: true,
		judgmentS: HUMAN_JUDGMENT_S.run_handoff_explicitly,
		repeatEntry: false,
	});

	r = runTimed(target, ["handoff", "--target", "."]);
	rec("handoff", "cli", r, {
		id: "handoff",
		label: "Regenerate live session-handoff.md (required before complete-check)",
		activeHuman: true,
		judgmentS: HUMAN_JUDGMENT_S.run_handoff_explicitly,
		repeatEntry: false,
	});

	r = runTimed(target, [
		"session",
		"complete-check",
		"--session",
		sid,
		"--strict",
		"--target",
		".",
	]);
	rec("complete-check --strict", "cli", r, {
		id: "read_complete_check",
		label: "Read complete-check reasons/missing",
		activeHuman: true,
		judgmentS: HUMAN_JUDGMENT_S.review_complete_check_output,
		repeatEntry: false,
	});

	r = runTimed(target, ["session", "complete", "--session", sid, "--target", "."]);
	rec("session complete", "cli", r, null);

	r = runTimed(target, ["accept", "--target", ".", "--plan", planRel, "--session", sid]);
	rec("accept", "cli", r, {
		id: "accept",
		label: "Human accept plan into evolution log",
		activeHuman: true,
		judgmentS: 30,
		repeatEntry: false,
	});

	const cliMs = steps
		.filter((s) => s.kind === "cli" || s.kind === "hybrid")
		.reduce((a, s) => a + s.ms, 0);
	const humanOpsActive = humanOps.filter(Boolean).filter((h) => h.activeHuman);
	const judgmentS = humanOpsActive.reduce((a, h) => a + (h.judgmentS || 0), 0);
	const judgmentSSteady = humanOpsActive
		.filter((h) => !h.amortized)
		.reduce((a, h) => a + (h.judgmentS || 0), 0);
	const repeatOps = humanOpsActive.filter((h) => h.repeatEntry);

	// Steady-state ordinary task: exclude first-install amortize
	const governanceOverheadMin = judgmentSSteady / 60;
	const cliMin = cliMs / 60000;

	let nextAfterApprove;
	try {
		nextAfterApprove = JSON.parse(n2.stdout);
	} catch {
		nextAfterApprove = { text: n2.stdout };
	}

	return {
		routeId: route.id,
		featureId: route.featureId,
		sessionId: sid,
		gateId,
		gateCount: gates.length,
		target,
		steps,
		humanOps: humanOpsActive,
		metrics: {
			cliWallMs: cliMs,
			cliWallMin: Number(cliMin.toFixed(3)),
			humanJudgmentS_all: judgmentS,
			humanJudgmentS_steady: judgmentSSteady,
			humanJudgmentMin_steady: Number(governanceOverheadMin.toFixed(2)),
			activeHumanOpCount: humanOpsActive.filter((h) => !h.amortized).length,
			repeatEntryOpCount: repeatOps.length,
			under10MinSteady: governanceOverheadMin <= 10,
			nextCompleteAfterApprove: Boolean(nextAfterApprove && nextAfterApprove.complete),
		},
		// Net benefit narrative fields for later synthesis (not measured clock time of review savings)
		netBenefitAssumptions: {
			baselineReviewWithoutAmberMin: null, // unknown without pilot
			note: "Net benefit cannot be proven positive without baseline pilot timing; overhead median is estimated from human ops + judgment model.",
		},
	};
}

function main() {
	const startedAt = new Date().toISOString();
	const routes = ROUTES.map(measureRoute);
	const steadyMinutes = routes.map((r) => r.metrics.humanJudgmentMin_steady);
	const median = [...steadyMinutes].sort((a, b) => a - b)[Math.floor(steadyMinutes.length / 2)];

	const report = {
		meta: {
			productVersion: require(path.join(REPO_ROOT, "package.json")).version,
			startedAt,
			finishedAt: new Date().toISOString(),
			method:
				"CLI wall-clock from real amber.js on temp git targets + structured human-judgment estimates for governance-only ops (excludes coding/implement time).",
			humanJudgmentModel: HUMAN_JUDGMENT_S,
		},
		routes,
		summary: {
			steadyGovernanceMinByRoute: Object.fromEntries(
				routes.map((r) => [r.routeId, r.metrics.humanJudgmentMin_steady]),
			),
			medianSteadyGovernanceMin: median,
			allUnder10Min: routes.every((r) => r.metrics.under10MinSteady),
			medianActiveHumanOps: routes.map((r) => r.metrics.activeHumanOpCount).sort((a, b) => a - b)[
				Math.floor(routes.length / 2)
			],
			repeatEntryOpsTypical: routes[1]?.metrics.repeatEntryOpCount ?? null,
			g1ObservedOnAll: routes.every((r) => r.metrics.nextCompleteAfterApprove),
			answer: {
				medianUnder10Min: median <= 10,
				netBenefitPositiveProven: false,
				reason:
					median <= 10
						? "Modeled steady human governance overhead median ≤10 minutes for ordinary tasks, but net benefit vs no-Amber baseline is unproven without pilot timing of review/handoff savings."
						: "Modeled median exceeds 10 minutes.",
			},
		},
	};

	fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
	fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + "\n");
	console.log(JSON.stringify(report.summary, null, 2));
	console.log("Wrote", OUT_JSON);
}

main();
