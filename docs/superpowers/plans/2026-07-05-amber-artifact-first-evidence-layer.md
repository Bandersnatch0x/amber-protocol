# Amber Artifact-First Evidence Layer — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three boundary-safe, zero-new-dependency commands that make Amber's drift detection CI-deployable and its tamper-evident ledger SIEM-consumable and git-anchored.

**Architecture:** Three independent commands layered on existing primitives. `amber drift` aggregates the three existing detectors (`detectArtifactDrift` / `detectWikiDrift` / `detectScaffoldDrift`) into a single CI-native gate. `amber ledger export` reads every `ledger.jsonl` via the already-exported `walkLedgers` and emits JSON/CSV/OTLP-JSON. `amber ledger seal` + `verify-anchoring` write ledger tail hashes into an annotated git tag so forging a ledger also requires rewriting git history. All three register through the existing `HANDLERS` dispatcher table + `COMMANDS` array + `COMMAND_HELP` map.

**Tech Stack:** Node.js ≥18.17 (`node:test`, `node:assert/strict`, `node:crypto`, `node:child_process`). CommonJS. Zero new runtime dependencies (root `package.json` stays at `ajv`, `ajv-formats`, `nodemailer`).

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-07-05-amber-artifact-first-evidence-layer-design.md`):

- Node `>=18.17.0`, npm `>=9.0.0` (engines floor).
- Zero new runtime dependencies in root `package.json`. OTLP output is JSON-encoded (valid OTLP), never protobuf.
- All three commands are read-only or write only a local git tag (no external writes, no push, no scheduling, no agent dispatch). Boundary per ADR-0001/0003/0005 — no ADR amendment required.
- `--json` is a boolean flag toggling a machine-readable envelope (existing Amber convention); default output is human-readable text.
- Tests use `node:test` + `node:assert/strict`, file suffix `.test.js`, collected by `scripts/run-tests.js` via `node --test`.

## File Structure

**Created:**
- `scripts/lib/drift-command.js` — `runDrift(target, options)` + `renderDrift(result, options)`. Aggregates the three detectors; CI exit semantics.
- `scripts/lib/core/ledger-export.js` — `exportLedger(target, options)`. Walks ledgers, verifies chains, emits JSON/CSV/OTLP-JSON.
- `scripts/lib/core/ledger-seal.js` — `sealLedger(target, options)` + `verifyAnchoring(target)`. Tag-based git anchoring.
- `tests/unit/drift-command.test.js` — drift aggregation + exit-code tests.
- `tests/unit/ledger-export.test.js` — fixture-ledger export + broken-chain refusal tests.
- `tests/unit/ledger-seal.test.js` — seal creates tag; verify-anchoring detects tamper.

**Modified:**
- `scripts/lib/core/git-exec.js` — add `gitRun(targetRoot, args)` write-op sibling to the read-only `gitOutput`.
- `scripts/lib/command-dispatcher.js` — add `handleDrift` + `handleLedger`; register both in `HANDLERS`.
- `scripts/amber.js` — add `"drift"` and `"ledger"` to the `COMMANDS` array; add `PER_COMMAND_USAGE.drift` + `PER_COMMAND_USAGE.ledger`.
- `scripts/lib/command-help.js` — add `drift` + `ledger` entries to `COMMAND_HELP`.
- `docs/CLI_REFERENCE.md` — document the three new commands + a GitHub Actions snippet for `amber drift`.

---

## Task 1: `amber drift` — CI-native drift gate

**Files:**
- Create: `scripts/lib/drift-command.js`
- Create: `tests/unit/drift-command.test.js`
- Modify: `scripts/amber.js` (COMMANDS array ~L8-40, PER_COMMAND_USAGE ~L46-68)
- Modify: `scripts/lib/command-dispatcher.js` (add `handleDrift`, register in `HANDLERS` ~L698-730)
- Modify: `scripts/lib/command-help.js` (COMMAND_HELP map)

**Interfaces:**
- Consumes: `detectArtifactDrift(targetRoot)` → `{available, counts:{drifted,aligned,skipped}, features:[{id,classification,paths,anchorDate,lastCommitDate}], skippedBreakdown}` (from `scripts/lib/core/artifact-drift.js`); `detectWikiDrift(targetRoot)` → `{available, counts:{staleDocs,missingRequired,controlledDrifted}}`; `detectScaffoldDrift(targetRoot)` → `{installed, counts:{fresh,stale,customized,ambiguous,missing}, note?}`; `classifyTarget(targetRoot)` → `{type}` (returns `"product-repo"` for the repo that ships templates).
- Produces: `runDrift(target, options)` → `{target, available, scopes:{artifact,wiki,scaffold}, totalDrifted, exitCode}` where each scope is `{available, counts, drifted}` or `{available:false, note}`; `renderDrift(result, options)` → string.

- [ ] **Step 1: Write the failing test (aggregation + exit code)**

Create `tests/unit/drift-command.test.js`:

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");
const { runDrift, renderDrift } = require("../../scripts/lib/drift-command");

// Build a minimal harnessed git repo with .amber state dir (detectors need git + feature_list).
function mkHarnessRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-drift-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email t@t.t && git config user.name t", { cwd: dir });
  fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
  // feature_list with one drifted feature: evidence dated before the commit.
  fs.writeFileSync(
    path.join(dir, "feature_list.json"),
    JSON.stringify({ features: [{ id: "F1", title: "t", paths: ["src/a"], evidence: [{ command: "c", result: "pass", date: "2020-01-01" }] }] }, null, 2),
  );
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/a"), "x");
  execSync("git add -A && git commit -q -m init", { cwd: dir });
  return dir;
}

test("runDrift aggregates and exits 1 when artifact drift exists", () => {
  const dir = mkHarnessRepo();
  const r = runDrift(dir);
  assert.strictEqual(r.available, true);
  assert.ok(r.totalDrifted >= 1, "artifact drift counted");
  assert.strictEqual(r.exitCode, 1);
});

test("--no-fail forces exitCode 0 even with drift", () => {
  const dir = mkHarnessRepo();
  const r = runDrift(dir, { noFail: true });
  assert.strictEqual(r.exitCode, 0);
  assert.ok(r.totalDrifted >= 1);
});

test("non-git repo: scopes unavailable, exitCode 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-drift-"));
  fs.writeFileSync(path.join(dir, "feature_list.json"), JSON.stringify({ features: [] }));
  const r = runDrift(dir);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.totalDrifted, 0);
});

test("renderDrift default emits a Total drifted line", () => {
  const dir = mkHarnessRepo();
  const out = renderDrift(runDrift(dir));
  assert.match(out, /Total drifted:/);
});

test("renderDrift gh-annotations emits ::warning lines", () => {
  const dir = mkHarnessRepo();
  const out = renderDrift(runDrift(dir), { format: "gh-annotations" });
  assert.match(out, /::warning/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-tests.js tests/unit/drift-command.test.js`
