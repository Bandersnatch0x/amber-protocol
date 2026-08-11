const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { run } = require("../scripts/amber");

const REPO_ROOT = path.join(__dirname, "..");

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-readiness-"));
}

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function copyFixture(relativePath, destination) {
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.copyFileSync(path.join(REPO_ROOT, relativePath), destination);
}

function makeRepoWithGovernanceControls(options = {}) {
	const dir = tempDir();
	const amberDir = path.join(dir, ".amber");
	const governanceDir = path.join(amberDir, "governance");
	fs.mkdirSync(governanceDir, { recursive: true });

	if (options.docs !== false) {
		for (const name of ["POLICY.md", "BOUNDARIES.md", "AUDIT_LOG.md"]) {
			fs.writeFileSync(path.join(governanceDir, name), `# ${name}\n`);
		}
	}

	if (options.policy) {
		writeJson(path.join(amberDir, "autonomous-policy.json"), options.policy);
	}

	copyFixture(
		"routes/feature-standard.route.json",
		path.join(dir, "routes", "feature-standard.route.json"),
	);
	copyFixture(
		"standards/security-governance.json",
		path.join(dir, "standards", "security-governance.json"),
	);

	if (options.packWithoutReviewGates) {
		writeJson(path.join(dir, "workflow-packs", "unsafe.pack.json"), {
			id: "unsafe-pack",
			title: "Unsafe Pack",
			version: "1.0.0",
			standards: ["security-governance"],
			workspaceIsolation: {
				mutatingLoopsUseWorktree: true,
				mainCheckoutMutation: false,
			},
			loopContracts: [
				{
					id: "unsafe-loop",
					goal: "Exercise missing review gate detection.",
					stateSpine: ".amber/loops/unsafe-loop/state.json",
				},
			],
			steps: [{ id: "inspect", title: "Inspect", kind: "manual" }],
		});
	} else if (options.corruptPack) {
		fs.mkdirSync(path.join(dir, "workflow-packs"), { recursive: true });
		fs.writeFileSync(path.join(dir, "workflow-packs", "corrupt.pack.json"), "{not json");
	} else {
		copyFixture(
			"workflow-packs/secure-code-review.pack.json",
			path.join(dir, "workflow-packs", "secure-code-review.pack.json"),
		);
	}

	return dir;
}

async function captureRun(argv) {
	let output = "";
	const originalWrite = process.stdout.write;
	process.stdout.write = (message) => {
		output += message;
		return true;
	};

	try {
		const exitCode = await run(argv);
		return { exitCode, output };
	} finally {
		process.stdout.write = originalWrite;
	}
}

async function runJson(argv) {
	const result = await captureRun(argv);
	return {
		exitCode: result.exitCode,
		payload: JSON.parse(result.output),
	};
}

test("governance readiness - complete controls with no evidence warns but does not block", async () => {
	const dir = makeRepoWithGovernanceControls();
	try {
		const { exitCode, payload } = await runJson([
			"governance",
			"readiness",
			"--target",
			dir,
			"--json",
		]);

		assert.strictEqual(exitCode, 0);
		assert.strictEqual(payload.decision, "warn");
		assert.ok(payload.findings.some((finding) => finding.id === "no-audit-evidence"));
		assert.ok(payload.sections.policy);
		assert.ok(payload.sections.routes);
		assert.ok(Array.isArray(payload.nextActions));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("governance readiness - unsafe policy blocks", async () => {
	const dir = makeRepoWithGovernanceControls({
		policy: {
			"auto-approve-all": true,
			gates: { auto: "approve", "user-approval": "block", "step-confirm": "block" },
		},
	});
	try {
		const { exitCode, payload } = await runJson([
			"governance",
			"readiness",
			"--target",
			dir,
			"--json",
		]);

		assert.strictEqual(exitCode, 1);
		assert.strictEqual(payload.decision, "block");
		assert.ok(payload.findings.some((finding) => finding.id === "policy-error"));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("governance readiness - missing governance docs are reported", async () => {
	const dir = makeRepoWithGovernanceControls({ docs: false });
	try {
		const { payload } = await runJson(["governance", "readiness", "--target", dir, "--json"]);

		const missingDocs = payload.findings.filter(
			(finding) => finding.id === "missing-governance-doc",
		);
		assert.strictEqual(missingDocs.length, 3);
		assert.strictEqual(payload.decision, "warn");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("governance readiness - workflow pack loop contract without review gates is reported", async () => {
	const dir = makeRepoWithGovernanceControls({ packWithoutReviewGates: true });
	try {
		const { payload } = await runJson(["governance", "readiness", "--target", dir, "--json"]);

		assert.ok(payload.findings.some((finding) => finding.id === "pack-missing-review-gates"));
		assert.strictEqual(payload.decision, "warn");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("governance readiness - corrupt workflow pack blocks readiness", async () => {
	const dir = makeRepoWithGovernanceControls({ corruptPack: true });
	try {
		const { exitCode, payload } = await runJson([
			"governance",
			"readiness",
			"--target",
			dir,
			"--json",
		]);

		assert.strictEqual(exitCode, 1);
		assert.strictEqual(payload.decision, "block");
		assert.ok(payload.findings.some((finding) => finding.id === "workflow-pack-read-error"));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("governance readiness - output writes markdown report", async () => {
	const dir = makeRepoWithGovernanceControls();
	const output = path.join(dir, "readiness.md");
	try {
		const { exitCode } = await captureRun([
			"governance",
			"readiness",
			"--target",
			dir,
			"--output",
			output,
		]);

		assert.strictEqual(exitCode, 0);
		const markdown = fs.readFileSync(output, "utf8");
		assert.match(markdown, /# Governance Readiness Report/);
		assert.match(markdown, /\*\*Decision:\*\* warn/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
