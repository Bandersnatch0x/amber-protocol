#!/usr/bin/env node
"use strict";

/**
 * AFK verification for wayfinder ticket:
 * "在全新目标仓库验证 Amber 治理闭环"
 *
 * Creates a fresh non-Amber git target and exercises:
 *   A) success path
 *   B) rejection paths (policy deny, claim-only vs strict, accept without evidence)
 *   C) verify-fail recovery
 *   D) cross-session handoff
 *
 * Read-only w.r.t. the product repo: only mutates a temp target.
 * Usage:
 *   npm run test:governance-loop
 *   node scripts/demo/e2e-governance-loop-verify.js [--output <json>] [--help]
 * Exits non-zero on any path regression or product-repo mutation.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AMBER = path.join(REPO_ROOT, "scripts", "amber.js");
const { DEPLOYMENT_PROFILES } = require("../lib/core/deployment-profile");

function parseRunnerArgs(argv) {
	const parsed = { outputPath: null, help: false, fixtureFamily: false };
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--help" || token === "-h") {
			parsed.help = true;
			continue;
		}
		if (token === "--fixture-family") {
			parsed.fixtureFamily = true;
			continue;
		}
		if (token === "--output") {
			parsed.outputPath = argv[index + 1] || null;
			index += 1;
			continue;
		}
		if (token.startsWith("--output=")) {
			parsed.outputPath = token.slice("--output=".length);
		}
	}
	return parsed;
}

function listSessionIds(root) {
	const dir = path.join(root, ".amber", "sessions");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => {
			try {
				return fs.statSync(path.join(dir, name)).isDirectory();
			} catch {
				return false;
			}
		})
		.sort();
}

function qualityLogMtime(root) {
	const logPath = path.join(root, "docs", "quality", "e2e-governance-loop-verify.json");
	if (!fs.existsSync(logPath)) return null;
	return fs.statSync(logPath).mtimeMs;
}

function gitPorcelain(root) {
	const res = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
	if (res.status !== 0) return [];
	return (res.stdout || "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.sort();
}

function snapshotProduct(root) {
	return {
		sessions: listSessionIds(root),
		qualityLogMtime: qualityLogMtime(root),
		porcelain: gitPorcelain(root),
	};
}

function detectProductMutation(root, snap) {
	const leakedSessions = listSessionIds(root).filter((id) => !(snap.sessions || []).includes(id));
	const dirtyPaths = [];
	const logPath = path.join(root, "docs", "quality", "e2e-governance-loop-verify.json");
	const mtime = qualityLogMtime(root);
	if (mtime != null && mtime !== snap.qualityLogMtime) {
		dirtyPaths.push(path.relative(root, logPath) || logPath);
	}
	const before = new Set(snap.porcelain || []);
	for (const line of gitPorcelain(root)) {
		if (!before.has(line)) dirtyPaths.push(line);
	}
	return { leakedSessions, dirtyPaths };
}

function exitCodeFromSummary(summary) {
	if (!summary || typeof summary !== "object") return 1;
	const rejections = summary.rejections || {};
	const rejectionsHold =
		Boolean(rejections.policyDeny) &&
		Boolean(rejections.claimStrict) &&
		Boolean(rejections.acceptNoEvidence) &&
		Boolean(rejections.approveNeedsGate);
	if ((summary.highFindings || []).length > 0) return 1;
	if (!summary.successClosed) return 1;
	if (!rejectionsHold) return 1;
	if (!summary.verifyFailRecovered) return 1;
	if (!summary.crossSessionHandoff) return 1;
	return 0;
}

function printRunnerHelp() {
	console.log(
		[
			"Usage: npm run test:governance-loop",
			"       node scripts/demo/e2e-governance-loop-verify.js [--output <json>] [--help]",
			"",
			"Runs the Governance Console paths on fresh non-Amber git targets:",
			"success (once per deployment profile), adversarial no-evidence refusal,",
			"rejections, verify-fail recovery, cross-session handoff.",
			"Exits non-zero on any path regression or product-repo mutation.",
			"Does not write docs/quality unless --output is given.",
			"",
			"--fixture-family  Check every committed golden (tests/fixtures/governance/)",
			"                  against its own path's runtime result. Exits non-zero",
			"                  on any golden mismatch. Green on a healthy run.",
		].join("\n"),
	);
}

const results = {
	meta: {
		// Redact absolute repo path so committed logs never contain forbidden legacy name segments.
		productRoot: "<product-root>",
		productVersion: require(path.join(REPO_ROOT, "package.json")).version,
		startedAt: new Date().toISOString(),
		platform: process.platform,
		node: process.version,
	},
	paths: {},
	findings: [],
};

function run(cwd, args, opts = {}) {
	const res = spawnSync(process.execPath, [AMBER, ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...(opts.env || {}) },
		timeout: opts.timeout || 120_000,
	});
	return {
		args,
		exitCode: res.status === null ? -1 : res.status,
		stdout: (res.stdout || "").trim(),
		stderr: (res.stderr || "").trim(),
	};
}

function git(cwd, args) {
	const res = spawnSync("git", args, { cwd, encoding: "utf8" });
	return {
		exitCode: res.status === null ? -1 : res.status,
		stdout: (res.stdout || "").trim(),
		stderr: (res.stderr || "").trim(),
	};
}

function note(id, severity, text, evidence) {
	results.findings.push({ id, severity, text, evidence });
}

function ensurePlanReady(target, planRel) {
	const planPath = path.join(target, planRel);
	let c = fs.readFileSync(planPath, "utf8");
	// Ensure every required section has a non-empty body for accept validation.
	const required = [
		"High Level Design",
		"Vertical Slices",
		"Resume Checkpoint",
		"Acceptance Criteria",
		"Verification",
		"Evidence Schema",
	];
	for (const section of required) {
		const re = new RegExp(`## ${section}\\n\\n\\s*\\n`, "m");
		if (re.test(c) || new RegExp(`## ${section}\\n\\n$`, "m").test(c)) {
			c = c.replace(
				new RegExp(`## ${section}\\n\\n`),
				`## ${section}\n\n- Filled by e2e harness for section ${section}.\n\n`,
			);
		}
	}
	// Verification must be non-empty for accept; feature seed may leave it empty.
	if (!/## Verification\n\n- /.test(c)) {
		c = c.replace(/## Verification\n\n/, "## Verification\n\n- Run npm test.\n\n");
	}
	// Resume Checkpoint fields
	if (!/- Resume Point:/i.test(c)) {
		c = c.replace(
			/## Resume Checkpoint\n\n/,
			"## Resume Checkpoint\n\n- Resume Point: e2e\n- Blockers: none\n- Next Action: implement\n- Recovery Instructions: reopen plan\n\n",
		);
	}
	// F027: gate/accept refuse `<fill:>` context-manifest placeholders.
	c = c
		.replace(
			"- implement: <fill: knowledge-surface paths the implementer needs>",
			"- implement: docs/wiki/engineering/verification.md",
		)
		.replace(
			"- review: <fill: knowledge-surface paths the reviewer needs>",
			"- review: docs/wiki/engineering/runbook.md",
		);
	fs.writeFileSync(planPath, c);
}

function parseJsonOut(r) {
	try {
		return JSON.parse(r.stdout);
	} catch {
		// Some commands mix logs; try last JSON object.
		const m = r.stdout.match(/\{[\s\S]*\}\s*$/);
		if (m) {
			try {
				return JSON.parse(m[0]);
			} catch {
				return null;
			}
		}
		return null;
	}
}

function nextJson(target, extra = []) {
	const r = run(target, ["next", "--target", ".", "--json", ...extra]);
	return { exitCode: r.exitCode, text: r.stdout, json: parseJsonOut(r) };
}

function mkTarget(label) {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), `amber-e2e-${label}-`));
	git(target, ["init"]);
	git(target, ["config", "user.email", "e2e@amber.test"]);
	git(target, ["config", "user.name", "Amber E2E"]);
	fs.writeFileSync(
		path.join(target, "package.json"),
		JSON.stringify(
			{
				name: "amber-e2e-target",
				version: "0.0.0",
				private: true,
				scripts: { test: "node -e \"console.log('ok')\"" },
			},
			null,
			2,
		) + "\n",
	);
	fs.writeFileSync(
		path.join(target, "README.md"),
		`# ${label}\n\nNon-Amber target for governance loop e2e.\n`,
	);
	git(target, ["add", "."]);
	git(target, ["commit", "-m", "chore: initial non-amber target"]);
	return target;
}

/**
 * Success path under a declared deployment profile (#160).
 *
 * The fixture family carries one success fixture per deployment profile; each
 * golden must be checked against a run that actually declared that profile,
 * because the profile flows into artifacts (sync envelope origin.profile).
 * @param {string} profileLabel - One of DEPLOYMENT_PROFILES.
 */
