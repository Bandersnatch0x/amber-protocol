---
layout_version: "amber/v1"
kind: "knowledge"
generated_by: "amber wiki knowledge"
---

# Repository Knowledge

Last Reviewed: 2026-07-16

This knowledge base is derived from the declarative knowledge plan.

## Grounding Notes
- Amber Protocol is a repository-local governance layer for AI-assisted engineering, NOT a runtime framework or agent platform. It produces review artifacts, dry-run plans, and approval records as files inside the target repo.
- The CLI entry point is scripts/amber.js. All business logic lives in scripts/lib/. The scripts/lib/core/ directory is the core engine; files matching scripts/lib/*-commands.js are thin CLI wrappers that delegate to core functions.
- Seven governance control layers in priority order: Governance (highest) > Verification > Observability > Lifecycle > Context > Tooling > Execution (lowest/avoid). This priority weighting shapes the entire codebase.
- The delivery lifecycle is: audit -> init -> governance report -> next -> plan -> gate -> verify -> approve -> handoff bundle -> handoff validate. Each stage maps to a CLI command.
- Safety boundary: read-only/dry-run first. 'init' and 'wiki' never overwrite existing files. Amber does not auto-execute target-project commands, dispatch live agents, or run dynamic workflows.
- Skills in skills/*/SKILL.md are the single source of truth. Platform-specific files (.claude/, .agents/skills/, .gemini/commands/) are auto-generated via 'npm run gen:agents'. Never edit generated files; edit skills/ instead.
- Dependencies are intentionally minimal: ajv for JSON Schema validation and ajv-formats for format validation. No Express, no database, no ORM in the CLI package.
- src/ contains auxiliary utilities only (migration + security scanners), not the main CLI logic. Do not confuse src/ with scripts/lib/core/.
- apps/web/ is a standalone React 18 + Vite + tRPC + TanStack Router application with its own package.json (@amber-protocol/web). It is NOT part of the published amber-protocol npm package.
- Governed loop execution (ADR-0003) requires four gates: declarative policy check, explicit 'amber loop approve', isolated git worktree, and tamper-evident hash-chain ledger. Default 'loop run' is still dry-run.
- The project uses CommonJS ('type': 'commonjs' in package.json). Node >= 18.17 required.
- JSON Schemas in schemas/ define contracts for knowledge-plan, loop-contract, route, session-manifest, and timeline-event. All are validated with ajv at runtime.
- The project follows loop-engineering patterns. Continuous improvement is governed (see LOOP.md and amber-continuous-improvement skill).
- Stable knowledge lives under docs/wiki/ (and docs/architecture/). Current work state lives in feature_list.json, session-handoff.md, session manifests, and ledgers.

## Categories

| Category | Goal |
| --- | --- |
| [CLI Architecture & Command Dispatch](./cli-architecture-command-dispatch/cli-architecture-command-dispatch.md) | Document how scripts/amber.js loads Command definitions from command-help.js, binds handlers in command-dispatcher.js, and delegates domain work to scripts/lib/core/. |
| [Governance Model & Seven Layers](./governance-model-seven-layers/governance-model-seven-layers.md) | Map the seven governance control layers to concrete commands, data structures, and enforcement points. |
| [Session & Lifecycle Management](./session-lifecycle-management/session-lifecycle-management.md) | Document routes, sessions, checkpoints, worktrees, and the lifecycle state machine. |
| [Adoption System](./adoption-system/adoption-system.md) | Explain the adoption report pipeline: proposals, gates, metrics, and the composer sub-module. |
| [Loop Engineering & Governed Execution](./loop-engineering-governed-execution/loop-engineering-governed-execution.md) | Document loop contracts, ledgers, dry-run mode, and the four-gate governed execution path. |
| [Skills & Platform Generation](./skills-platform-generation/skills-platform-generation.md) | Explain the skill system: SKILL.md as source of truth, gen:agents generation, and platform integrations. |
| [Web Dashboard](./web-dashboard/web-dashboard.md) | Document the apps/web React dashboard architecture: tRPC API, TanStack Router routes, and session/timeline components. |
| [Schema & Validation Layer](./schema-validation-layer/schema-validation-layer.md) | Document the JSON Schema contracts and runtime validation with ajv. |
| [Handoff & Continuity](./handoff-continuity/handoff-continuity.md) | Explain the handoff bundle, session handoff, and continuity surfaces that make work transferable. |
| [Security & Migration Utilities](./security-migration-utilities/security-migration-utilities.md) | Document the auxiliary security scanners and state migration tools in src/. |

## Knowledge Cards

See [knowledge-cards.md](./knowledge-cards.md) for 9 concise facts.
