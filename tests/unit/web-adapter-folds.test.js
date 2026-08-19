"use strict";

// Unit tests for the four read-only folds added to scripts/lib/web-adapter.js
// (task #1 — web adapter seam extension, ADR-0007). Covers the happy path and
// the no-handoff / no-bundle empty states, plus the zero-write discipline:
// previews render, they never persist.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ADAPTER_PATH = path.join(__dirname, "../../scripts/lib/web-adapter.js");

function loadAdapter() {
	const resolved = require.resolve(ADAPTER_PATH);
	delete require.cache[resolved];
	return require(ADAPTER_PATH);
}

function tmpRepo() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-web-folds-"));
}

function cleanup(dir) {
	fs.rmSync(dir, { recursive: true, force: true });
}

function seedMinimalProject(dir) {
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({
			name: "web-folds-fixture",
			scripts: { test: 'node -e "process.exit(0)"' },
		}) + "\n",
	);
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({ features: [] }, null, 2) + "\n",
	);
}

/** Non-scaffold handoff content — same shape as the completion-gate fixture. */
const LIVE_HANDOFF = `# Session Handoff

Last Updated: 2026-08-18

## Summary

Active session \`abc\` — "goal" (executing). 1 feature(s): 1 passing

## Repo State

- Branch: main
- Uncommitted changes: clean
- Last commit: abc123 work

## Runtime / Verification State

- Command: npm test
- Result: passed (exit 0, 10ms)
- When: 2026-07-11

## Feature State

- F001 [passing] Demo

## Verification Evidence

- F001: \`npm test\` → passed

## Blockers

None recorded.

## Next Actions

1. Accept the plan
`;

const SCAFFOLD_HANDOFF = `# Session Handoff

## Summary

The repository-local Harness has been scaffolded and is ready for project-specific customization.

## Runtime / Verification State

- Command: not run yet
- Result: pending
`;

function buildSession(root, sessionId, manifest, timelineEvents = [], opts = {}) {
	const sessionDir = path.join(root, ".amber", "sessions", sessionId);
	fs.mkdirSync(sessionDir, { recursive: true });
	fs.writeFileSync(path.join(sessionDir, "manifest.json"), JSON.stringify(manifest, null, 2));
	if (timelineEvents.length > 0) {
		const lines = timelineEvents
			.map((event) => JSON.stringify({ timestamp: new Date().toISOString(), ...event }))
			.join("\n");
		fs.writeFileSync(path.join(sessionDir, "timeline.jsonl"), `${lines}\n`);
	}
	if (opts.handoffContent != null) {
		fs.writeFileSync(path.join(root, "session-handoff.md"), opts.handoffContent);
	}
}

/** Seed a structurally valid handoff bundle at .amber/handoff/latest. */
function seedBundle(root) {
	const bundleDir = path.join(root, ".amber", "handoff", "latest");
	fs.mkdirSync(bundleDir, { recursive: true });
	const files = [
		"README.md",
		"session-summary.md",
		"verification-evidence.md",
		"next-actions.md",
		"risks.md",
		"recovery-commands.md",
	];
	for (const rel of files) {
		fs.writeFileSync(path.join(bundleDir, rel), `# ${rel}\n\nfixture content\n`);
	}
	fs.writeFileSync(
		path.join(bundleDir, "manifest.json"),
		JSON.stringify(
			{
				schemaVersion: 1,
				artifactType: "amber-handoff-bundle",
				target: root,
				generatedAt: new Date().toISOString(),
				readinessScore: 90,
				decision: "ready",
				files,
			},
			null,
			2,
		) + "\n",
	);
	return bundleDir;
}

describe("adapter surface: new read-only folds", () => {
	it("exports the four new folds alongside the original three", () => {
		const adapter = loadAdapter();
		assert.equal(typeof adapter.getHandoffStatus, "function");
		assert.equal(typeof adapter.getHandoffPreview, "function");
		assert.equal(typeof adapter.getGovernanceSummary, "function");
		assert.equal(typeof adapter.getCompletionNextActions, "function");
		assert.equal(typeof adapter.evaluateLifecycleNext, "function");
		assert.equal(typeof adapter.getCompletionStatus, "function");
		assert.equal(typeof adapter.runEvidenceCommand, "function");
	});
});