Expected: FAIL — `Cannot find module '../../scripts/lib/drift-command'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/drift-command.js`:

```js
"use strict";

// `amber drift` — CI-native drift gate. Aggregates the three existing drift
// detectors (artifact / wiki / scaffold) into one concern with CI exit
// semantics: exit 1 iff any actionable drift. Read-only; no execution; no
// auto-fix. Mirrors the Verification-layer shape of `doctor` / `manifests`.
// ponytail: single-pass aggregation — detectors already do the work; this
// just shapes their output for CI.
const { resolveTarget } = require("./core/fs-utils");
const { detectArtifactDrift } = require("./core/artifact-drift");
const { detectWikiDrift } = require("./core/wiki-drift");
const { detectScaffoldDrift } = require("./core/scaffold-version-drift");
const { classifyTarget } = require("./core/target-classification");

function safe(fallback, fn) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function scopeArtifact(targetRoot) {
  const a = safe({ available: false, note: "detector error" }, () => detectArtifactDrift(targetRoot));
  if (!a.available) return { available: false, note: a.note };
  const driftedFeatures = (a.features || []).filter((f) => f.classification === "drifted");
  return { available: true, counts: a.counts, drifted: a.counts.drifted, driftedFeatures };
}

function scopeWiki(targetRoot) {
  const w = safe({ available: false, note: "detector error" }, () => detectWikiDrift(targetRoot));
  if (!w.available) return { available: false, note: w.note };
  const c = w.counts;
  return { available: true, counts: c, drifted: c.staleDocs + c.missingRequired };
}

function scopeScaffold(targetRoot) {
  if (classifyTarget(targetRoot).type === "product-repo") {
    return { available: false, note: "n/a (product-repo ships the templates)" };
  }
  const s = safe({ installed: false, note: "detector error" }, () => detectScaffoldDrift(targetRoot));
  if (!s.installed || !s.counts) return { available: false, note: s.note || "no install provenance" };
  return { available: true, counts: s.counts, drifted: s.counts.stale };
}

function runDrift(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const scope = options.scope || "all";
  const want = (s) => scope === "all" || scope === s;
  const scopes = {};
  if (want("artifact")) scopes.artifact = scopeArtifact(targetRoot);
  if (want("wiki")) scopes.wiki = scopeWiki(targetRoot);
  if (want("scaffold")) scopes.scaffold = scopeScaffold(targetRoot);
  const totalDrifted = Object.values(scopes).reduce((sum, s) => sum + (s.drifted || 0), 0);
  const exitCode = options.noFail ? 0 : totalDrifted > 0 ? 1 : 0;
  return { target: targetRoot, available: true, scopes, totalDrifted, exitCode };
}

function renderDrift(result, options = {}) {
  return options.format === "gh-annotations" ? renderGh(result) : renderText(result);
}

function renderText(result) {
  const lines = [`Target: ${result.target}`];
  for (const [name, s] of Object.entries(result.scopes)) {
    if (!s.available) {
      lines.push(`${name}: ${s.note}`);
      continue;
    }
    const c = s.counts;
    if (name === "artifact") lines.push(`artifact: drifted=${c.drifted} aligned=${c.aligned} skipped=${c.skipped}`);
    else if (name === "wiki") lines.push(`wiki: staleDocs=${c.staleDocs} missingRequired=${c.missingRequired} controlledDrifted=${c.controlledDrifted}`);
    else if (name === "scaffold") lines.push(`scaffold: fresh=${c.fresh} stale=${c.stale} customized=${c.customized} ambiguous=${c.ambiguous} missing=${c.missing}`);
  }
  lines.push(`Total drifted: ${result.totalDrifted}`);
  lines.push(`Exit: ${result.exitCode}`);
  return lines.join("\n");
}

function renderGh(result) {
  const lines = [];
  const art = result.scopes.artifact;
  if (art && art.available) {
    for (const f of art.driftedFeatures || []) {
      const file = (f.paths && f.paths[0]) || "feature_list.json";
      lines.push(`::warning file=${file}::feature ${f.id} drifted — code newer than last evidence (${f.lastCommitDate} > ${f.anchorDate})`);
    }
  }
  const wiki = result.scopes.wiki;
  if (wiki && wiki.available) {
    if (wiki.counts.staleDocs > 0) lines.push(`::warning::wiki drift: ${wiki.counts.staleDocs} stale doc(s)`);
    if (wiki.counts.missingRequired > 0) lines.push(`::warning::wiki drift: ${wiki.counts.missingRequired} missing required page(s)`);
  }
  const scaf = result.scopes.scaffold;
  if (scaf && scaf.available && scaf.counts.stale > 0) {
    lines.push(`::warning::scaffold drift: ${scaf.counts.stale} stale scaffold file(s) — run \`amber sync\``);
  }
  return lines.join("\n");
}