function pathSuccess(profileLabel) {
	const target = mkTarget(`success-${profileLabel}`);
	const { writeProfileFile } = require("../lib/core/deployment-profile");
	const profileErrors = writeProfileFile(target, profileLabel).errors;
	if (profileErrors.length > 0) {
		note(
			"S0",
			"high",
			`Success path could not declare profile "${profileLabel}": ${profileErrors.join("; ")}`,
		);
	}
	const log = [];
	const step = (name, r) => {
		log.push({
			name,
			exitCode: r.exitCode,
			stdoutHead: (r.stdout || "").slice(0, 400),
			stderrHead: (r.stderr || "").slice(0, 200),
		});
		return r;
	};

	step("audit", run(target, ["audit", "--target", ".", "--json"]));
	const n0 = nextJson(target);
	log.push({ name: "next@empty", next: n0.json || n0.text });

	step("init", run(target, ["init", "--target", "."]));
	const n1 = nextJson(target);
	log.push({ name: "next@init", next: n1.json || n1.text });

	// Prefer seeded F001 if present; else add F002.
	const fl = JSON.parse(fs.readFileSync(path.join(target, "feature_list.json"), "utf8"));
	const featureId = fl.features?.[0]?.id || "F002";
	if (!fl.features?.length) {
		step(
			"feature add",
			run(target, [
				"feature",
				"add",
				"--target",
				".",
				"--id",
				"F002",
				"--title",
				"E2E feature",
				"--priority",
				"1",
				"--area",
				"e2e",
			]),
		);
	}

	step(
		"plan",
		run(target, ["plan", "--target", ".", "--feature", featureId, "--title", "E2E plan"]),
	);
	const plans = fs.readdirSync(path.join(target, "docs", "plans")).filter((f) => f.endsWith(".md"));
	const planRel = `docs/plans/${plans[0]}`;
	ensurePlanReady(target, planRel);

	const n2 = nextJson(target);
	log.push({ name: "next@plan", next: n2.json || n2.text });

	step("gate --confirm", run(target, ["gate", "--confirm", "--target", ".", "--plan", planRel]));
	const n3 = nextJson(target);
	log.push({ name: "next@gate", next: n3.json || n3.text });

	// Real work outside .amber so complete-check "work present" is meaningful.
	fs.writeFileSync(path.join(target, "src-app.js"), "module.exports = { ok: true };\n");
	git(target, ["add", "src-app.js"]);
	git(target, ["commit", "-m", "feat: app stub for e2e work evidence"]);

	const start = step(
		"session start",
		run(target, [
			"session",
			"start",
			"--target",
			".",
			"--goal",
			"e2e success path",
			"--feature",
			featureId,
			"--confirm",
			"--json",
		]),
	);
	const sid = parseJsonOut(start)?.sessionId;
	const n4 = nextJson(target);
	log.push({ name: "next@session-start", sessionId: sid, next: n4.json || n4.text });

	step(
		"session verify --execute",
		run(target, [
			"session",
			"verify",
			"--session",
			sid,
			"--execute",
			"--command",
			"npm test",
			"--target",
			".",
			"--confirm",
		]),
	);
	const n5 = nextJson(target);
	log.push({ name: "next@verify", next: n5.json || n5.text });

	// Approve one session gate (demo uses implement gate).
	step(
		"session approve",
		run(target, [
			"session",
			"approve",
			"--session",
			sid,
			"--gate",
			"user-approval-implement",
			"--yes",
			"--target",
			".",
		]),
	);
	const n6 = nextJson(target);
	log.push({ name: "next@approve", next: n6.json || n6.text });

	const handoffBefore = fs.readFileSync(path.join(target, "session-handoff.md"), "utf8");
	const isTemplateHandoff =
		/scaffolded|not run yet|not recorded/i.test(handoffBefore) ||
		handoffBefore.includes("Command: not run yet");

	// G2: complete-check must FAIL while handoff is still the init scaffold.
	const ccOnTemplate = step(
		"complete-check --strict (scaffold handoff)",
		run(target, ["session", "complete-check", "--session", sid, "--strict", "--target", "."]),
	);
	const nextAfterApprove = n6.json;
	const nextRecommendsHandoff =
		(nextAfterApprove && nextAfterApprove.nextStep && nextAfterApprove.nextStep.id === "handoff") ||
		/handoff/i.test(JSON.stringify(nextAfterApprove || n6.text));
	const nextSaysDone =
		(nextAfterApprove && nextAfterApprove.complete === true) ||
		/All lifecycle steps complete/i.test(n6.text || "");

	// G1 path: handoff → complete-check → session complete → accept
	const handoff = step("handoff", run(target, ["handoff", "--target", "."]));
	const handoffAfter = fs.readFileSync(path.join(target, "session-handoff.md"), "utf8");
	const nH = nextJson(target);
	log.push({ name: "next@handoff", next: nH.json || nH.text });

	const ccStrict = step(
		"complete-check --strict (after live handoff)",
		run(target, ["session", "complete-check", "--session", sid, "--strict", "--target", "."]),
	);
	log.push({
		name: "handoff-template-check",
		isTemplateHandoff,
		completeCheckFailedOnTemplate:
			ccOnTemplate.exitCode !== 0 || /status: fail/i.test(ccOnTemplate.stdout),
		completeCheckPassedAfterLive: /status: pass/i.test(ccStrict.stdout),
		completeCheckOut: ccStrict.stdout,
	});

	step("session complete", run(target, ["session", "complete", "--session", sid, "--target", "."]));
	const n7 = nextJson(target);
	log.push({ name: "next@session-complete", next: n7.json || n7.text });

	const accept = step(
		"accept",
		run(target, ["accept", "--target", ".", "--plan", planRel, "--session", sid]),
	);
	step("handoff after accept", run(target, ["handoff", "--target", "."]));
	const n8 = nextJson(target);
	log.push({ name: "next@done", next: n8.json || n8.text });

	const flAfter = JSON.parse(fs.readFileSync(path.join(target, "feature_list.json"), "utf8"));
	const feature = flAfter.features.find((f) => f.id === featureId);
	const completeCheckPassedAfterLiveHandoff = /status: pass/i.test(ccStrict.stdout);

	const success = {
		target,
		sessionId: sid,
		profile: profileLabel,
		planRel,
		featureStatus: feature?.status,
		evidenceCount: feature?.evidence?.length || 0,
		acceptExit: accept.exitCode,
		handoffExit: handoff.exitCode,
		handoffContainsEvidence: /npm test/i.test(handoffAfter),
		handoffContainsSession: handoffAfter.includes(String(sid).slice(0, 8)),
		nextAfterApproveComplete: nextSaysDone,
		nextRecommendsHandoff,
		completeCheckFailedOnTemplateHandoff:
			ccOnTemplate.exitCode !== 0 || /status: fail/i.test(ccOnTemplate.stdout),
		completeCheckPassedAfterLiveHandoff,
		isTemplateHandoffBeforeRegen: isTemplateHandoff,
		closed:
			accept.exitCode === 0 &&
			handoff.exitCode === 0 &&
			(feature?.evidence?.length || 0) > 0 &&
			completeCheckPassedAfterLiveHandoff,
		log,
	};

	if (success.closed) {
		note(
			"S1",
			"info",
			"Success path closed: init→plan→gate→session→verify--execute→approve→handoff→complete-check→complete→accept with feature evidence.",
			{ sessionId: sid, featureStatus: feature?.status },
		);
	} else {
		note("S1", "high", "Success path did not fully close.", success);
	}
	// G1 fixed: next should recommend handoff after approve (not "all complete").
	if (nextSaysDone || !nextRecommendsHandoff) {
		note(
			"G1",
			"high",
			"Regression: after approve, amber next did not recommend handoff last-mile.",
			{ next: nextAfterApprove || n6.text },
		);
	} else {
		note("G1", "info", "G1 fixed: after approve, next recommends handoff.", {
			next: nextAfterApprove,
		});
	}
	// G2 fixed: complete-check must fail on scaffold handoff.
	if (isTemplateHandoff && success.completeCheckFailedOnTemplateHandoff) {
		note(
			"G2",
			"info",
			"G2 fixed: complete-check --strict fails while session-handoff.md is still the init template.",
			{ handoffHead: handoffBefore.slice(0, 240) },
		);
	} else if (isTemplateHandoff) {
		note(
			"G2",
			"high",
			"Regression: complete-check --strict still passes on init template handoff.",
			{ out: ccOnTemplate.stdout },
		);
	}

	return success;
}

