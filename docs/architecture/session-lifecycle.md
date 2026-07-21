# Session Lifecycle Architecture

## Overview

The session lifecycle manages the complete workflow execution from creation to completion, including checkpoints, gates, retries, and autonomous execution. Sessions are the primary unit of work in Amber Protocol.

## Core Concepts

### Session

A session represents a single goal-driven workflow execution. Each session:
- Has a unique UUID identifier
- Tracks a specific goal/objective
- Follows a route (workflow definition)
- Maintains state through execution
- Records a complete timeline of events
- Supports pause/resume via checkpoints

**Session Storage:**
```
.amber/sessions/<session-id>/
├── manifest.json          # Session metadata and state
├── timeline.jsonl         # Event log (JSON Lines format)
├── checkpoints/           # Checkpoint snapshots
│   ├── checkpoint-001.json
│   └── checkpoint-002.json
└── artifacts/             # Session outputs
```

### Session States

Sessions transition through these states:

1. **created** - Initial state after `session start`
2. **planning** - Route selection and planning phase
3. **executing** - Active execution of stages
4. **paused** - Manually paused or budget-paused
5. **completed** - Successfully finished all stages
6. **failed** - Execution failed with unrecoverable error
7. **aborted** - User-cancelled session

### Timeline

The timeline is an append-only event log in JSON Lines format:

```jsonl
{"type":"session_created","timestamp":"2026-06-21T10:00:00Z","sessionId":"abc-123","goal":"fix login bug"}
{"type":"stage_started","timestamp":"2026-06-21T10:00:01Z","stage":"reproduce"}
{"type":"gate_approved","timestamp":"2026-06-21T10:05:00Z","gateId":"user-approval-fix"}
{"type":"stage_completed","timestamp":"2026-06-21T10:10:00Z","stage":"reproduce"}
{"type":"session_completed","timestamp":"2026-06-21T10:15:00Z","status":"success"}
```

**Event Types:**
- session_created, session_started, session_completed, session_failed, session_aborted
- stage_started, stage_completed, stage_failed, stage_retrying
- gate_encountered, gate_approved, gate_rejected
- checkpoint_created, checkpoint_restored
- budget_exceeded, budget_reset

## Architecture Components

### 1. Session Commands (`scripts/lib/session-commands.js`)

**Purpose:** CLI commands for session lifecycle management.

**Functions:**

- **`startSession(goal, { route, interactive, mode })`**
  - Creates new session with unique ID
  - Selects route based on goal (or uses explicit route ID)
  - Writes initial manifest and timeline events
  - Returns session ID

- **`statusSession(sessionId)`**
  - Reads manifest and timeline
  - Reports current state, progress, elapsed time
  - Shows next action or blocking gate

- **`listSessions({ filter, format })`**
  - Scans `.amber/sessions/` directory
  - Filters by state (active/completed/failed)
  - Returns list with summary info

- **`abortSession(sessionId, { reason })`**
  - Updates manifest state to `aborted`
  - Logs abort event to timeline
  - Cleans up any running processes

- **`continueSession(sessionId, { fromCheckpoint })`**
  - Resumes paused session
  - Optionally restores from specific checkpoint
  - Updates state to `executing`

### 2. Execution Engine (`scripts/lib/execution-engine.js`)

**Purpose:** Execute session stages according to route definition.

**Function:**
- `executeSession(sessionId, { dryRun })`
  - Loads session manifest and route
  - Iterates through route stages sequentially
  - Dispatches each stage to appropriate executor (pack/skill/command)
  - Handles gates and checkpoints
  - Records all events to timeline
  - Updates manifest state after each stage

**Stage Execution Flow:**
```
Load Stage → Pre-Gate Check → Execute Stage → Post-Gate Check → Next Stage
```

**Stage Types:**
- **pack**: Execute a workflow pack
- **skill**: Invoke an agent skill
- **command**: Run a shell command
- **gate**: Checkpoint requiring approval

