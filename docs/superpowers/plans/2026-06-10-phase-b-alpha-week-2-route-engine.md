# Phase B Alpha — Week 2: Route Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the route engine — two missing reference routes plus a `route` CLI command group (`list`, `inspect`, `validate`, `test --dry-run`) and a goal-based route selector — wired into `scripts/harness.js`.

**Architecture:** Pure CommonJS modules under `scripts/lib/` that read `routes/*.route.json`, reuse the existing Week 1 `validate-route.js` validator, and return plain strings + exit codes so every subcommand is unit-testable without spawning a process. `scripts/harness.js` registers `route` as a top-level command and dispatches to subcommands via the existing `args._[0]` pattern. No new CLI framework, no new dependencies.

**Tech Stack:** Node.js >= 18.17, CommonJS (`require`/`module.exports`), Node built-in test runner (`node --test`, `node:test` + `node:assert`), `ajv` + `ajv-formats` (already installed, used transitively through `validate-route.js`). No `uuid` (the installed `uuid@14` is ESM-only and must not be `require()`d from these CommonJS modules).

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `routes/bugfix-quick.route.json` | Create | Reference route: reproduce → fix → verify (complexity `simple`, goalPattern matches fix/bug). |
| `routes/refactor-safe.route.json` | Create | Reference route: characterize → refactor → verify (complexity `complex`, goalPattern matches refactor). |
| `scripts/lib/route-loader.js` | Create | Read `routes/` directory, parse + validate every `*.route.json`, return `{ routes, errors }`. Single source of truth for "all routes". |
| `scripts/lib/route-selector.js` | Create | Match a goal string against each route's `trigger.goalPattern`, return best match + confidence score with deterministic tie-breaking. |
| `scripts/lib/route-commands.js` | Create | The four subcommands as pure functions returning `{ text, exitCode }`: `listRoutes`, `inspectRoute`, `validateRouteFile`, `testRoute`. |
| `scripts/harness.js` | Modify | Register `route` in `COMMANDS`, add dispatch block, `commandSummary`, and usage examples. |
| `tests/unit/route-loader.test.js` | Create | Unit tests for the loader. |
| `tests/unit/route-selector.test.js` | Create | 20+ goal scenarios for the selector. |
| `tests/unit/route-commands.test.js` | Create | Unit tests for each of the four subcommand functions. |
| `tests/integration/route-commands.test.js` | Create | Drives the real CLI dispatcher via `spawnSync` and asserts on stdout / exit codes. |
| `tests/fixtures/routes/broken.route.json` | Create | Deliberately-invalid route used to prove `route validate` rejects bad input. |

**Reused, not reimplemented:** `scripts/lib/validate-route.js` (Week 1) is the only route validator. `route-loader.js` and `route-commands.js` both call it. `scripts/lib/harness-core.js` helpers (`parseArgs`, `printResult`) keep the CLI surface identical to existing commands — the `route` dispatch produces a `result` object with `errors`/`warnings` arrays, exactly like every other command.

---

## Conventions locked from the existing codebase

These were read from the repo before writing this plan. Honor them in every step:

- **Test runner:** `package.json` → `"test": "node --test"`. Tests start with `const { describe, it } = require("node:test");` and `const assert = require("assert");`. Use `beforeEach`/`afterEach` from `node:test` for fixtures (see `tests/unit/timeline-writer.test.js`). Do **not** use mocha/jest/chai.
- **Module system:** CommonJS. `const x = require(...)`, `module.exports = ...`.
- **Validator contract:** `validateRoute(routeData)` returns `{ valid: boolean, errors: string[] }` (from `scripts/lib/validate-route.js`).
- **Schema truth:** `schemas/route.schema.json` requires `routeId` (kebab-case `^[a-z0-9-]+$`), `schemaVersion` (const `"1.0.0"`), and `stages` (`minItems: 1`). Stage requires `name` + `type` (`pack|skill|command|gate`). Gate requires `id` (kebab-case) + `type` (`auto|user-approval|step-confirm`). `trigger.goalPattern` is a string; `trigger.complexity` is `simple|medium|complex`.
- **CLI dispatch (`scripts/harness.js`):** top-level commands live in the `COMMANDS` array; subcommands are read from `args._[0]`; per-command help comes from `usage(command)` + `commandSummary(command)`; results are printed by `printResult(result, { json: args.json })`; exit code is `1` when `result.errors.length > 0` else `0`.
- **Integration test pattern:** spawn the CLI with `spawnSync(process.execPath, [path.join(ROOT, "scripts", "harness.js"), ...args], { cwd: ROOT, encoding: "utf8" })` and parse `--json` stdout (see `tests/harness-cli-failures.test.js`).

---

## Task 1: Two missing reference routes

Week 1 created only `routes/feature-standard.route.json`. Week 2 must add the two that were deferred, and both must pass `scripts/lib/validate-route.js`.

**Files:**
- Create: `routes/bugfix-quick.route.json`
- Create: `routes/refactor-safe.route.json`
- Test: (validated via the loader test in Task 2 and the acceptance check at the end; this task verifies them directly via the validator on the command line)

- [ ] **Step 1: Create `routes/bugfix-quick.route.json`**

Create `routes/bugfix-quick.route.json` with exactly this content:

```json
{
  "routeId": "bugfix-quick",
  "schemaVersion": "1.0.0",
  "version": "1.0.0",
  "displayName": "Quick Bug Fix",
  "description": "Short path for fixing a defect: reproduce, fix, then verify",
  "trigger": {
    "goalPattern": "^(fix|resolve|patch|repair)\\s+.*(bug|defect|issue|error|crash)",
    "complexity": "simple"
  },
  "stages": [
    { "name": "reproduce", "displayName": "Reproduce Bug", "type": "skill", "target": "bug-reproduction", "gateAfter": "user-approval-fix" },
    { "name": "fix", "displayName": "Apply Fix", "type": "pack", "target": "tdd-implementation" },
    { "name": "verify", "displayName": "Run Verification", "type": "command", "target": "npm test" }
  ],
  "gates": [
    { "id": "user-approval-fix", "type": "user-approval", "description": "Reproduction confirmed. Proceed to apply the fix?" }
  ]
}
```

- [ ] **Step 2: Verify `bugfix-quick` passes the validator**

Run:

```bash
node -e "const v=require('./scripts/lib/validate-route');const fs=require('fs');console.log(JSON.stringify(v(JSON.parse(fs.readFileSync('routes/bugfix-quick.route.json','utf8')))));"
```

Expected output (exactly):

```
{"valid":true,"errors":[]}
```

- [ ] **Step 3: Create `routes/refactor-safe.route.json`**

Create `routes/refactor-safe.route.json` with exactly this content:

```json
{
  "routeId": "refactor-safe",
  "schemaVersion": "1.0.0",
  "version": "1.0.0",
  "displayName": "Safe Refactor",
  "description": "Refactor under a safety net: characterize behavior, refactor, then verify nothing changed",
  "trigger": {
    "goalPattern": "^(refactor|restructure|clean\\s*up|simplify|extract)\\b",
    "complexity": "complex"
  },
  "stages": [
    { "name": "characterize", "displayName": "Characterize Behavior", "type": "pack", "target": "characterization-tests", "gateAfter": "user-approval-refactor" },
    { "name": "refactor", "displayName": "Refactor Code", "type": "pack", "target": "tdd-implementation", "gateAfter": "user-approval-merge" },
    { "name": "verify", "displayName": "Run Verification", "type": "command", "target": "npm test" }
  ],
  "gates": [
    { "id": "user-approval-refactor", "type": "user-approval", "description": "Characterization tests are green. Proceed to refactor?" },
    { "id": "user-approval-merge", "type": "user-approval", "description": "Refactor complete and tests still green. Approve for merge?" }
  ]
}
```

- [ ] **Step 4: Verify `refactor-safe` passes the validator**

Run:

```bash
node -e "const v=require('./scripts/lib/validate-route');const fs=require('fs');console.log(JSON.stringify(v(JSON.parse(fs.readFileSync('routes/refactor-safe.route.json','utf8')))));"
```

Expected output (exactly):

```
{"valid":true,"errors":[]}
```

- [ ] **Step 5: Commit**

```bash
git add routes/bugfix-quick.route.json routes/refactor-safe.route.json
git commit -m "feat: add bugfix-quick and refactor-safe reference routes"
```

---

## Task 2: Route loader

A single module that finds and loads every route file once, validates each, and returns a typed result. `route-commands.js` and the selector build on this so directory-walking and validation are not duplicated.

**Files:**
- Create: `scripts/lib/route-loader.js`
- Test: `tests/unit/route-loader.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/route-loader.test.js`:

```javascript
const { describe, it } = require("node:test");
const assert = require("assert");
const path = require("path");
const { loadRoutes, loadRouteFile } = require("../../scripts/lib/route-loader");

const ROUTES_DIR = path.join(__dirname, "../../routes");

describe("loadRoutes", () => {
  it("loads all three reference routes from the routes directory", () => {
    const result = loadRoutes(ROUTES_DIR);
    const ids = result.routes.map((r) => r.routeId).sort();
    assert.deepStrictEqual(ids, ["bugfix-quick", "feature-standard", "refactor-safe"]);
  });

  it("returns no errors for the reference routes", () => {
    const result = loadRoutes(ROUTES_DIR);
    assert.deepStrictEqual(result.errors, []);
  });

  it("attaches the source file path to each loaded route", () => {
    const result = loadRoutes(ROUTES_DIR);
    const feature = result.routes.find((r) => r.routeId === "feature-standard");
    assert.ok(feature.filePath.endsWith("feature-standard.route.json"));
  });

  it("returns an empty list and no errors when the directory is missing", () => {
    const result = loadRoutes(path.join(__dirname, "../../does-not-exist"));
    assert.deepStrictEqual(result.routes, []);
    assert.deepStrictEqual(result.errors, []);
  });

  it("ignores files that do not end with .route.json", () => {
    const result = loadRoutes(ROUTES_DIR);
    assert.ok(result.routes.every((r) => r.filePath.endsWith(".route.json")));
  });
});

describe("loadRouteFile", () => {
  it("loads and validates a single route file", () => {
    const file = path.join(ROUTES_DIR, "feature-standard.route.json");
    const result = loadRouteFile(file);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.route.routeId, "feature-standard");
    assert.deepStrictEqual(result.errors, []);
  });

  it("reports a parse error for a non-existent file", () => {
    const result = loadRouteFile(path.join(ROUTES_DIR, "nope.route.json"));
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.strictEqual(result.route, null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/unit/route-loader.test.js
```