/**
 * Adversarial success variant (#160): attempt to accept a feature with NO
 * executed verification evidence on the success path. The governance gate
 * must refuse (R3) — the golden for success-adversarial-no-evidence asserts
 * successClosed false, highFindings ["R3"], exitCode 1.
 *
 * This genuinely exercises the refusal instead of proxying the rejection
 * path's accept-without-evidence facts.
 * @returns {{acceptBlocked: boolean, closed: boolean}}
 */
function pathSuccessAdversarial() {
	const target = mkTarget("adversarial");
	const log = [];
	const step = (name, r) => {
		log.push({
			name,
			exitCode: r.exitCode,
			stdoutHead: (r.stdout || "").slice(0, 400),
			stderrHead: (r.stderr || "").slice(0, 200),
		});
		return r;
	};
	const { writeProfileFile } = require("../lib/core/deployment-profile");
	writeProfileFile(target, "personal-node");

	step("init", run(target, ["init", "--target", "."]));
	const fl = JSON.parse(fs.readFileSync(path.join(target, "feature_list.json"), "utf8"));
	const featureId = fl.features?.[0]?.id || "F002";
	if (!fl.features?.length) {
		step(
			"feature add",
			run(target, [
				"feature",
				"add",
				"--target",
				".",
				"--id",
				featureId,
				"--title",
				"Adversarial no-evidence feature",
				"--priority",
				"1",
				"--area",
				"e2e",
			]),
		);
	}
	step(
		"plan",
		run(target, ["plan", "--target", ".", "--feature", featureId, "--title", "Adversarial plan"]),
	);
	const plans = fs.readdirSync(path.join(target, "docs", "plans")).filter((f) => f.endsWith(".md"));
	const planRel = `docs/plans/${plans[0]}`;
	ensurePlanReady(target, planRel);
	step("gate --confirm", run(target, ["gate", "--confirm", "--target", ".", "--plan", planRel]));

	// Start a session but NEVER run verify --execute / claim with evidence.
	const start = step(
		"session start",
		run(target, [
			"session",
			"start",
			"--target",
			".",
			"--goal",
			"adversarial no-evidence path",
			"--feature",
			featureId,
			"--confirm",
			"--json",
		]),
	);
	const sid = parseJsonOut(start)?.sessionId;

	// Attempt accept without any verification evidence.
	const acceptNoEv = step(
		"accept without evidence",
		run(target, ["accept", "--target", ".", "--plan", planRel]),
	);
	const acceptBlocked =
		acceptNoEv.exitCode !== 0 &&
		(/NO_EVIDENCE|no verification evidence/i.test(acceptNoEv.stdout + acceptNoEv.stderr) ||
			/Cannot accept/i.test(acceptNoEv.stdout));

	const out = { target, sessionId: sid, acceptBlocked, closed: false, log };
	if (acceptBlocked) {
		note(
			"A1",
			"info",
			"Adversarial success variant: accept without verification evidence was refused (R3 semantics).",
			{ exit: acceptNoEv.exitCode },
		);
	} else {
		note(
			"A1",
			"high",
			"Adversarial success variant: accept without evidence was NOT blocked.",
			acceptNoEv,
		);
	}
	results.paths.successAdversarial = out;
	return out;
}

