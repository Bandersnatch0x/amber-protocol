"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const AMBER = path.join(__dirname, "..", "..", "scripts", "amber.js");

function tmpRepo() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-next-int-"));
}

function amber(dir, args) {
	return spawnSync("node", [AMBER, ...args], { cwd: dir, encoding: "utf8" });
}

function nextOut(dir, extra = []) {
	const r = amber(dir, ["next", "--target", ".", "--json", ...extra]);
	assert.equal(r.status, 0, r.stderr);
	return JSON.parse(r.stdout);
}

function nextId(dir, extra = []) {
	const out = nextOut(dir, extra);
	return out.nextStep && out.nextStep.id;
}

describe("amber next (integration)", () => {
	it("recommends init on a bare directory (JSON)", () => {
		const dir = tmpRepo();
		const out = nextOut(dir);
		assert.equal(out.nextStep.id, "init");
	});

	it("existing project: audit is read-only and next still advises init (A1, #43)", () => {
		const dir = tmpRepo();
		fs.writeFileSync(path.join(dir, "package.json"), '{"name":"x"}\n');
		fs.writeFileSync(path.join(dir, "README.md"), "# existing\n");
		// next advances straight to init — audit is a non-blocking advisory.
		assert.equal(nextId(dir), "init");
		// audit is read-only: file tree identical before/after, no stamp written.
		const before = fs.readdirSync(dir).sort();
		assert.equal(amber(dir, ["audit", "--target", "."]).status, 0);
		const after = fs.readdirSync(dir).sort();
		assert.deepEqual(before, after);
		assert.equal(nextId(dir), "init");
	});

	it("session approve remedy names a real gate id (N2)", () => {
		const dir = tmpRepo();
		const { execSync } = require("node:child_process");
		execSync("git init -q && git config user.email a@b.c && git config user.name t", {
			cwd: dir,
		});
		assert.equal(amber(dir, ["init", "--target", "."]).status, 0);
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({ scripts: { test: "node -e \"console.log(1)\"" } }) + "\n",
		);
		execSync("git add -A && git commit -qm init", { cwd: dir });
		const start = amber(dir, [
			"session",
			"start",
			"--target",
			".",
			"--goal",
			"n2",
			"--feature",
			"F001",
			"--json",
		]);
		assert.equal(start.status, 0, start.stderr);
		const { sessionId } = JSON.parse(start.stdout);
		assert.equal(
			amber(dir, [
				"session",
				"verify",
				"--session",
				sessionId,
				"--execute",
				"--command",
				"npm test",
				"--target",
				".",
			]).status,
			0,
		);
		const out = nextOut(dir);
		assert.equal(out.nextStep.id, "approve");
		assert.match(out.nextStep.remedy, /--gate user-approval-/);
		assert.doesNotMatch(out.nextStep.remedy, /<gate-id>/);
	});

	it("prints a human context + Run line in text mode", () => {
		const dir = tmpRepo();
		fs.writeFileSync(
			path.join(dir, "feature_list.json"),
			JSON.stringify({ features: [{ id: "F001", title: "Login", status: "not_started", evidence: [] }] }) + "\n",
		);
		const r = amber(dir, ["next", "--target", ".", "--feature", "F001"]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /Context: feature F001/);
		assert.match(r.stdout, /Next step: /);
		assert.match(r.stdout, /Run: amber /);
	});
});