Expected: FAIL — `Cannot find module '../../scripts/lib/route-loader'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/route-loader.js`:

```javascript
"use strict";

const fs = require("fs");
const path = require("path");
const validateRoute = require("./validate-route");

const ROUTE_FILE_SUFFIX = ".route.json";

function loadRouteFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return { valid: false, route: null, filePath, errors: [`Cannot read ${filePath}: ${err.message}`] };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { valid: false, route: null, filePath, errors: [`Invalid JSON in ${filePath}: ${err.message}`] };
  }

  const { valid, errors } = validateRoute(parsed);
  return { valid, route: valid ? parsed : null, filePath, errors };
}

function listRouteFiles(routesDir) {
  if (!fs.existsSync(routesDir)) {
    return [];
  }
  return fs
    .readdirSync(routesDir)
    .filter((name) => name.endsWith(ROUTE_FILE_SUFFIX))
    .sort()
    .map((name) => path.join(routesDir, name));
}

function loadRoutes(routesDir) {
  const routes = [];
  const errors = [];

  for (const filePath of listRouteFiles(routesDir)) {
    const result = loadRouteFile(filePath);
    if (result.valid) {
      routes.push({ ...result.route, filePath });
    } else {
      errors.push(...result.errors);
    }
  }

  return { routes, errors };
}

module.exports = { loadRoutes, loadRouteFile, ROUTE_FILE_SUFFIX };
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/unit/route-loader.test.js
```

Expected: PASS — `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/route-loader.js tests/unit/route-loader.test.js
git commit -m "feat: add route loader with validation"
```

---

## Task 3: Route selector

Given a goal string, test it against each route's `trigger.goalPattern` (a regex string) and return the best match plus a confidence score. Tie-breaking must be deterministic: higher confidence wins; on equal confidence, the more specific pattern (longer source) wins; on a further tie, the lexicographically smaller `routeId` wins.

**Files:**
- Create: `scripts/lib/route-selector.js`
- Test: `tests/unit/route-selector.test.js`

- [ ] **Step 1: Write the failing test (20+ goal scenarios)**

Create `tests/unit/route-selector.test.js`:

```javascript
const { describe, it } = require("node:test");
const assert = require("assert");
const path = require("path");
const { selectRoute, scoreRoutes } = require("../../scripts/lib/route-selector");
const { loadRoutes } = require("../../scripts/lib/route-loader");

const ROUTES = loadRoutes(path.join(__dirname, "../../routes")).routes;

function pick(goal) {
  return selectRoute(goal, ROUTES);
}

describe("selectRoute — feature goals", () => {
  it("routes 'implement a new export feature' to feature-standard", () => {
    assert.strictEqual(pick("implement a new export feature").routeId, "feature-standard");
  });
  it("routes 'add a billing feature' to feature-standard", () => {
    assert.strictEqual(pick("add a billing feature").routeId, "feature-standard");
  });
  it("routes 'build the reporting feature' to feature-standard", () => {
    assert.strictEqual(pick("build the reporting feature").routeId, "feature-standard");
  });
  it("routes 'create a dashboard feature' to feature-standard", () => {
    assert.strictEqual(pick("create a dashboard feature").routeId, "feature-standard");
  });
});

describe("selectRoute — bugfix goals", () => {
  it("routes 'fix the login bug' to bugfix-quick", () => {
    assert.strictEqual(pick("fix the login bug").routeId, "bugfix-quick");
  });
  it("routes 'resolve crash on startup' to bugfix-quick", () => {
    assert.strictEqual(pick("resolve crash on startup").routeId, "bugfix-quick");
  });
  it("routes 'patch the null pointer error' to bugfix-quick", () => {
    assert.strictEqual(pick("patch the null pointer error").routeId, "bugfix-quick");
  });
  it("routes 'repair the broken export defect' to bugfix-quick", () => {
    assert.strictEqual(pick("repair the broken export defect").routeId, "bugfix-quick");
  });
  it("routes 'fix the timeout issue' to bugfix-quick", () => {
    assert.strictEqual(pick("fix the timeout issue").routeId, "bugfix-quick");
  });
});

describe("selectRoute — refactor goals", () => {
  it("routes 'refactor the auth module' to refactor-safe", () => {
    assert.strictEqual(pick("refactor the auth module").routeId, "refactor-safe");
  });
  it("routes 'restructure the payment service' to refactor-safe", () => {
    assert.strictEqual(pick("restructure the payment service").routeId, "refactor-safe");
  });
  it("routes 'clean up the parser' to refactor-safe", () => {
    assert.strictEqual(pick("clean up the parser").routeId, "refactor-safe");
  });
  it("routes 'simplify the router' to refactor-safe", () => {
    assert.strictEqual(pick("simplify the router").routeId, "refactor-safe");
  });
  it("routes 'extract the validation helper' to refactor-safe", () => {
    assert.strictEqual(pick("extract the validation helper").routeId, "refactor-safe");
  });
});

describe("selectRoute — confidence and shape", () => {
  it("returns a confidence between 0 and 1 for a match", () => {
    const match = pick("fix the login bug");
    assert.ok(match.confidence > 0 && match.confidence <= 1);
  });
  it("returns matched=true for a matching goal", () => {
    assert.strictEqual(pick("fix the login bug").matched, true);
  });
  it("includes the route displayName on a match", () => {
    assert.strictEqual(pick("add a billing feature").displayName, "Standard Feature Development");
  });
});

describe("selectRoute — no match", () => {
  it("returns matched=false for an unrelated goal", () => {
    const match = pick("write the quarterly report");
    assert.strictEqual(match.matched, false);
    assert.strictEqual(match.routeId, null);
    assert.strictEqual(match.confidence, 0);
  });
  it("returns matched=false for an empty goal", () => {
    assert.strictEqual(pick("").matched, false);
  });
  it("returns matched=false when no routes are provided", () => {
    assert.strictEqual(selectRoute("fix the bug", []).matched, false);
  });
});

describe("selectRoute — input validation", () => {
  it("throws a TypeError when goal is not a string", () => {
    assert.throws(() => selectRoute(42, ROUTES), TypeError);
  });
  it("throws a TypeError when routes is not an array", () => {
    assert.throws(() => selectRoute("fix the bug", null), TypeError);
  });
});

describe("scoreRoutes — deterministic ordering", () => {
  it("ranks all matching routes and is sorted by descending confidence", () => {
    const scored = scoreRoutes("fix the login bug", ROUTES);
    for (let i = 1; i < scored.length; i += 1) {
      assert.ok(scored[i - 1].confidence >= scored[i].confidence);
    }
  });

  it("breaks confidence ties by longer pattern then routeId", () => {
    const routes = [
      { routeId: "z-short", trigger: { goalPattern: "^do" } },
      { routeId: "a-long", trigger: { goalPattern: "^do\\s+it" } },
      { routeId: "b-long", trigger: { goalPattern: "^do\\s+it" } }
    ];
    const scored = scoreRoutes("do it now", routes);
    assert.strictEqual(scored[0].routeId, "a-long");
    assert.strictEqual(scored[1].routeId, "b-long");
    assert.strictEqual(scored[2].routeId, "z-short");
  });

  it("skips routes without a goalPattern", () => {
    const routes = [
      { routeId: "no-trigger" },
      { routeId: "has-trigger", trigger: { goalPattern: "^go" } }
    ];
    const scored = scoreRoutes("go now", routes);
    assert.strictEqual(scored.length, 1);
    assert.strictEqual(scored[0].routeId, "has-trigger");
  });

  it("ignores routes whose goalPattern is an invalid regex", () => {
    const routes = [
      { routeId: "broken-regex", trigger: { goalPattern: "([unterminated" } },
      { routeId: "good-regex", trigger: { goalPattern: "^go" } }
    ];
    const scored = scoreRoutes("go now", routes);
    assert.strictEqual(scored.length, 1);
    assert.strictEqual(scored[0].routeId, "good-regex");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/unit/route-selector.test.js
```

