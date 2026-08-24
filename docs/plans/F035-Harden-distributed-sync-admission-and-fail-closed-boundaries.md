# Plan: Harden distributed sync admission and fail-closed boundaries

Feature: F035
Status: accepted
User Confirmation: confirmed

## Goal

Close every finding from the two-axis review of `v1.6.0...HEAD`: prevent Sync
Runtime artifacts from escaping their repository or impersonating another
artifact type; use the envelope schema as the runtime validation source of
truth; enforce protocol, Tenant, Repository, and generation admission; remove
ungoverned Git side effects; fail closed on corrupt distributed read models;
and restore the Web design system's flat-at-rest input styling.

## Review Scope And Finding Map

- Fixed point: `v1.6.0`
- Diff: `git diff v1.6.0...HEAD`
- Reviewed range: 86 commits, 412 files
- Standards findings: 4
- Spec findings: 5
- Deduplicated repair slices: 6

| Slice | Findings closed | Priority |
|-------|-----------------|----------|
| 1. Canonical artifact path and allowlist | Standards S1; Spec P1 arbitrary artifact | P1 |
| 2. Schema SSOT and protocol compatibility | Standards S3; Spec P1 producer-version check | P1/P2 |
| 3. Structural identity admission | Spec P1 Tenant/Repository/generation admission | P1 |
| 4. Governed sync transport | Standards S2; Spec P2 refusal/conflict persistence | P1/P2 |
| 5. Corrupt read-model handling | Spec P2 fail-closed reads | P2 |
| 6. Web input styling | Standards S4 | P3 |

## High Level Design

- Establish one envelope admission pipeline with the fixed order:
  `schema -> artifact path/type -> protocol -> tenant -> repository ->
  generation -> content hash`.
- Route `packEnvelope`, `unpackEnvelope`, `applyEnvelope`, `pullEnvelopes`, and
  `replayEnvelopes` through the same contract and admission primitives.
- Treat repository containment as both a lexical and realpath invariant.
  Artifact type is not authority by itself: every type maps to a canonical
  repository-owned path family.
- Compile `schemas/sync-envelope.schema.json` once and use it as the only
  runtime structural validator. Keep compatibility and local admission as
  explicit semantic checks layered after schema validation.
- Convert sync transport to preparation/report-only behavior in this feature.
  Amber may describe the required Git operations, but it does not run
  `git add`, `git commit`, or `git push`. Reintroducing live transport requires
  a separate accepted ADR defining policy, approval, isolation, ledger, and
  recovery semantics.
- Make missing ledgers a valid empty state and corrupt or unreadable ledgers a
  typed failure with a non-zero CLI result.
- Keep the UI fix isolated from broader `GatesPage` refactoring.

## Governance Preconditions

1. Restore local dependencies before using Amber commands. The planning
   attempt on 2026-08-24 failed because `ajv` was unavailable.
2. Add F035 to `feature_list.json` and book only the implementation and test
   paths named by this plan.
3. Run `amber next`, validate this plan with `amber gate`, and obtain explicit
   user confirmation before implementation.
4. Start or continue one governed session with an explicitly selected Route.
5. Record real verification evidence before review, approval, handoff, or
   acceptance claims.

## Context Manifests

Entries are knowledge-surface paths only. Code and test paths belong in the
feature's booked paths.

- implement: docs/adr/0001-governance-first-artifact-first.md, docs/adr/0012-protocol-and-schema-versioning.md, docs/adr/0019-distributed-governance-stage1-decisions.md, docs/architecture/context-threat-model.md, docs/architecture/distributed-governance-baseline.md, schemas/sync-envelope.schema.json, DESIGN.md
- review: docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md, docs/adr/0012-protocol-and-schema-versioning.md, docs/architecture/context-threat-model.md, docs/architecture/distributed-governance-baseline.md, schemas/sync-envelope.schema.json, DESIGN.md

## Vertical Slices

### Slice 1: Canonical artifact path and allowlist

- [ ] Add one `resolveSyncArtifact(cwd, artifactType, artifactPath)` primitive,
  reusing `scripts/lib/core/fs-utils.js#resolvePathWithin`.
- [ ] Reject empty, absolute, root, dot-segment, traversal, directory, special
  file, and realpath/symlink escape inputs before any existence check, read,
  hash, or ledger write.
- [ ] Return one canonical repository-relative POSIX path after validation.
- [ ] Define an explicit `artifactType -> canonical path pattern` registry for
  all types in the sync-envelope schema.
- [ ] Reject a valid type paired with an unrelated path, including source,
  package, credential, secret, agent, and tool files.
- [ ] Route pack, unpack, and conflict application through this primitive;
  remove raw `path.join(cwd, envelope.artifactRef.path)` reads.
