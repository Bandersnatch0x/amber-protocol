"use strict";

// Isolated unit coverage for the governance-readiness collector seam. These
// collectors are pure(ish) functions of disk state — exporting them lets us
// assert review-gate / worktree-isolation detection against a single crafted
// workflow-pack, without booting the CLI or scaffolding a full repo.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	inspectRoutes,
	inspectWorkflowPacks,
	inspectSecurityGovernance,
} = require("../../scripts/lib/core/governance-readiness");

const REPO_ROOT = path.resolve(__dirname, "../..");

// Fresh dir per test (shared fixture paths cause flaky cross-test bleed).
function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-readiness-collector-"));
}

function writePack(root, id, pack) {
	const packsDir = path.join(root, "workflow-packs");
	fs.mkdirSync(packsDir, { recursive: true });
	fs.writeFileSync(path.join(packsDir, `${id}.pack.json`), JSON.stringify(pack, null, 2));
}

test("inspectRoutes reports target-relative paths through a target directory link", (t) => {
	const container = tempDir();
	const target = path.join(container, "real-target");
	const linkedTarget = path.join(container, "linked-target");
	const routesDir = path.join(target, "routes");
	fs.mkdirSync(routesDir, { recursive: true });
	fs.copyFileSync(
		path.join(REPO_ROOT, "routes", "feature-standard.route.json"),
		path.join(routesDir, "feature-standard.route.json"),
	);

	try {
		fs.symlinkSync(target, linkedTarget, process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		fs.rmSync(container, { recursive: true, force: true });
		if (/EPERM|ENOSYS|not permitted/i.test(error.message)) {
			t.skip(`directory links unavailable: ${error.message}`);
			return;
		}
		throw error;
	}

	try {
		const result = inspectRoutes(linkedTarget);
		assert.equal(result.routesDir, "routes");
		assert.deepEqual(
			result.routes.map((route) => route.file),
			["routes/feature-standard.route.json"],
		);
	} finally {
		fs.rmSync(container, { recursive: true, force: true });
	}
});

test("inspectWorkflowPacks flags a loop contract missing review gates", () => {
	const root = tempDir();
	writePack(root, "loop", {
		id: "loop-pack",
		loopContracts: [{ id: "nightly", reviewGates: [] }],
		workspaceIsolation: { mutatingLoopsUseWorktree: true, mainCheckoutMutation: false },
	});

	const result = inspectWorkflowPacks(root);

	assert.equal(result.count, 1);
	assert.deepEqual(result.missingReviewGates, [{ pack: "loop-pack", contractId: "nightly" }]);
	assert.deepEqual(result.missingWorktreeIsolation, []);
});

test("inspectWorkflowPacks flags a mutating pack without worktree isolation", () => {
	const root = tempDir();
	writePack(root, "risky", {
		id: "risky-pack",
		loopContracts: [{ id: "cleanup", reviewGates: ["human-review"] }],
		// no workspaceIsolation block -> hasWorktreeIsolation is false
	});

	const result = inspectWorkflowPacks(root);

	assert.deepEqual(result.missingReviewGates, []);
	assert.deepEqual(result.missingWorktreeIsolation, ["risky-pack"]);
});

test("inspectWorkflowPacks returns an empty inventory when no packs exist", () => {
	const result = inspectWorkflowPacks(tempDir());
	assert.deepEqual(result, {
		count: 0,
		packs: [],
		missingReviewGates: [],
		missingWorktreeIsolation: [],
		readErrors: [],
	});
});

test("inspectSecurityGovernance reports a security-named pack that is not linked to the standard", () => {
	const root = tempDir();
	const packs = inspectWorkflowPacks(root); // empty, we hand-build the arg below
	const workflowPacks = {
		...packs,
		packs: [
			{
				id: "secure-loop",
				title: "Security scan",
				file: "workflow-packs/secure-loop.pack.json",
				standards: [],
			},
			{
				id: "docs",
				title: "Docs",
				file: "workflow-packs/docs.pack.json",
				standards: ["security-governance"],
			},
		],
	};

	const result = inspectSecurityGovernance(root, workflowPacks);

	assert.equal(result.standardExists, false);
	assert.deepEqual(result.securityNamedPacks, ["secure-loop"]);
	assert.deepEqual(result.unlinkedSecurityPacks, ["secure-loop"]);
});
