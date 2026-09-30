---
id: action-types
title: "Action Types & MCP Integration"
sidebar_label: "Action Types & MCP"
description: "Operational ontology action types, function bindings, and safe read-only boundaries."
---

# Action Types & MCP Integration

Amber Protocol is positioned as an **operational-ontology governance layer**: coding agents act *through* Amber's governed surface rather than around it.

## Action Types

Amber defines 21 machine-readable Action Types under `action-types/*.json` (listed here from their own `actionTypeId`). Each action represents an atomic verb operating on governance objects:

- `amber.breakglass.grant`
- `amber.context.ingest`
- `amber.contracts.validate`
- `amber.eval.admit`
- `amber.eval.run`
- `amber.external.propose`
- `amber.governance.report`
- `amber.memory.abandon`
- `amber.memory.approve`
- `amber.memory.status`
- `amber.object.query`
- `amber.route.test`
- `amber.runner.request`
- `amber.runner.settle`
- `amber.session.approve`
- `amber.session.lease`
- `amber.session.run`
- `amber.session.settle`
- `amber.session.start`
- `amber.session.status`
- `amber.session.verify`

## Model Context Protocol (MCP) Server

Amber exposes its action vocabulary through a local stdio MCP server (`scripts/amber-mcp.js`).

### Governance Seam Invariants

1. **Read-Only Auto-Execution**: Only actions verified as read-only by the contract registry (`scripts/lib/mcp-action-contracts.js`) can execute without explicit human approval.
2. **Approval Required for Mutations**: Any mutating action (such as writing state, modifying ledgers, or external effects) is returned with `requiresApproval: true` and is never spawned autonomously.
3. **Repository Confinement**: Every action is strictly confined to target repositories configured at server startup (`scripts/lib/mcp-targets.js`).
4. **Fail-Closed Reporting**: If governance state is corrupt or command execution fails, the MCP response immediately returns `isError: true`.