Expected: FAIL — `Cannot find module '../../scripts/lib/route-selector'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/route-selector.js`:

```javascript
"use strict";

const MATCH_WEIGHT = 0.6;
const COVERAGE_WEIGHT = 0.4;

function compilePattern(route) {
  const pattern = route && route.trigger && route.trigger.goalPattern;
  if (typeof pattern !== "string" || pattern.length === 0) {
    return null;
  }
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function confidenceFor(goal, regex, match) {
  const matchedText = match[0] || "";
  const coverage = goal.length > 0 ? matchedText.length / goal.length : 0;
  const bounded = Math.min(1, Math.max(0, coverage));
  const score = MATCH_WEIGHT + COVERAGE_WEIGHT * bounded;
  return Math.round(Math.min(1, score) * 1000) / 1000;
}

function scoreRoutes(goal, routes) {
  if (typeof goal !== "string") {
    throw new TypeError("goal must be a string");
  }
  if (!Array.isArray(routes)) {
    throw new TypeError("routes must be an array");
  }

  const scored = [];
  for (const route of routes) {
    const regex = compilePattern(route);
    if (!regex) {
      continue;
    }
    const match = goal.match(regex);
    if (!match) {
      continue;
    }
    scored.push({
      routeId: route.routeId,
      displayName: route.displayName || route.routeId,
      confidence: confidenceFor(goal, regex, match),
      patternLength: route.trigger.goalPattern.length
    });
  }

  scored.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    if (b.patternLength !== a.patternLength) {
      return b.patternLength - a.patternLength;
    }
    return a.routeId < b.routeId ? -1 : a.routeId > b.routeId ? 1 : 0;
  });

  return scored;
}

function selectRoute(goal, routes) {
  const scored = scoreRoutes(goal, routes);
  if (scored.length === 0) {
    return { matched: false, routeId: null, displayName: null, confidence: 0, candidates: [] };
  }
  const best = scored[0];
  return {
    matched: true,
    routeId: best.routeId,
    displayName: best.displayName,
    confidence: best.confidence,
    candidates: scored
  };
}

module.exports = { selectRoute, scoreRoutes };
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/unit/route-selector.test.js
```