- [ ] Add positive tests for every registered artifact type and negative tests
  for `../`, absolute paths, outside symlinks, missing descendants beneath an
  outside symlink, directories, source files, and type/path mismatch.
- [ ] Assert rejection does not expose or persist the outside file's hash.

Primary files:

- `scripts/lib/core/sync-remote.js`
- `scripts/lib/core/sync-conflicts.js`
- `scripts/lib/core/fs-utils.js`
- `tests/unit/sync-remote.test.js`
- `tests/unit/sync-conflicts.test.js`
- `tests/amber-cli-sync-envelope.test.js`

### Slice 2: Schema SSOT and protocol compatibility

- [ ] Add a small cached AJV adapter, for example
  `scripts/lib/core/sync-envelope-contract.js`.
- [ ] Remove the handwritten structural rules from `validateEnvelope`; retain
  its public return shape while delegating to the compiled schema.
- [ ] Convert AJV diagnostics into deterministic, user-facing error strings.
- [ ] Require `versionNegotiation`, `amberProtocolVersion`,
  `minCompatibleVersion`, and `capabilities` in the envelope schema.
- [ ] Reject malformed semantic versions and unsupported schema/protocol major
  versions instead of silently interpreting them.
- [ ] Check both the producer's `amberProtocolVersion` and its declared
  `minCompatibleVersion`; an unknown future producer version paired with a low
  minimum must fail.
- [ ] Require every declared capability and refuse unknown compatibility
  combinations unless they appear in an explicit compatibility matrix.
- [ ] Share one fixture matrix between schema tests and runtime tests so the
  two surfaces cannot drift again.
- [ ] Update ADR-0012 or its compatibility table if the accepted version
  relation needs clarification; do not encode an undocumented relation.

Primary files:

- `schemas/sync-envelope.schema.json`
- `scripts/lib/core/sync-envelope-contract.js` (new)
- `scripts/lib/core/sync-remote.js`
- `tests/unit/distributed-governance-schemas.test.js`
- `tests/unit/sync-remote.test.js`
- `tests/amber-cli-sync-envelope.test.js`

### Slice 3: Structural identity admission and conflict classification

- [ ] Introduce one `admitEnvelope(cwd, envelope)` result that carries
  admission status, conflict type, errors, and the already-validated artifact
  path.
- [ ] Compare the incoming Tenant, Repository, and generation against a
  canonical local structural identity before reading artifact content.
- [ ] Map Tenant and Repository mismatch to `identity-mismatch`, generation
  mismatch to `generation-mismatch`, protocol mismatch to `version-mismatch`,
  and content divergence to `concurrent-edit`.
- [ ] Make Repository Identity stable across clones. Do not use
  `path.basename(cwd)` as the shared identity. Extend the governed identity
  contract and bootstrap/override rules before enforcing the comparison.
- [ ] Record every semantic refusal as one pending conflict and never mark the
  envelope applied.
- [ ] Preserve replay idempotency: processing the same refused envelope again
  must not append duplicate conflict records.
- [ ] Make the previously unreachable identity and generation conflict types
  reachable through unit and CLI tests.

Primary files:

- `scripts/lib/core/identity.js`
- `scripts/lib/core/sync-remote.js`
- `scripts/lib/core/sync-conflicts.js`
- `schemas/structural-identity.schema.json`
- `tests/unit/identity-bootstrap.test.js`
- `tests/unit/sync-remote.test.js`
- `tests/unit/sync-conflicts.test.js`
- `tests/amber-cli-sync-conflicts.test.js`

### Slice 4: Remove ungoverned sync Git writes and persist refusals

- [ ] Change `sync session run|push` to produce a transport preparation report:
  envelope list, affected `.amber/sync/**` paths, proposed Git operations, and
  refusal/conflict summary.
- [ ] Remove default calls to `git add`, `git commit`, and `git push` from the
  Sync Runtime implementation.
- [ ] Do not add a lightweight `--execute` escape hatch in this feature. Live
  external transport requires its own accepted ADR and governed Action.
- [ ] Route `pullEnvelopes` through `admitEnvelope/applyEnvelope` so version,
  identity, and generation refusals are recorded in the conflict ledger.
- [ ] Ensure invalid structural envelopes fail explicitly but are not marked
  applied; distinguish invalid input from a valid semantic conflict.
- [ ] Update `amber sync` help so its drift behavior and the `envelope` and
  `session` subcommands are accurately documented.
- [ ] Replace tests that expect commits with assertions that HEAD, index,
  working-tree user files, and remote state remain unchanged.
- [ ] Update the Team Hub tracer to verify replayable transport preparation,
  not live Git execution.

Primary files:

- `scripts/lib/core/sync-session.js`
- `scripts/lib/sync-commands.js`
- `scripts/lib/command-registry.js`
- `tests/unit/sync-session.test.js`
- `tests/amber-cli-sync-session.test.js`
- `tests/amber-cli-team-hub-tracer.test.js`

### Slice 5: Fail closed on corrupt distributed read models

- [ ] Change Knowledge Record current-state and lineage reads from
  `onCorrupt: "skip"` to `onCorrupt: "throw"`.
- [ ] Convert corruption into a stable result such as
  `AMBER_E_KB_CORRUPT`, an empty result payload, non-empty diagnostics, and
  CLI exit code 1.
- [ ] Ensure knowledge `list`, `status`, `query`, lifecycle transitions, and
  lineage reads cannot operate on a partial store.
- [ ] Stop `listAuditEvents` from converting corrupt or unreadable ledgers to
  an empty successful array. Return a typed failure and CLI exit code 1.
- [ ] Preserve missing-ledger semantics as a legitimate empty state.
- [ ] Audit the new distributed-governance read surfaces for the same
  corruption-to-empty pattern and add a table-driven invariant test.
- [ ] Strengthen existing tests to assert an explicit corruption code/message,
  not merely `ok: false`, so an unknown-scope denial cannot masquerade as a
  corruption failure.
- [ ] Cover corrupt first, middle, and last JSONL lines plus filesystem read
  errors.

Primary files:

- `scripts/lib/core/knowledge-base.js`
- `scripts/lib/knowledge-commands.js`
- `scripts/lib/core/organization-audit.js`
- `scripts/lib/org-audit-commands.js`
- `tests/unit/knowledge-base.test.js`
- `tests/unit/organization-audit.test.js`
- `tests/amber-cli-knowledge.test.js`
- `tests/amber-cli-organization-audit.test.js`

### Slice 6: Restore flat-at-rest Web input styling

- [ ] Remove the two resting `shadow-sm` classes from gate inputs.
- [ ] Preserve borders, focus rings, validation colors, contrast, and dark-mode
  behavior.
- [ ] Add or update a render assertion proving that the inputs have no resting
  shadow and retain their focus/error classes.
- [ ] Keep the slice scoped to the documented design violation; do not combine
  it with a broad `GatesPage` decomposition.

Primary files:

- `apps/web/src/routes/gates.tsx`
- the closest existing gate render/component test
- `DESIGN.md` only if implementation reveals a genuine ambiguity

## Deviation And Decision Table

| # | Decision | Plan position | Follow-up if rejected |
|---|----------|---------------|-----------------------|
| D1 | May Sync Runtime run Git commit/push? | No. This feature makes transport preparation/report-only to satisfy the repository-local, non-executing boundary. | Write and accept a separate ADR for policy, approval, isolation, execution evidence, remote-write authorization, and recovery before adding live transport. |
| D2 | Is `artifactType` sufficient authorization? | No. Type and canonical path family must both match, after repository containment. | Any broader artifact surface requires a schema/registry change plus threat-model review. |
| D3 | How are future protocol versions handled? | Fail closed unless an explicit compatibility relation proves support. | Add the version pair/capability set to a reviewed compatibility matrix. |
| D4 | What is an empty read model? | Only an absent ledger is empty. Corrupt or unreadable ledgers are errors. | None; relaxing this would contradict the accepted fail-closed baseline. |

## Acceptance Criteria

- No Sync Runtime file read can escape the selected repository lexically or
  through a symlink/realpath transition.
- Every enveloped artifact matches both a registered type and its canonical
  path family; arbitrary files, source, secrets, agents, and tools are refused.
- Runtime structure validation is derived from
  `schemas/sync-envelope.schema.json`; no handwritten duplicate remains.
- Compatibility checks validate the producer protocol version, minimum
  compatible version, schema version, and required capabilities.
- Incoming Tenant, Repository, and generation are compared to local admitted
  identity before content access.
- Identity, generation, version, and content conflicts are reachable,
  append-only, pending by default, and idempotent under replay.
- `sync session run|push` cannot commit or push without a separately accepted
  governed execution design.
- Normal pull/run refusal paths write the required conflict evidence and do
  not mark refused envelopes applied.
- Corrupt Knowledge and Organization ledgers yield non-zero CLI results and
  cannot be returned as empty success or partial projections.
- Gate inputs satisfy the `DESIGN.md` flat-at-rest rule.
- All nine original review findings have a linked negative test and closure
  evidence.
- Phase boundary guardrails: no live transport, execution, or agent dispatch is
  added — transport stays preparation/report-only (decision D1), and no phase
  boundary expands.

## Verification

Focused checks during implementation:

