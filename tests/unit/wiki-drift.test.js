"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { detectWikiDrift } = require("../../scripts/lib/core/wiki-drift");
const { REQUIRED_HARNESS_FILES } = require("../../scripts/lib/core/constants");

function mkWikiDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-wiki-"));
  fs.mkdirSync(path.join(dir, "docs", "wiki", "product"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "wiki", "engineering"), { recursive: true });
  return dir;
}
// Install every required wiki page as a minimal stub.
function seedRequired(dir) {
  for (const rel of REQUIRED_HARNESS_FILES) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "# stub\n");
  }
}

test("no wiki dir -> available:false with note", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-wiki-"));
  const r = detectWikiDrift(dir);
  assert.strictEqual(r.available, false);
  assert.match(r.note, /wiki/);
});

test("missingRequired counts absent required pages", () => {
  const dir = mkWikiDir();
  seedRequired(dir);
  // Delete one required page -> should be detected.
  fs.unlinkSync(path.join(dir, REQUIRED_HARNESS_FILES[0]));
  const r = detectWikiDrift(dir);
  assert.strictEqual(r.available, true);
  assert.ok(r.counts.missingRequired >= 1);
  assert.ok(r.missingRequired.includes(REQUIRED_HARNESS_FILES[0]));
});

test("staleDocs flags wiki md missing the Last Reviewed marker", () => {
  const dir = mkWikiDir();
  seedRequired(dir);
  // A wiki md WITHOUT a "Last Reviewed:" marker -> detectStaleDocs reports it stale.
  fs.writeFileSync(path.join(dir, "docs", "wiki", "product", "overview.md"), "# no marker here\n");
  const r = detectWikiDrift(dir);
  assert.ok(r.counts.staleDocs >= 1);
});

test("controlledDrifted is empty (not crashing) when no provenance", () => {
  const dir = mkWikiDir();
  seedRequired(dir);
  const r = detectWikiDrift(dir);
  assert.strictEqual(r.counts.controlledDrifted, 0);
});

test("non-git project is NOT skipped (wiki drift is marker/file based)", () => {
  const dir = mkWikiDir();
  seedRequired(dir);
  // dir is a plain temp dir, never git-init'd.
  const r = detectWikiDrift(dir);
  assert.strictEqual(r.available, true);
});