### 3. Gate Handler (`scripts/lib/gate-handler.js`)

**Purpose:** Manage approval gates and checkpoints.

**Gate Types:**

1. **auto** - Automatically approved (no user interaction)
2. **user-approval** - Requires explicit user approval
3. **step-confirm** - Pause for user review before continuing

**Functions:**

- **`handleGate(gateId, sessionId, policy)`**
  - Checks policy for auto-approval rules
  - If manual approval required:
    - Pauses session
    - Records gate event in timeline
    - Waits for user input
  - Returns approval decision

- **`approveGate(sessionId, gateId)`**
  - Records approval in timeline
  - Resumes session execution

- **`rejectGate(sessionId, gateId, reason)`**
  - Records rejection in timeline
  - Transitions session to failed or aborted state

### 4. Checkpoint Manager (`scripts/lib/checkpoint-manager.js`)

**Purpose:** Create and restore session snapshots.

**Functions:**

- **`createCheckpoint(sessionId, label)`**
  - Snapshots current manifest state
  - Records file tree snapshot (optional)
  - Writes checkpoint file
  - Returns checkpoint ID

- **`restoreCheckpoint(sessionId, checkpointId)`**
  - Loads checkpoint file
  - Restores manifest to checkpoint state
  - Optionally restores file tree
  - Records restore event in timeline

- **`listCheckpoints(sessionId)`**
  - Returns all checkpoints for session
  - Includes timestamp, label, size

### 5. Autonomous Executor (`scripts/lib/autonomous-executor.js`)

**Purpose:** Execute sessions without human intervention (autonomous mode).

**Function:**
- `executeAutonomous(projectRoot, sessionId, options)`
  - Loads autonomous policy configuration
  - Executes session with policy-driven gate approval
  - Implements retry logic for failed stages
  - Handles budget exhaustion (pause vs abort)
  - Sends notifications on key events
  - Returns final exit code: 0=success, 1=failure, 2=paused

**Autonomous Policy (`autonomous-policy.json`):**
```json
{
  "gates": {
    "auto": "approve",
    "user-approval": "block",
    "step-confirm": "block"
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
    "email": { "enabled": false },
    "slack": { "enabled": false }
  }
}
```

### 6. Budget Tracker (`scripts/lib/budget-tracker.js`)

**Purpose:** Track and enforce resource budgets.

**Functions:**

- **`trackUsage(sessionId, resource, amount)`**
  - Records resource usage (tokens, time, API calls)
  - Updates running totals in manifest

- **`checkBudget(sessionId, policy)`**
  - Compares usage against policy limits
  - Returns: `{ exceeded: boolean, remaining: object }`

- **`resetBudget(sessionId)`**
  - Clears usage counters
  - Used when continuing from checkpoint

## Data Flow

```
User Goal
    ↓
session start
    ↓
Route Selection (route-selector.js)
    ↓
Session Created (manifest.json + timeline.jsonl)
    ↓
Execution Engine
    ↓
For Each Stage:
    ├─→ Pre-Gate Check (gate-handler.js)
    ├─→ Execute Stage (pack/skill/command)
    ├─→ Post-Gate Check
    ├─→ Create Checkpoint (optional)
    └─→ Record Events (session-timeline.js / appendSessionEvent)
    ↓
Budget Check (budget-tracker.js)
    ↓
Session Complete/Failed/Paused
```