- `rtk node --test tests/unit/sync-remote.test.js`
- `rtk node --test tests/unit/sync-conflicts.test.js`
- `rtk node --test tests/unit/sync-session.test.js`
- `rtk node --test tests/unit/distributed-governance-schemas.test.js`
- `rtk node --test tests/unit/knowledge-base.test.js`
- `rtk node --test tests/unit/organization-audit.test.js`
- `rtk node --test tests/amber-cli-sync-envelope.test.js`
- `rtk node --test tests/amber-cli-sync-conflicts.test.js`
- `rtk node --test tests/amber-cli-sync-session.test.js`
- `rtk node --test tests/amber-cli-knowledge.test.js`
- `rtk node --test tests/amber-cli-organization-audit.test.js`
- `rtk npm --prefix apps/web test`

Repository gates before completion:

- `rtk npm test`
- `rtk npm run manifests`
- `rtk npm run doctor`
- `rtk npm run gen:agents:check`
- `rtk npm run format:check`
- `rtk npm --prefix apps/web run format:check`

Every recorded verification must include the command, exit code, relevant
artifact/session path, and remaining risk. A claim-only verification does not
satisfy completion.

## Evidence Schema

- Command: per-slice targeted suites (`node --test` on `tests/unit/sync-remote.test.js`, `tests/unit/sync-conflicts.test.js`, `tests/amber-cli-sync-envelope.test.js`, `tests/unit/distributed-governance-schemas.test.js`, `tests/unit/identity-bootstrap.test.js`, `tests/amber-cli-sync-conflicts.test.js`, `tests/unit/sync-session.test.js`, `tests/amber-cli-sync-session.test.js`, `tests/amber-cli-team-hub-tracer.test.js`, `tests/unit/knowledge-base.test.js`, `tests/unit/organization-audit.test.js`, `tests/amber-cli-knowledge.test.js`, `tests/amber-cli-organization-audit.test.js`, and `npm --prefix apps/web test`), then the repository gates `npm test`, `npm run doctor`, `npm run manifests`, `npm run gen:agents:check`, `npm run format:check`, and `npm --prefix apps/web run format:check`.
- Result: every targeted suite exits 0 — S1 24 red→green, then sync-remote 35/35, sync-conflicts 14/14, CLI sync-envelope 11/11, adjacent sync 23/23, schemas 16/16; S2 37 red→green, then 111/111 targeted + 42/42 adjacent; S3 21 red→green, then 118/118 targeted + 87/87 adjacent; S4 13 red→green, then 25/25; S5 24 red→green, then 74/74; S6 3 red→green, then web exit 0 (571 tests). Full `npm test` exits 0 with 2513 passed / 0 failed.
- Date: 2026-08-24.
- Plan gate result and explicit user confirmation.
- Feature/session identity and exact booked paths.
- Before-fix negative-test failures for every P1/P2 finding.
- Focused test results per vertical slice.
- Full repository gate results.
- Diff inspection proving no unplanned files or generated-surface drift.
- Two-axis follow-up review with zero unresolved P1/P2 findings.
- Approval, handoff bundle, handoff validation, and acceptance records.

## Suggested Commit Sequence

1. `test(sync): characterize envelope security boundaries`
2. `fix(sync): enforce canonical artifact paths and schema validation`
3. `fix(sync): enforce structural identity admission`
4. `fix(sync): make transport preparation non-executing`
5. `fix(governance): fail closed on corrupt distributed ledgers`
6. `fix(web): remove resting input shadows`
7. `docs(sync): align CLI help and distributed-governance contracts`

## Risks

- A stable Repository Identity may require an identity-contract migration for
  repositories that currently infer identity from directory names.
- Tightening the schema can reject envelopes produced by the current buggy
  implementation. Compatibility must be explicit; do not silently accept
  malformed legacy envelopes.
- Removing live Git mutations changes the current `sync session run|push`
  behavior. Help, tracer fixtures, and release notes must identify the change.
- Changing corruption handling can turn previously successful list commands
  into failures. This is intentional, but callers and Web adapters must handle
  the typed error instead of assuming arrays.
- The local dependency state currently blocks Amber CLI execution; no gate or
  session evidence can be produced until dependencies are restored.

## Resume Checkpoint

- Resume Point: plan exported; implementation has not started.
- Blockers: `ajv` is unavailable in the current local dependency state, so
  Amber CLI route/session commands cannot run.
- Next Action: restore dependencies, add F035 to feature state, run `amber
  next`, validate this plan, and request explicit plan confirmation.
- Recovery Instructions: reopen this file, confirm the fixed point and current
  worktree, then continue from the first unchecked vertical slice. Do not mark
  later slices complete after an earlier gate or verification failure.