module.exports = { runDrift, renderDrift };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-tests.js tests/unit/drift-command.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire into the CLI**

5a. In `scripts/amber.js`, add `"drift"` to the `COMMANDS` array (insert after `"status"`, before `"sync"`).

5b. In `scripts/amber.js` `PER_COMMAND_USAGE`, add:
```js
  drift: "Usage: amber drift --target <repo> [--scope artifact|wiki|scaffold|all] [--format text|json|gh-annotations] [--no-fail] [--json]",
```

5c. In `scripts/lib/command-dispatcher.js`, add the handler (place near `handleStatus`):
```js
function handleDrift(args) {
  const { runDrift, renderDrift } = require("./drift-command");
  const result = runDrift(args.target, {
    scope: args.scope,
    noFail: args.noFail,
  });
  const format = args.format || (args.json ? "json" : "text");
  if (args.json) {
    return { result: { target: args.target, ...result, errors: [], warnings: [] }, exitCode: result.exitCode, bypassPrint: false };
  }
  const text = format === "gh-annotations" ? renderDrift(result, { format: "gh-annotations" }) : renderDrift(result);
  return {
    result: { target: args.target, text, drift: result, errors: [], warnings: [] },
    exitCode: result.exitCode,
    bypassPrint: true,
  };
}
```
Register in `HANDLERS`: add `drift: handleDrift,` (near `status: handleStatus,`).

5d. In `scripts/lib/command-help.js` `COMMAND_HELP`, add:
```js
	drift: "CI-native drift gate. Exit 1 if any artifact/wiki/scaffold drift. Supports --scope, --format gh-annotations, --no-fail.",
```

- [ ] **Step 6: Verify the wired command works end-to-end**

Run: `node scripts/amber.js drift --target . --no-fail`
Expected: prints a `Target:` / per-scope / `Total drifted:` / `Exit: 0` block (this repo is a `product-repo`, so scaffold shows `n/a`; artifact/wiki report their state).

Run: `node scripts/amber.js drift --target . --json --no-fail | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('exitCode field:',j.exitCode)})"`
Expected: prints `exitCode field: 0` (proves the JSON envelope carries exitCode).

Run the full suite to confirm no regression: `npm test`
Expected: all prior tests still pass plus the 5 new ones.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/drift-command.js tests/unit/drift-command.test.js scripts/amber.js scripts/lib/command-dispatcher.js scripts/lib/command-help.js
git commit -m "feat(drift): add amber drift CI-native drift gate"
```

---

## Task 2: `amber ledger export` — SIEM/compliance bridge

**Files:**
- Create: `scripts/lib/core/ledger-export.js`
- Create: `tests/unit/ledger-export.test.js`
- Modify: `scripts/amber.js` (add `"ledger"` to COMMANDS; add `PER_COMMAND_USAGE.ledger`)
- Modify: `scripts/lib/command-dispatcher.js` (add `handleLedger`; register in `HANDLERS`)
- Modify: `scripts/lib/command-help.js` (add `ledger` to `COMMAND_HELP`)

**Interfaces:**
- Consumes: `walkLedgers(stateDir, cb)` (from `loop-ledger.js`, walks `loops|routes|sessions`), `readLedger(ledgerPath)`, `verifyLedgerChain(ledgerPath)` → `{intact, brokenAt, records}`.
- Produces: `exportLedger(target, options)` → `{target, stateDir, format, ledgers:[{home,sub,intact,recordCount,records}], intactCount, brokenCount, payload, errors, warnings}`. `payload` is the serialized string (JSON/CSV/OTLP-JSON).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ledger-export.test.js`:

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const L = require("../../scripts/lib/core/loop-ledger");
const { exportLedger } = require("../../scripts/lib/core/ledger-export");

function mkStateWithLedger(home, sub, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-exp-"));
  const ledgerDir = path.join(dir, ".amber", home, sub);
  fs.mkdirSync(ledgerDir, { recursive: true });
  const ledgerPath = path.join(ledgerDir, "ledger.jsonl");
  for (const r of records) L.appendLedgerRecord(ledgerPath, r);
  return dir;
}

test("json export serializes an intact ledger", () => {
  const dir = mkStateWithLedger("sessions", "S1", [{ kind: "approved", approvalKey: "a1" }]);
  const r = exportLedger(dir, { format: "json" });
  assert.strictEqual(r.brokenCount, 0);
  assert.strictEqual(r.intactCount, 1);
  const parsed = JSON.parse(r.payload);
  assert.strictEqual(parsed.ledgers[0].records[0].kind, "approved");
});

