---
id: boundaries
title: "Safety Boundaries & Privacy Posture"
sidebar_label: "Safety Boundaries"
description: "Formal statement of safety constraints: zero telemetry, no autonomous execution, no remote agent dispatch."
---

# Safety Boundaries & Privacy Posture

Amber Protocol enforces strict architectural boundaries to guarantee safety, privacy, and non-execution integrity.

## Zero-Telemetry Posture

Amber Protocol believes that developer tooling and governance infrastructure must not track user behavior or leak codebase context:

- **Zero Third-Party Analytics**: Neither the documentation site nor the CLI includes Google Analytics, telemetry beacons, tracking pixels, or remote logging services.
- **Local Build-Time Search**: Site search is powered by a pre-built local index (`@easyops-cn/docusaurus-search-local`). Queries never leave your browser.
- **Offline Capable**: Normal reading, search, and CLI operations require no active internet connection.
- **Future Policy Gate**: Any proposal to introduce usage analytics requires a formal, explicit governance decision rather than an implementation-side override.

## Safety & Non-Execution Boundaries

**No dynamic workflow execution.** Amber records, verifies, and gates work; it never runs a dynamic workflow, dispatches a live agent, or schedules a loop run on your behalf. Everything that executes does so inside a declared, approval-gated route.

| Boundary Dimension | Enforcement Mechanism | Failure Mode |
| --- | --- | --- |
| **No Dynamic Code Execution** | Amber does not automatically run tests or target build scripts unless explicitly instructed via `--execute`. | Operation refuses or records claim as unverified. |
| **Confined File Writes** | Mutations are confined strictly to `.amber/` within the target repository. | Path traversal (`../`) rejected immediately. |
| **No Silent Overwrites** | `init` and `wiki` skip existing user-authored files. | File untouched; skipped notification printed. |
| **Fail-Closed Security** | Corrupt ledgers, invalid signatures, or missing approval tokens halt execution. | Process exits with non-zero exit code. |
| **Single-Use Approvals** | Human authorizations expire and settle atomically with exactly one decision. | Replay attempts fail closed. |
| **No Dynamic Workflow Execution** | Route stages run only behind owner proof, a live lease, an explicit approval, and the session ledger; no live agent is ever started by Amber. | Stage is refused; the governed lifecycle must be used instead. |