function pathRejections() {
	const target = mkTarget("reject");
	const log = [];
	const step = (name, r) => {
		log.push({
			name,
			exitCode: r.exitCode,
			stdoutHead: (r.stdout || "").slice(0, 500),
			stderrHead: (r.stderr || "").slice(0, 200),
		});
		return r;
	};

	step("init", run(target, ["init", "--target", "."]));
	const fl = JSON.parse(fs.readFileSync(path.join(target, "feature_list.json"), "utf8"));
	const featureId = fl.features[0].id;
	step(
		"plan",
		run(target, ["plan", "--target", ".", "--feature", featureId, "--title", "Reject path"]),
	);
	const plans = fs.readdirSync(path.join(target, "docs", "plans")).filter((f) => f.endsWith(".md"));
	const planRel = `docs/plans/${plans[0]}`;
	ensurePlanReady(target, planRel);
	step("gate", run(target, ["gate", "--confirm", "--target", ".", "--plan", planRel]));

	const start = step(
		"session start",
		run(target, [
			"session",
			"start",
			"--target",
			".",
			"--goal",
			"reject path",
			"--feature",
			featureId,
			"--confirm",
			"--json",
		]),
	);
	const sid = parseJsonOut(start)?.sessionId;

	// B1: policy deny for non-allowlisted command
	const denied = step(
		"verify --execute denied command",
		run(target, [
			"session",
			"verify",
			"--session",
			sid,
			"--execute",
			"--command",
			"echo should-deny",
			"--target",
			".",
			"--confirm",
		]),
	);
	const denyOk = denied.exitCode !== 0 && /denied|policy/i.test(denied.stdout + denied.stderr);

	// B2: claim-only verify then strict complete-check must fail on verification
	step(
		"verify claim-only",
		run(target, ["session", "verify", "--session", sid, "--target", ".", "--confirm"]),
	);
	const claimCc = step(
		"complete-check --strict after claim",
		run(target, ["session", "complete-check", "--session", sid, "--strict", "--target", "."]),
	);
	const claimStrictFails =
		claimCc.exitCode !== 0 ||
		/status: fail/i.test(claimCc.stdout) ||
		/Missing:.*verification/i.test(claimCc.stdout);

	// B3: accept without evidence (fresh feature without executed verify reflux)
	// Use a second feature that has plan confirmed but no evidence.
	step(
		"feature add F-NOEV",
		run(target, [
			"feature",
			"add",
			"--target",
			".",
			"--id",
			"F-NOEV",
			"--title",
			"No evidence",
			"--priority",
			"2",
			"--area",
			"e2e",
		]),
	);
	step(
		"plan F-NOEV",
		run(target, ["plan", "--target", ".", "--feature", "F-NOEV", "--title", "No evidence plan"]),
	);
	const plans2 = fs
		.readdirSync(path.join(target, "docs", "plans"))
		.filter((f) => f.includes("F-NOEV") || f.includes("No-evidence"));
	let planNoEv = plans2[0]
		? `docs/plans/${plans2[0]}`
		: `docs/plans/${fs
				.readdirSync(path.join(target, "docs", "plans"))
				.filter((f) => f.endsWith(".md"))
				.sort()
				.pop()}`;
	// Find plan that references F-NOEV
	for (const f of fs.readdirSync(path.join(target, "docs", "plans"))) {
		const p = path.join(target, "docs", "plans", f);
		if (fs.readFileSync(p, "utf8").includes("Feature: F-NOEV")) {
			planNoEv = `docs/plans/${f}`;
			break;
		}
	}
	ensurePlanReady(target, planNoEv);
	step("gate F-NOEV", run(target, ["gate", "--confirm", "--target", ".", "--plan", planNoEv]));
	const acceptNoEv = step(
		"accept without evidence",
		run(target, ["accept", "--target", ".", "--plan", planNoEv]),
	);
	const acceptBlocked =
		acceptNoEv.exitCode !== 0 &&
		(/NO_EVIDENCE|no verification evidence/i.test(acceptNoEv.stdout + acceptNoEv.stderr) ||
			/Cannot accept/i.test(acceptNoEv.stdout));

	// B4: approve without --gate when multiple gates
	const approveNoGate = step(
		"approve without --gate",
		run(target, ["session", "approve", "--session", sid, "--yes", "--target", "."]),
	);
	const needsGate =
		approveNoGate.exitCode !== 0 && /specify one with --gate|gates/i.test(approveNoGate.stdout);

	const out = {
		target,
		sessionId: sid,
		policyDenyWorks: denyOk,
		claimOnlyStrictFails: claimStrictFails,
		acceptWithoutEvidenceBlocked: acceptBlocked,
		approveRequiresGateId: needsGate,
		log,
	};

	if (denyOk) {
		note("R1", "info", "Rejection path: non-allowlisted verify --execute is denied by policy.", {
			command: "echo should-deny",
		});
	} else {
		note("R1", "high", "Expected policy deny for non-allowlisted command did not fire.", denied);
	}
	if (claimStrictFails) {
		note(
			"R2",
			"info",
			"Rejection path: claim-only verify does not satisfy complete-check --strict.",
			{ out: claimCc.stdout },
		);
	} else {
		note("R2", "high", "claim-only verify incorrectly passed complete-check --strict.", claimCc);
	}
	if (acceptBlocked) {
		note("R3", "info", "Rejection path: accept without feature evidence is blocked.", {
			exit: acceptNoEv.exitCode,
		});
	} else {
		note("R3", "high", "accept without evidence was allowed.", acceptNoEv);
	}
	if (needsGate) {
		note("R4", "info", "Rejection path: multi-gate route requires --gate on session approve.", {});
	} else {
		note(
			"R4",
			"high",
			"session approve without --gate did not require gate id (route may have single gate).",
			approveNoGate,
		);
	}

	results.paths.rejections = out;
	return out;
}