describe("amber next progression (feature path, no session)", () => {
	it("advances init → plan → gate → feature-evidence → accept → complete on seeded F001", () => {
		const dir = tmpRepo();

		// 1. bare → init
		assert.equal(nextId(dir), "init");

		// 2. install Amber (seeds F001 with no plan) → plan
		let r = amber(dir, ["init", "--target", "."]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(nextId(dir, ["--feature", "F001"]), "plan");

		// 3. create the plan → gate
		r = amber(dir, ["plan", "--target", ".", "--feature", "F001", "--title", "Login slice"]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(nextId(dir, ["--feature", "F001"]), "gate");

		// 4. confirm the plan (discover the real filename — case preserved) → feature-evidence
		const planFile = fs
			.readdirSync(path.join(dir, "docs", "plans"))
			.find((f) => f.endsWith(".md"));
		const planPath = `docs/plans/${planFile}`;
		r = amber(dir, ["gate", "--confirm", "--target", ".", "--plan", planPath]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(nextId(dir, ["--feature", "F001"]), "feature-evidence");

		// 5. record feature evidence → accept
		r = amber(dir, ["feature", "verify", "--target", ".", "--feature", "F001", "--command", "npm test", "--result", "ok"]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(nextId(dir, ["--feature", "F001"]), "accept");

		// 6. accept → handoff (live, not init scaffold) → complete
		r = amber(dir, ["accept", "--target", ".", "--plan", planPath]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(nextId(dir, ["--feature", "F001"]), "handoff");
		r = amber(dir, ["handoff", "--target", "."]);
		assert.equal(r.status, 0, r.stderr);
		const out = nextOut(dir, ["--feature", "F001"]);
		assert.equal(out.complete, true);
		assert.equal(out.nextStep, null);
	});

	it("session last-mile: after approve, next recommends handoff then complete-check (G1)", () => {
		const dir = tmpRepo();
		// Minimal git so work evidence can pass later if needed.
		const { execSync } = require("node:child_process");
		execSync("git init -q && git config user.email a@b.c && git config user.name t", {
			cwd: dir,
		});
		assert.equal(amber(dir, ["init", "--target", "."]).status, 0);
		fs.writeFileSync(
			path.join(dir, "package.json"),
			JSON.stringify({ scripts: { test: "node -e \"console.log(1)\"" } }) + "\n",
		);
		execSync("git add -A && git commit -qm init", { cwd: dir });

		const start = amber(dir, [
			"session",
			"start",
			"--target",
			".",
			"--goal",
			"last mile",
			"--feature",
			"F001",
			"--json",
		]);
		assert.equal(start.status, 0, start.stderr);
		const { sessionId } = JSON.parse(start.stdout);

		assert.equal(
			amber(dir, [
				"session",
				"verify",
				"--session",
				sessionId,
				"--execute",
				"--command",
				"npm test",
				"--target",
				".",
			]).status,
			0,
		);
		assert.equal(
			amber(dir, [
				"session",
				"approve",
				"--session",
				sessionId,
				"--gate",
				"user-approval-implement",
				"--yes",
				"--target",
				".",
			]).status,
			0,
		);

		// Init scaffold is still on disk → next must not say "complete".
		const afterApprove = nextOut(dir);
		assert.equal(afterApprove.complete, false);
		assert.equal(afterApprove.nextStep.id, "handoff");
		assert.match(afterApprove.nextStep.remedy, /amber handoff/);

		assert.equal(amber(dir, ["handoff", "--target", "."]).status, 0);
		// Real work so complete-check can pass.
		fs.writeFileSync(path.join(dir, "app.js"), "module.exports=1\n");
		execSync("git add app.js && git commit -qm work", { cwd: dir });

		const afterHandoff = nextOut(dir);
		assert.equal(afterHandoff.complete, false);
		// May be complete-check or session-complete depending on whether
		// complete-check already passes when evaluated inline.
		assert.ok(
			["complete-check", "session-complete"].includes(afterHandoff.nextStep.id),
			`expected complete-check or session-complete, got ${afterHandoff.nextStep && afterHandoff.nextStep.id}`,
		);

		assert.equal(
			amber(dir, [
				"session",
				"complete-check",
				"--session",
				sessionId,
				"--strict",
				"--target",
				".",
			]).status,
			0,
		);
		const afterCc = nextOut(dir);
		assert.equal(afterCc.nextStep.id, "session-complete");
		assert.match(afterCc.nextStep.remedy, /session complete/);
	});

	it("accept refuses a feature with no verification evidence (gated by AMBER_E_FEATURE_NO_EVIDENCE)", () => {
		const dir = tmpRepo();
		amber(dir, ["init", "--target", "."]);
		amber(dir, ["plan", "--target", ".", "--feature", "F001", "--title", "Login slice"]);
		const planFile = fs
			.readdirSync(path.join(dir, "docs", "plans"))
			.find((f) => f.endsWith(".md"));
		const planPath = `docs/plans/${planFile}`;
		// Fill the Verification section so reviewPlan's own gate passes, leaving
		// only the new evidence gate to trip.
		const abs = path.join(dir, planPath);
		fs.writeFileSync(
			abs,
			fs.readFileSync(abs, "utf8").replace(
				"## Verification\n\n\n",
				"## Verification\n\n- Run npm test.\n\n",
			),
		);
		amber(dir, ["gate", "--confirm", "--target", ".", "--plan", planPath]);

		// No `feature verify` yet → accept must refuse with the coded error.
		const r = amber(dir, ["accept", "--target", ".", "--plan", planPath]);
		assert.notEqual(r.status, 0, "accept should fail without evidence");
		assert.match(r.stdout, /AMBER_E_FEATURE_NO_EVIDENCE/);

		// --force bypasses with a recorded warning.
		const forced = amber(dir, ["accept", "--target", ".", "--plan", planPath, "--force"]);
		assert.equal(forced.status, 0, forced.stderr);
		assert.match(forced.stdout, /--force despite no verification evidence/);
	});
});

describe("amber next target-safety (#41)", () => {
	it("init remedy is target-safe and installs into an external target whose path has spaces", () => {
		const dir = tmpRepo();
		const spaced = path.join(dir, "with space");
		fs.mkdirSync(spaced, { recursive: true });

		// next recommends init for an external bare target outside the Amber checkout.
		const r = spawnSync("node", [AMBER, "next", "--target", spaced, "--json"], { encoding: "utf8" });
		assert.equal(r.status, 0, r.stderr);
		const out = JSON.parse(r.stdout);
		assert.equal(out.nextStep.id, "init");

		const remedy = out.nextStep.remedy;
		// The spaced path is quoted so it survives copy-paste as one shell argument.
		assert.match(remedy, /'[^']*with space[^']*'/);

		// Executing the remedy's command + target installs Amber into the spaced target.
		const exec = spawnSync("node", [AMBER, "init", "--target", spaced], { encoding: "utf8" });
		assert.equal(exec.status, 0, exec.stderr);
		assert.ok(fs.existsSync(path.join(spaced, "AGENTS.md")), "installed into the spaced external target");
	});

	it("the emitted remedy string executes verbatim through a POSIX shell (#41 AC3)", () => {
		// shellQuote emits POSIX single-quotes; cmd/PowerShell would include them literally.
		// CI runs this on Linux; Windows local skips (same trade-off as the web e2e suite).
		if (process.platform === "win32") return;

		const dir = tmpRepo();
		const spaced = path.join(dir, "with space");
		fs.mkdirSync(spaced, { recursive: true });

		const r = spawnSync("node", [AMBER, "next", "--target", spaced, "--json"], { encoding: "utf8" });
		assert.equal(r.status, 0, r.stderr);
		const remedy = JSON.parse(r.stdout).nextStep.remedy;

		// Execute the EMITTED remedy string verbatim (not reconstructed argv) through a shell.
		const sh = spawnSync(remedy.replace(/^amber\s+/, `node "${AMBER}" `), { shell: true, encoding: "utf8" });
		assert.equal(sh.status, 0, sh.stderr);
		assert.ok(fs.existsSync(path.join(spaced, "AGENTS.md")), "emitted remedy installed into the spaced target");
	});
});
