# Plan: Loop no-progress reporting

Feature: F015
Status: accepted
User Confirmation: confirmed

## Goal

Loop status reports bounded no-progress signals from recorded ledger history without executing or scheduling work.

## High Level Design

- Context: `loop status --ledger <file>` currently validates one recorded ledger object and returns it unchanged. Future Track requires no-progress detection over repeated observations, unchanged evidence deltas, repeated stop reasons, and budget exhaustion.
- Proposed approach: preserve single-file behavior; when `--ledger` points to a directory, load at most the newest 100 `*.json` ledger records in deterministic chronological order. Feed valid records to a pure progress assessor and retain valid history when individual files are corrupt.
- Progress outcome: `insufficient-history`, `progressing`, or `stalled`, plus explicit signal counts and concrete remedies. A stalled decision requires conservative repeated evidence; one empty or repeated record is never enough, except an explicit budget-exhausted stop reason.
- Boundaries: read-only analysis only. No commands execute, no jobs schedule, no external systems are called, and no ledger files are written or rewritten.
- Risks: false-positive stalls from legitimate repeated dry-runs; mitigate with explicit thresholds, transparent signals, deterministic ordering, and tests for changing evidence. Large/corrupt history could be noisy; cap history and report redacted per-file warnings while retaining valid records.

## Vertical Slices

- [x] Slice 1: add a pure bounded `assessLoopProgress(records)` outcome with unit coverage for insufficient history, repeated observations, empty evidence deltas, repeated stop reasons, budget exhaustion, and resumed progress.
- [x] Slice 2: extend `inspectLoopLedger` to accept a ledger directory, load newest valid JSON records deterministically with a 100-record cap, preserve single-file compatibility, and expose partial-history warnings.
- [x] Slice 3: update `loop status` help/reference and integration coverage; verify execution boundary flags stay false and existing single-record output remains compatible.

## Resume Checkpoint

- Resume Point: all three F015 slices implemented, verified, reviewed, and accepted.
- Blockers: none.
- Next Action: none for F015; use `loop status --ledger <file-or-directory> --json` for bounded no-progress inspection.
- Recovery Instructions: review feature F015 evidence and session `595182bf-419e-45f8-8e89-63ea810a688e`; do not widen the live-scheduling boundary without a new approved plan.

## Acceptance Criteria

- A single ledger file still returns `record` with its historical fields and adds `progress.state: insufficient-history` without changing the file.
- A ledger directory returns valid records in deterministic chronological order, bounded to the newest 100 records; corrupt records become warnings and do not discard retained valid history.
- Two or more equivalent tail observations with empty artifact/replay-evidence deltas produce transparent no-progress signals; changed evidence reports `progressing`.
- Repeated stop reasons and explicit budget-exhausted stops are surfaced with concrete remedies without fabricating execution evidence.
- Every status outcome reports `executesAnything: false`, `schedulesJobs: false`, and `callsExternalSystems: false`.
- Existing Amber guardrails still pass.

## Verification

- node --test tests/phase-future-loop-readiness.test.js
- npm test

## Evidence Schema

- Command:
- Result:
- Date:
- Notes:
