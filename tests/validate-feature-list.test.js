"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { validateFeatureListData, validateFeatureListFile } = require("../scripts/lib/amber-core");

function validFeature(overrides = {}) {
  return {
    id: "F001",
    priority: 1,
    area: "core",
    title: "Example feature",
    user_visible_behavior: "User sees a clear result.",
    status: "not_started",
    verification: ["Run the check"],
    evidence: [],
    notes: [],
    ...overrides
  };
}

test("template feature_list.json is valid", () => {
  const result = validateFeatureListFile(path.join(__dirname, "..", "templates", "feature_list.json"));
  assert.deepEqual(result.errors, []);
});

test("multiple in_progress features and passing without evidence fail", () => {
  const data = {
    features: [
      {
        id: "F001",
        priority: 1,
        area: "a",
        title: "A",
        user_visible_behavior: "A",
        status: "in_progress",
        verification: ["check"],
        evidence: [],
        notes: []
      },
      {
        id: "F002",
        priority: 2,
        area: "b",
        title: "B",
        user_visible_behavior: "B",
        status: "in_progress",
        verification: ["check"],
        evidence: [],
        notes: []
      },
      {
        id: "F003",
        priority: 3,
        area: "c",
        title: "C",
        user_visible_behavior: "C",
        status: "passing",
        verification: ["check"],
        evidence: [],
        notes: []
      }
    ]
  };

  const result = validateFeatureListData(data);
  assert.ok(result.errors.some((error) => /At most one feature/.test(error)));
  assert.ok(result.errors.some((error) => /passing but has no evidence/.test(error)));
});

test("feature list schema rejects malformed root and features array", () => {
  assert.ok(validateFeatureListData(null).errors.some((error) => /must contain an object/.test(error)));
  assert.ok(validateFeatureListData([]).errors.some((error) => /must contain an object/.test(error)));
  assert.ok(validateFeatureListData({}).errors.some((error) => /features array/.test(error)));
});

test("feature list schema validates required feature fields", () => {
  const cases = [
    [{ id: "" }, /features\[0]\.id must be a non-empty string/],
    [{ area: "" }, /features\[0]\.area must be a non-empty string/],
    [{ title: "" }, /features\[0]\.title must be a non-empty string/],
    [{ user_visible_behavior: "" }, /features\[0]\.user_visible_behavior must be a non-empty string/],
    [{ status: "" }, /features\[0]\.status must be a non-empty string/],
    [{ priority: "1" }, /features\[0]\.priority must be an integer/]
  ];

  for (const [override, expected] of cases) {
    const result = validateFeatureListData({ features: [validFeature(override)] });
    assert.ok(result.errors.some((error) => expected.test(error)), `missing ${expected}`);
  }
});

test("feature list schema validates verification, evidence, and notes arrays", () => {
  const cases = [
    [{ verification: [] }, /verification must contain at least one step/],
    [{ verification: [""] }, /verification steps must be non-empty strings/],
    [{ evidence: "proof" }, /evidence must be an array/],
    [{ notes: "note" }, /notes must be an array/]
  ];

  for (const [override, expected] of cases) {
    const result = validateFeatureListData({ features: [validFeature(override)] });
    assert.ok(result.errors.some((error) => expected.test(error)), `missing ${expected}`);
  }
});

test("feature list schema rejects duplicate ids and invalid status", () => {
  const result = validateFeatureListData({
    features: [
      validFeature({ id: "F001" }),
      validFeature({ id: "F001", status: "unknown" })
    ]
  });

  assert.ok(result.errors.some((error) => /duplicates F001/.test(error)));
  assert.ok(result.errors.some((error) => /status must be one of/.test(error)));
});

test("blocked features without notes warn instead of fail", () => {
  const result = validateFeatureListData({ features: [validFeature({ status: "blocked", notes: [] })] });

  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => /blocked but has no notes/.test(warning)));
});

test("invalid json file reports a readable error", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "coding-harness-invalid-feature-"));
  const filePath = path.join(target, "feature_list.json");
  fs.writeFileSync(filePath, "{ invalid json");

  const result = validateFeatureListFile(filePath);
  assert.ok(result.errors[0].startsWith("Cannot read feature_list.json:"));
});