function pathVerifyFailRecover() {
	const target = mkTarget("fail-recover");
	const log = [];
	const step = (name, r) => {
		log.push({
			name,
			exitCode: r.exitCode,
			stdoutHead: (r.stdout || "").slice(0, 400),
		});
		return r;
	};

	// Start with failing test script.
	fs.writeFileSync(
		path.join(target, "package.json"),
		JSON.stringify(
			{
				name: "amber-e2e-fail",
				version: "0.0.0",
				private: true,
				scripts: { test: 'node -e "process.exit(1)"' },
			},
			null,
			2,
		) + "\n",
	);
	git(target, ["add", "package.json"]);
	git(target, ["commit", "-m", "chore: failing tests"]);

	step("init", run(target, ["init", "--target", "."]));
	const fl = JSON.parse(fs.readFileSync(path.join(target, "feature_list.json"), "utf8"));
	const featureId = fl.features[0].id;
	step(
		"plan",
		run(target, ["plan", "--target", ".", "--feature", featureId, "--title", "Fail recover"]),
	);
	const plans = fs.readdirSync(path.join(target, "docs", "plans")).filter((f) => f.endsWith(".md"));
	const planRel = `docs/plans/${plans[0]}`;
	ensurePlanReady(target, planRel);
	step("gate", run(target, ["gate", "--confirm", "--target", ".", "--plan", planRel]));
	fs.writeFileSync(path.join(target, "work.js"), "exports.x=1\n");
	git(target, ["add", "work.js"]);
	git(target, ["commit", "-m", "feat: work"]);

	const start = step(
		"session start",
		run(target, [
			"session",
			"start",
			"--target",
			".",
			"--goal",
			"fail then recover",
			"--feature",
			featureId,
			"--confirm",
			"--json",
		]),
	);
	const sid = parseJsonOut(start)?.sessionId;

	const fail = step(
		"verify --execute failing",
		run(target, [
			"session",
			"verify",
			"--session",
			sid,
			"--execute",
			"--command",
			"npm test",
			"--target",
			".",
			"--confirm",
		]),
	);
	const failRecorded =
		fail.exitCode !== 0 && /FAILED|verification_failed|NOT marked complete/i.test(fail.stdout);

	// Session still open; fix tests and re-verify.
	fs.writeFileSync(
		path.join(target, "package.json"),
		JSON.stringify(
			{
				name: "amber-e2e-fail",
				version: "0.0.0",
				private: true,
				scripts: { test: "node -e \"console.log('ok')\"" },
			},
			null,
			2,
		) + "\n",
	);
	git(target, ["add", "package.json"]);
	git(target, ["commit", "-m", "fix: tests pass"]);

	const ok = step(
		"verify --execute after fix",
		run(target, [
			"session",
			"verify",
			"--session",
			sid,
			"--execute",
			"--command",
			"npm test",
			"--target",
			".",
			"--confirm",
		]),
	);
	step(
		"approve",
		run(target, [
			"session",
			"approve",
			"--session",
			sid,
			"--gate",
			"user-approval-implement",
			"--yes",
			"--target",
			".",
		]),
	);
	step("handoff", run(target, ["handoff", "--target", "."]));
	const cc = step(
		"complete-check --strict",
		run(target, ["session", "complete-check", "--session", sid, "--strict", "--target", "."]),
	);
	const recovered = ok.exitCode === 0 && (/status: pass/i.test(cc.stdout) || cc.exitCode === 0);

	// Inspect timeline for failure then success events.
	const sessionDir = path.join(target, ".amber", "sessions", sid);
	const timeline = fs.existsSync(path.join(sessionDir, "timeline.jsonl"))
		? fs.readFileSync(path.join(sessionDir, "timeline.jsonl"), "utf8")
		: "";
	const hasFailedEvent = /verification_failed/.test(timeline);
	const hasPassedEvent = /stage_completed/.test(timeline);

	const out = {
		target,
		sessionId: sid,
		failExit: fail.exitCode,
		failRecorded,
		recoverExit: ok.exitCode,
		completeCheckPass: /status: pass/i.test(cc.stdout),
		hasFailedEvent,
		hasPassedEvent,
		recovered: recovered && hasFailedEvent && hasPassedEvent,
		log,
	};

	if (out.recovered) {
		note(
			"F1",
			"info",
			"Verify-fail recovery works: failure recorded, session stays open, re-verify can pass strict complete-check.",
			{ sid },
		);
	} else {
		note("F1", "high", "Verify-fail recovery incomplete.", out);
	}

	results.paths.verifyFailRecover = out;
	return out;
}

