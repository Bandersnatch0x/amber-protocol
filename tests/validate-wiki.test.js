"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { scaffoldHarness, validateWiki } = require("../scripts/lib/amber-core");

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-harness-wiki-${name}-`));
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test("scaffolded wiki has no broken local links", () => {
  const target = tempDir("valid");
  scaffoldHarness(target);

  const result = validateWiki(target);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("broken Harness fixture reports missing wiki link", () => {
  const target = tempDir("broken");
  fs.cpSync(path.join(__dirname, "fixtures", "broken-harness"), target, { recursive: true });

  const result = validateWiki(target);
  assert.ok(result.errors.some((error) => /missing\.md/.test(error)));
});

test("wiki validator reports missing and empty wiki structures", () => {
  const missing = tempDir("missing");
  const empty = tempDir("empty");
  fs.mkdirSync(path.join(empty, "docs", "wiki"), { recursive: true });

  const missingResult = validateWiki(missing);
  const emptyResult = validateWiki(empty);

  assert.ok(missingResult.errors.some((error) => /docs\/wiki directory is missing/.test(error)));
  assert.ok(emptyResult.errors.some((error) => /docs\/wiki has no markdown files/.test(error)));
  assert.ok(emptyResult.errors.some((error) => /docs\/wiki\/index\.md is missing/.test(error)));
});

test("wiki validator reports missing index when pages exist", () => {
  const target = tempDir("missing-index");
  writeFile(target, "docs/wiki/product/overview.md", "# Overview\n");

  const result = validateWiki(target);

  assert.ok(result.errors.some((error) => /docs\/wiki\/index\.md is missing/.test(error)));
});

test("wiki validator warns when starter pages lack unknown markers", () => {
  const target = tempDir("unknown-markers");
  writeFile(target, "docs/wiki/index.md", "# Index\n");
  writeFile(target, "docs/wiki/product/overview.md", "# Product Overview\n\nKnown context only.\n");

  const result = validateWiki(target);

  assert.deepEqual(result.errors, []);
  assert.ok(
    result.warnings.some((warning) =>
      /docs\/wiki\/product\/overview\.md is missing an Unknowns \/ Needs Confirmation section/.test(warning)
    )
  );
});

test("wiki validator accepts external links, anchors, query strings, and nested relatives", () => {
  const target = tempDir("links");
  writeFile(
    target,
    "docs/wiki/index.md",
    [
      "# Index",
      "[External](https://example.com)",
      "[Mail](mailto:test@example.com)",
      "[Anchor](#local)",
      "[Overview](product/overview.md?view=full#top)",
      "[Nested](product/details/deep.md)"
    ].join("\n")
  );
  writeFile(target, "docs/wiki/product/overview.md", "# Overview\n");
  writeFile(target, "docs/wiki/product/details/deep.md", "# Deep\n[Back](../overview.md#top)\n");

  const result = validateWiki(target);

  assert.deepEqual(result.errors, []);
});
