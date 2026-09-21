---
id: schemas
title: "Declarative JSON Schemas"
sidebar_label: "JSON Schemas"
description: "Overview of core JSON schemas: session, timeline, route, manifest, handoff, and action types."
---

# Declarative JSON Schemas

Amber Protocol uses declarative JSON Schemas (Draft 2020-12 / Draft 7) to validate all state files, manifests, timeline events, and runtime payloads.

All schemas are compiled and validated through `scripts/lib/core/schema-contract.js`.

## Core Schema Definitions

| Schema File | Domain / Target | Key Validated Properties |
| --- | --- | --- |
| `schemas/session.schema.json` | `.amber/sessions/<id>/manifest.json` | `sessionId`, `goal`, `routeId`, `budget`, `worktree`, `createdAt`, `status` |
| `schemas/session-timeline.schema.json` | `.amber/sessions/<id>/timeline.jsonl` | `eventId`, `timestamp`, `type`, `stage`, `checkpoint`, `payload` |
| `schemas/route.schema.json` | `routes/*.route.json` | `id`, `version`, `goalPattern`, `stages`, `gatePoints`, `requiredArtifacts` |
| `schemas/action.type.schema.json` | `action-types/*.json` | `name`, `type`, `parameters`, `returns`, `isMutating`, `requiresApproval` |
| `schemas/evidence.schema.json` | `.amber/evidence/receipts.jsonl` | `receiptId`, `producer`, `assuranceLevel`, `subject`, `command`, `chainHash` |
| `schemas/gate.schema.json` | `.amber/gates/` | `gateId`, `require`, `thresholds`, `owners`, `expiry`, `freshnessBounds` |
| `schemas/handoff-bundle.schema.json` | `.amber/handoff/latest/manifest.json` | `bundleVersion`, `sessionId`, `artifacts`, `checksums` |
| `schemas/rules.schema.json` | `.amber/governance/rules.json` | `allowedNodeEngines`, `requiredAgentFiles`, `driftTolerances` |

## Schema Validation in CI

The integrity of all registered schemas and their fixture instances is verified continuously:

```bash
npm run manifests
```
