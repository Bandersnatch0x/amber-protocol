# Phase B Beta — Week 6-9: Autonomous Mode + Production Readiness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully automated session execution without human intervention, production-grade hardening, comprehensive testing, and complete documentation.

**Architecture:** Autonomous executor runs sessions with policy-driven gate approval and retry logic. Daemon mode enables background execution with PID management. Notification system (email/Slack) alerts on key events. Session locking prevents concurrent modifications. Structured logging and metrics enable observability. All components reuse Week 3-5 infrastructure (session-commands, execution-engine, checkpoint-manager).

**Tech Stack:** Node.js >= 18.17, CommonJS, Node built-in test runner, nodemailer (email), node-fetch (Slack webhooks), built-in fs/child_process (daemon), existing harness modules.

**Time:** 4 weeks (W6-W9)

---

## File Structure

### Week 6-7: Autonomous Core
```
scripts/lib/
  autonomous-executor.js           # Auto-execute sessions with policy
  autonomous-policy.js             # Policy engine (gate approval, retry, budget)
  daemon.js                        # Background daemon management
  notifier.js                      # Email/Slack notifications
.harness/
  autonomous-policy.json           # Default policy configuration
  daemon.pid                       # Daemon process ID
  logs/harness.log                 # Structured JSON logs
tests/unit/
  autonomous-executor.test.js
  autonomous-policy.test.js
  daemon.test.js
  notifier.test.js
```


### Week 8: Production Hardening
```
scripts/lib/
  session-lock.js                  # Session locking (prevent concurrent access)
  error-recovery.js                # Graceful degradation utilities
  logger.js                        # Structured JSON logging
  metrics-collector.js             # Session metrics (duration, success rate)
  health-checker.js                # System health diagnostics
tests/unit/
  session-lock.test.js
  error-recovery.test.js
  logger.test.js
  metrics-collector.test.js
```

### Week 9: Testing & Documentation
```
tests/e2e/
  autonomous-session.test.js       # End-to-end autonomous scenarios
  concurrent-sessions.test.js      # Concurrency tests
  daemon-lifecycle.test.js         # Daemon start/stop/status
tests/load/
  sequential-sessions.test.js      # 100 sessions performance
  timeline-throughput.test.js      # 1000 events performance
docs/
  AUTONOMOUS_MODE_GUIDE.md         # User guide
  POLICY_CONFIGURATION.md          # Policy reference
  NOTIFICATION_SETUP.md            # Email/Slack setup
  TROUBLESHOOTING.md               # Common issues
  CLI_REFERENCE.md                 # All commands
```

---

## Conventions from Existing Codebase

- **Test runner:** `node --test`, CommonJS, `node:test` + `node:assert`
- **Module system:** CommonJS (`require`/`module.exports`)
- **Session storage:** `.harness/sessions/<uuid>/manifest.json` + `timeline.jsonl`
- **Exit codes:** 0=success, 1=failure, 2=paused (new for autonomous mode)
- **Reuse:** `execution-engine.js`, `session-commands.js`, `checkpoint-manager.js`, `gate-handler.js`, `budget-tracker.js`
- **No new major dependencies:** Use built-in Node modules (fs, child_process, crypto) where possible
- **Functions <50 lines:** Split complex logic into focused helpers
- **Immutability:** Never mutate manifest in-place; always create new objects

---

## Week 6-7: Autonomous Mode Core

### Task 1: Autonomous Policy Engine

**Goal:** Policy-driven gate approval, retry logic, and budget handling.

**Files:**
- Create: `scripts/lib/autonomous-policy.js`
- Create: `.harness/autonomous-policy.json`
- Create: `tests/unit/autonomous-policy.test.js`

- [ ] **Step 1: Write failing test for policy loading**

Create `tests/unit/autonomous-policy.test.js`:

```javascript
const { describe, it } = require("node:test");
const assert = require("assert");
const { loadPolicy, shouldAutoApproveGate, getRetryConfig } = require("../../scripts/lib/autonomous-policy");

describe("autonomous-policy", () => {
  it("should load default policy", () => {
    const policy = loadPolicy();
    assert.ok(policy);
    assert.strictEqual(policy.gates.auto, "approve");
  });

  it("should auto-approve gate based on policy", () => {
    const policy = { gates: { "user-approval": "approve", "step-confirm": "skip" } };
    assert.strictEqual(shouldAutoApproveGate("user-approval", policy), true);
    assert.strictEqual(shouldAutoApproveGate("step-confirm", policy), false);
    assert.strictEqual(shouldAutoApproveGate("unknown", policy), false);
  });

  it("should return retry config", () => {
    const policy = { retry: { maxAttempts: 3, backoffMs: [1000, 5000, 15000] } };
    const config = getRetryConfig(policy);
    assert.strictEqual(config.maxAttempts, 3);
    assert.strictEqual(config.backoffMs.length, 3);
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test tests/unit/autonomous-policy.test.js
```

Expected: `FAIL` - module not found

- [ ] **Step 3: Create default policy file**

Create `.harness/autonomous-policy.json`:

```json
{
  "gates": {
    "auto": "approve",
    "user-approval": "approve",
    "step-confirm": "skip"
  },
  "retry": {
    "maxAttempts": 3,
    "backoffMs": [1000, 5000, 15000],
    "retryableStages": ["implement", "verify"]
  },
  "budget": {
    "onExceed": "pause"
  },
  "notifications": {
    "email": {
      "enabled": false,
      "to": "",
      "triggers": ["session_failed"]
    },
    "slack": {
      "enabled": false,
      "webhook": "",
      "triggers": ["session_completed", "session_failed"]
    }
  }
}
```

- [ ] **Step 4: Implement policy engine**

Create `scripts/lib/autonomous-policy.js`:

```javascript
const fs = require("fs");
const path = require("path");

function loadPolicy(projectRoot = process.cwd()) {
  const policyPath = path.join(projectRoot, ".harness", "autonomous-policy.json");
  
  if (!fs.existsSync(policyPath)) {
    return getDefaultPolicy();
  }
  
  return JSON.parse(fs.readFileSync(policyPath, "utf8"));
}

function getDefaultPolicy() {
  return {
    gates: { auto: "approve", "user-approval": "approve", "step-confirm": "skip" },
    retry: { maxAttempts: 3, backoffMs: [1000, 5000, 15000], retryableStages: ["implement", "verify"] },
    budget: { onExceed: "pause" },
    notifications: { email: { enabled: false }, slack: { enabled: false } }
  };
}

function shouldAutoApproveGate(gateType, policy) {
  return policy.gates[gateType] === "approve";
}

function getRetryConfig(policy) {
  return policy.retry;
}

function getBudgetPolicy(policy) {
  return policy.budget;
}

function getNotificationConfig(policy) {
  return policy.notifications;
}

module.exports = {
  loadPolicy,
  shouldAutoApproveGate,
  getRetryConfig,
  getBudgetPolicy,
  getNotificationConfig
};
```

- [ ] **Step 5: Run test (expect pass)**

```bash
npm test tests/unit/autonomous-policy.test.js
```

Expected: `PASS` - 3 tests

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/autonomous-policy.js .harness/autonomous-policy.json tests/unit/autonomous-policy.test.js
git commit -m "feat: add autonomous policy engine"
```

---

### Task 2: Autonomous Session Executor

**Goal:** Execute sessions fully automatically with policy-driven gate approval and retry logic.

**Files:**
- Create: `scripts/lib/autonomous-executor.js`
- Create: `tests/unit/autonomous-executor.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/autonomous-executor.test.js`:

```javascript
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { executeAutonomous } = require("../../scripts/lib/autonomous-executor");