function pathCrossSessionHandoff() {
	const target = mkTarget("handoff");
	const log = [];
	const step = (name, r) => {
		log.push({ name, exitCode: r.exitCode, stdoutHead: (r.stdout || "").slice(0, 300) });
		return r;
	};

	step("init", run(target, ["init", "--target", "."]));
	const fl = JSON.parse(fs.readFileSync(path.join(target, "feature_list.json"), "utf8"));
	const featureId = fl.features[0].id;
	step(
		"plan",
		run(target, ["plan", "--target", ".", "--feature", featureId, "--title", "Handoff path"]),
	);
	const plans = fs.readdirSync(path.join(target, "docs", "plans")).filter((f) => f.endsWith(".md"));
	const planRel = `docs/plans/${plans[0]}`;
	ensurePlanReady(target, planRel);
	step("gate", run(target, ["gate", "--confirm", "--target", ".", "--plan", planRel]));
	fs.writeFileSync(path.join(target, "lib.js"), "exports.v=1\n");
	git(target, ["add", "lib.js"]);
	git(target, ["commit", "-m", "feat: lib"]);

	const s1 = step(
		"session1 start",
		run(target, [
			"session",
			"start",
			"--target",
			".",
			"--goal",
			"session one work",
			"--feature",
			featureId,
			"--confirm",
			"--json",
		]),
	);
	const sid1 = parseJsonOut(s1)?.sessionId;
	step(
		"verify",
		run(target, [
			"session",
			"verify",
			"--session",
			sid1,
			"--execute",
			"--command",
			"npm test",
			"--target",
			".",
			"--confirm",
		]),
	);
	step(
		"approve",
		run(target, [
			"session",
			"approve",
			"--session",
			sid1,
			"--gate",
			"user-approval-implement",
			"--yes",
			"--target",
			".",
		]),
	);
	step("handoff before complete", run(target, ["handoff", "--target", "."]));
	step("complete", run(target, ["session", "complete", "--session", sid1, "--target", "."]));
	step("accept", run(target, ["accept", "--target", ".", "--plan", planRel, "--session", sid1]));
	step("handoff regenerate", run(target, ["handoff", "--target", "."]));

	const handoff1 = fs.readFileSync(path.join(target, "session-handoff.md"), "utf8");
	const handoffUseful =
		/npm test/i.test(handoff1) &&
		(/Next Actions/i.test(handoff1) || /next/i.test(handoff1)) &&
		!handoff1.includes("Command: not run yet");

	// Second session: new feature work, should be able to start and see prior evidence via handoff/features.
	step(
		"feature add F2",
		run(target, [
			"feature",
			"add",
			"--target",
			".",
			"--id",
			"F2",
			"--title",
			"Second slice",
			"--priority",
			"2",
			"--area",
			"e2e",
		]),
	);
	const s2 = step(
		"session2 start",
		run(target, [
			"session",
			"start",
			"--target",
			".",
			"--goal",
			"continue from handoff",
			"--feature",
			"F2",
			"--confirm",
			"--json",
		]),
	);
	const sid2 = parseJsonOut(s2)?.sessionId;
	const continueCompleted = step(
		"session continue on completed s1",
		run(target, ["session", "continue", "--session", sid1, "--target", "."]),
	);
	const refuseResurrect =
		continueCompleted.exitCode !== 0 ||
		/already completed|handoff|new session/i.test(continueCompleted.stdout);

	// Independent reviewer can re-run complete-check on completed session artifacts.
	const recheck = step(
		"complete-check on completed s1",
		run(target, ["session", "complete-check", "--session", sid1, "--strict", "--target", "."]),
	);
	const recheckPass = /status: pass/i.test(recheck.stdout);

	const flAfter = JSON.parse(fs.readFileSync(path.join(target, "feature_list.json"), "utf8"));
	const f1 = flAfter.features.find((f) => f.id === featureId);

	const out = {
		target,
		sid1,
		sid2,
		handoffUseful,
		refuseResurrectCompleted: refuseResurrect,
		recheckCompletedPass: recheckPass,
		feature1Status: f1?.status,
		feature1Evidence: f1?.evidence?.length || 0,
		session2Started: Boolean(sid2),
		log,
	};

	if (handoffUseful && refuseResurrect && sid2) {
		note(
			"H1",
			"info",
			"Cross-session handoff works: live handoff carries evidence/next actions; completed session cannot be resurrected; new session can start.",
			{ sid1, sid2 },
		);
	} else {
		note("H1", "high", "Cross-session handoff incomplete.", out);
	}

	results.paths.crossSessionHandoff = out;
	return out;
}