test("csv export has a header and one row per record", () => {
  const dir = mkStateWithLedger("loops", "daily", [
    { kind: "approved", approvalKey: "a1" },
    { kind: "executed", consumedApprovalKey: "a1" },
  ]);
  const r = exportLedger(dir, { format: "csv" });
  const rows = r.payload.split("\n");
  assert.match(rows[0], /ledger_home/);
  assert.strictEqual(rows.length, 3); // header + 2 records
});

test("otlp-json export is a valid resourceSpans document", () => {
  const dir = mkStateWithLedger("routes", "R1", [{ kind: "verification_passed" }]);
  const r = exportLedger(dir, { format: "otlp-json" });
  const parsed = JSON.parse(r.payload);
  assert.ok(Array.isArray(parsed.resourceSpans));
  assert.ok(parsed.resourceSpans[0].scopeSpans[0].spans.length >= 1);
});

test("broken chain: intact=false and brokenCount counts it", () => {
  const dir = mkStateWithLedger("sessions", "S2", [{ kind: "approved", approvalKey: "a1" }]);
  const ledgerPath = path.join(dir, ".amber", "sessions", "S2", "ledger.jsonl");
  const lines = fs.readFileSync(ledgerPath, "utf8").trim().split("\n");
  const rec = JSON.parse(lines[0]);
  rec.kind = "tampered"; // body change breaks the hash chain
  fs.writeFileSync(ledgerPath, JSON.stringify(rec) + "\n");
  const r = exportLedger(dir, { format: "json" });
  assert.strictEqual(r.brokenCount, 1);
  assert.strictEqual(r.ledgers[0].intact, false);
});

test("--home filter limits the walk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-exp-"));
  for (const sub of ["S1"]) {
    const lp = path.join(dir, ".amber", "sessions", sub, "ledger.jsonl");
    fs.mkdirSync(path.dirname(lp), { recursive: true });
    L.appendLedgerRecord(lp, { kind: "approved", approvalKey: "a1" });
  }
  const lp2 = path.join(dir, ".amber", "loops", "daily", "ledger.jsonl");
  fs.mkdirSync(path.dirname(lp2), { recursive: true });
  L.appendLedgerRecord(lp2, { kind: "approved", approvalKey: "a2" });
  const r = exportLedger(dir, { format: "json", home: "sessions" });
  assert.strictEqual(r.ledgers.length, 1);
  assert.strictEqual(r.ledgers[0].home, "sessions");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-tests.js tests/unit/ledger-export.test.js`
Expected: FAIL — `Cannot find module '../../scripts/lib/core/ledger-export'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/core/ledger-export.js`:

```js
"use strict";

// `amber ledger export` — SIEM/compliance bridge. Walks every ledger.jsonl via
// walkLedgers, verifies each chain, and emits JSON / CSV / OTLP-JSON. A broken
// chain is exported as-is with intact:false (data, not refusal) so a SOC can
// see the break; brokenCount surfaces it. Pure read; no external writes.
const fs = require("node:fs");
const path = require("node:path");
const { resolveTarget } = require("./fs-utils");
const { walkLedgers, readLedger, verifyLedgerChain } = require("./loop-ledger");

function resolveStateDir(targetRoot) {
  if (fs.existsSync(path.join(targetRoot, ".amber"))) return ".amber";
  if (fs.existsSync(path.join(targetRoot, ".harness"))) return ".harness";
  return null;
}

function collectLedgers(targetRoot) {
  const stateDir = resolveStateDir(targetRoot);
  if (!stateDir) return { stateDir: null, ledgers: [] };
  const ledgers = [];
  walkLedgers(path.join(targetRoot, stateDir), ({ home, sub, ledgerPath }) => {
    const records = readLedger(ledgerPath);
    const v = verifyLedgerChain(ledgerPath);
    ledgers.push({ home, sub, intact: v.intact, recordCount: v.records || 0, records });
  });
  return { stateDir, ledgers };
}

function exportLedger(target, options = {}) {
  const targetRoot = resolveTarget(target);
  const format = options.format || "json";
  const homeFilter = options.home && options.home !== "all" ? options.home : null;
  const { stateDir, ledgers } = collectLedgers(targetRoot);
  const filtered = homeFilter ? ledgers.filter((l) => l.home === homeFilter) : ledgers;
  const intactCount = filtered.filter((l) => l.intact).length;
  const brokenCount = filtered.length - intactCount;
  const errors = [];
  if (!stateDir) errors.push("no .amber or .harness state directory");
  if (brokenCount > 0) errors.push(`${brokenCount} ledger(s) have a broken hash chain (exported with intact:false).`);
  const payload = buildPayload(format, filtered);
  return { target: targetRoot, stateDir, format, ledgers: filtered, intactCount, brokenCount, payload, errors, warnings: [] };
}

function buildPayload(format, ledgers) {
  if (format === "csv") return toCsv(ledgers);
  if (format === "otlp-json") return toOtlpJson(ledgers);
  return toJson(ledgers);
}

function toJson(ledgers) {
  return JSON.stringify(
    {
      ledgers: ledgers.map((l) => ({
        home: l.home,
        sub: l.sub,
        intact: l.intact,
        recordCount: l.recordCount,
        records: l.records,
      })),
    },
    null,
    2,
  );
}