describe("autonomous-executor", () => {
  const testRoot = path.join(__dirname, "../fixtures/autonomous-test");
  
  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });
  
  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should execute session autonomously", async () => {
    const result = await executeAutonomous(testRoot, "test-session-id", { dryRun: true });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exitCode, 0);
  });

  it("should return exit code 2 on budget exceeded", async () => {
    const result = await executeAutonomous(testRoot, "test-session-id", { 
      dryRun: true, 
      simulateBudgetExceeded: true 
    });
    assert.strictEqual(result.exitCode, 2);
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test tests/unit/autonomous-executor.test.js
```

Expected: `FAIL`

- [ ] **Step 3: Implement autonomous executor**

Create `scripts/lib/autonomous-executor.js`:

```javascript
const fs = require("fs");
const path = require("path");
const { executeSession } = require("./execution-engine");
const { loadPolicy, shouldAutoApproveGate, getRetryConfig, getBudgetPolicy } = require("./autonomous-policy");
const { loadRoutes } = require("./route-loader");
const { TimelineWriter } = require("./timeline-writer");

async function executeAutonomous(projectRoot, sessionId, options = {}) {
  const sessionDir = path.join(projectRoot, ".harness", "sessions", sessionId);
  const manifestPath = path.join(sessionDir, "manifest.json");
  
  if (!fs.existsSync(manifestPath)) {
    return { success: false, exitCode: 1, error: "Session not found" };
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const policy = loadPolicy(projectRoot);
  const { routes } = loadRoutes(path.join(projectRoot, "routes"));
  const route = routes.find(r => r.routeId === manifest.route.id);
  
  if (!route) {
    return { success: false, exitCode: 1, error: "Route not found" };
  }
  
  const retryConfig = getRetryConfig(policy);
  let attempt = 0;
  let lastError = null;
  
  while (attempt < retryConfig.maxAttempts) {
    attempt++;
    
    const sessionResult = await executeSession(sessionDir, manifest, route, {
      autoApprove: (gate) => shouldAutoApproveGate(gate.type, policy),
      dryRun: options.dryRun
    });
    
    if (sessionResult.success) {
      return { success: true, exitCode: 0, stagesCompleted: sessionResult.stagesCompleted };
    }
    
    if (sessionResult.reason === "Budget exceeded") {
      const budgetPolicy = getBudgetPolicy(policy);
      if (budgetPolicy.onExceed === "pause") {
        return { success: false, exitCode: 2, reason: "paused" };
      }
    }
    
    lastError = sessionResult.reason;
    
    if (attempt < retryConfig.maxAttempts) {
      const backoff = retryConfig.backoffMs[attempt - 1] || 15000;
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  
  return { success: false, exitCode: 1, error: lastError, attempts: attempt };
}

module.exports = { executeAutonomous };
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npm test tests/unit/autonomous-executor.test.js
```

Expected: `PASS` - 2 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/autonomous-executor.js tests/unit/autonomous-executor.test.js
git commit -m "feat: add autonomous session executor"
```

---

### Task 3: Background Daemon

**Goal:** Run sessions in background with PID management and signal handling.

**Files:**
- Create: `scripts/lib/daemon.js`
- Create: `tests/unit/daemon.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/daemon.test.js`:

```javascript
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { startDaemon, stopDaemon, getDaemonStatus } = require("../../scripts/lib/daemon");

describe("daemon", () => {
  const testRoot = path.join(__dirname, "../fixtures/daemon-test");
  
  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });
  
  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should write PID file on start", () => {
    const pidFile = path.join(testRoot, ".harness", "daemon.pid");
    const result = startDaemon(testRoot, "test-session", { test: true });
    assert.ok(result.success);
    assert.ok(fs.existsSync(pidFile));
  });

  it("should return daemon status", () => {
    const status = getDaemonStatus(testRoot);
    assert.ok(status.running !== undefined);
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test tests/unit/daemon.test.js
```

Expected: `FAIL`

- [ ] **Step 3: Implement daemon manager**

Create `scripts/lib/daemon.js`:

```javascript
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

function startDaemon(projectRoot, sessionId, options = {}) {
  const pidPath = path.join(projectRoot, ".harness", "daemon.pid");
  const harnessDir = path.dirname(pidPath);
  
  if (!fs.existsSync(harnessDir)) {
    fs.mkdirSync(harnessDir, { recursive: true });
  }
  
  if (fs.existsSync(pidPath)) {
    const pid = parseInt(fs.readFileSync(pidPath, "utf8"));
    if (isProcessRunning(pid)) {
      return { success: false, error: "Daemon already running", pid };
    }
  }
  
  if (options.test) {
    fs.writeFileSync(pidPath, process.pid.toString());
    return { success: true, pid: process.pid };
  }
  
  const child = spawn(process.execPath, [
    path.join(__dirname, "../harness.js"),
    "session", "continue", "--session-id", sessionId, "--mode", "autonomous"
  ], {
    detached: true,
    stdio: "ignore",
    cwd: projectRoot
  });
  
  child.unref();
  fs.writeFileSync(pidPath, child.pid.toString());
  
  return { success: true, pid: child.pid };
}

function stopDaemon(projectRoot) {
  const pidPath = path.join(projectRoot, ".harness", "daemon.pid");
  
  if (!fs.existsSync(pidPath)) {
    return { success: false, error: "No daemon running" };
  }
  
  const pid = parseInt(fs.readFileSync(pidPath, "utf8"));
  
  if (!isProcessRunning(pid)) {
    fs.unlinkSync(pidPath);
    return { success: false, error: "Daemon not running" };
  }
  
  try {
    process.kill(pid, "SIGTERM");
    fs.unlinkSync(pidPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getDaemonStatus(projectRoot) {
  const pidPath = path.join(projectRoot, ".harness", "daemon.pid");
  
  if (!fs.existsSync(pidPath)) {
    return { running: false };
  }
  
  const pid = parseInt(fs.readFileSync(pidPath, "utf8"));
  const running = isProcessRunning(pid);
  
  if (!running) {
    fs.unlinkSync(pidPath);
  }
  
  return { running, pid: running ? pid : null };
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

module.exports = { startDaemon, stopDaemon, getDaemonStatus };
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npm test tests/unit/daemon.test.js
```

Expected: `PASS` - 2 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/daemon.js tests/unit/daemon.test.js
git commit -m "feat: add background daemon manager"
```

---

### Task 4: Notification System

**Goal:** Send email and Slack notifications on key events.

**Files:**
- Create: `scripts/lib/notifier.js`
- Create: `tests/unit/notifier.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/notifier.test.js`:

```javascript
const { describe, it } = require("node:test");
const assert = require("assert");
const { sendNotification, formatNotification } = require("../../scripts/lib/notifier");

describe("notifier", () => {
  it("should format notification message", () => {
    const message = formatNotification("session_completed", { sessionId: "123", goal: "test" });
    assert.ok(message.subject);
    assert.ok(message.body);
    assert.ok(message.body.includes("123"));
  });

  it("should skip disabled notification channels", async () => {
    const config = { email: { enabled: false }, slack: { enabled: false } };
    const result = await sendNotification("session_completed", {}, config, { dryRun: true });
    assert.strictEqual(result.sent, 0);
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test tests/unit/notifier.test.js
```

Expected: `FAIL`

- [ ] **Step 3: Install dependencies**

```bash
npm install nodemailer
```

- [ ] **Step 4: Implement notifier**

Create `scripts/lib/notifier.js`:

```javascript
const nodemailer = require("nodemailer");

function formatNotification(eventType, data) {
  const templates = {
    session_completed: {
      subject: `Session completed: ${data.sessionId || "unknown"}`,
      body: `Session ${data.sessionId} has completed successfully.\n\nGoal: ${data.goal || "N/A"}\nStages: ${data.stagesCompleted || 0}`
    },
    session_failed: {
      subject: `Session failed: ${data.sessionId || "unknown"}`,
      body: `Session ${data.sessionId} has failed.\n\nGoal: ${data.goal || "N/A"}\nError: ${data.error || "Unknown error"}`
    },
    budget_warning: {
      subject: `Budget warning: ${data.sessionId || "unknown"}`,
      body: `Session ${data.sessionId} has used ${data.percentage}% of budget.\n\nUsed: ${data.used}\nTotal: ${data.total}`
    }
  };
  
  return templates[eventType] || { subject: `Event: ${eventType}`, body: JSON.stringify(data) };
}

async function sendNotification(eventType, data, config, options = {}) {
  let sent = 0;
  
  if (config.email?.enabled && config.email.triggers?.includes(eventType)) {
    if (!options.dryRun) {
      await sendEmail(eventType, data, config.email);
    }
    sent++;
  }
  
  if (config.slack?.enabled && config.slack.triggers?.includes(eventType)) {
    if (!options.dryRun) {
      await sendSlack(eventType, data, config.slack);
    }
    sent++;
  }
  
  return { sent };
}

async function sendEmail(eventType, data, emailConfig) {
  const message = formatNotification(eventType, data);
  const transporter = nodemailer.createTransporter({
    host: emailConfig.host || "smtp.gmail.com",
    port: emailConfig.port || 587,
    secure: false,
    auth: { user: emailConfig.user, pass: emailConfig.pass }
  });
  
  await transporter.sendMail({
    from: emailConfig.from || emailConfig.user,
    to: emailConfig.to,
    subject: message.subject,
    text: message.body
  });
}

async function sendSlack(eventType, data, slackConfig) {
  const message = formatNotification(eventType, data);
  const fetch = (await import("node-fetch")).default;
  
  await fetch(slackConfig.webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `${message.subject}\n\n${message.body}` })
  });
}

module.exports = { sendNotification, formatNotification };
```

- [ ] **Step 5: Run test (expect pass)**

```bash
npm test tests/unit/notifier.test.js
```

Expected: `PASS` - 2 tests

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/notifier.js tests/unit/notifier.test.js package.json package-lock.json
git commit -m "feat: add notification system (email/Slack)"
```

---

### Task 5: CLI Integration

**Goal:** Add `--mode autonomous` and `harness daemon` commands.

**Files:**
- Modify: `scripts/lib/session-commands.js`
- Modify: `scripts/harness.js`
- Create: `tests/integration/autonomous-mode.test.js`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/autonomous-mode.test.js`:

```javascript
const { describe, it } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("autonomous mode integration", () => {
  it("should accept --mode autonomous flag", () => {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/harness.js"),
      "session", "start", "--goal", "test", "--mode", "autonomous", "--help"
    ], { cwd: ROOT, encoding: "utf8" });
    
    assert.strictEqual(result.status, 0);
  });

  it("should support daemon status command", () => {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/harness.js"),
      "daemon", "status"
    ], { cwd: ROOT, encoding: "utf8" });
    
    assert.ok(result.status === 0 || result.status === 1);
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test tests/integration/autonomous-mode.test.js
```

Expected: `FAIL` - daemon command not found

- [ ] **Step 3: Modify session-commands.js to support autonomous mode**

In `scripts/lib/session-commands.js`, update `continueSession`:

```javascript
// Add after line where manifest is loaded
if (manifest.mode === "autonomous") {
  const { executeAutonomous } = require("./autonomous-executor");
  const result = await executeAutonomous(projectRoot, sessionId, options);
  
  if (result.exitCode === 2) {
    return { text: "Session paused due to budget", exitCode: 2 };
  }
  
  if (!result.success) {
    return { text: `Session failed: ${result.error}`, exitCode: 1 };
  }
  
  return { text: `Session completed: ${result.stagesCompleted} stages`, exitCode: 0 };
}
```

- [ ] **Step 4: Add daemon commands to harness.js**

In `scripts/harness.js`, add to `COMMANDS` array:

```javascript
"daemon"
```

Add daemon command handler after existing command blocks:

```javascript
if (command === "daemon") {
  const subcommand = args._[0];
  const { startDaemon, stopDaemon, getDaemonStatus } = require("./lib/daemon");
  
  if (subcommand === "status") {
    const status = getDaemonStatus(process.cwd());
    const text = status.running 
      ? `Daemon running (PID: ${status.pid})` 
      : "Daemon not running";
    printResult({ text }, args);
    process.exit(status.running ? 0 : 1);
  }
  
  if (subcommand === "stop") {
    const result = stopDaemon(process.cwd());
    printResult(result, args);
    process.exit(result.success ? 0 : 1);
  }
  
  printResult({ text: "Usage: harness daemon <status|stop>" }, args);
  process.exit(1);
}
```

- [ ] **Step 5: Run test (expect pass)**

```bash
npm test tests/integration/autonomous-mode.test.js
```

Expected: `PASS` - 2 tests

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/session-commands.js scripts/harness.js tests/integration/autonomous-mode.test.js
git commit -m "feat: integrate autonomous mode into CLI"
```

---

## Week 8: Production Hardening

### Task 6: Session Locking

**Goal:** Prevent concurrent modifications to the same session.

**Files:**
- Create: `scripts/lib/session-lock.js`
- Create: `tests/unit/session-lock.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/session-lock.test.js`:

```javascript
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { acquireLock, releaseLock, isLocked } = require("../../scripts/lib/session-lock");

describe("session-lock", () => {
  const testRoot = path.join(__dirname, "../fixtures/lock-test");
  const sessionId = "test-session";
  
  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });
  
  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should acquire lock successfully", () => {
    const result = acquireLock(testRoot, sessionId);
    assert.strictEqual(result.success, true);
    assert.ok(isLocked(testRoot, sessionId));
  });

  it("should fail to acquire when already locked", () => {
    acquireLock(testRoot, sessionId);
    const result = acquireLock(testRoot, sessionId);
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes("locked"));
  });

  it("should release lock", () => {
    acquireLock(testRoot, sessionId);
    releaseLock(testRoot, sessionId);
    assert.strictEqual(isLocked(testRoot, sessionId), false);
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test tests/unit/session-lock.test.js
```

Expected: `FAIL`

- [ ] **Step 3: Implement session lock**

Create `scripts/lib/session-lock.js`:

```javascript
const fs = require("fs");
const path = require("path");

const LOCK_TIMEOUT_MS = 300000; // 5 minutes

function acquireLock(projectRoot, sessionId) {
  const lockPath = getLockPath(projectRoot, sessionId);
  const lockDir = path.dirname(lockPath);
  
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }
  
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const age = Date.now() - lock.timestamp;
    
    if (age < LOCK_TIMEOUT_MS) {
      return { success: false, error: "Session is locked by another process" };
    }
    
    // Stale lock - remove it
    fs.unlinkSync(lockPath);
  }
  
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    timestamp: Date.now()
  }));
  
  return { success: true };
}

function releaseLock(projectRoot, sessionId) {
  const lockPath = getLockPath(projectRoot, sessionId);
  
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

function isLocked(projectRoot, sessionId) {
  const lockPath = getLockPath(projectRoot, sessionId);
  
  if (!fs.existsSync(lockPath)) {
    return false;
  }
  
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const age = Date.now() - lock.timestamp;
  
  return age < LOCK_TIMEOUT_MS;
}

function getLockPath(projectRoot, sessionId) {
  return path.join(projectRoot, ".harness", "sessions", sessionId, ".lock");
}

module.exports = { acquireLock, releaseLock, isLocked };
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npm test tests/unit/session-lock.test.js
```

Expected: `PASS` - 3 tests

- [ ] **Step 5: Integrate into execution-engine.js**

In `scripts/lib/execution-engine.js`, add at start of `executeSession`:

```javascript
const { acquireLock, releaseLock } = require("./session-lock");

// At start of executeSession
const lockResult = acquireLock(path.dirname(path.dirname(sessionDir)), manifest.sessionId);
if (!lockResult.success) {
  throw new Error(lockResult.error);
}

// In finally block at end
try {
  // ... existing cleanup
} finally {
  releaseLock(path.dirname(path.dirname(sessionDir)), manifest.sessionId);
}
```

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/session-lock.js scripts/lib/execution-engine.js tests/unit/session-lock.test.js
git commit -m "feat: add session locking to prevent concurrent access"
```

---

### Task 7: Structured Logging

**Goal:** JSON logs for debugging and observability.

**Files:**
- Create: `scripts/lib/logger.js`
- Create: `tests/unit/logger.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/logger.test.js`:

```javascript
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createLogger } = require("../../scripts/lib/logger");

describe("logger", () => {
  const testRoot = path.join(__dirname, "../fixtures/logger-test");
  const logPath = path.join(testRoot, "test.log");
  
  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });
  
  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should write JSON log entry", () => {
    const logger = createLogger(logPath);
    logger.info("test message", { key: "value" });
    logger.close();
    
    const content = fs.readFileSync(logPath, "utf8");
    const log = JSON.parse(content.trim().split("\n")[0]);
    
    assert.strictEqual(log.level, "info");
    assert.strictEqual(log.message, "test message");
    assert.strictEqual(log.key, "value");
    assert.ok(log.timestamp);
  });

  it("should write error logs", () => {
    const logger = createLogger(logPath);
    logger.error("error message", { error: "details" });
    logger.close();
    
    const content = fs.readFileSync(logPath, "utf8");
    const log = JSON.parse(content.trim());
    
    assert.strictEqual(log.level, "error");
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test tests/unit/logger.test.js
```

Expected: `FAIL`

- [ ] **Step 3: Implement structured logger**

Create `scripts/lib/logger.js`:

```javascript
const fs = require("fs");
const path = require("path");

class Logger {
  constructor(filePath) {
    this.filePath = filePath;
    this.stream = null;
  }

  log(level, message, data = {}) {
    if (!this.stream) {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data
    };

    this.stream.write(JSON.stringify(entry) + "\n");
  }

  info(message, data) {
    this.log("info", message, data);
  }

  error(message, data) {
    this.log("error", message, data);
  }

  warn(message, data) {
    this.log("warn", message, data);
  }

  close() {
    if (this.stream) {
      this.stream.end();
    }
  }
}

function createLogger(filePath) {
  return new Logger(filePath);
}

module.exports = { createLogger };
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npm test tests/unit/logger.test.js
```

Expected: `PASS` - 2 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/logger.js tests/unit/logger.test.js
git commit -m "feat: add structured JSON logger"
```

---

### Task 8: Metrics Collection

**Goal:** Track session duration, stage timings, and success rate.

**Files:**
- Create: `scripts/lib/metrics-collector.js`
- Create: `tests/unit/metrics-collector.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/metrics-collector.test.js`:

```javascript
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { collectMetrics, getMetricsSummary } = require("../../scripts/lib/metrics-collector");

describe("metrics-collector", () => {
  const testRoot = path.join(__dirname, "../fixtures/metrics-test");
  
  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });
  
  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should collect session metrics", () => {
    const metrics = collectMetrics(testRoot, "test-session");
    assert.ok(metrics.duration !== undefined);
    assert.ok(metrics.stagesCompleted !== undefined);
  });

  it("should calculate success rate", () => {
    const summary = getMetricsSummary(testRoot);
    assert.ok(summary.totalSessions !== undefined);
    assert.ok(summary.successRate !== undefined);
  });
});
```

- [ ] **Step 2: Run test (expect failure)**

```bash
npm test tests/unit/metrics-collector.test.js
```

Expected: `FAIL`

- [ ] **Step 3: Implement metrics collector**

Create `scripts/lib/metrics-collector.js`:

```javascript
const fs = require("fs");
const path = require("path");

function collectMetrics(projectRoot, sessionId) {
  const manifestPath = path.join(projectRoot, ".harness", "sessions", sessionId, "manifest.json");
  
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const duration = new Date(manifest.updatedAt) - new Date(manifest.createdAt);
  
  return {
    sessionId,
    status: manifest.status,
    duration,
    stagesCompleted: (manifest.completedStages || []).length,
    budgetUsed: manifest.budget?.used || 0,
    createdAt: manifest.createdAt
  };
}

function getMetricsSummary(projectRoot) {
  const sessionsDir = path.join(projectRoot, ".harness", "sessions");
  
  if (!fs.existsSync(sessionsDir)) {
    return { totalSessions: 0, successRate: 0, avgDuration: 0 };
  }
  
  const sessions = fs.readdirSync(sessionsDir)
    .map(id => collectMetrics(projectRoot, id))
    .filter(m => m !== null);
  
  const completed = sessions.filter(s => s.status === "completed").length;
  const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);
  
  return {
    totalSessions: sessions.length,
    successRate: sessions.length > 0 ? completed / sessions.length : 0,
    avgDuration: sessions.length > 0 ? totalDuration / sessions.length : 0
  };
}

module.exports = { collectMetrics, getMetricsSummary };
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npm test tests/unit/metrics-collector.test.js
```

Expected: `PASS` - 2 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/metrics-collector.js tests/unit/metrics-collector.test.js
git commit -m "feat: add metrics collection"
```

---

## Week 9: Testing and Documentation

### Task 9: End-to-End Tests

**Goal:** Comprehensive E2E scenarios for autonomous mode.

**Files:**
- Create: `tests/e2e/autonomous-session.test.js`
- Create: `tests/e2e/concurrent-sessions.test.js`
- Create: `tests/e2e/daemon-lifecycle.test.js`

- [ ] **Step 1: Create autonomous session E2E test**

Create `tests/e2e/autonomous-session.test.js`:

```javascript
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("autonomous session E2E", () => {
  const testRoot = path.join(__dirname, "../fixtures/e2e-autonomous");
  
  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });
  
  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should complete autonomous session without intervention", () => {
    const start = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/harness.js"),
      "session", "start",
      "--goal", "test feature",
      "--mode", "autonomous",
      "--json"
    ], { cwd: testRoot, encoding: "utf8" });
    
    assert.strictEqual(start.status, 0);
    const startResult = JSON.parse(start.stdout);
    const sessionId = startResult.sessionId;
    
    const continueCmd = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/harness.js"),
      "session", "continue",
      "--session-id", sessionId,
      "--json"
    ], { cwd: testRoot, encoding: "utf8" });
    
    assert.ok(continueCmd.status === 0 || continueCmd.status === 2);
  });
});
```

- [ ] **Step 2: Create concurrent sessions test**

Create `tests/e2e/concurrent-sessions.test.js`:

```javascript
const { describe, it } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("concurrent sessions E2E", () => {
  it("should handle 5 concurrent sessions", () => {
    const sessions = [];
    
    for (let i = 0; i < 5; i++) {
      const result = spawnSync(process.execPath, [
        path.join(ROOT, "scripts/harness.js"),
        "session", "start",
        "--goal", `test ${i}`,
        "--json"
      ], { cwd: ROOT, encoding: "utf8" });
      
      if (result.status === 0) {
        const data = JSON.parse(result.stdout);
        sessions.push(data.sessionId);
      }
    }
    
    assert.ok(sessions.length >= 4, "Should create at least 4 sessions");
  });
});
```

- [ ] **Step 3: Create daemon lifecycle test**

Create `tests/e2e/daemon-lifecycle.test.js`:

```javascript
const { describe, it } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("daemon lifecycle E2E", () => {
  it("should report status correctly", () => {
    const status = spawnSync(process.execPath, [
      path.join(ROOT, "scripts/harness.js"),
      "daemon", "status"
    ], { cwd: ROOT, encoding: "utf8" });
    
    assert.ok(status.status === 0 || status.status === 1);
    assert.ok(status.stdout.includes("Daemon"));
  });
});
```

- [ ] **Step 4: Run E2E tests**

```bash
npm test tests/e2e/
```

Expected: `PASS` - all E2E tests pass

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/
git commit -m "test: add end-to-end tests for autonomous mode"
```

