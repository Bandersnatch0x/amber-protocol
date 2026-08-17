# External Reference IP Audit

**Date:** 2026-08-16

**Scope:** Amber Protocol current branch at audit time, ignored local artifacts, reachable Git history, dependencies, and isolated real Target Repository E2E runs.

**Purpose:** monitor trademark/source-reference residue and reduce accidental copying or license contamination. This is an engineering provenance audit, not legal advice.

## External references and licenses

| Reference | Upstream | License identified by upstream | Amber treatment |
| --- | --- | --- | --- |
| Better Harness | `QoderAI/better-harness` | MIT | Research reference only. ADR-0008 requires Amber vocabulary and forbids importing upstream expression/structure. |
| Trellis | `mindfold-ai/Trellis` | AGPL-3.0 | Mechanism ideas only. No source, template, or prose copied into implementation. |
| Loop Engineering | `cobusgreyling/loop-engineering` | MIT | Explicit companion/reference attribution in `LOOP.md`, README, and continuous-improvement skill guidance. |

License identification was rechecked against the public GitHub repositories on 2026-08-16.

## Scan coverage

- Every tracked path from `git ls-files`.
- Implementation surfaces: `scripts/`, `apps/`, `schemas/`, `tests/`, `action-types/`, `routes/`, `workflow-packs/`, and `standards/`.
- Agent and template surfaces: `skills/`, generated platform commands, and `templates/`.
- Research and governance artifacts under `docs/`, `feature_list.json`, root references, and reachable Git commit subjects.
- Dependency manifests/locks and submodules.
- Ignored files via `rg --no-ignore`, including `.qoder/` report runs that normal Git-aware scans skip.

Search families included direct project/vendor names and distinctive phrases: Agent Work Loop, Task Understanding, Controlled Execution, Change Validation, Reliable Delivery, Learning Capture, demand-source analysis, loop discovery, and learning-loop patterns.

## Findings

### Implementation — clean

No Better Harness, Trellis, QoderAI, or vendor identifiers occur in the tracked implementation directories. No related package dependency or Git submodule exists. Current owner-routing, lifecycle, breadcrumb, break-loop, dirty-path, context-manifest, and workflow-assessment identifiers use Amber vocabulary.

### Tracked research/provenance references — explicit and bounded

- Better Harness references are concentrated in `docs/quality/better-harness-reference-improvement-plan.md` and ADR-0008. The research artifact contains upstream terminology for comparison; ADR-0008 explicitly prohibits using that expression as Amber product vocabulary.
- Trellis references occur in historical feature notes and the F025 plan. Every occurrence identifies the AGPL boundary and states mechanism-only/original-wording treatment.
- Loop Engineering references are explicit companion attribution. Amber retains its no-scheduler/no-autonomous-execution boundary.

These are source/provenance records, not implementation identifiers. They remain reviewable rather than concealing the external input.

### Ignored local artifacts — cleanup recommended

`.qoder/better-harness/` and `.qoder/better-harness-runs/` contain approximately 253 KB of generated report data and copied renderer/helper files from a local Better Harness plugin run. They are excluded by `.gitignore` and no `.qoder/` path is tracked, so they are absent from commits, packages, and releases. They still create accidental `git add -f` and local reuse risk. Archive or delete them after preserving any needed evidence.

## Continuous guard

`tests/unit/external-reference-ip-hygiene.test.js` enforces:

1. external project/vendor identifiers cannot enter implementation surfaces;
2. tracked reference mentions stay in a reviewed allowlist;
3. ignored `.qoder/` products cannot become tracked;
4. related packages cannot enter dependencies.

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

- The Better Harness research comparison retains upstream vocabulary and a five-part model description. This is useful provenance but deserves legal/reviewer scrutiny before public release if risk tolerance is strict.
- Ignored `.qoder/` generated artifacts remain on local disk until separately approved for deletion.
- Keyword monitoring detects identifiers and known distinctive phrases; it cannot prove absence of semantic similarity. Architecture and prose review remain required.
