---
module: amber-protocol
role: governance-layer
entry_point: scripts/amber.js
boundary: repository-local
scope: root
safety:
  - read-only-first
  - never-overwrite-user-files
  - executesAnything: false
---

# AGENTS.md

Amber Protocol is a repository-local governance layer for agent-assisted engineering.
All capability is exposed through one CLI entry point.

Operating manual: `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md` — boundaries, gates, evidence, and routing rules; read before nontrivial tasks.

## Entry point

```bash
node scripts/amber.js <command> --target <repo>
```

## Core commands

Default `amber` help projects the journey entry (`next`) and core governance commands below.
Use `node scripts/amber.js --all` for deprecated and expert compatibility commands.

- `node scripts/amber.js init --target <repo>` - install the V1 scaffold (skips existing files).
- `node scripts/amber.js audit --target <repo>` - read-only readiness inspection.
- `node scripts/amber.js wiki --target <repo>` - create/validate the wiki skeleton.
- `node scripts/amber.js doctor --target <repo>` - validate the Amber setup.
- `node scripts/amber.js handoff --target <repo>` - validate session handoff state.
- `node scripts/amber.js governance report --target <repo>` - score readiness, risks, and structured next actions.
- `node scripts/amber.js handoff bundle --target <repo>` - produce the portable continuation bundle.
- `node scripts/amber.js handoff validate --target <repo>` - verify the handoff bundle is complete.
- `node scripts/amber.js context request --target <repo> --page <id>` - write a distillation contract; `ingest`/`verify`/`refresh`/`stats` close the loop (ADR-0009).
- `node scripts/amber.js memory <request|ingest|approve|book|abandon|status> --target <repo>` - governed MEMORY.md write-back pipeline (ADR-0018); humans curate MEMORY.md, Amber admits/approves/registers.
- `node scripts/amber.js route list` - list available routes.
- `node scripts/amber.js session status` - inspect the current session.
- `node scripts/amber.js artifact <admit|show|list> --target <repo>` - admit and read Canonical Planning Artifacts (F049; ADR-0023): each revision binds a human-readable Body to a machine-actionable Envelope in one atomic, journal-settled admission; only committed revisions are visible and history is append-only. `--type decision` (F050) binds the acting Principal (`--principal`, verified against the Principal registry) and its kind (`--decision-kind acceptance|approval|review`; acceptance/approval are human-only slots).
- `node scripts/amber.js principal <register|show|list|revoke> --target <repo>` - govern the Principal registry (F050): humans and service identities that can act with authority, each binding identity, kind, role, membership, capability, scope, validity window, issuer, and terminal revocation state in a tamper-evident append-only ledger under `.amber/principals/`.
- `node scripts/amber.js evidence <record|verify|show|list> --target <repo>` - record and independently verify Evidence receipts (F050) under `.amber/evidence/`: each binds producer (a registry-verified Principal snapshot), scope, subject, inputs, tools, environment, time, status, and outputs to the fixed four-level Assurance contract (`unavailable|observed|replayable|verified`); `verified` is never recordable — only an independent registered Principal's verification event (verifier id ≠ producer id) promotes effective assurance, and `replayable` requires named replay provenance.
- `node scripts/amber.js approval <grant|revoke|consume|show|list> --target <repo>` - govern Approval records (F050) under `.amber/approvals/`: the human authorizations a Decision settles under — scoped, expiring (half-open `[validAt, validUntil)`, no clock-skew tolerance), revocable, and single-use. `consume` settles the authorized Decision atomically with the consumption (decisionKind `approval`, principal = the frozen approver; failed admission leaves the authorization unconsumed), so one authorization can never be replayed; approver/revoker slots are human-only; the hash-chained ledger fails every read closed on in-place edits and derives the effective status (`granted|revoked|consumed|expired`) at read time.
- `node scripts/amber.js gate <evaluate|show|list> --target <repo>` - evaluate Gate Contracts deterministically (F050) and read their immutable outcomes: a Gate Contract is a canonical artifact of the registered `gate` type whose content (required Evidence types, Assurance levels, thresholds with registered comparators, bounded explicit `anyOf`, owners, expiry, freshness bounds, deny-only failure behavior) rides the Envelope's `extensions` carrier under the `gate` namespace — admission through a Gate is decided by that reviewable contract, never by hidden weights or model confidence. Evaluation is fail-closed (`allOf` over `gate.require` plus bounded explicit `anyOf`; stale, missing, or failed Evidence never satisfies a current Gate; an expired Gate refuses to run) and appends one immutable `evaluated` event per run to the hash-chained ledger under `.amber/gates/outcomes.jsonl` — a pass is never silently revised, and a fail verdict is a recorded outcome (exit 0), not a command error. A bare `amber gate --plan <path>` keeps the legacy plan gate-check unchanged.
- `node scripts/amber.js policy <evaluate|show|list> --target <repo>` - evaluate deny-wins Policy Contracts for strict consumption (F050): org and tenant Policy are required and form the non-relaxable ceiling, optional repo/play/gate policies may only tighten, and missing/stale/unsupported/conflicting policy refuses before any outcome is appended. Evaluation binds a consumed Approval, a passing Gate Outcome, subject, submitter, capability, policy hashes, separation-of-duties actors (submitter, approver, Evidence producer, verifier), and any direct org/tenant-scoped delegation (bounded by the delegator Principal's own capability/scope) into an immutable hash-chained Policy Outcome under `.amber/policies/outcomes.jsonl`; self-approval/self-production/self-verification and absent/expired/non-matching delegation deny strict consumption.
- `node scripts/amber.js eval run --target <repo>` - replay the deterministic instruction-surface Eval suite (F050 Evidence; F058): MCP tool descriptions, Context quote boundary, breadcrumb authenticity. Report-only; not Approval; does not call a model. `node scripts/amber.js eval admit --target <repo> --producer <principal> --yes` is the explicit F050 T7 admission path: it admits canonical `eval` definition + `eval-result` artifacts and records a normal replayable Evidence receipt that can later be independently verified.
- `node scripts/amber.js projection rebuild --type governance-graph --target <repo>` - rebuild the Governance Graph (the only graph projection; ADR-0021) from context pages plus every committed artifact revision: one node per committed revision, one typed edge per resolved Trace (`refines`/`realizes`/`supersedes`). Deterministic rebuild with a receipt recording the source checkpoint, rule and schema versions, and result hash; `projection query --scope <type>/<identity>@<revision>` reads bounded neighborhoods; `projection strict-query` requires exact scope/checkpoint/projection-version/limit/sort/depth and expiring cursors, while `projection invalidate` appends scoped staleness receipts that make affected strict queries fail closed. The projection is read-only (never writes or repairs artifacts) and fails closed on a corrupt store.
- `node scripts/amber.js sync session push --target <repo>` - report-only transport preparation (F040 structured report); `approve --reviewer <name>` + `push --execute --yes` performs the ADR-0020 Stage A governed local commit (add + commit behind identity, policy, single-use approval, and path-and-state confinement; `git push` is never executed); `ledger` verifies the transport ledger chain.
- Deprecated adoption reports remain available via `node scripts/amber.js --all` and `amber adoption --help`; prefer the diagnosis/adoption journey for new work.
- `node scripts/amber.js plan --target <repo> --feature <feature-id> --title "<title>"` - scaffold a feature plan.
- `node scripts/amber.js loop recommend` / `loop run --dry-run` — safe continuous improvement entrypoints (see LOOP.md).
- `node scripts/amber.js next --objective "<goal>" --target <repo>` - deterministic route advice; never an LLM decision.
- `node scripts/amber.js learnings --target <repo> --feature <id>` - inspect post-accept knowledge write-back triggers; `--reviewed` books the review (Amber never writes the docs itself).
- `node scripts/amber.js break-loop --target <repo> --issue <n> --title "<t>" --recurrence <n>` - scaffold a post-mortem for a defect class that recurred (>=2); `validate --file <path>` refuses placeholder content.

## Safety boundaries

- Read-only / dry-run first; `init` and `wiki` never overwrite existing files.
- Amber does not auto-execute target-project commands, dispatch live agents, or run dynamic workflows.
- Never overwrite user-authored files without explicit approval.
- Amber never runs `git push`. The one gated exception to "no live git": ADR-0020 Stage A
  (`amber sync session push --execute --yes`) performs the local `git add` + `git commit` of sync
  envelopes behind identity, policy, single-use approval, path-and-state confinement, and a
  tamper-evident transport ledger; every other git interaction stays read-only.

## Governance philosophy (operational-ontology positioning)

Amber is positioned as an operational-ontology governance layer: agents act
_through_ Amber's governed surface, not around it. The protocol exposes
verbs (Action Types, `schemas/action.type.schema.json`) on top of the
objects it already manages (sessions, routes, wiki, evidence). Design
reference: `docs/wiki/amber-ontology-mcp.md` — the P1 stdio MCP server
(`scripts/amber-mcp.js`) and P2 OAG query layer (`amber.object.query`)
are implemented. F018 enforces the governance seam: only registry-proven
read-only variants execute without approval; every mutating operation is
returned as approval-required and is never spawned by the adapter; corrupt
governance state and non-zero command results fail closed (`isError`); and
every Action/Function is confined to repositories configured at startup
(`scripts/lib/mcp-targets.js`, `scripts/lib/mcp-action-contracts.js`).

See also `LOOP.md` (loop engineering self-description) and the explicit `execution: { executesAnything: false }` rule in all Amber loop contracts.

## Skills & commands

`skills/<name>/SKILL.md` is the single source of truth. Run `npm run gen:agents` to
regenerate every platform product (edit `skills/`, never the generated files;
`npm run gen:agents:check` guards against drift in CI).

This repo also follows loop-engineering patterns (see LOOP.md). Skills in `skills/` can be used directly from Grok `/loop`, Claude `$skill`, etc. The `amber-continuous-improvement` skill implements a governed form of daily triage.

Use the user-invoked `amber` router to choose among four deep journeys: `amber-delivery`,
`amber-diagnosis-adoption`, `amber-context-continuity`, and `amber-continuous-improvement`.
The journey skills compose deterministic CLI primitives; they do not add execution authority.

- **Claude Code** - loaded via `.claude-plugin/` -> `skills/`; manual slash commands in `.claude/commands/`.
- **Codex & Cursor** - skills mirrored to `.agents/skills/` (the shared open-standard location both read natively).
- **Gemini CLI** - manual commands in `.gemini/commands/amber/`.