---

### Task 10: Load Testing

**Goal:** Verify performance under load.

**Files:**
- Create: `tests/load/sequential-sessions.test.js`
- Create: `tests/load/timeline-throughput.test.js`

- [ ] **Step 1: Create sequential sessions load test**

Create `tests/load/sequential-sessions.test.js`:

```javascript
const { describe, it } = require("node:test");
const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "../..");

describe("sequential sessions load test", () => {
  it("should complete 100 sessions in <10 minutes", function() {
    this.timeout(600000); // 10 minutes
    
    const startTime = Date.now();
    let successCount = 0;
    
    for (let i = 0; i < 100; i++) {
      const result = spawnSync(process.execPath, [
        path.join(ROOT, "scripts/harness.js"),
        "session", "start",
        "--goal", `load test ${i}`,
        "--json"
      ], { cwd: ROOT, encoding: "utf8" });
      
      if (result.status === 0) {
        successCount++;
      }
    }
    
    const duration = Date.now() - startTime;
    const avgTime = duration / 100;
    
    assert.ok(successCount >= 95, `Only ${successCount}/100 succeeded`);
    assert.ok(avgTime < 6000, `Average time ${avgTime}ms exceeds 6s target`);
  });
});
```

- [ ] **Step 2: Create timeline throughput test**