function summarize() {
	const highs = results.findings.filter((f) => f.severity === "high");
	const infos = results.findings.filter((f) => f.severity === "info");
	results.meta.finishedAt = new Date().toISOString();
	const successRuns = Object.values(results.paths.success || {});
	results.summary = {
		successClosed: successRuns.length > 0 && successRuns.every((run) => Boolean(run?.closed)),
		rejections: {
			policyDeny: Boolean(results.paths.rejections?.policyDenyWorks),
			claimStrict: Boolean(results.paths.rejections?.claimOnlyStrictFails),
			acceptNoEvidence: Boolean(results.paths.rejections?.acceptWithoutEvidenceBlocked),
			approveNeedsGate: Boolean(results.paths.rejections?.approveRequiresGateId),
		},
		verifyFailRecovered: Boolean(results.paths.verifyFailRecover?.recovered),
		crossSessionHandoff: Boolean(
			results.paths.crossSessionHandoff?.handoffUseful &&
			results.paths.crossSessionHandoff?.session2Started &&
			results.paths.crossSessionHandoff?.refuseResurrectCompleted,
		),
		highFindings: highs.map((f) => f.id),
		infoFindings: infos.map((f) => f.id),
		// After G1/G2 product fix: navigation last-mile + live handoff gate closed for CLI path.
		loopJudgementHint: highs.length === 0 ? "closed-cli" : "partial",
		loopJudgementReason:
			highs.length === 0
				? "Success/reject/recover/handoff close on fresh targets; next recommends handoff after approve; complete-check rejects scaffold handoff."
				: "Remaining high findings: " + highs.map((f) => f.id).join(", "),
	};
}

function main(argv = process.argv.slice(2)) {
	const args = parseRunnerArgs(argv);
	if (args.help) {
		printRunnerHelp();
		return 0;
	}

	results.paths = {};
	results.findings = [];
	results.meta.startedAt = new Date().toISOString();
	delete results.summary;

	console.log("Amber e2e governance-loop verify — fresh targets only");
	const snap = snapshotProduct(REPO_ROOT);
	results.paths.success = {};
	for (const profile of DEPLOYMENT_PROFILES) {
		results.paths.success[profile] = pathSuccess(profile);
	}
	pathSuccessAdversarial();
	pathRejections();
	pathVerifyFailRecover();
	pathCrossSessionHandoff();
	summarize();

	const mutation = detectProductMutation(REPO_ROOT, snap);
	if (mutation.leakedSessions.length > 0 || mutation.dirtyPaths.length > 0) {
		note(
			"ISO1",
			"high",
			"Product repo mutated or sessions leaked under the product Amber Setup.",
			mutation,
		);
		summarize();
	}

	if (args.outputPath) {
		fs.mkdirSync(path.dirname(args.outputPath), { recursive: true });
		fs.writeFileSync(args.outputPath, JSON.stringify(results, null, 2) + "\n");
		console.log("Wrote", args.outputPath);
	}

	console.log(JSON.stringify(results.summary, null, 2));
	const code = exitCodeFromSummary(results.summary);
	if (results.summary.highFindings.length) {
		console.log("High findings:", results.summary.highFindings.join(", "));
	}
	if (args.fixtureFamily) {
		const report = reportFixtureCoverage(results.paths);
		console.log(JSON.stringify(report, null, 2));
		if (report.mismatches.length > 0) {
			process.exitCode = 1;
			return 1;
		}
	}
	return code;
}

if (require.main === module) {
	main();
}

