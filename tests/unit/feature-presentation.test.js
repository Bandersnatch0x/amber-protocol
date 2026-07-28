"use strict";

// Unit tests for `runFeatureAction` presentation entry in feature-commands.js.
// The 5 structured action fns stay exported for lifecycle/session callers;
// this entry only absorbs presentation + arg-shaping.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runFeatureAction } = require("../../scripts/lib/feature-commands");

function emptyFeatureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-feat-pres-empty-"));
  fs.writeFileSync(
    path.join(dir, "feature_list.json"),
    JSON.stringify({ features: [] }, null, 2) + "\n",
  );
  return dir;
}

function dirWithFeature() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-feat-pres-one-"));
  fs.writeFileSync(
    path.join(dir, "feature_list.json"),
    JSON.stringify(
      {
        features: [
          {
            id: "F1",
            priority: 1,
            title: "T",
            status: "not_started",
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  return dir;
}

test("runFeatureAction list on empty dir yields No features registered.", () => {
  const dir = emptyFeatureDir();
  try {
    const result = runFeatureAction("list", dir, {});
    assert.strictEqual(result.text, "No features registered.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runFeatureAction list on dir with feature formats Features header and row", () => {
  const dir = dirWithFeature();
  try {
    const result = runFeatureAction("list", dir, {});
    assert.ok(
      result.text.startsWith("Features:\n"),
      `expected text to start with 'Features:\\n', got: ${JSON.stringify(result.text)}`,
    );
    assert.ok(
      result.text.includes("F1 [not_started] T (P1)"),
      `expected row 'F1 [not_started] T (P1)' in: ${JSON.stringify(result.text)}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runFeatureAction add succeeds with id+title; missing id errors", () => {
  const dir = emptyFeatureDir();
  try {
    const added = runFeatureAction("add", dir, { id: "F1", title: "T" });
    assert.strictEqual(added.text, "Feature added: F1 — T");

    const missing = runFeatureAction("add", dir, { title: "T" });
    const errs = (missing.errors || []).join(" ");
    assert.ok(
      errs.includes("feature add requires --id"),
      `expected errors to carry 'feature add requires --id', got: ${errs}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runFeatureAction unknown action errors list valid actions", () => {
  const dir = emptyFeatureDir();
  try {
    const result = runFeatureAction("unknown", dir, {});
    assert.ok(
      Array.isArray(result.errors) && result.errors.length > 0,
      "unknown action must yield a non-empty errors array",
    );
    const text = result.errors.join(" ");
    for (const action of ["add", "list", "remove", "verify", "evidence"]) {
      assert.ok(
        text.includes(action),
        `unknown-action errors must list valid action "${action}": ${text}`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runFeatureAction add surfaces a doctor-valid hint warning when behavior/verify omitted (#75)", () => {
  const dir = emptyFeatureDir();
  try {
    const result = runFeatureAction("add", dir, { id: "F1", title: "T", area: "a" });
    assert.strictEqual(result.text, "Feature added: F1 — T");
    const joined = (result.warnings || []).join(" ");
    assert.ok(
      joined.includes("--behavior"),
      `expected warning to mention --behavior, got: ${joined}`,
    );
    assert.ok(
      joined.includes("--verify"),
      `expected warning to mention --verify, got: ${joined}`,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runFeatureAction add with --behavior/--verify produces no warning (#75)", () => {
  const dir = emptyFeatureDir();
  try {
    const result = runFeatureAction("add", dir, {
      id: "F2",
      title: "T",
      area: "a",
      behavior: "User sees X.",
      verify: ["npm test"],
    });
    assert.strictEqual(result.text, "Feature added: F2 — T");
    assert.deepStrictEqual(result.warnings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