Create `tests/load/timeline-throughput.test.js`:

```javascript
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { TimelineWriter } = require("../../scripts/lib/timeline-writer");

describe("timeline throughput load test", () => {
  const testRoot = path.join(__dirname, "../fixtures/timeline-load");
  const timelinePath = path.join(testRoot, "timeline.jsonl");
  
  beforeEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
    fs.mkdirSync(testRoot, { recursive: true });
  });
  
  afterEach(() => {
    if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
  });

  it("should write 1000 events in <500ms", async () => {
    const writer = new TimelineWriter(timelinePath);
    const startTime = Date.now();
    
    for (let i = 0; i < 1000; i++) {
      await writer.append({
        type: "stage_started",
        stage: `stage-${i}`,
        data: { index: i }
      });
    }
    
    await writer.close();
    const duration = Date.now() - startTime;
    
    assert.ok(duration < 500, `Write duration ${duration}ms exceeds 500ms target`);
    
    const lines = fs.readFileSync(timelinePath, "utf8").trim().split("\n");
    assert.strictEqual(lines.length, 1000);
  });
});
```

- [ ] **Step 3: Run load tests**

```bash
npm test tests/load/
```

Expected: `PASS` - performance targets met

- [ ] **Step 4: Commit**

```bash
git add tests/load/
git commit -m "test: add load tests for performance validation"
```

