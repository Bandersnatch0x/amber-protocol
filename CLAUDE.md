# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Operating manual: `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md` — boundaries, gates, evidence, and routing rules; read before nontrivial tasks.

## Project Overview

**Amber Protocol** (formerly Coding Harness) is a repository-local governance and control layer for agent-assisted engineering. It provides installation, auditing, validation, and maintenance capabilities for project files that help agents understand codebases, track feature state, and hand off work cleanly.

**Product Boundary:** Amber is a governance-first protocol layer, NOT a general agent framework or execution platform. It focuses on constraining, verifying, auditing, and handing off agent work safely inside a repository.

## Governance Philosophy: Operational Ontology Positioning

Amber's core mission is to give coding agents a repository-local, auditable,
handoff-able governance layer. The operational-ontology paradigm (as analyzed
in `docs/wiki/amber-ontology-mcp.md`) frames this as moving from a
_descriptive_ protocol — one that records what exists (sessions, routes,
wiki pages, evidence) — toward an _operative_ one: the protocol itself
exposes governed operations that agents can call through typed, auditable
Action Types (`schemas/action.type.schema.json`).

Three principles follow:

1. **Verbs are first-class.** A session isn't just a manifest; it is
   something that can be started, verified, approved, and closed through
   declared operations. Each operation states its parameters, submission
   criteria, effects, rollback behavior, and evidence requirements.
2. **Governance is intrinsic, not bolted on.** Approval gates, ledger
   writes, and evidence records are part of the operation contract itself.
   There is no sanctioned path that bypasses `governed-runner.js`.
3. **Agents operate through Amber, not around it.** External agents reach
   the repository through the protocol's governed surface. Amber never
   auto-executes target-project commands, dispatches live agents, or runs
   dynamic workflows on behalf of others.

This positioning does not change what Amber executes; it gives the
product boundary a stable vocabulary that the MCP bridge
(`scripts/amber-mcp.js`) and OAG query layer (`amber.object.query`) are
built against.

## Core Architecture

### Module Organization

```
scripts/amber.js              -> Unified CLI entry point
scripts/amber-mcp.js           -> P1 stdio MCP server exposing governed Action Types (see docs/wiki/amber-ontology-mcp.md)
scripts/lib/command-help.js -> Command definitions, help, output policy, and stable public order
scripts/lib/command-dispatcher.js -> Command handlers, startup registry binding, and dispatch
scripts/lib/context/          -> Public Context Interface and command adapter boundary
scripts/lib/core/             -> Domain modules (adoption-*, loops, doctor, profiles, etc.); imported directly (no facade — ADR-0005)
scripts/lib/core/context-*.js -> Context lifecycle, assurance evidence, projections, benchmarks, source adapters, retention, and Loadout assembly
scripts/lib/core/governed-runner.js -> Governed execution gates (ledger, policy, confidence, approval, worktree)
scripts/lib/core/agent-orchestration.js -> Artifact-only worker/reviewer dispatch records and approval markers
scripts/lib/migrate-command.js -> Schema migration and ADR-0012 version backfill for recognized artifacts
scripts/lib/route-commands.js -> Route engine (loader, selector, inspector)
scripts/lib/session-commands.js -> Session lifecycle (start, status, list, abort, continue)
templates/                    -> Amber starter files (AGENTS.md, CLAUDE.md, feature_list.json, etc.)
routes/                       -> Route definitions (feature-standard, bugfix-quick, refactor-safe)
schemas/                      -> JSON Schema validation (route, session-manifest, timeline-event, action.type)
action-types/                 -> Governed Action Type whitelist consumed by scripts/amber-mcp.js
workflow-packs/               -> Declarative workflow packs
skills/                       -> Agent-facing skill instructions (amber-init, amber-audit, etc.)
profiles/                     -> Project profiles
src/migration/                -> Migration utilities (dry-run, rollback, schema-validator)
apps/web/                     -> Phase C web viewer (Vite + React + tRPC)
```

### Control Layers (Priority Order)

1. **Governance** (Highest) - Approval records, policy boundaries, adoption controls
2. **Verification** (High) - Doctor, audit, validation, review, gate surfaces
3. **Observability** (High) - Timelines, manifests, ledgers, reports
4. **Lifecycle** (Medium) - Routes, sessions, checkpoints, worktrees
5. **Context** (Medium) - Starter docs, wiki scaffolds, manifests, handoff artifacts
6. **Tooling** (Medium) - CLI commands, schemas, validators, workflow packs
7. **Execution** (Low) - Minimal; avoids becoming a live agent platform

