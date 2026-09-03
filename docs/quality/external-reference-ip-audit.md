# External Reference IP Audit

**Date:** 2026-08-16

**Scope:** Amber Protocol current branch at audit time, ignored local artifacts, reachable Git history, dependencies, and isolated real Target Repository E2E runs.

**Purpose:** monitor trademark/source-reference residue and reduce accidental copying or license contamination. This is an engineering provenance audit, not legal advice.

## External references and licenses

| Reference | Upstream | License identified by upstream | Amber treatment |
| --- | --- | --- | --- |
| Reviewed workflow model | Pinned research snapshot | Reference only. ADR-0008 requires Amber vocabulary and forbids importing upstream expression or structure. |
| Reviewed workflow framework | Separate mechanism study | Mechanism ideas only. No source, template, or prose copied into implementation. |
| Workflow engineering notes | Companion research notes | No runtime dependency; only independently re-expressed engineering principles are retained. |

License identification was rechecked against the public GitHub repositories on 2026-08-16.

## Scan coverage

- Every tracked path from `git ls-files`.
- Implementation surfaces: `scripts/`, `apps/`, `schemas/`, `tests/`, `action-types/`, `routes/`, `workflow-packs/`, and `standards/`.
- Agent and template surfaces: `skills/`, generated platform commands, and `templates/`.
- Research and governance artifacts under `docs/`, `feature_list.json`, root references, and reachable Git commit subjects.
- Dependency manifests/locks and submodules.
- Ignored files via `rg --no-ignore`, including local report runs that normal Git-aware scans skip.

Search families included direct project/vendor names and distinctive phrases: Agent Work Loop, Task Understanding, Controlled Execution, Change Validation, Reliable Delivery, Learning Capture, demand-source analysis, loop discovery, and learning-loop patterns.

## Findings

### Implementation — clean

No external project, author, or vendor identifiers occur in the tracked implementation directories. No related package dependency or Git submodule exists. Current owner-routing, lifecycle, breadcrumb, break-loop, dirty-path, context-manifest, and workflow-assessment identifiers use Amber vocabulary.

### Tracked research/provenance references — explicit and bounded

- The reviewed workflow comparison is concentrated in `docs/quality/external-framework-reference-improvement-plan.md` and ADR-0008. The research artifact retains only a neutral summary; ADR-0008 explicitly prohibits importing external expression as Amber product vocabulary.
- Historical feature notes and the F025 plan retain only independently written mechanism descriptions.
- Amber retains its no-scheduler/no-autonomous-execution boundary.

These are source/provenance records, not implementation identifiers. They remain reviewable rather than concealing the external input.

### Ignored local artifacts — cleanup recommended

Local `.scratch/` report runs contain generated data and copied renderer/helper files from development-time research. They are excluded from commits, packages, and releases, but still create accidental `git add -f` and local-reuse risk. Archive or delete them after preserving any needed evidence.

## Continuous guard

`tests/unit/external-reference-ip-hygiene.test.js` enforces:

1. external project, author, and vendor identifiers cannot enter the product surface;
2. product paths cannot carry external identifiers;
3. related packages cannot enter dependencies.

The guard intentionally avoids embedding the direct identifiers in its own source expression, so the monitor does not create a self-match.

## Real E2E evidence

Isolated temporary Target Repository: `temporary-e2e-target`

Session: `8139a867-b430-475e-9f5d-0e87b3f35a00`

Executed flow:

1. `amber init --with-wiki`, doctor, and wiki validation;
2. register F900, scaffold/curate/review/confirm plan;
3. create and execute one real Node test (`npm test`: 1/1 passed);
4. `amber session verify --execute --command "npm test"` recorded exit 0 in the session ledger;
5. approve both feature-standard gates;
6. strict completion initially refused missing handoff, proving the gate fails closed;
7. regenerate handoff, strict completion passed;
8. record feature evidence and strict accept F900;
9. book learning write-back with owner `command` and `docs/specs/f900.md`;
10. validate handoff bundle, feature state, wiki, and doctor: all Errors 0.

Final F900 state: accepted; evidence present; learning status reviewed; owner status assigned; owner `command`; surface `docs/specs/f900.md`.

The first handoff bundle scored 91/100 because a fresh minimal target lacked optional governance documents/rules; bundle validation and all functional checks still passed. This warning was retained as real evidence and then used as a regression target.

### Quality-signal closure

A second clean Target Repository reran the flow after both findings were addressed:

- the E2E setup explicitly ran `amber governance docs` and `amber governance rules init` instead of treating fresh `init` as a complete higher-autonomy setup;
- `acceptPlan` now adds `Last Reviewed: <local date>` when it creates `docs/wiki/engineering/harness-evolution.md`, with a regression assertion in `tests/phase-v2-5.test.js`;
- the second real `npm test`, session ledger verification, two approvals, strict completion, accept, learning booking, doctor, feature/wiki validators, and handoff validation all passed;
- the final handoff readiness score was **100/100 (ready)** with Errors 0.

## Residual risk

- The research comparison retains a five-part model description. It is useful provenance but deserves legal/reviewer scrutiny before public release if risk tolerance is strict.
- Ignored local generated artifacts remain on local disk until separately approved for deletion.
- Keyword monitoring detects identifiers and known distinctive phrases; it cannot prove absence of semantic similarity. Architecture and prose review remain required.