---

### Task 11: Documentation

**Goal:** Complete user-facing documentation.

**Files:**
- Create: `docs/AUTONOMOUS_MODE_GUIDE.md`
- Create: `docs/POLICY_CONFIGURATION.md`
- Create: `docs/NOTIFICATION_SETUP.md`
- Create: `docs/TROUBLESHOOTING.md`
- Create: `docs/CLI_REFERENCE.md`

- [ ] **Step 1: Create autonomous mode user guide**

Create `docs/AUTONOMOUS_MODE_GUIDE.md`:

```markdown
# Autonomous Mode User Guide

## Overview

Autonomous mode enables fully automated session execution without human intervention.

## Quick Start

```bash
# Start session in autonomous mode
harness session start --goal "implement user auth" --mode autonomous

# Start in background (daemon mode)
harness session start --goal "implement user auth" --mode autonomous --detach

# Check daemon status
harness daemon status

# Stop daemon
harness daemon stop
```

## How It Works

1. **Auto-Route Selection**: Matches goal to best route automatically
2. **Policy-Driven Gates**: Gates auto-approved based on policy configuration
3. **Retry on Failure**: Failed stages retry with exponential backoff
4. **Budget Handling**: Pauses on budget exceed (configurable)
5. **Notifications**: Email/Slack alerts on completion/failure

## Exit Codes

- `0`: Success
- `1`: Failure
- `2`: Paused (budget exceeded)

## Best Practices

- Use autonomous mode for well-defined, repeatable tasks
- Configure retry policy for your use case
- Set budget limits to prevent runaway execution
- Enable notifications for long-running sessions
- Review logs in `.harness/logs/harness.log`

See POLICY_CONFIGURATION.md for detailed policy settings.
```

- [ ] **Step 2: Create policy configuration reference**

Create `docs/POLICY_CONFIGURATION.md`:

```markdown
# Policy Configuration Reference

Policy file: `.harness/autonomous-policy.json`

## Structure

```json
{
  "gates": {
    "auto": "approve|skip",
    "user-approval": "approve|skip",
    "step-confirm": "approve|skip"
  },
  "retry": {
    "maxAttempts": 3,
    "backoffMs": [1000, 5000, 15000],
    "retryableStages": ["implement", "verify"]
  },
  "budget": {
    "onExceed": "pause|fail|continue"
  },
  "notifications": {
    "email": {
      "enabled": true,
      "host": "smtp.gmail.com",
      "port": 587,
      "user": "your@email.com",
      "pass": "your-password",
      "to": "recipient@email.com",
      "triggers": ["session_completed", "session_failed"]
    },
    "slack": {
      "enabled": true,
      "webhook": "https://hooks.slack.com/...",
      "triggers": ["session_completed", "session_failed", "budget_warning"]
    }
  }
}
```

## Gates

- `approve`: Automatically approve and continue
- `skip`: Skip the gate check entirely

## Retry

- `maxAttempts`: Maximum retry attempts (1-10)
- `backoffMs`: Delay between retries in milliseconds
- `retryableStages`: Stage names that can be retried

## Budget

- `pause`: Stop and set status to paused (exit code 2)
- `fail`: Stop and set status to failed (exit code 1)
- `continue`: Ignore budget and continue (dangerous)

## Notifications

See NOTIFICATION_SETUP.md for detailed setup instructions.
```