## Common Commands

### Core Operations

```bash
# Install Amber files (idempotent, skips existing files)
node scripts/amber.js init --target path/to/repo

# Audit existing project (read-only)
node scripts/amber.js audit --target path/to/repo --summary

# Create/validate wiki skeleton
node scripts/amber.js wiki --target path/to/repo --dry-run

# Validate Amber setup
node scripts/amber.js doctor --target path/to/repo

# Generate handoff report
node scripts/amber.js handoff --target path/to/repo
```

### Route Engine

```bash
# List available routes
node scripts/amber.js route list

# Inspect route definition
node scripts/amber.js route inspect feature-standard

# Validate route file
node scripts/amber.js route validate routes/feature-standard.route.json

# Test route (dry-run)
node scripts/amber.js route test bugfix-quick --dry-run
```

### Session Lifecycle

```bash
# Start new session
node scripts/amber.js session start --goal "fix login bug"
node scripts/amber.js session start --goal "add feature" --mode interactive

# Check session status
node scripts/amber.js session status

# List all sessions
node scripts/amber.js session list

# Abort session
node scripts/amber.js session abort <session-id>

# Continue from checkpoint
node scripts/amber.js session continue
```

### Adoption (for existing projects)

```bash
# Generate adoption report
node scripts/amber.js adoption report --target path/to/project --output-dir docs/examples/adoptions

# Create adoption bundle
node scripts/amber.js adoption bundle --reports-dir docs/examples/adoptions --index docs/examples/adoptions-index.md --output-dir docs/examples/project-adoption-bundle

# Gate check
node scripts/amber.js adoption gate --reports-dir docs/examples/adoptions

# Generate next actions
node scripts/amber.js adoption next-actions --bundle-dir docs/examples/project-adoption-bundle --output docs/examples/project-adoption-next-actions.md
```

### Migration

```bash
# Inspect the repository without writing, then merge legacy .harness into .amber
node scripts/amber.js audit --target .
node scripts/amber.js migrate state --target .
```

### Testing & Validation

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:load        # Load tests
npm run test:e2e         # E2E tests

# Validate manifests
npm run manifests