function csvField(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(ledgers) {
  const cols = ["ledger_home", "ledger_sub", "record_index", "kind", "prevHash", "hash"];
  const rows = [cols.join(",")];
  for (const l of ledgers) {
    l.records.forEach((r, i) => {
      rows.push([l.home, l.sub, i, r.kind || "", r.prevHash || "", r.hash || ""].map(csvField).join(","));
    });
  }
  return rows.join("\n");
}

function toOtlpJson(ledgers) {
  // JSON-encoded OTLP (valid OTLP encoding; no protobuf, no dependency).
  // One span per ledger record; traceId/spanId derived from the record hash so
  // the chain structure is preserved in the telemetry backend.
  const spans = [];
  for (const l of ledgers) {
    l.records.forEach((r, i) => {
      const h = r.hash || "";
      spans.push({
        traceId: h.padEnd(32, "0").slice(0, 32),
        spanId: h.slice(0, 16).padEnd(16, "0"),
        name: `amber.ledger.${r.kind || "record"}`,
        attributes: [
          { key: "amber.ledger.home", value: { stringValue: l.home } },
          { key: "amber.ledger.sub", value: { stringValue: l.sub } },
          { key: "amber.ledger.record_index", value: { intValue: String(i) } },
          { key: "amber.ledger.intact", value: { boolValue: l.intact } },
          { key: "amber.ledger.prevHash", value: { stringValue: r.prevHash || "" } },
        ],
      });
    });
  }
  return JSON.stringify(
    { resourceSpans: [{ scopeSpans: [{ scope: { name: "amber-protocol-ledger" }, spans }] }] },
    null,
    2,
  );
}

module.exports = { exportLedger, collectLedgers };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-tests.js tests/unit/ledger-export.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire into the CLI (introduces the `ledger` command group)**

5a. In `scripts/amber.js`, add `"ledger"` to the `COMMANDS` array (insert after `"loop"`).

5b. In `scripts/amber.js` `PER_COMMAND_USAGE`, add:
```js
  ledger: "Usage: amber ledger <export|seal|verify-anchoring> --target <repo> [--format json|csv|otlp-json] [--home loops|routes|sessions|all] [--out <path>] [--reviewer <name>] [--json]",
```

5c. In `scripts/lib/command-dispatcher.js`, add `handleLedger` (the `export` subcommand works now; `seal`/`verify-anchoring` are added in Task 3):
```js
function handleLedger(args) {
  const action = args._ && args._[0];
  const targetRoot = resolveTarget(args);
  if (action === "export") {
    const { exportLedger } = require("./core/ledger-export");
    const r = exportLedger(targetRoot, { format: args.format, home: args.home });
    if (args.out) {
      const fs = require("node:fs");
      const path = require("node:path");
      const outPath = path.resolve(targetRoot, args.out);
      fs.writeFileSync(outPath, r.payload + "\n");
      return { result: { target: args.target, text: `Wrote ${r.ledgers.length} ledger(s) to ${outPath} (intact=${r.intactCount}, broken=${r.brokenCount})`, errors: r.errors, warnings: r.warnings }, bypassPrint: !args.json };
    }
    if (args.json) return { result: { target: args.target, ...r, errors: r.errors, warnings: r.warnings } };
    return { result: { target: args.target, text: r.payload, errors: r.errors, warnings: r.warnings }, bypassPrint: true };
  }
  return { result: { target: args.target, errors: ["ledger requires export, seal, or verify-anchoring."], warnings: [] } };
}
```
Register in `HANDLERS`: add `ledger: handleLedger,`.

5d. In `scripts/lib/command-help.js` `COMMAND_HELP`, add:
```js
	ledger: "Export, seal, or verify-anchoring for Amber's tamper-evident ledgers. export emits JSON/CSV/OTLP-JSON for SIEM.",
```

- [ ] **Step 6: Verify end-to-end**

Run: `node scripts/amber.js ledger export --target . --format json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('ledgers:',j.ledgers.length)})"`
Expected: prints `ledgers: <N>` where N ≥ 0 (this repo may have session/route/loop ledgers from prior runs).

Run: `npm test` — expected: all green.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/core/ledger-export.js tests/unit/ledger-export.test.js scripts/amber.js scripts/lib/command-dispatcher.js scripts/lib/command-help.js
git commit -m "feat(ledger): add amber ledger export (SIEM/compliance bridge)"
```

---

## Task 3: `amber ledger seal` + `verify-anchoring` — git-anchored integrity

**Files:**
- Modify: `scripts/lib/core/git-exec.js` (add `gitRun`)
- Create: `scripts/lib/core/ledger-seal.js`
- Create: `tests/unit/ledger-seal.test.js`
- Modify: `scripts/lib/command-dispatcher.js` (extend `handleLedger` with `seal` + `verify-anchoring`)
- Modify: `scripts/amber.js` (no change — `ledger` already in COMMANDS/usage from Task 2)

**Interfaces:**
- Consumes: `gitOutput(targetRoot, args)` (read-only git, returns trimmed stdout or null); new `gitRun(targetRoot, args)` → `{ok, stdout, stderr}` (write git). `walkLedgers` + `readLedger`.
- Produces: `sealLedger(target, options)` → `{target, sealed, tagName, head, ledgerCount, errors, warnings}`; `verifyAnchoring(target)` → `{target, anchored, sealTag, ledgerChangedSinceSeal, drift:[{home,sub,status,sealedTail,currentTail}], errors, warnings}`.

- [ ] **Step 1: Write the failing test for `gitRun`**

Create a small addition to the git-exec test if one exists, else add `tests/unit/git-exec.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-tests.js tests/unit/git-exec.test.js`
Expected: FAIL — `gitRun is not a function`.

- [ ] **Step 3: Add `gitRun` to `scripts/lib/core/git-exec.js`**

Append before `module.exports`:
```js
// Canonical write git invocation (tag/commit/etc). Returns {ok, stdout, stderr}.
// ok mirrors exit status; never throws — callers decide how to surface failure.
function gitRun(targetRoot, args) {
  try {
    const res = spawnSync("git", args, { cwd: targetRoot, encoding: "utf8" });
    return {
      ok: !!(res && res.status === 0),
      stdout: (res && res.stdout && res.stdout.trim()) || "",
      stderr: (res && res.stderr && res.stderr.trim()) || "",
    };
  } catch (e) {
    return { ok: false, stdout: "", stderr: String((e && e.message) || e) };
  }
}
```
Update the export: `module.exports = { gitOutput, gitRun };`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-tests.js tests/unit/git-exec.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for seal + verify-anchoring**

Create `tests/unit/ledger-seal.test.js`:

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");
const L = require("../../scripts/lib/core/loop-ledger");
const { sealLedger, verifyAnchoring } = require("../../scripts/lib/core/ledger-seal");

function mkHarnessWithLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-seal-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email t@t.t && git config user.name t", { cwd: dir });
  const ledgerDir = path.join(dir, ".amber", "sessions", "S1");
  fs.mkdirSync(ledgerDir, { recursive: true });
  L.appendLedgerRecord(path.join(ledgerDir, "ledger.jsonl"), { kind: "approved", approvalKey: "a1" });
  fs.writeFileSync(path.join(dir, "x"), "1");
  execSync("git add -A && git commit -q -m init", { cwd: dir });
  return dir;
}

test("seal creates a tag and verifies anchored immediately after", () => {
  const dir = mkHarnessWithLedger();
  const seal = sealLedger(dir);
  assert.strictEqual(seal.sealed, true);
  assert.match(seal.tagName, /^amber-ledger-seal-/);
  const v = verifyAnchoring(dir);
  assert.strictEqual(v.anchored, true);
  assert.strictEqual(v.ledgerChangedSinceSeal, 0);
});

test("appending a record after seal flips verify to not-anchored", () => {
  const dir = mkHarnessWithLedger();
  sealLedger(dir);
  L.appendLedgerRecord(path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl"), { kind: "executed", consumedApprovalKey: "a1" });
  const v = verifyAnchoring(dir);
  assert.strictEqual(v.anchored, false);
  assert.strictEqual(v.ledgerChangedSinceSeal, 1);
  assert.strictEqual(v.drift[0].status, "tail-changed");
});

test("verify on a repo with no seal reports anchored:false", () => {
  const dir = mkHarnessWithLedger();
  const v = verifyAnchoring(dir);
  assert.strictEqual(v.anchored, false);
  assert.match(v.errors[0], /no seal tag/i);
});

test("seal refuses on a non-git repo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-seal-"));
  fs.mkdirSync(path.join(dir, ".amber", "sessions", "S1"), { recursive: true });
  const seal = sealLedger(dir);
  assert.strictEqual(seal.sealed, false);
  assert.ok(seal.errors.length > 0);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node scripts/run-tests.js tests/unit/ledger-seal.test.js`
Expected: FAIL — `Cannot find module '../../scripts/lib/core/ledger-seal'`.

- [ ] **Step 7: Write the implementation**

Create `scripts/lib/core/ledger-seal.js`:

```js
"use strict";

// `amber ledger seal` + `verify-anchoring` — anchor ledger tail hashes into
// git history via an annotated tag. Closes the ADR-0003 self-admitted gap:
// "hash chain detects tampering but does not prevent a full-file rewrite
// (that needs external anchoring)." After sealing, forging a ledger requires
// rewriting git tag history too. Human-triggered; no push; no scheduling.
const fs = require("node:fs");
const path = require("node:path");
const { resolveTarget } = require("./fs-utils");
const { walkLedgers, readLedger } = require("./loop-ledger");
const { gitOutput, gitRun } = require("./git-exec");

const SEAL_PREFIX = "amber-ledger-seal-";

function resolveStateDir(targetRoot) {
  if (fs.existsSync(path.join(targetRoot, ".amber"))) return ".amber";
  if (fs.existsSync(path.join(targetRoot, ".harness"))) return ".harness";
  return null;
}

function collectTails(targetRoot) {
  const stateDir = resolveStateDir(targetRoot);
  if (!stateDir) return { stateDir: null, tails: [] };
  const tails = [];
  walkLedgers(path.join(targetRoot, stateDir), ({ home, sub, ledgerPath }) => {
    const records = readLedger(ledgerPath);
    const tail = records.length ? records[records.length - 1].hash : null;
    tails.push({ home, sub, tailHash: tail, recordCount: records.length });
  });
  return { stateDir, tails };
}

function sealLedger(target, options = {}) {
  const targetRoot = resolveTarget(target);
  if (!gitOutput(targetRoot, ["rev-parse", "--is-inside-work-tree"])) {
    return { target: targetRoot, sealed: false, errors: ["not a git repository"], warnings: [] };
  }
  const { stateDir, tails } = collectTails(targetRoot);
  if (!stateDir) {
    return { target: targetRoot, sealed: false, errors: ["no .amber or .harness state directory"], warnings: [] };
  }
  const head = gitOutput(targetRoot, ["rev-parse", "HEAD"]);
  const headShort = head ? head.slice(0, 12) : "no-head";
  const tagName = `${SEAL_PREFIX}${headShort}`;
  const message = JSON.stringify({ reviewer: options.reviewer || null, ledgers: tails });
  const res = gitRun(targetRoot, ["tag", "-f", "-a", tagName, "-m", message]);
  if (!res.ok) {
    return { target: targetRoot, sealed: false, errors: [`failed to create seal tag: ${res.stderr || "git error"}`], warnings: [] };
  }
  return { target: targetRoot, sealed: true, tagName, head: headShort, ledgerCount: tails.length, errors: [], warnings: [] };
}

function latestSealTag(targetRoot) {
  const list = gitOutput(targetRoot, ["tag", "-l", `${SEAL_PREFIX}*`, "--sort=-creatordate"]);
  if (!list) return null;
  return list.split("\n").map((s) => s.trim()).filter(Boolean)[0] || null;
}

function readSealMessage(targetRoot, tagName) {
  return gitOutput(targetRoot, ["tag", "-l", "--format=%(contents)", tagName]);
}

function verifyAnchoring(target) {
  const targetRoot = resolveTarget(target);
  const tagName = latestSealTag(targetRoot);
  if (!tagName) {
    return { target: targetRoot, anchored: false, errors: ["no seal tag found — run `amber ledger seal`"], warnings: [] };
  }
  const msg = readSealMessage(targetRoot, tagName);
  let sealed;
  try {
    sealed = JSON.parse(msg);
  } catch {
    return { target: targetRoot, anchored: false, sealTag: tagName, errors: ["seal tag message is not valid JSON"], warnings: [] };
  }
  const current = collectTails(targetRoot).tails;
  const byKey = new Map(current.map((t) => [`${t.home}/${t.sub}`, t]));
  const drift = [];
  for (const sealedTail of sealed.ledgers || []) {
    const key = `${sealedTail.home}/${sealedTail.sub}`;
    const cur = byKey.get(key);
    if (!cur) {
      drift.push({ home: sealedTail.home, sub: sealedTail.sub, status: "ledger-removed" });
    } else if (cur.tailHash !== sealedTail.tailHash) {
      drift.push({ home: sealedTail.home, sub: sealedTail.sub, status: "tail-changed", sealedTail: sealedTail.tailHash, currentTail: cur.tailHash });
    }
  }
  return {
    target: targetRoot,
    anchored: drift.length === 0,
    sealTag: tagName,
    ledgerChangedSinceSeal: drift.length,
    drift,
    errors: [],
    warnings: [],
  };
}

module.exports = { sealLedger, verifyAnchoring, collectTails, SEAL_PREFIX };
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node scripts/run-tests.js tests/unit/ledger-seal.test.js`
Expected: PASS (4 tests).

- [ ] **Step 9: Wire `seal` + `verify-anchoring` into `handleLedger`**

In `scripts/lib/command-dispatcher.js`, extend `handleLedger` — add these branches before the final `return` for unknown action:

```js
  if (action === "seal") {
    const { sealLedger } = require("./core/ledger-seal");
    const r = sealLedger(targetRoot, { reviewer: args.reviewer });
    const text = r.sealed
      ? `Sealed ${r.ledgerCount} ledger(s) to tag ${r.tagName} at HEAD ${r.head}.`
      : `Seal failed: ${r.errors.join("; ")}`;
    return { result: { target: args.target, text, ...r, errors: r.errors, warnings: r.warnings }, exitCode: r.sealed ? 0 : 1, bypassPrint: !args.json };
  }
  if (action === "verify-anchoring") {
    const { verifyAnchoring } = require("./core/ledger-seal");
    const r = verifyAnchoring(targetRoot);
    const text = r.anchored
      ? `Anchored: all ledgers match seal tag ${r.sealTag}.`
      : `NOT anchored: ${r.ledgerChangedSinceSeal} ledger(s) changed since seal tag ${r.sealTag}.`;
    return { result: { target: args.target, text, ...r, errors: r.errors, warnings: r.warnings }, exitCode: r.anchored ? 0 : 1, bypassPrint: !args.json };
  }
```
Update the unknown-action message to: `"ledger requires export, seal, or verify-anchoring."`.

- [ ] **Step 10: Verify end-to-end**

Run: `node scripts/amber.js ledger seal --target . --reviewer $(git config user.name)`
Expected: `Sealed N ledger(s) to tag amber-ledger-seal-<sha> at HEAD <sha>.` (N may be 0 if no ledgers exist yet — still seals an empty map).

Run: `node scripts/amber.js ledger verify-anchoring --target .`
Expected: `Anchored: all ledgers match seal tag ...` (exit 0).

Run: `npm test` — expected: all green.

- [ ] **Step 11: Commit**

```bash
git add scripts/lib/core/git-exec.js scripts/lib/core/ledger-seal.js tests/unit/git-exec.test.js tests/unit/ledger-seal.test.js scripts/lib/command-dispatcher.js
git commit -m "feat(ledger): git-anchored ledger seal + verify-anchoring (closes ADR-0003 gap)"
```

---

## Task 4: Docs + dogfood CI integration

**Files:**
- Modify: `docs/CLI_REFERENCE.md` (add `amber drift`, `amber ledger` sections)
- Modify: `.github/workflows/ci.yml` (add a non-blocking `amber drift` step to dogfood the gate)

**Interfaces:** None (documentation + CI only).

- [ ] **Step 1: Document the three commands**

Append to `docs/CLI_REFERENCE.md` (mirror the existing per-command section style):

```markdown
## amber drift

CI-native drift gate. Aggregates artifact, wiki, and scaffold drift into one
exit code: `0` if no actionable drift, `1` if any. Read-only; no execution.

\`\`\`bash
amber drift --target .                           # human text, exit 0/1
amber drift --target . --json                    # machine envelope (exitCode field)
amber drift --target . --format gh-annotations   # GitHub Actions ::warning lines
amber drift --target . --scope artifact          # one scope only
amber drift --target . --no-fail                 # always exit 0 (informational CI step)
\`\`\`

GitHub Actions snippet (add as a step in any workflow that runs on PRs):

\`\`\`yaml
- name: Amber drift gate
  run: |
    npm install -g amber-protocol
    amber drift --target . --format gh-annotations --no-fail
\`\`\`

## amber ledger

Export, seal, or verify-anchoring for Amber's tamper-evident ledgers.

\`\`\`bash
# SIEM/compliance export (JSON default; csv and otlp-json also valid OTLP)
amber ledger export --target . --format json | otelcol-contrib ...   # pipe to your collector
amber ledger export --target . --format csv --out audits/ledger.csv
amber ledger export --target . --format otlp-json
amber ledger export --target . --home sessions                       # one ledger home

# Git-anchor ledger tail hashes (closes the ADR-0003 full-rewrite gap)
amber ledger seal --target . --reviewer <name>
amber ledger verify-anchoring --target .     # exit 1 if any ledger changed since the last seal
\`\`\`

`export` emits a broken chain as `intact:false` (data, not refusal) and counts it in `brokenCount`. `seal` writes an annotated git tag `amber-ledger-seal-<head-sha>` carrying each ledger's tail hash; forging a ledger then requires rewriting git tag history. No Ed25519 signing yet (deferred per spec §4.3 — key management is its own project).
```

- [ ] **Step 2: Add a non-blocking dogfood step in CI**

In `.github/workflows/ci.yml`, after the existing checkout/setup-node step, add:

```yaml
- name: Amber drift (dogfood, non-blocking)
  run: node scripts/amber.js drift --target . --format gh-annotations --no-fail
  continue-on-error: true
```

`continue-on-error: true` + `--no-fail` keeps this informational for Phase 1 (we are dogfooding on a `product-repo` where some scopes report `n/a`); flip to blocking in a later phase once the repo's own drift baseline is zero.

- [ ] **Step 3: Verify docs render and CI config parses**

Run: `node scripts/amber.js drift --help`
Expected: prints the `Usage:` line and the `COMMAND_HELP.drift` summary.

Run: `node scripts/amber.js ledger --help`
Expected: prints the `Usage:` line and the `COMMAND_HELP.ledger` summary.

Validate CI YAML locally if a parser is available; otherwise rely on the next CI run. (No new dependency — skip if `node -e` YAML parse is unavailable.)

- [ ] **Step 4: Commit**

```bash
git add docs/CLI_REFERENCE.md .github/workflows/ci.yml
git commit -m "docs: document amber drift + amber ledger; dogfood drift gate in CI"
```

---

## Self-review (spec coverage)

- **§4.1 `amber drift` CI gate** → Task 1 (aggregator + gh-annotations + exit semantics + scope flag). ✅
- **§4.2 `amber ledger export`** → Task 2 (json/csv/otlp-json + broken-chain handling + `--home` filter). ✅
- **§4.3 `amber ledger seal` + `verify-anchoring`** → Task 3 (git-anchored tag + tamper detection; Ed25519 explicitly NOT included, deferred per §4.3). ✅
- **§5 boundary compliance** → all three tasks are read-only or write a local git tag; no `--execute`, no policy/approval gate needed (none runs a command). The plan adds no scheduling, no push, no agent dispatch. ✅
- **§7 open questions:**
  - Seal-tag proliferation → resolved: mutable single tag per commit (`-f` force-update on re-seal), latest read via `--sort=-creatordate`. Documented in Task 3 Step 7. ✅
  - `amber drift` default scope → `all`. ✅
  - OTLP field mapping → Task 2 Step 3 specifies the exact span/attribute shape. ✅
  - `walkLedgers` covers loops/routes/sessions → no future-home action needed. ✅
  - Phase-2 adoption signal → not a code task; tracked as a follow-up. ✅
- **§8 success metrics** → covered: three commands shipped with tests + self-checks (Tasks 1-3), dogfood in CI (Task 4 Step 2), OTLP round-trip asserted in Task 2 test, forge-detection asserted in Task 3 test, zero new deps (Global Constraints). ✅

**Placeholder scan:** none. Every step has real code or an exact command with expected output.

**Type/signature consistency:** `runDrift` / `renderDrift` (Task 1) consumed by `handleDrift` with matching options. `exportLedger(target, {format, home})` (Task 2) consumed by `handleLedger` export branch. `sealLedger(target, {reviewer})` / `verifyAnchoring(target)` (Task 3) consumed by the seal/verify-anchoring branches with matching return shapes. `gitRun(targetRoot, args) → {ok, stdout, stderr}` defined in Task 3 Step 3, used in Task 3 Step 7. Names match across task boundaries. ✅

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-05-amber-artifact-first-evidence-layer.md`. The spec (`docs/superpowers/specs/2026-07-05-amber-artifact-first-evidence-layer-design.md`) is approved. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach? (Note: the user's original request stopped at "制定 plan" — confirm before implementing.)