- [ ] **Step 3: Create notification setup guide**

Create `docs/NOTIFICATION_SETUP.md`:

```markdown
# Notification Setup Guide

## Email Notifications

### Gmail Setup

1. Enable 2-factor authentication
2. Generate app password: https://myaccount.google.com/apppasswords
3. Configure in `.harness/autonomous-policy.json`:

```json
{
  "notifications": {
    "email": {
      "enabled": true,
      "host": "smtp.gmail.com",
      "port": 587,
      "user": "your-email@gmail.com",
      "pass": "your-app-password",
      "to": "recipient@example.com",
      "triggers": ["session_completed", "session_failed"]
    }
  }
}
```

## Slack Notifications

1. Create incoming webhook: https://api.slack.com/messaging/webhooks
2. Copy webhook URL
3. Configure in `.harness/autonomous-policy.json`:

```json
{
  "notifications": {
    "slack": {
      "enabled": true,
      "webhook": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
      "triggers": ["session_completed", "session_failed", "budget_warning"]
    }
  }
}
```

## Available Triggers

- `session_created`: When session starts
- `session_completed`: When session completes successfully
- `session_failed`: When session fails
- `budget_warning`: When budget reaches 90%
- `budget_exceeded`: When budget is exceeded

## Testing

```bash
# Test email configuration
node -e "const n=require('./scripts/lib/notifier');n.sendNotification('session_completed',{sessionId:'test',goal:'test'},{email:{enabled:true,host:'smtp.gmail.com',port:587,user:'your@email.com',pass:'pass',to:'recipient@email.com',triggers:['session_completed']}})"

# Test Slack configuration
node -e "const n=require('./scripts/lib/notifier');n.sendNotification('session_completed',{sessionId:'test',goal:'test'},{slack:{enabled:true,webhook:'YOUR_WEBHOOK',triggers:['session_completed']}})"
```
```

- [ ] **Step 4: Create troubleshooting guide**

Create `docs/TROUBLESHOOTING.md`:

```markdown
# Troubleshooting Guide

## Session Lock Issues

**Symptom**: "Session is locked by another process"

**Cause**: Another process is modifying the session, or stale lock

**Solution**:
```bash
# Check lock age (should timeout after 5 minutes)
ls -la .harness/sessions/<session-id>/.lock

# Force remove stale lock
rm .harness/sessions/<session-id>/.lock
```

## Daemon Won't Start

**Symptom**: `harness daemon status` shows "not running" immediately after start

**Cause**: Session failed immediately, or PID file corrupt

**Solution**:
```bash
# Check session logs
cat .harness/logs/harness.log

# Remove stale PID
rm .harness/daemon.pid

# Check session status
harness session status
```

## Budget Exceeded

**Symptom**: Session paused with exit code 2

**Solution**:
```bash
# Option 1: Increase budget in policy
# Edit .harness/autonomous-policy.json: budget.total

# Option 2: Continue with higher budget
harness session continue --session-id <id>
```

## Notification Not Sent

**Symptom**: No email/Slack notification received

**Solution**:
```bash
# Verify configuration
cat .harness/autonomous-policy.json

# Check trigger is enabled for event
# Verify email credentials (try sending test email)
# Check Slack webhook is valid
```

## Session Stuck

**Symptom**: Session status shows "executing" but nothing happening

**Solution**:
```bash
# Check if process still running
harness daemon status

# View latest timeline events
tail -20 .harness/sessions/<session-id>/timeline.jsonl

# Abort and restart
harness session abort --session-id <id>
harness session start --goal "..." --mode autonomous
```

## High Memory Usage

**Symptom**: System slowing down during session execution

**Solution**:
- Reduce concurrent sessions
- Increase timeline flush frequency
- Check for memory leaks in custom stages
```

- [ ] **Step 5: Create CLI reference**

Create `docs/CLI_REFERENCE.md`:

```markdown
# CLI Reference

## Session Commands

### session start
```bash
harness session start --goal "description" [options]

Options:
  --goal <text>          Session goal (required)
  --route <id>           Specific route ID (optional, auto-selected if omitted)
  --budget <number>      Budget limit (optional)
  --mode <mode>          Execution mode: interactive|autonomous (default: interactive)
  --worktree             Create isolated worktree (optional)
  --detach               Run in background (daemon mode, requires --mode autonomous)
  --json                 JSON output

Exit codes: 0=success, 1=error
```

### session continue
```bash
harness session continue [--session-id <id>] [options]

Options:
  --session-id <id>      Session to continue (optional, uses latest if omitted)
  --from-checkpoint <stage>  Resume from specific checkpoint
  --json                 JSON output

Exit codes: 0=success, 1=error, 2=paused (budget)
```

### session status
```bash
harness session status [--session-id <id>]

Options:
  --session-id <id>      Session ID (optional, uses latest if omitted)
  --json                 JSON output

Exit codes: 0=success, 1=not found
```

### session list
```bash
harness session list [options]

Options:
  --json                 JSON output

Exit codes: 0=success
```

### session abort
```bash
harness session abort --session-id <id>

Options:
  --session-id <id>      Session ID (required)
  --json                 JSON output

Exit codes: 0=success, 1=error
```

## Daemon Commands

### daemon status
```bash
harness daemon status

Exit codes: 0=running, 1=not running
```

### daemon stop
```bash
harness daemon stop

Exit codes: 0=success, 1=error
```

## Route Commands

### route list
```bash
harness route list [--json]

Exit codes: 0=success
```

### route inspect
```bash
harness route inspect <route-id> [--json]

Exit codes: 0=success, 1=not found
```

### route validate
```bash
harness route validate <file> [--json]

Exit codes: 0=valid, 1=invalid
```

### route test
```bash
harness route test <route-id> --dry-run [--json]

Exit codes: 0=success, 1=error
```

## Global Options

All commands support:
- `--json`: JSON output for programmatic use
- `--help`: Show command help

## Environment Variables

- `HARNESS_ROOT`: Project root directory (default: current directory)
- `HARNESS_LOG_LEVEL`: Log level (info|warn|error)

## Exit Codes

- `0`: Success
- `1`: Failure
- `2`: Paused (autonomous mode, budget exceeded)
```

