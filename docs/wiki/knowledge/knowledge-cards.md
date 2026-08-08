---
kind: "knowledge_cards"
---

# Knowledge Cards

Last Reviewed: 2026-08-08

Concise, high-signal facts for rapid orientation.

- **core-engine** — scripts/lib/core/ is the core engine — treat as one knowledge module. It contains audit, doctor, governance, planning, lifecycle, loops, handoff, adoption, scaffold, maintenance, team, and workflow-pack logic. _(architecture, core)_
- **adoption-composer** — scripts/lib/core/adoption-composer/ is a sub-module with dedicated renderers (bundle, decision, gate, report) for composing adoption reports — split from the core adoption logic. _(adoption)_
- **cli-wrappers** — scripts/lib/*-commands.js files are thin CLI command handlers. They parse arguments and delegate to scripts/lib/core/ functions. Map each to its core counterpart. _(cli, architecture)_
- **aux-modules** — src/migration/ and src/security/ are auxiliary utility modules separate from the CLI core. Migration handles state schema upgrades; security provides read-only scanners (dependency, permission, secret). _(migration, security)_
- **skills-source-of-truth** — skills/ contains platform-agnostic skill definitions (amber-adoption through amber-wiki). Platform-specific files in .claude/, .agents/skills/, .gemini/commands/ are generated, never hand-edited. Run `npm run gen:agents` after changing skills/. _(skills, generation)_
- **web-app-separate** — apps/web/ is a standalone React+Vite+tRPC application with its own package.json. Its src/ uses TanStack Router for file-based routing and tRPC for type-safe API calls to an Express server. _(web, viewer)_
- **templates-purpose** — templates/ contains starter file templates that 'amber init' and 'amber wiki' scaffold into target repos. Includes AGENTS.md, CLAUDE.md, wiki skeleton, feature_list.json, and governance templates. _(scaffolding)_
- **schemas-contracts** — schemas/ defines five JSON Schema contracts: knowledge-plan, loop-contract, route, session-manifest, and timeline-event. These are the authoritative validation contracts used across the CLI. _(validation, schema)_
- **command-help** — scripts/lib/command-help.js owns Command definitions, help knowledge, output policy, and stable public order; it binds definitions to handlers at startup. _(cli, core)_
- **command-dispatcher** — scripts/lib/command-dispatcher.js owns handler implementations, the bound runtime registry, and dispatch — not the definition source of truth. _(cli, core)_

## Derived from these grounding notes
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