describe("getHandoffStatus", () => {
	it("reports live state with session evidence and a graceful no-bundle empty state", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		const sessionId = "sess-handoff-live";
		buildSession(
			dir,
			sessionId,
			{
				sessionId,
				goal: "live handoff fixture",
				status: "executing",
				handoff: { path: "session-handoff.md" },
				completedStages: [],
			},
			[{ type: "session_created" }],
			{ handoffContent: LIVE_HANDOFF },
		);

		const result = adapter.getHandoffStatus(dir, sessionId);

		assert.equal(result.handoffPath, path.join(dir, "session-handoff.md"));
		assert.equal(result.state, "live");
		assert.equal(result.sessionEvidence, true);
		// No bundle on disk → graceful empty state, not a throw.
		assert.deepEqual(result.bundle, {
			present: false,
			valid: false,
			structureValid: false,
			deliveryReady: false,
			readinessScore: null,
			errors: [],
		});
		cleanup(dir);
	});

	it("reports scaffold state for the init template handoff", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		fs.writeFileSync(path.join(dir, "session-handoff.md"), SCAFFOLD_HANDOFF);

		const result = adapter.getHandoffStatus(dir);
		assert.equal(result.state, "scaffold");
		assert.equal(result.sessionEvidence, false);
		cleanup(dir);
	});

	it("reports missing state when no handoff file exists", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);

		const result = adapter.getHandoffStatus(dir, "no-such-session");
		assert.equal(result.state, "missing");
		assert.equal(result.sessionEvidence, false);
		assert.equal(result.bundle.present, false);
		cleanup(dir);
	});

	it("validates a present bundle: structure valid with readiness score", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		seedBundle(dir);
		fs.writeFileSync(path.join(dir, "session-handoff.md"), LIVE_HANDOFF);

		const result = adapter.getHandoffStatus(dir);
		assert.equal(result.bundle.present, true);
		assert.equal(result.bundle.valid, true);
		assert.equal(result.bundle.structureValid, true);
		assert.equal(typeof result.bundle.deliveryReady, "boolean");
		assert.equal(typeof result.bundle.readinessScore, "number");
		assert.deepEqual(result.bundle.errors, []);
		cleanup(dir);
	});

	it("reports an invalid bundle (missing files) without throwing", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		// Bundle dir exists but is incomplete — only one required file present.
		const bundleDir = path.join(dir, ".amber", "handoff", "latest");
		fs.mkdirSync(bundleDir, { recursive: true });
		fs.writeFileSync(path.join(bundleDir, "README.md"), "# README\n");

		const result = adapter.getHandoffStatus(dir);
		assert.equal(result.bundle.present, true);
		assert.equal(result.bundle.valid, false);
		assert.equal(result.bundle.structureValid, false);
		assert.equal(result.bundle.deliveryReady, false);
		assert.equal(result.bundle.readinessScore, null);
		assert.ok(result.bundle.errors.length > 0);
		cleanup(dir);
	});

	it("treats traversal session ids as unknown sessions (no out-of-bounds read)", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		// Decoy OUTSIDE the sessions dir that would read as live handoff
		// evidence if the id were path-joined without a containment guard
		// (`<stateDir>/sessions/../../evil` → `<dir>/evil`).
		const evilDir = path.join(dir, "evil");
		fs.mkdirSync(evilDir, { recursive: true });
		fs.writeFileSync(
			path.join(evilDir, "manifest.json"),
			JSON.stringify(
				{
					sessionId: "evil",
					goal: "boolean oracle",
					status: "executing",
					handoff: { path: "session-handoff.md" },
					completedStages: [],
				},
				null,
				2,
			),
		);
		fs.writeFileSync(path.join(dir, "session-handoff.md"), LIVE_HANDOFF);

		// Escaping id → graceful empty state (no evidence), never a throw and
		// never an out-of-bounds manifest read.
		const traversal = adapter.getHandoffStatus(dir, "../../evil");
		assert.equal(traversal.sessionEvidence, false);

		// Absolute ids are rejected by the same guard.
		const absolute = adapter.getHandoffStatus(dir, evilDir);
		assert.equal(absolute.sessionEvidence, false);

		// The rest of the status fold keeps working for the escaping request.
		assert.equal(traversal.state, "live");
		assert.equal(traversal.bundle.present, false);
		cleanup(dir);
	});
});

describe("getHandoffPreview", () => {
	it("renders a live preview from repo state without writing session-handoff.md", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		assert.equal(fs.existsSync(path.join(dir, "session-handoff.md")), false);

		const result = adapter.getHandoffPreview(dir, "sess-preview");
		assert.equal(result.source, "rendered");
		// No session exists → the rendered preview belongs to no session,
		// while the original request stays observable via requestedSessionId.
		assert.equal(result.sessionId, null);
		assert.equal(result.requestedSessionId, "sess-preview");
		assert.match(result.markdown, /^# Session Handoff/);
		assert.match(result.markdown, /## Verification Evidence/);
		// Zero-write discipline: render-only, nothing persisted.
		assert.equal(fs.existsSync(path.join(dir, "session-handoff.md")), false);
		cleanup(dir);
	});

	it("echoes the ACTUALLY rendered (most recent) session id, not the request", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		const realSessionId = "sess-rendered-actual";
		buildSession(
			dir,
			realSessionId,
			{
				sessionId: realSessionId,
				goal: "preview session id fixture",
				status: "executing",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
				completedStages: [],
			},
			[{ type: "session_created" }],
		);

		// renderHandoff always targets the most recent session and ignores the
		// requested id — the response must echo the rendered session, not the
		// (unknown) request.
		const result = adapter.getHandoffPreview(dir, "sess-some-other-request");
		assert.equal(result.source, "rendered");
		assert.equal(result.sessionId, realSessionId);
		assert.equal(result.requestedSessionId, "sess-some-other-request");
		assert.match(result.markdown, /# Session Handoff/);
		cleanup(dir);
	});

	it("returns the existing handoff content shape when present (preview is read-only)", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		fs.writeFileSync(path.join(dir, "session-handoff.md"), LIVE_HANDOFF);

		const before = fs.readFileSync(path.join(dir, "session-handoff.md"), "utf8");
		const result = adapter.getHandoffPreview(dir);
		assert.equal(result.source, "rendered");
		assert.equal(result.requestedSessionId, null);
		assert.ok(result.markdown.length > 0);
		const after = fs.readFileSync(path.join(dir, "session-handoff.md"), "utf8");
		assert.equal(after, before, "preview must not rewrite the on-disk handoff");
		cleanup(dir);
	});
});