function matchGolden(runtimeSummary, golden) {
	const mismatches = [];
	const gs = golden.summary || {};
	if (
		typeof gs.successClosed === "boolean" &&
		Boolean(runtimeSummary.successClosed) !== gs.successClosed
	) {
		mismatches.push(
			`successClosed: expected ${gs.successClosed}, got ${runtimeSummary.successClosed}`,
		);
	}
	if (
		typeof gs.verifyFailRecovered === "boolean" &&
		Boolean(runtimeSummary.verifyFailRecovered) !== gs.verifyFailRecovered
	) {
		mismatches.push(
			`verifyFailRecovered: expected ${gs.verifyFailRecovered}, got ${runtimeSummary.verifyFailRecovered}`,
		);
	}
	if (
		typeof gs.crossSessionHandoff === "boolean" &&
		Boolean(runtimeSummary.crossSessionHandoff) !== gs.crossSessionHandoff
	) {
		mismatches.push(
			`crossSessionHandoff: expected ${gs.crossSessionHandoff}, got ${runtimeSummary.crossSessionHandoff}`,
		);
	}
	if (gs.rejections && typeof gs.rejections === "object") {
		const rr = runtimeSummary.rejections || {};
		for (const key of ["policyDeny", "claimStrict", "acceptNoEvidence", "approveNeedsGate"]) {
			if (typeof gs.rejections[key] === "boolean" && Boolean(rr[key]) !== gs.rejections[key]) {
				mismatches.push(`rejections.${key}: expected ${gs.rejections[key]}, got ${rr[key]}`);
			}
		}
	}
	if (Array.isArray(gs.highFindings)) {
		const runtimeHighs = (runtimeSummary.highFindings || []).slice().sort();
		const goldenHighs = gs.highFindings.slice().sort();
		if (JSON.stringify(runtimeHighs) !== JSON.stringify(goldenHighs)) {
			mismatches.push(
				`highFindings: expected ${JSON.stringify(goldenHighs)}, got ${JSON.stringify(runtimeHighs)}`,
			);
		}
	}
	const expectedExit = golden.exitCode;
	const actualExit =
		typeof runtimeSummary.exitCode === "number"
			? runtimeSummary.exitCode
			: exitCodeFromSummary(runtimeSummary);
	if (typeof expectedExit === "number" && expectedExit !== actualExit) {
		mismatches.push(`exitCode: expected ${expectedExit}, got ${actualExit}`);
	}
	return mismatches;
}

/**
 * Build the runtime summary a fixture's golden must be checked against.
 *
 * Every fixture names a governance path (+ variant + deployment profile).
 * The runner produces one result per path — and per profile for the success
 * path — and the golden for a fixture must match THAT path/profile's runtime
 * outcome, not the whole-run aggregate. Adversarial fixtures assert the
 * governance gate REFUSES the adversarial input; the runner exercises that
 * refusal directly (success-adversarial-no-evidence → R3).
 * @param {object} fixture - Fixture.
 * @param {object} paths - Per-path runtime results (results.paths).
 * @returns {object|null} Runtime summary, or null when the path/profile is unmapped.
 */
function runtimeSummaryForFixture(fixture, paths) {
	const variant = fixture.variant || "canonical";
	if (variant === "adversarial") {
		// Refusal state: accept without evidence must be blocked (R3).
		const run = paths.successAdversarial;
		if (!run) return null;
		const blocked = Boolean(run.acceptBlocked);
		return {
			successClosed: false,
			highFindings: blocked ? ["R3"] : [],
			exitCode: blocked ? 1 : 0,
		};
	}
	switch (fixture.path) {
		case "success": {
			const profile = fixture.deploymentProfile || "personal-node";
			const result = paths.success?.[profile];
			if (!result) return null;
			const closed = Boolean(result.closed);
			return { successClosed: closed, highFindings: [], exitCode: closed ? 0 : 1 };
		}
		case "rejection": {
			const result = paths.rejections;
			const hold = Boolean(
				result?.policyDenyWorks &&
				result?.claimOnlyStrictFails &&
				result?.acceptWithoutEvidenceBlocked &&
				result?.approveRequiresGateId,
			);
			return {
				rejections: {
					policyDeny: Boolean(result?.policyDenyWorks),
					claimStrict: Boolean(result?.claimOnlyStrictFails),
					acceptNoEvidence: Boolean(result?.acceptWithoutEvidenceBlocked),
					approveNeedsGate: Boolean(result?.approveRequiresGateId),
				},
				highFindings: [],
				exitCode: hold ? 0 : 1,
			};
		}
		case "verify-fail-recover": {
			const recovered = Boolean(paths.verifyFailRecover?.recovered);
			return { verifyFailRecovered: recovered, highFindings: [], exitCode: recovered ? 0 : 1 };
		}
		case "cross-session-handoff": {
			const result = paths.crossSessionHandoff;
			const useful = Boolean(
				result?.handoffUseful && result?.session2Started && result?.refuseResurrectCompleted,
			);
			return { crossSessionHandoff: useful, highFindings: [], exitCode: useful ? 0 : 1 };
		}
		default:
			return null;
	}
}

/**
 * Check every committed fixture's golden against the corresponding per-path
 * runtime result. A golden mismatch fails the fixture gate; the gate is
 * GREEN on a healthy run (canonical goldens match, the adversarial refusal
 * is proven).
 * @param {object} paths - Per-path runtime results (results.paths).
 * @returns {{familySize: number, errors: string[], mismatches: Array<object>, matches: Array<object>}}
 */
function reportFixtureCoverage(paths) {
	let family;
	try {
		family = require("../lib/core/fixture-family").loadFamily();
	} catch (err) {
		return { error: err.message, fixtures: [], mismatches: [] };
	}
	const matches = [];
	const mismatches = [];
	for (const { fixture } of family.fixtures) {
		const entry = {
			fixtureId: fixture.fixtureId,
			path: fixture.path,
			variant: fixture.variant || "canonical",
			deploymentProfile: fixture.deploymentProfile || null,
		};
		const runtimeSummary = runtimeSummaryForFixture(fixture, paths);
		if (runtimeSummary === null) {
			entry.diffs = [`path "${fixture.path}" has no runtime result`];
			mismatches.push(entry);
			continue;
		}
		const diffs = matchGolden(runtimeSummary, fixture.golden);
		if (diffs.length > 0) {
			entry.diffs = diffs;
			mismatches.push(entry);
		} else {
			matches.push(entry);
		}
	}
	return {
		familySize: family.fixtures.length,
		errors: family.errors,
		matches,
		mismatches,
	};
}

module.exports = {
	main,
	parseRunnerArgs,
	snapshotProduct,
	detectProductMutation,
	exitCodeFromSummary,
	matchGolden,
	runtimeSummaryForFixture,
	reportFixtureCoverage,
};
