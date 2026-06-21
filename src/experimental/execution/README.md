# Experimental Execution Module

**Status:** 🚧 Experimental - V2 Scope

This directory contains execution modules that were moved out of V1 production scope to align with ADR-0001 (governance-first, artifact-first).

## Modules

- **execution-engine.js** — Session-level execution orchestrator
- **stage-executor.js** — Stage-level command spawner
- **autonomous-executor.js** — Autonomous mode wrapper

## Why Experimental?

Amber Protocol V1 is explicitly positioned as a **governance console**, not an execution platform:

- ✅ V1 Scope: Audit, validate, inspect, gate, report
- ❌ V1 Non-Goals: Execute dynamic workflows, dispatch live agents, run target project commands automatically

These modules implement live command orchestration, which contradicts:
1. **ADR-0001** — "governance-first, artifact-first... without executing Dynamic Workflows"
2. **CLAUDE.md** — "V1 does NOT execute dynamic workflows"
3. **README.md Non-Goals** — "No Dynamic Workflow execution"

## V2 Considerations

If execution capabilities are reintroduced in V2, they should be:
- **Governed** — approval gates before execution
- **Inspectable** — dry-run mode, execution artifacts
- **Constrained** — explicit user authorization, not autonomous
- **Documented** — clear ADR amendment explaining the scope change

## Current State

- **CLI Access:** Removed from `amber.js` (no `--mode autonomous`)
- **Tests:** Moved to `tests/experimental/`
- **Integration:** Not exposed via `amber-core.js` facade
- **Documentation:** Marked as experimental in all references

## Testing Locally

```bash
# Run experimental tests
npm run test:experimental

# These tests are skipped in CI by default
```

## Re-enabling (V2)

If V2 decides to support execution:
1. Write ADR-0002 explaining scope expansion
2. Add governance constraints (approval gates, dry-run)
3. Move modules back to `scripts/lib/`
4. Update CLI to expose `--mode autonomous` (gated)
5. Enable experimental tests in CI

---

**Last Updated:** 2026-06-21  
**Decision Maker:** Project lead  
**Reference:** ADR-0001, execution-audit-20260621.md
