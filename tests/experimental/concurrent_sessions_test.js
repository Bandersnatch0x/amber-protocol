"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("fs");
const test = require("node:test");
const ROOT = path.resolve(__dirname, "../../..");
const TMP_DIR = path.join(ROOT, "tests", ".tmp", "concurrent-sessions");

const { startSession } = require("../../../scripts/lib/session-commands");
const { createManifest } = require("../../../scripts/lib/session-manifest");
const { executeSession } = require("../../../scripts/lib/execution-engine");

// ── utilities ──────────────────────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function getSessionDir(projectRoot, sessionId) {
  return path.join(projectRoot, ".amber", "sessions", sessionId);
}

// ── route fixtures (no gates → executeSession completes without blocking) ─

const SIMPLE_ROUTE = {
  routeId: "concurrent-simple",
  schemaVersion: "1.0.0",
  version: "1.0.0",
  displayName: "Simple Concurrent Route",
  description: "A gate-free route for concurrent execution tests",
  stages: [
    {
      name: "verify",
      displayName: "Verify",
      type: "command",
      target: "echo OK",
    },
  ],
  gates: [],
};

const SLOW_ROUTE = {
  routeId: "concurrent-slow",
  schemaVersion: "1.0.0",
  version: "1.0.0",
  displayName: "Slow Concurrent Route",
  description: "A slow route for timeout tests",
  stages: [
    {
      name: "slow",
      displayName: "Delay Stage",
      type: "command",
      target:
        process.platform === "win32"
          ? "ping -n 6 127.0.0.1 > nul"
          : "sleep 5",
    },
  ],
  gates: [],
};

// ── runConcurrentSessions helper ────────────────────────────────────────

/**
 * Run multiple sessions concurrently — each creates its own session,
 * writes a manifest, executes through the supplied route, and returns
 * { sessionId, success, error }.
 *
 * @param {string}  projectRoot
 * @param {{goal:string, route:object}[]} requests
 * @param {object}  [opts]
 * @returns {Promise<{sessionId:string|null, success:boolean, error:string|null}[]>}
 */
async function runConcurrentSessions(projectRoot, requests, opts = {}) {
  return Promise.all(
    requests.map(async ({ goal, route }) => {
      let sessionId = null;
      try {
        // Create the session manifest
        const manifest = createManifest({
          route: { id: route.routeId, version: route.version || "1.0.0" },
          goal,
          budget: opts.budget,
        });

        sessionId = manifest.sessionId;
        const sessionDir = getSessionDir(projectRoot, sessionId);
        fs.mkdirSync(sessionDir, { recursive: true });

        fs.writeFileSync(
          path.join(sessionDir, "manifest.json"),
          JSON.stringify(manifest, null, 2),
        );

        // Execute through the route pipeline
        const execResult = await executeSession(
          sessionDir,
          manifest,
          route,
          opts,
        );

        return {
          sessionId,
          success: execResult.success,
          error: execResult.reason || null,
        };
      } catch (err) {
        return { sessionId, success: false, error: err.message };
      }
    }),
  );
}

// ── lifecycle ───────────────────────────────────────────────────────────

test.beforeEach(() => {
  removeDir(TMP_DIR);
  ensureDir(TMP_DIR);
});

test.afterEach(() => {
  removeDir(TMP_DIR);
});

// ── tests ───────────────────────────────────────────────────────────────

