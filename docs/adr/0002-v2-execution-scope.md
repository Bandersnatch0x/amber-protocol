# ADR-0002: V2 Execution Scope — Experimental Isolation

**Status:** Accepted  
**Date:** 2026-06-21  
**Context:** ADR-0001 compliance audit

---

## Context

During an architecture review audit (2026-06-21), we discovered that `execution-engine.js`, `stage-executor.js`, and `autonomous-executor.js` implement live command orchestration that directly contradicts ADR-0001's core principle: "governance-first, artifact-first... **without executing Dynamic Workflows**."

These modules:
- Spawn shell commands via `child_process`
- Loop through route stages and execute them automatically
- Are exposed via `--mode autonomous` CLI flag
- Have 15+ tests validating execution behavior

This contradicts our documented V1 scope in multiple places:
- **ADR-0001:** "without executing Dynamic Workflows, dispatching live subagents, running target-repository commands automatically"
- **CLAUDE.md Non-Goals:** "❌ Dynamic Workflow execution, ❌ Live subagent runner invocation, ❌ Automatic target project command execution"
- **README.md:** Same non-goals repeated

## Decision

We **isolate execution modules as experimental V2 scope** rather than removing them entirely.

**Rationale:**
1. **Preserve exploration** — Code represents real engineering effort; isolation allows V2 reconsideration
2. **Clear V1 boundary** — Moving out of production paths eliminates ADR conflict without data loss
3. **Future flexibility** — V2 may add execution under governance constraints (approval gates, dry-run, explicit authorization)

## Implementation

### Moved Modules
- `scripts/lib/execution-engine.js` → `src/experimental/execution/`
- `scripts/lib/stage-executor.js` → `src/experimental/execution/`
- `scripts/lib/autonomous-executor.js` → `src/experimental/execution/`

### Tests
- `tests/integration/execution-flow.test.js` → `tests/experimental/`
- `tests/integration/autonomous-mode.test.js` → `tests/experimental/`
- `tests/unit/stage-executor.test.js` → `tests/experimental/`
- Tests updated to import from experimental path
- Marked to skip in standard CI runs

### CLI Changes
- `session start --mode autonomous` now returns explicit error:
  > "Autonomous execution is experimental and not available in V1. Amber V1 focuses on governance (audit, gate, inspect) without live execution."

### Documentation
- Created `src/experimental/execution/README.md` explaining:
  - Why moved (ADR-0001 alignment)
  - V2 considerations (governance constraints if re-enabled)
  - How to test locally
  - Re-enabling process

## Consequences

### Positive
- ✅ ADR-0001 compliance restored
- ✅ Product positioning clarified (governance console, not execution platform)
- ✅ Code preserved for V2 consideration
- ✅ Clear boundary for users ("V1 does not execute")

### Negative
- ❌ `--mode autonomous` no longer works (intentional breaking change)
- ❌ 15 tests no longer run in standard CI (moved to experimental)
- ❌ Some integration test scenarios (`concurrent_sessions_test.js`, `e2e_feature_delivery_test.js`) may need updates if they relied on execution

### Neutral
- Session CRUD (start, status, list, abort) unaffected — 97% of CLI surface intact
- Route inspection (list, inspect, validate) unaffected
- Adoption, doctor, audit workflows unaffected

## V2 Considerations

If V2 reintroduces execution capabilities, they must be:

1. **Governed** — Approval gates before any execution
2. **Inspectable** — Dry-run mode generates artifacts; user reviews before execution
3. **Explicit** — No autonomous execution without explicit user authorization
4. **Constrained** — Execution scope limited, not a general agent runtime
5. **Documented** — Clear ADR amendment explaining why execution aligns with governance-first

Example V2 model:
```
amber session plan → generates execution plan artifact
amber session review → user inspects plan
amber session approve → user approves plan
amber session execute → executes approved plan with logging
```

## Related

- **ADR-0001:** Governance-first, artifact-first protocol
- **Audit Report:** `/tmp/execution-audit-20260621.md`
- **Architecture Review:** `/tmp/architecture-review-20260621-092312.html` (Candidate 4)

---

**Approved by:** Project lead  
**Implementation:** 2026-06-21
