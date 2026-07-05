"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");
const { gitRun, gitOutput } = require("../../scripts/lib/core/git-exec");

function mkGit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-git-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email t@t.t && git config user.name t", { cwd: dir });
  fs.writeFileSync(path.join(dir, "x"), "1");
  execSync("git add -A && git commit -q -m init", { cwd: dir });
  return dir;
}

test("gitRun creates an annotated tag and reports ok", () => {
  const dir = mkGit();
  const r = gitRun(dir, ["tag", "-a", "-m", "seal", "amber-ledger-seal-test"]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(gitOutput(dir, ["tag", "-l", "amber-ledger-seal-test"]), "amber-ledger-seal-test");
});

test("gitRun reports ok:false on a failing write", () => {
  const dir = mkGit();
  const r = gitRun(dir, ["tag", "-a", "-m", "seal", "bad tag name with spaces"]);
  assert.strictEqual(r.ok, false);
});