test("runs 3 sessions concurrently with no file conflicts", async () => {
  const goals = ["Add feature A", "Add feature B", "Add feature C"];

  // startSession uses ROUTES_DIR from scripts/lib (hardcoded to <project>/routes)
  // but writes sessions under projectRoot — use TMP_DIR for isolation
  const results = await Promise.all(
    goals.map((goal) => startSession(TMP_DIR, { goal, route: "feature-standard" })),
  );

  assert.equal(results.length, 3);
  assert.equal(
    results.filter((r) => r.exitCode === 0).length,
    3,
    "all startSession calls should succeed",
  );

  // All sessionIds must be unique
  const ids = results.map((r) => r.sessionId);
  assert.equal(new Set(ids).size, 3, "each session must have a unique ID");

  // Every manifest must exist with the correct goal
  for (const result of results) {
    const manifestPath = path.join(
      TMP_DIR,
      ".amber",
      "sessions",
      result.sessionId,
      "manifest.json",
    );
    assert.ok(fs.existsSync(manifestPath), `manifest missing: ${result.sessionId}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.ok(goals.includes(manifest.goal), `goal mismatch for ${result.sessionId}`);
    assert.equal(manifest.status, "created");
    assert.equal(manifest.route.id, "feature-standard");
  }
});

test("isolates session working directories", async () => {
  const goals = ["Add feature X", "Add feature Y", "Add feature Z"];

  const results = await Promise.all(
    goals.map((goal) => startSession(TMP_DIR, { goal, route: "feature-standard" })),
  );

  const dirs = results.map((r) =>
    path.join(TMP_DIR, ".amber", "sessions", r.sessionId),
  );

  // All session directories are unique
  assert.equal(new Set(dirs).size, 3, "each session must have its own directory");

  // Each directory contains the expected files
  for (const dir of dirs) {
    assert.ok(fs.existsSync(dir), `session dir missing: ${dir}`);
    const files = fs.readdirSync(dir);
    assert.ok(files.includes("manifest.json"), `${dir}: missing manifest.json`);
    assert.ok(files.includes("timeline.jsonl"), `${dir}: missing timeline.jsonl`);
  }

  // No file is shared across session directories (no accidental collisions)
  const seen = new Set();
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir)) {
      const real = fs.realpathSync(path.join(dir, file));
      if (seen.has(real)) {
        assert.fail(`Shared file across sessions: ${real}`);
      }
      seen.add(real);
    }
  }
});

test("runConcurrentSessions helper function", async () => {
  const requests = [
    { goal: "Concurrent task alpha", route: SIMPLE_ROUTE },
    { goal: "Concurrent task beta", route: SIMPLE_ROUTE },
    { goal: "Concurrent task gamma", route: SIMPLE_ROUTE },
  ];

  const results = await runConcurrentSessions(TMP_DIR, requests);

  assert.equal(results.length, 3);

  for (const r of results) {
    assert.ok(r.sessionId, `expected sessionId, got: ${JSON.stringify(r)}`);
    assert.equal(r.success, true, `expected success, got: ${JSON.stringify(r)}`);
    assert.equal(r.error, null, `expected no error, got: ${JSON.stringify(r)}`);
  }

  // All session IDs are unique
  const ids = results.map((r) => r.sessionId);
  assert.equal(new Set(ids).size, 3, "all session IDs must be unique");

  // Every manifest was persisted
  for (const r of results) {
    const manifestPath = path.join(
      TMP_DIR,
      ".amber",
      "sessions",
      r.sessionId,
      "manifest.json",
    );
    assert.ok(fs.existsSync(manifestPath), `manifest missing: ${r.sessionId}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.ok(
      manifest.budget,
      "manifest should include budget after execution",
    );
  }
});

test("handles timeout gracefully", async () => {
  const TIMEOUT_MS = 2000;

  // Two fast requests + one slow
  const fastRequests = [
    { goal: "Fast One", route: SIMPLE_ROUTE },
    { goal: "Fast Two", route: SIMPLE_ROUTE },
  ];

  const slowRequest = { goal: "Slow One", route: SLOW_ROUTE };

  // Run fast sessions
  const fastPromise = Promise.all(
    fastRequests.map((req) =>
      runConcurrentSessions(TMP_DIR, [req]).then((arr) => arr[0]),
    ),
  );

  // Run slow session wrapped in a race against a manual timeout
  const slowPromise = Promise.race([
    runConcurrentSessions(TMP_DIR, [slowRequest]).then((arr) => arr[0]),
    new Promise((resolve) =>
      setTimeout(
        () => resolve({ sessionId: null, success: false, error: "timeout" }),
        TIMEOUT_MS,
      ),
    ),
  ]);

  const [fastResults, slowResult] = await Promise.all([
    fastPromise,
    slowPromise,
  ]);

  // Fast sessions must complete
  assert.equal(fastResults.length, 2);
  for (const r of fastResults) {
    assert.equal(r.success, true, `fast session must succeed: ${JSON.stringify(r)}`);
    assert.equal(r.error, null, `fast session must have no error: ${JSON.stringify(r)}`);
  }

  // Slow session must have been aborted by timeout
  assert.equal(slowResult.success, false, "slow session must not succeed");
  assert.equal(slowResult.error, "timeout", "slow session must report timeout");

  // Wait for the background slow process to settle so afterEach cleanup
  // doesn't fail with ENOTEMPTY (the process still holds files open)
  await new Promise((resolve) => setTimeout(resolve, 4000));
});

module.exports = { runConcurrentSessions };