# Run doctor check
npm run doctor
```

### Web Viewer (Phase C)

```bash
cd apps/web
npm install --legacy-peer-deps
npm run dev              # Start dev server (client + backend)
npm run dev:client       # Vite dev server only
npm run dev:server       # Express + tRPC server only
npm run build            # Production build
npm test                 # Run Vitest tests
npm run test:e2e         # Run Playwright tests
```

### Weekly self-dogfood ritual

Each week, drive one real piece of work through the full Amber session lifecycle
(`plan → gate → verify --execute → approve → complete → accept → handoff`) and log
every UX friction as a `next-up` issue. This is the continuous, cheap replacement
for episodic external pilots. Full ritual, command template, exit criteria, and
the first-round candidate list live in **[`docs/dogfood-weekly.md`](docs/dogfood-weekly.md)**.

## Development Notes

### Key Design Principles

1. **Idempotency**: `init` and `wiki` commands skip existing files; re-running is safe
2. **Read-Only by Default**: `audit` and adoption reports never modify target projects
3. **Dry-Run First**: Planning and review commands generate artifacts before execution
4. **Safety Boundaries**: V1 does NOT execute dynamic workflows, dispatch live agents, or auto-rewrite existing project docs
5. **Schema-Driven**: All route/session/timeline structures are validated against JSON Schema

### Non-Goals (Critical)

- Not allowed: Dynamic Workflow execution
- Not allowed: Live subagent runner invocation
- Not allowed: Automatic target project command execution
- Not allowed: External marketplace publishing
- Not allowed: Automatic rewrite of existing target project docs
- Not allowed: Scheduled loop execution (current product boundary)

See `LOOP.md` for the operational description of Amber's loops (daily-amber-triage via contract + CI dogfooding + continuous improvement). Amber implements governed loop engineering — pair it with external `npx @cobusgreyling/loop-audit` and loop patterns for readiness scoring and simple STATE.md overlays.

> **Boundary note (governance enforcement):** Amber MAY install an **opt-in** git pre-commit guard
> (`amber hooks install`) that enforces governance _metadata_ at commit time (e.g. a feature marked
> complete must carry evidence). This is Governance-layer enforcement, not execution - the guard
> reads metadata only and still does **not** run target project build/test commands or dispatch
> agents. It is never installed automatically.

> **Boundary note (governed execution, ADR-0003):** Amber MAY run a loop contract's declared
> `governed.command` via `amber loop run --execute`, but ONLY behind four gates — policy
> (`.amber/governance/rules.json`), an explicit `amber loop approve` (one approval ⇒ one run),
> an isolated git worktree, and a tamper-evident ledger (`amber loop verify-ledger`). This is
> governance-gated, human-triggered execution, NOT autonomous or scheduled work. Cron/daemon
> scheduling, external writes, auto-approval, and agent tool-call interception remain disallowed.
> `loop run` is dry-run unless `--execute` is passed and an approval exists.

### File Conventions

- **Templates** (`templates/`): Safe defaults for AGENTS.md, CLAUDE.md, feature_list.json, etc.
- **Routes** (`routes/`): JSON definitions with stages, gates, and triggers
- **Sessions** (`.amber/sessions/` or `.harness/sessions/`): Session manifest, timeline.jsonl, checkpoints
- **Schemas** (`schemas/`): JSON Schema Draft 2020-12 validation definitions
- **Wiki** (`docs/wiki/`): Project context skeleton (architecture, runbook, verification, glossary)

### Testing Strategy

- **Unit tests**: `tests/unit/` - Core logic, schemas, validators
- **Integration tests**: `tests/integration/` - Route/session workflows
- **E2E tests**: `tests/e2e/` - Full command flows
- **Load tests**: `tests/load/` - Sequential session stress tests
- **Migration tests**: `tests/migration/` - Legacy state migration
- **Security tests**: `tests/security/` - Boundary checks

### Legacy Compatibility

- Legacy `.harness/` state is readable via built-in shims
- `coding-harness` entrypoint remains available via `scripts/compat/coding-harness.js`
- `scripts/harness.js` is aliased to `scripts/amber.js`
- Use `node scripts/amber.js migrate state --target .` to convert legacy state to the Amber layout

### Web Viewer Architecture

- **Frontend**: Vite + React 18 + TanStack Router + TanStack Query
- **Backend**: Express 5 + tRPC 10
- **Styling**: Tailwind CSS
- **Testing**: Vitest (unit) + Playwright (E2E)
- **Server runs on**: `localhost:3001` (configurable via PORT env var)
- **Client runs on**: `localhost:5173` (Vite default)

### Common Gotchas

1. **Web app uses `--legacy-peer-deps`**: Required for current dependency resolution
2. **Daemon commands exist but are lower-level**: Not documented in main README; used internally by execution engine
3. **Loop commands are dry-run/inspect only**: `readyForLiveScheduling` is `false` by product boundary
4. **Route/session schemas are versioned**: Check `schemaVersion` field; migration utilities exist in `src/migration/`
5. **Agent instructions live in `skills/`**: These are NOT general coding patterns; they're task-specific agent workflows

### When Working on This Codebase

- **Adding new commands**: Add the Command definition (identity, help, output policy, public order) in `scripts/lib/command-help.js`, implement the handler in `scripts/lib/command-dispatcher.js` (or a dedicated `*-commands.js` module bound there), and keep registry parity tests green
- **Modifying schemas**: Update `schemas/*.schema.json` and ensure validators in `scripts/validate-*.js` are synced
- **Adding templates**: Place in `templates/` and update `scripts/lib/core/scaffolding.js`
- **Adding routes**: Create `.route.json` in `routes/` following `schemas/route.schema.json`
- **Migration changes**: Add utilities to `src/migration/` with dry-run support

### CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on pushes and PRs:

- Tests on Node 18.x, 20.x, 22.x
- Manifest validation
- Doctor checks
- CLI smoke tests
- Release dry-run on all `v*` tags; stable `v*.*.*` tags (no `-rc`/`-beta` suffix) auto-publish to npm after all jobs pass

## Agent skills

### Issue tracker

Issues live in GitHub (`Bandersnatch0x/amber-protocol`); use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles with default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at repo root + `docs/adr/`. See `docs/agents/domain.md`.
