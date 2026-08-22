# Plan: Governed Memory Layer batch A

Feature: F033
Status: accepted
User Confirmation: confirmed

## Goal

amber memory request/ingest/approve/book/abandon/status govern the MEMORY.md write-back pipeline: nominations are mechanically admitted under schema, binding, signal, alpha and gamma gates; humans approve entry-by-entry; book registers the surface hash; doctor enforces ledger-registry consistency, source health, and drift rules

## High Level Design

- Context:
  - ADR-0018 and docs/specs/2026-08-21-governed-memory-layer.md define the
    Governed Memory Layer: a four-tier memory model whose L3 surface
    (MEMORY.md) stays human-curated while Amber owns admission, approval,
    registration, and audit through a five-verb CLI surface.
  - The spec's §13 batch A checklist (12 steps) is a single atomic PR:
    command-family registration (four tables + typed seam whitelist), exactly
    three action types, the data substrate (registry, requests, shared
    events.jsonl ledger, 12 AMBER_E_MEMORY_* codes), two schemas, the test
    face, docs surfaces, and skills propagation via gen:agents.
  - Amber never writes MEMORY.md; every mutation stays inside
    `.amber/memory/` plus append-only `memory-*` ledger events. Memory
    commands spawn nothing and never execute target-repo code
    (executesAnything: false).
- Proposed approach:
  1. Register `memory` in the command registry (COMMANDS/COMMAND_HELP/
     COMMAND_OUTPUT/TIER_BY_COMMAND, tier core), extend the action-type
     schema `execution.command` enum, and add exactly three capabilities
     (memory/approve, memory/abandon, memory/status) with
     KNOWN_UNTYPED_SUBCOMMANDS covering request/ingest/book.
  2. Implement the verb business logic in scripts/lib/memory-commands.js over
     a minimal data layer (scripts/lib/core/memory-store.js): request
     (payload + identity gate), five-stage all-or-nothing ingest (ajv →
     per-source hash binding → signal closed set → α projection → γ rolling
     quota → K1/K2/K3-ranked admission with F3 abandoned exclusion), the
     human approve gate (entry-level, β pair atomicity, reject→draft),
     book (surface hash registration, dual origin, needs-re-review reset),
     abandon (terminal marker), and the read-only three-section status
     projection.
  3. Enforce the §11 doctor rules 1–11 (ledger-registry consistency,
     source health with mechanical needs-re-review transitions, best-effort
     pointers, surface drift with the two-choice remedy, budget/rate
     compliance, α forced review, ratification-class, acknowledged
     gitignore divergence, pack triplet identity, git detection, abandoned
     statistics) and surface the §6.1 nomination channel mix in the
     governance report.
  4. Cover the whole face with tests: the §14-5 dogfood chain replay, §4.1
     state-machine edges, gate negatives, F1(i)/F3 lineage rules, doctor
     positive/negative cases, MCP tools/list exactly-three + approval
     semantics, CLI seam gating, and a real `amber memory status --json`
     invocation.
- Risks:
  - Doctor-owned state transitions (rules 2/4) write registry files during a
    nominally read-only command; this is spec-mandated (§11 "状态迁移") and
    leaves the ledger untouched — the finding is the record.
  - Source-drift re-review is deliberately oscillating (§4.1): re-book only
    re-registers the surface hash; durable exits are supersede/abandon.
  - T1/T2 auto-trigger mounting (spec §5.1) is NOT in batch A; the verb
    surface is complete but currently human/escape-hatch driven only.

## Context manifests

Entries are bare, comma- or space-separated knowledge-surface paths only — docs/specs contracts, wiki pages, ADRs, schema docs; code paths belong in the feature's booked paths, not here.
- implement: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md, docs/wiki/amber-ontology-mcp.md, schemas/memory-request.schema.json, schemas/memory-entry.schema.json
- review: docs/specs/2026-08-21-governed-memory-layer.md, docs/adr/0018-governed-memory-layer.md, docs/wiki/amber-ontology-mcp.md

## Vertical Slices

- [x] Slice 1: registration + data substrate — four tables, typed seam
  whitelist, three action types, two schemas, memory-store, twelve error
  codes, dispatcher handler.
- [x] Slice 2: five-verb business logic — request/ingest/approve/book/
  abandon/status with identity gates, five-stage ingest, β pair, F1(i)/F3
  lineage rules, status projection.
- [x] Slice 3: judgment surfaces — doctor rules 1–11, governance report
  nomination channel mix, MEMORY.md template entry format, scaffold
  gitignore advisory, memory-maintenance workflow pack.
- [x] Slice 4: test + docs face — memory-commands integration suite,
  MCP/contract/seam/schema/registry test extensions, CLI_REFERENCE,
  ontology wiki, AGENTS/README command lists, skills propagation and
  gen:agents regeneration.

## Resume Checkpoint

- Resume Point: implementation and full verification complete; independent
  two-axis review in flight.
- Blockers: none.
- Next Action: close the independent review, book evidence, flip F033 to
  passing, commit batch A as one atomic PR.
- Recovery Instructions: reopen this plan and continue at the first unchecked
  vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- The user-visible behavior is demonstrably satisfied.
- Existing Amber guardrails still pass.

## Verification

- node --test tests/integration/memory-commands.test.js
- node --test tests/unit/cli-typed-seam.test.js tests/unit/mcp-action-contracts.test.js tests/integration/action-type-schema.test.js
- npm test

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