Expected: PASS — `# pass 26`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/route-selector.js tests/unit/route-selector.test.js
git commit -m "feat: add goal-based route selector with deterministic tie-breaking"
```

---

## Task 4: Broken-route test fixture

The `route validate` acceptance criterion requires proving the command rejects a deliberately-broken route. Create the fixture now so Tasks 5 and the integration test can both use it.

**Files:**
- Create: `tests/fixtures/routes/broken.route.json`

- [ ] **Step 1: Create the broken fixture**

Create `tests/fixtures/routes/broken.route.json`. It is invalid on three counts: `routeId` is not kebab-case (uppercase + space), `schemaVersion` is wrong, and `stages` is empty (violates `minItems: 1`).

```json
{
  "routeId": "Broken Route",
  "schemaVersion": "0.9.0",
  "version": "1.0.0",
  "displayName": "Deliberately Broken Route",
  "description": "Used by tests to prove validation rejects malformed routes",
  "stages": []
}
```

- [ ] **Step 2: Confirm the fixture is actually rejected by the validator**

Run:

```bash
node -e "const v=require('./scripts/lib/validate-route');const fs=require('fs');const r=v(JSON.parse(fs.readFileSync('tests/fixtures/routes/broken.route.json','utf8')));console.log('valid:',r.valid,'| firstError:',r.errors[0]);"
```

Expected output (exactly):

```
valid: false | firstError: /routeId must match pattern "^[a-z0-9-]+$"
```

Note: the Week 1 validator constructs `ajv` with default options (`allErrors` is off), so it reports only the **first** schema violation and stops. The fixture is broken on three counts (bad `routeId`, wrong `schemaVersion`, empty `stages`) for robustness, but the validator surfaces just the first one. Tests assert `valid === false` and that the message mentions `routeId` — they do not depend on the error count.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/routes/broken.route.json
git commit -m "test: add deliberately-broken route fixture"
```

---

## Task 5: Route command functions

Implement the four subcommands as pure functions in `scripts/lib/route-commands.js`. Each returns `{ text: string, exitCode: number }` so they are unit-testable without a process. `listRoutes` and `testRoute`/`inspectRoute` read from the loader; `validateRouteFile` reuses `loadRouteFile` (which reuses `validate-route.js`).

**Files:**
- Create: `scripts/lib/route-commands.js`
- Test: `tests/unit/route-commands.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/route-commands.test.js`:

```javascript
const { describe, it } = require("node:test");
const assert = require("assert");
const path = require("path");
const {
  listRoutes,
  inspectRoute,
  validateRouteFile,
  testRoute
} = require("../../scripts/lib/route-commands");

const ROUTES_DIR = path.join(__dirname, "../../routes");
const BROKEN = path.join(__dirname, "../fixtures/routes/broken.route.json");

describe("listRoutes", () => {
  it("lists all three reference routes with id, version, and stage count", () => {
    const { text, exitCode } = listRoutes(ROUTES_DIR);
    assert.strictEqual(exitCode, 0);
    assert.match(text, /feature-standard/);
    assert.match(text, /bugfix-quick/);
    assert.match(text, /refactor-safe/);
  });

  it("shows the stage count for a known route", () => {
    const { text } = listRoutes(ROUTES_DIR);
    // feature-standard has 4 stages
    assert.match(text, /feature-standard.*\b4 stages\b/);
  });

  it("returns exitCode 0 and a message when no routes exist", () => {
    const { text, exitCode } = listRoutes(path.join(__dirname, "../../no-routes-here"));
    assert.strictEqual(exitCode, 0);
    assert.match(text, /No routes found/);
  });
});

describe("inspectRoute", () => {
  it("prints the full JSON of a route by id", () => {
    const { text, exitCode } = inspectRoute("feature-standard", ROUTES_DIR);
    assert.strictEqual(exitCode, 0);
    const jsonStart = text.indexOf("{");
    const parsed = JSON.parse(text.slice(jsonStart, text.lastIndexOf("}") + 1));
    assert.strictEqual(parsed.routeId, "feature-standard");
  });

  it("renders a stage tree with gate annotations", () => {
    const { text } = inspectRoute("feature-standard", ROUTES_DIR);
    assert.match(text, /capture/);
    assert.match(text, /gate: user-approval-plan/);
  });

  it("returns exitCode 1 for an unknown route id", () => {
    const { text, exitCode } = inspectRoute("does-not-exist", ROUTES_DIR);
    assert.strictEqual(exitCode, 1);
    assert.match(text, /not found/);
  });
});

describe("validateRouteFile", () => {
  it("reports a valid route with exitCode 0", () => {
    const { text, exitCode } = validateRouteFile(path.join(ROUTES_DIR, "feature-standard.route.json"));
    assert.strictEqual(exitCode, 0);
    assert.match(text, /VALID/);
  });

  it("reports an invalid route with exitCode 1 and lists errors", () => {
    const { text, exitCode } = validateRouteFile(BROKEN);
    assert.strictEqual(exitCode, 1);
    assert.match(text, /INVALID/);
    assert.match(text, /routeId/);
  });

  it("returns exitCode 1 when no file path is given", () => {
    const { text, exitCode } = validateRouteFile("");
    assert.strictEqual(exitCode, 1);
    assert.match(text, /requires a file path/);
  });
});

describe("testRoute (dry-run)", () => {
  it("prints the ordered stage sequence for a route", () => {
    const { text, exitCode } = testRoute("bugfix-quick", ROUTES_DIR);
    assert.strictEqual(exitCode, 0);
    assert.match(text, /1\. reproduce/);
    assert.match(text, /2\. fix/);
    assert.match(text, /3\. verify/);
  });

  it("marks where gates fire", () => {
    const { text } = testRoute("bugfix-quick", ROUTES_DIR);
    assert.match(text, /GATE user-approval-fix fires after reproduce/);
  });

  it("returns exitCode 1 for an unknown route id", () => {
    const { exitCode } = testRoute("nope", ROUTES_DIR);
    assert.strictEqual(exitCode, 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/unit/route-commands.test.js
```