describe("getGovernanceSummary", () => {
	it("returns the structured governance DTO with a learnings overview", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);

		const result = adapter.getGovernanceSummary(dir);
		assert.equal(result.target, dir);
		assert.ok(["ready", "warn", "block"].includes(result.decision));
		assert.equal(typeof result.scores.overall, "number");
		assert.equal(typeof result.summary.features, "number");
		assert.ok(Array.isArray(result.findings));
		assert.ok(Array.isArray(result.nextActions));
		assert.ok(Array.isArray(result.errors));
		assert.ok(Array.isArray(result.warnings));
		// No featureId → focus-based overview only.
		assert.equal(typeof result.learnings.status, "string");
		assert.equal(typeof result.learnings.hasTriggers, "boolean");
		assert.ok(Array.isArray(result.learnings.matchedCategories));
		assert.equal(typeof result.learnings.reviewBooked, "boolean");
		cleanup(dir);
	});

	it("reports not-found learnings for an unknown featureId (empty state)", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);

		const result = adapter.getGovernanceSummary(dir, { featureId: "F999" });
		assert.equal(result.learnings.featureId, "F999");
		assert.equal(result.learnings.status, "not-found");
		assert.equal(result.learnings.hasTriggers, false);
		assert.equal(result.learnings.reviewBooked, false);
		cleanup(dir);
	});
});

describe("getCompletionNextActions", () => {
	it("maps each missing item to an in-page or cli-command action", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		const sessionId = "sess-next-actions";
		// Timeline only: no executed verification, no gate, no live handoff.
		buildSession(
			dir,
			sessionId,
			{
				sessionId,
				goal: "next actions fixture",
				status: "executing",
				completedStages: [],
			},
			[{ type: "session_created" }],
			{ handoffContent: null },
		);

		const result = adapter.getCompletionNextActions(dir, sessionId);
		assert.equal(result.status, "fail");
		assert.ok(result.missing.length > 0);
		assert.deepEqual(
			result.actions.map((a) => a.item),
			result.missing,
			"one action per missing item, in order",
		);

		const byItem = new Map(result.actions.map((a) => [a.item, a]));
		if (byItem.has("verification")) {
			assert.equal(byItem.get("verification").action, "in-page");
			assert.equal(byItem.get("verification").command, undefined);
		}
		if (byItem.has("approval")) {
			assert.equal(byItem.get("approval").action, "in-page");
			assert.match(byItem.get("approval").hint, /\/gates/);
		}
		if (byItem.has("handoff")) {
			const handoffAction = byItem.get("handoff");
			assert.equal(handoffAction.action, "cli-command");
			assert.equal(handoffAction.command, "amber handoff --target .");
		}
		for (const action of result.actions) {
			assert.ok(["in-page", "cli-command"].includes(action.action));
			assert.equal(typeof action.hint, "string");
			assert.ok(action.hint.length > 0);
		}
		cleanup(dir);
	});

	it("returns the session-complete closing action when all checks pass", () => {
		const adapter = loadAdapter();
		const dir = tmpRepo();
		seedMinimalProject(dir);
		const sessionId = "sess-complete";
		buildSession(
			dir,
			sessionId,
			{
				sessionId,
				goal: "all checks pass",
				status: "completed",
				handoff: { path: "session-handoff.md" },
				completedStages: ["verify"],
			},
			[
				{ type: "session_created" },
				{ type: "stage_completed", data: { stage: "verify", executed: true, exitCode: 0 } },
				{ type: "gate_passed", data: { gate: "final" } },
			],
			{ handoffContent: LIVE_HANDOFF },
		);

		const result = adapter.getCompletionNextActions(dir, sessionId);
		assert.equal(result.status, "pass");
		assert.deepEqual(result.missing, []);
		assert.equal(result.actions.length, 1);
		assert.equal(result.actions[0].action, "cli-command");
		assert.equal(result.actions[0].command, `amber session complete --session ${sessionId}`);
		cleanup(dir);
	});
});
