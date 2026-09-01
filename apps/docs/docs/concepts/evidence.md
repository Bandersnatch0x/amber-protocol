---
id: evidence
title: "Evidence & Assurance Model"
sidebar_label: "Evidence & Assurance"
description: "Four assurance levels (unavailable, observed, replayable, verified) and tamper-evident receipts."
---

# Evidence & Assurance Model

Amber enforces a strict **Four-Level Assurance Contract** for all claims, test runs, lint passes, and benchmark results produced during development.

## The 4 Assurance Levels

| Level | Name | Meaning & Requirements |
| --- | --- | --- |
| `0` | **unavailable** | Evidence is missing, expired, failed, or unverifiable. |
| `1` | **observed** | An unverified claim made by a producer or self-reported by an agent. |
| `2` | **replayable** | Evidence that includes named replay provenance (command, environment, inputs, working directory) and deterministic exit codes. |
| `3` | **verified** | Promoted *only* through an independent registered Principal's verification event (where `verifier_id ≠ producer_id`). |

## Evidence Receipts

Every evidence event is recorded in `.amber/evidence/receipts.jsonl` as a cryptographic hash-chained receipt:

```json
{
  "receiptId": "ev-20260901-001",
  "producer": "principal://service/ci-runner",
  "assuranceLevel": "replayable",
  "subject": "tests/unit/public-docs-seam.test.js",
  "command": "npm test",
  "exitCode": 0,
  "timestamp": "2026-09-01T10:00:00Z",
  "chainHash": "a1b2c3d4..."
}
```

Receipts cannot be modified in place without breaking the hash chain.