Expected: FAIL — `Cannot find module '../../scripts/lib/route-commands'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/route-commands.js`:

```javascript
"use strict";

const path = require("path");
const { loadRoutes, loadRouteFile } = require("./route-loader");

const DEFAULT_ROUTES_DIR = path.join(__dirname, "../../routes");

function stageCount(route) {
  return Array.isArray(route.stages) ? route.stages.length : 0;
}

function findRoute(routeId, routesDir) {
  const { routes } = loadRoutes(routesDir);
  return routes.find((r) => r.routeId === routeId) || null;
}

function listRoutes(routesDir = DEFAULT_ROUTES_DIR) {
  const { routes } = loadRoutes(routesDir);
  if (routes.length === 0) {
    return { text: "No routes found.", exitCode: 0 };
  }

  const lines = ["Available routes:"];
  for (const route of routes) {
    const version = route.version || "0.0.0";
    const description = route.description || "";
    lines.push(`  ${route.routeId} (v${version}) — ${stageCount(route)} stages — ${description}`);
  }
  return { text: lines.join("\n"), exitCode: 0 };
}

function renderStageTree(route) {
  const gatesById = new Map((route.gates || []).map((g) => [g.id, g]));
  const lines = [];
  route.stages.forEach((stage, index) => {
    const branch = index === route.stages.length - 1 ? "└─" : "├─";
    lines.push(`  ${branch} ${stage.name} [${stage.type}${stage.target ? `: ${stage.target}` : ""}]`);
    if (stage.gateAfter) {
      const gate = gatesById.get(stage.gateAfter);
      const gateType = gate ? gate.type : "unknown";
      lines.push(`       gate: ${stage.gateAfter} (${gateType})`);
    }
  });
  return lines.join("\n");
}

function inspectRoute(routeId, routesDir = DEFAULT_ROUTES_DIR) {
  const route = findRoute(routeId, routesDir);
  if (!route) {
    return { text: `Route "${routeId}" not found.`, exitCode: 1 };
  }

  const { filePath, ...clean } = route;
  const lines = [
    `Route: ${route.routeId}`,
    "",
    "Stage tree:",
    renderStageTree(route),
    "",
    "Full definition:",
    JSON.stringify(clean, null, 2)
  ];
  return { text: lines.join("\n"), exitCode: 0 };
}

function validateRouteFile(filePath) {
  if (!filePath) {
    return { text: "route validate requires a file path.", exitCode: 1 };
  }

  const result = loadRouteFile(filePath);
  if (result.valid) {
    return { text: `VALID: ${filePath}`, exitCode: 0 };
  }

  const lines = [`INVALID: ${filePath}`, "Errors:"];
  for (const error of result.errors) {
    lines.push(`  - ${error}`);
  }
  return { text: lines.join("\n"), exitCode: 1 };
}

function testRoute(routeId, routesDir = DEFAULT_ROUTES_DIR) {
  const route = findRoute(routeId, routesDir);
  if (!route) {
    return { text: `Route "${routeId}" not found.`, exitCode: 1 };
  }

  const lines = [`Dry-run for route: ${route.routeId}`, "Stage sequence:"];
  route.stages.forEach((stage, index) => {
    lines.push(`  ${index + 1}. ${stage.name} [${stage.type}]`);
    if (stage.gateAfter) {
      lines.push(`     >> GATE ${stage.gateAfter} fires after ${stage.name}`);
    }
  });
  lines.push("No execution performed (dry-run).");
  return { text: lines.join("\n"), exitCode: 0 };
}

module.exports = { listRoutes, inspectRoute, validateRouteFile, testRoute };
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --test tests/unit/route-commands.test.js
```

Expected: PASS — `# pass 12`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/route-commands.js tests/unit/route-commands.test.js
git commit -m "feat: add route command functions (list, inspect, validate, test)"
```

---

## Task 6: Integrate `route` into `scripts/harness.js`

Register `route` as a top-level command following the exact dispatch pattern already used by `pack`, `profile`, `loop`, etc.: read the subcommand from `args._[0]`, call the matching function from `route-commands.js`, and wrap its `{ text, exitCode }` into the standard result shape so `printResult` and the existing exit-code logic work unchanged.

**Files:**
- Modify: `scripts/harness.js` (require block; `COMMANDS`; `commandSummary`; usage examples; dispatch chain; result printing)

- [ ] **Step 1: Add the require for the route command functions**

In `scripts/harness.js`, the file currently starts by destructuring from `./lib/harness-core`. Add a second `require` immediately after that destructuring block (after the line `} = require("./lib/harness-core");`):

```javascript
const {
  listRoutes,
  inspectRoute,
  validateRouteFile,
  testRoute,
} = require("./lib/route-commands");
```

- [ ] **Step 2: Register `route` in the COMMANDS array**

Find this line:

```javascript
const COMMANDS = ["init", "audit", "wiki", "doctor", "handoff", "plan", "gate", "review", "accept", "pack", "profile", "task", "result", "agent", "team", "maintenance", "adoption", "loop"];
```

Replace it with (adds `"route"`):

```javascript
const COMMANDS = ["init", "audit", "wiki", "doctor", "handoff", "plan", "gate", "review", "accept", "pack", "profile", "task", "result", "agent", "team", "maintenance", "adoption", "loop", "route"];
```

- [ ] **Step 3: Add a command summary for `route`**

In `commandSummary(command)`, add this block immediately before the final `return "Run Coding Harness command.";` line:

```javascript
  if (command === "route") {
    return [
      "Inspect, validate, and dry-run delivery routes from routes/*.route.json.",
      "",
      "Subcommands:",
      "  list                 List all routes (id, version, stage count).",
      "  inspect <id>         Print a route's stage tree and full JSON.",
      "  validate <file>      Validate a route file; non-zero exit on invalid.",
      "  test <id> --dry-run  Print the ordered stage sequence and gate points.",
      "",
      "Examples:",
      "  node scripts/harness.js route list",
      "  node scripts/harness.js route inspect feature-standard",
      "  node scripts/harness.js route validate routes/feature-standard.route.json",
      "  node scripts/harness.js route test bugfix-quick --dry-run"
    ].join("\n");
  }
```

- [ ] **Step 4: Add the dispatch block**

In `run(...)`, find the `loop` dispatch chain. Immediately after the closing brace of the `} else if (command === "loop") { ... }` block and before `} else if (command === "team") {`, insert this new branch:

```javascript
  } else if (command === "route") {
    const action = args._ && args._[0];
    let routeResult;
    if (action === "list") {
      routeResult = listRoutes();
    } else if (action === "inspect") {
      routeResult = inspectRoute(args._[1] || "");
    } else if (action === "validate") {
      routeResult = validateRouteFile(args._[1] || args.file || "");
    } else if (action === "test") {
      routeResult = testRoute(args._[1] || "");
    } else {
      routeResult = { text: "route requires list, inspect, validate, or test.", exitCode: 1 };
    }
    result = {
      target: args.target,
      text: routeResult.text,
      errors: routeResult.exitCode === 0 ? [] : [routeResult.text],
      warnings: []
    };
    if (!args.json) {
      console.log(routeResult.text);
      return routeResult.exitCode;
    }
    printResult(result, { json: true });
    return routeResult.exitCode;
```

Note: for `route`, plain-text output is printed directly (the subcommand already formats it), and the function returns the subcommand's own exit code. The `--json` path emits the standard `{ target, text, errors, warnings }` envelope via `printResult`, matching every other command's JSON shape and the `errors.length > 0 → exit 1` contract.

- [ ] **Step 5: Add usage examples**

In `usage()` (the no-argument form), find the `"Examples:"` block and add these two lines at the end of the examples array, immediately before the closing `].join("\n")` of that array (after the last `adoption selected-files ...` example line):

```javascript
    ,"  node scripts/harness.js route list"
    ,"  node scripts/harness.js route inspect feature-standard"
```

(The leading commas keep the array valid since they are appended after the final existing element.)

- [ ] **Step 6: Smoke-test the new command manually**

Run:

```bash
node scripts/harness.js route list
```

Expected output (order of the three routes is alphabetical by filename):

```
Available routes:
  bugfix-quick (v1.0.0) — 3 stages — Short path for fixing a defect: reproduce, fix, then verify
  feature-standard (v1.0.0) — 4 stages — Complete feature delivery with planning and review
  refactor-safe (v1.0.0) — 3 stages — Refactor under a safety net: characterize behavior, refactor, then verify nothing changed
```

- [ ] **Step 7: Smoke-test validate exit code on the broken fixture**

Run:

```bash
node scripts/harness.js route validate tests/fixtures/routes/broken.route.json; echo "exit=$?"
```

Expected output (the validator reports the first violation only — see Task 4 Step 2 — and exits 1):

```
INVALID: tests/fixtures/routes/broken.route.json
Errors:
  - /routeId must match pattern "^[a-z0-9-]+$"
exit=1
```

- [ ] **Step 8: Smoke-test the help text**

Run:

```bash
node scripts/harness.js route --help
```

Expected: prints `Usage: node scripts/harness.js route --target <repo> [--json]` followed by the subcommand summary from Step 3 (the lines listing `list`, `inspect`, `validate`, `test`).

- [ ] **Step 9: Commit**

```bash
git add scripts/harness.js
git commit -m "feat: integrate route command group into harness CLI"
```

---

## Task 7: Integration test driving the dispatcher

Prove the wired-up CLI works end-to-end by spawning the real `harness.js` process, mirroring the `spawnSync` pattern from `tests/harness-cli-failures.test.js`.

**Files:**
- Create: `tests/integration/route-commands.test.js`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/route-commands.test.js`:

```javascript
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");

function runHarness(args) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", "harness.js"), ...args], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

test("route list shows all three reference routes and exits 0", () => {
  const result = runHarness(["route", "list"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /feature-standard/);
  assert.match(result.stdout, /bugfix-quick/);
  assert.match(result.stdout, /refactor-safe/);
});

test("route inspect feature-standard outputs parseable full JSON", () => {
  const result = runHarness(["route", "inspect", "feature-standard"]);
  assert.equal(result.status, 0);
  const jsonStart = result.stdout.indexOf("{");
  const jsonEnd = result.stdout.lastIndexOf("}") + 1;
  const parsed = JSON.parse(result.stdout.slice(jsonStart, jsonEnd));
  assert.equal(parsed.routeId, "feature-standard");
  assert.ok(Array.isArray(parsed.stages));
});

test("route validate rejects the broken fixture with non-zero exit", () => {
  const result = runHarness(["route", "validate", "tests/fixtures/routes/broken.route.json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /INVALID/);
});

test("route validate accepts a valid reference route with exit 0", () => {
  const result = runHarness(["route", "validate", "routes/feature-standard.route.json"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /VALID/);
});

test("route test --dry-run prints the ordered stage sequence", () => {
  const result = runHarness(["route", "test", "refactor-safe", "--dry-run"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1\. characterize/);
  assert.match(result.stdout, /2\. refactor/);
  assert.match(result.stdout, /3\. verify/);
});

test("route --json emits a standard envelope with an errors array", () => {
  const result = runHarness(["route", "validate", "tests/fixtures/routes/broken.route.json", "--json"]);
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payload.errors));
  assert.ok(payload.errors.length > 0);
});

test("unknown route subcommand exits non-zero", () => {
  const result = runHarness(["route", "frobnicate"]);
  assert.notEqual(result.status, 0);
});
```

- [ ] **Step 2: Run the test to verify it passes**

Because Task 6 already wired the command, this integration test should pass on first run. Run:

```bash
node --test tests/integration/route-commands.test.js
```

Expected: PASS — `# pass 7`, `# fail 0`.

(If it fails with "module not found" for the route-commands require, re-check Task 6 Step 1. If `route list` shows fewer than three routes, re-check Task 1.)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/route-commands.test.js
git commit -m "test: add route command integration test driving the CLI dispatcher"
```

---

## Task 8: Full suite green + coverage check

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run:

```bash
node --test
```

Expected: all suites pass, including the pre-existing Week 1 tests and the new Week 2 tests. `# fail 0`.

- [ ] **Step 2: Run only the Week 2 unit + integration tests together**

Run:

```bash
node --test tests/unit/route-loader.test.js tests/unit/route-selector.test.js tests/unit/route-commands.test.js tests/integration/route-commands.test.js
```

Expected: `# pass 52`, `# fail 0` (7 loader + 26 selector + 12 commands + 7 integration).

- [ ] **Step 3: Spot-check coverage of the new modules**

Run:

```bash
node --test --experimental-test-coverage tests/unit/route-loader.test.js tests/unit/route-selector.test.js tests/unit/route-commands.test.js
```

Expected: the coverage table lists `route-loader.js`, `route-selector.js`, and `route-commands.js` each at **≥ 80%** line coverage. If any module is below 80%, add a focused test for the uncovered branch (e.g., the missing-directory path in the loader, or the invalid-regex path in the selector) and re-run.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: week 2 route engine complete — all tests green"
```

---

## Week 2 Acceptance

Each acceptance criterion from `docs/wiki/PHASE_B_ALPHA_TASKS.md` (Week 2 验收) mapped to the task and test that proves it:

| Acceptance criterion | Proven by |
|----------------------|-----------|
| `route list` 显示所有 3 条参考 route (`route list` shows all 3 reference routes) | Task 1 (creates bugfix-quick + refactor-safe), Task 5 `listRoutes` test "lists all three reference routes…", Task 7 integration test "route list shows all three reference routes and exits 0". Manual check: Task 6 Step 6. |
| `route inspect feature-standard` 输出完整 JSON (outputs full JSON) | Task 5 `inspectRoute` test "prints the full JSON of a route by id", Task 7 integration test "route inspect feature-standard outputs parseable full JSON". |
| `route validate` 能检测出故意的错误 route (detects a deliberately-broken route) | Task 4 (broken fixture `tests/fixtures/routes/broken.route.json`), Task 5 `validateRouteFile` test "reports an invalid route with exitCode 1…", Task 7 integration test "route validate rejects the broken fixture with non-zero exit". Manual check: Task 6 Step 7. |
| 路由选择器对 20+ goal 测试全部通过 (route-selector passes 20+ goal test cases) | Task 3 `route-selector.test.js` contains 26 `it(...)` cases (13 positive route assignments across feature/bugfix/refactor + confidence/shape + no-match + validation + deterministic ordering), all asserted against the real reference routes. |

**Deliverables (交付物) checklist:**
- [ ] `route` command group (4 subcommands) — Tasks 5 + 6
- [ ] Route selector with tests — Task 3
- [ ] CLI integration + docs (help text) — Task 6 (Steps 3, 5, 8) + Task 7
- [ ] Two missing reference routes conforming to `schemas/route.schema.json` — Task 1

**Implementation note (harness.js integration):** The `route` command intentionally prints subcommand-formatted plain text directly and returns the subcommand's own exit code, rather than routing through the generic `printResult` text branch. This is because subcommand output (stage trees, JSON dumps) is already fully formatted, whereas `printResult`'s non-JSON branches assume the audit/scaffold result shapes. The `--json` path still emits the standard `{ target, text, errors, warnings }` envelope so JSON consumers and the `errors.length > 0 → exit 1` contract remain identical to every other command.