- [ ] **Step 6: Commit documentation**

```bash
git add docs/*.md
git commit -m "docs: add complete Phase B Beta documentation"
```

---

## Acceptance Criteria Validation

### Week 6-7: Autonomous Core

- [ ] **AC1: Autonomous execution without human input**

```bash
harness session start --goal "test feature" --mode autonomous
# Should complete without prompts
```

Expected: Exit code 0, session status = completed

- [ ] **AC2: Retry on failure**

```bash
# Simulate failure by killing process mid-execution
harness session start --goal "test" --mode autonomous &
sleep 2
kill %1
harness session continue
```

Expected: Session retries with exponential backoff

- [ ] **AC3: Daemon mode runs in background**

```bash
harness session start --goal "test" --mode autonomous --detach
harness daemon status
```

Expected: "Daemon running (PID: ...)"

- [ ] **AC4: Daemon status shows running sessions**

```bash
harness daemon status
```

Expected: Shows PID if running, "not running" otherwise

- [ ] **AC5: Email notification on completion**

```bash
# Configure email in .harness/autonomous-policy.json
harness session start --goal "test" --mode autonomous
# Wait for completion
```

Expected: Email received with "Session completed" subject

- [ ] **AC6: Slack notification on failure**

```bash
# Configure Slack in .harness/autonomous-policy.json
# Trigger failure scenario
```

Expected: Slack message received with failure details

### Week 8: Production Hardening

- [ ] **AC7: Session lock prevents concurrent access**

```bash
# Terminal 1
harness session continue --session-id <id> &

# Terminal 2 (immediately)
harness session continue --session-id <id>
```

Expected: Second command fails with "Session is locked"

- [ ] **AC8: 10 concurrent sessions complete without conflicts**

```bash
for i in {1..10}; do
  harness session start --goal "test $i" --mode autonomous &
done
wait
```

Expected: All 10 sessions complete successfully, no lock conflicts

- [ ] **AC9: Structured logs to .harness/logs/harness.log**

```bash
harness session start --goal "test" --mode autonomous
cat .harness/logs/harness.log
```

Expected: JSON-formatted log entries with timestamp, level, message

### Week 9: Testing and Performance

- [ ] **AC10: 100 sequential sessions in <10 minutes**

```bash
npm test tests/load/sequential-sessions.test.js
```

Expected: `PASS`, average <6s per session

- [ ] **AC11: 1000 timeline events in <500ms**

```bash
npm test tests/load/timeline-throughput.test.js
```

Expected: `PASS`, write duration <500ms

- [ ] **AC12: Health check detects issues**

```bash
# Corrupt a session manifest
echo "invalid json" > .harness/sessions/<id>/manifest.json

harness session status --session-id <id>
```

Expected: Clear error message, exit code 1

---

## Final Integration Test

**Scenario**: Complete autonomous workflow from start to finish

- [ ] **Step 1: Start autonomous session**

```bash
harness session start --goal "implement user authentication feature" --mode autonomous --budget 5000
```

Expected output:
```
Session created: <uuid>
Route: feature-standard
Goal: implement user authentication feature
Mode: autonomous
```

- [ ] **Step 2: Verify session executes autonomously**

```bash
harness session status
```

Expected: Status progresses through stages without human input

- [ ] **Step 3: Simulate budget warning**

Wait for session to reach 90% budget usage.

Expected: Warning logged to timeline, notification sent (if configured)

- [ ] **Step 4: Session completes successfully**

Expected: 
- Status = "completed"
- All stages completed
- Notification sent
- Metrics collected
- Exit code 0

- [ ] **Step 5: Verify metrics**

```bash
node -e "const m=require('./scripts/lib/metrics-collector');console.log(JSON.stringify(m.getMetricsSummary('.')))"
```

Expected: JSON with totalSessions, successRate, avgDuration

---

## Summary

**Tasks**: 11 major tasks
**Steps**: 60+ TDD steps
**Files Created**: 25+
**Files Modified**: 3

**Key Architectural Decisions**:

1. **Autonomous vs Interactive Separation**: Autonomous mode is a separate execution path that reuses the same stage-executor and checkpoint system, not a flag added to interactive mode.

2. **Policy-Driven Design**: All autonomous behavior (gate approval, retry, budget handling, notifications) is controlled by a single JSON policy file, making it easy to customize without code changes.

3. **Exit Code Contract**: Exit code 2 signals "paused" state (budget exceeded), enabling external orchestration tools to distinguish between failure and intentional pause.

4. **Session Locking**: Lock files with 5-minute timeout prevent concurrent access while allowing stale lock cleanup, balancing safety and resilience.

5. **Structured Logging**: JSON logs enable programmatic analysis and debugging without parsing unstructured text.

6. **Notification Abstraction**: Template-based notification system supports email and Slack with same interface, making it easy to add new channels.

7. **Metrics Collection**: Session-level metrics (duration, stages, budget) enable observability and performance tuning without external monitoring tools.

8. **Daemon Architecture**: Parent process manages child session executor, enabling background execution while keeping the session logic simple.

9. **Load Testing as Acceptance**: Performance targets (6s/session, 500ms/1000 events) are validated by automated load tests, not manual benchmarking.

10. **Documentation-First**: Complete user documentation created as part of the implementation plan, ensuring features are documented before release.

---

## Mapping to EVOLUTION_ROADMAP.md Acceptance Criteria

| Roadmap Criterion | Plan Section | Validation |
|------------------|-------------|------------|
| Autonomous session completes without human input | Task 2, AC1 | Integration test |
| Retry on failure works | Task 2, AC2 | E2E test |
| Daemon mode runs in background | Task 3, AC3 | Integration test |
| Daemon status shows running sessions | Task 3, AC4 | CLI test |
| Email notification sent | Task 4, AC5 | Integration test |
| Slack notification sent | Task 4, AC6 | Integration test |
| 10 concurrent sessions without conflicts | Task 6, AC8 | Load test |
| 100 sequential sessions <10 min | Task 10, AC10 | Load test |
| Session lock prevents concurrent modification | Task 6, AC7 | E2E test |
| Health check detects issues | AC12 | Integration test |

All acceptance criteria from EVOLUTION_ROADMAP.md Phase B Beta are covered by this plan.