## Session Manifest Schema

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "goal": "fix login bug",
  "route": "bugfix-quick",
  "state": "executing",
  "currentStage": "fix",
  "createdAt": "2026-06-21T10:00:00Z",
  "startedAt": "2026-06-21T10:00:01Z",
  "completedAt": null,
  "checkpoints": ["checkpoint-001"],
  "usage": {
    "tokens": 15000,
    "durationMs": 180000,
    "apiCalls": 42
  },
  "mode": "interactive"
}
```

## Concurrency and Locking

### Session Lock (`scripts/lib/session-lock.js`)

**Purpose:** Prevent concurrent modifications to session state.

**Functions:**

- **`acquireLock(sessionId)`**
  - Creates lock file: `.amber/sessions/<sessionId>/session.lock`
  - Contains: PID, hostname, timestamp
  - Returns lock handle or throws if already locked

- **`releaseLock(sessionId, lockHandle)`**
  - Removes lock file
  - Validates lock ownership

- **`isLocked(sessionId)`**
  - Checks if lock file exists
  - Validates lock is still active (checks PID)

**Lock File Format:**
```json
{
  "pid": 12345,
  "hostname": "dev-machine",
  "acquiredAt": "2026-06-21T10:00:00Z"
}
```

## Daemon Mode

### Daemon Manager (`scripts/lib/daemon.js`)

**Purpose:** Run sessions in the background.

**Functions:**

- **`startDaemon(sessionId)`**
  - Forks process
  - Detaches from terminal
  - Writes PID to `.amber/daemon.pid`
  - Redirects logs to `.amber/logs/harness.log`

- **`stopDaemon()`**
  - Reads PID file
  - Sends SIGTERM to daemon process
  - Waits for graceful shutdown

- **`daemonStatus()`**
  - Checks if daemon is running
  - Returns: PID, uptime, active sessions

## Error Handling and Recovery

### Error Recovery (`scripts/lib/error-recovery.js`)

**Purpose:** Graceful degradation and recovery strategies.

**Functions:**

- **`retryStage(sessionId, stageIndex, maxAttempts, backoffMs)`**
  - Implements exponential backoff retry
  - Records retry attempts in timeline
  - Falls back to checkpoint on repeated failure

- **`recoverFromError(sessionId, error)`**
  - Determines if error is recoverable
  - Suggests recovery actions
  - Returns recovery plan

**Recoverable Errors:**
- Network timeouts
- Transient API failures
- Resource exhaustion

**Unrecoverable Errors:**
- Schema validation failures
- Missing route definitions
- Corrupt session data

## Observability

### Structured Logging (`scripts/lib/logger.js`)

**Purpose:** JSON-structured logging for production debugging.

**Log Format:**
```json
{
  "timestamp": "2026-06-21T10:00:00Z",
  "level": "info",
  "component": "execution-engine",
  "sessionId": "abc-123",
  "message": "Stage completed",
  "metadata": { "stage": "implement", "durationMs": 45000 }
}
```

### Metrics Collection (`scripts/lib/metrics-collector.js`)

**Purpose:** Track session performance and success rates.

**Metrics:**
- Session duration (p50, p95, p99)
- Stage execution times
- Success/failure rates by route
- Gate approval rates
- Retry counts

## Testing Strategy

### Unit Tests
- Session commands: Creation, state transitions, listing
- Execution engine: Stage dispatch, error handling
- Gate handler: Approval logic, policy evaluation
- Checkpoint manager: Snapshot/restore cycles

### Integration Tests
- Full session lifecycle
- Concurrent session execution
- Checkpoint restore across restarts
- Autonomous mode end-to-end

### E2E Tests
- Real route execution
- Gate interaction workflows
- Error recovery scenarios
- Daemon lifecycle

### Load Tests
- 100 sequential sessions (performance baseline)
- Timeline throughput (1000 events)
- Concurrent session execution

## Design Principles

1. **Immutability**: Never mutate manifest in-place; always create new objects
2. **Append-only timeline**: Events are never deleted or modified
3. **Idempotent operations**: Commands can be safely retried
4. **Graceful degradation**: Non-critical failures don't crash sessions
5. **Observability-first**: All state changes logged to timeline
6. **Process isolation**: Daemon runs detached from CLI

## Future Extensions

- Distributed sessions (multi-machine execution)
- Session templates (pre-configured workflows)
- Session forking (branch from checkpoint)
- Real-time session streaming
- Session analytics dashboard
- Custom stage executors
