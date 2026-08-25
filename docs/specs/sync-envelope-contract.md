# Sync Envelope Contract (F035)

> Runtime contract for the distributed sync admission pipeline hardened by
> F035. A sync envelope wraps exactly one governed artifact
> (`schemas/sync-envelope.schema.json`) and never carries source code,
> secrets, agents, tools, or arbitrary files. Every incoming envelope passes
> through one admission pipeline with a fixed refusal order — schema →
> artifact path/type → protocol → tenant → repository → generation → content
> hash — and structural identity is compared BEFORE any artifact content is
> read, so a foreign-tenant envelope always surfaces as `identity-mismatch`
> and never leaks into content-based classification. Structural validation
> routes exclusively through one cached AJV adapter compiled from the schema;
> hand-rolled structural validation is forbidden. Semantic refusals are
> preserved append-only in `.amber/sync/conflicts.jsonl` and are never marked
> applied; structurally invalid envelopes fail explicitly WITHOUT a conflict
> entry. Transport is preparation/report-only (decision D1): Amber proposes
> git operations as structured, schema-governed operations
> (`schemas/sync-transport-report.schema.json`, F040 / ADR-0020 D5) for a
> human or external executor to replay and never runs `git add`, `git
> commit`, or `git push`.

**Date:** 2026-08-25
**Plan:** `docs/plans/F035-Harden-distributed-sync-admission-and-fail-closed-boundaries.md`
**Implementation:** `schemas/sync-envelope.schema.json` (structural SSOT),
`scripts/lib/core/sync-envelope-contract.js` (cached AJV adapter),
`scripts/lib/core/sync-remote.js` (admission, compatibility, path registry,
pack), `scripts/lib/core/identity.js` (structural identity),
`scripts/lib/core/sync-conflicts.js` (ledgers, apply, replay),
`scripts/lib/core/sync-session.js` (pull/push/session), CLI wiring in
`scripts/lib/sync-commands.js`.

## Envelope structure and the schema SSOT (信封结构与单一事实源)

`schemas/sync-envelope.schema.json` is the single structural source of truth.
It is compiled once by the AJV adapter
(`scripts/lib/core/sync-envelope-contract.js`) and the compiled validator is
cached for the process lifetime; `validateEnvelope` in `sync-remote.js`
delegates to it. No hand-rolled structural rules may exist beside it — the
F035 rewrite deleted the previous handwritten checks precisely so the runtime
can never drift from the published schema. The adapter:

- compiles with `allErrors: true` and registers the `date-time` format
  manually (AJV 8 ships no built-in formats; without registration the schema
  throws at compile time) using an RFC 3339 regex;
- converts AJV diagnostics into deterministic, user-facing error strings
  (`formatErrors`) with keyword-specific wording for `required`,
  `additionalProperties`, `pattern`, `enum`, `minLength`, `minItems`,
  `minimum`, and `type`, and the raw message otherwise.

Required envelope fields (top level `additionalProperties: false`):

| Field | Constraints |
| --- | --- |
| `schemaVersion` | enum `["1.0.0"]` — breaking shape changes bump this |
| `envelopeId` | UUID, lowercase-hex pattern; immutable |
| `artifactType` | one of the 12 registered types below |
| `artifactRef` | `{ path, hash }` — repo-relative path (minLength 1) and `sha256:<64 hex>` content hash |
| `structuralIdentity` | `{ tenantId, repositoryId, repositoryGeneration }` — non-empty strings, integer generation ≥ 0 |
| `origin` | `{ profile, personId?, agentId? }` — profile is `personal-node` \| `team-hub` \| `organization` |
| `createdAt` | RFC 3339 date-time |
| `versionNegotiation` | `{ amberProtocolVersion, minCompatibleVersion, capabilities }` — both versions strict `x.y.z`; capabilities an array of unique strings with `minItems: 1` |

Optional fields: `conflictRecord` (`{ conflictType?, remoteEnvelopeId?,
resolution?, recordedAt? }` — present only when a sync conflict was detected;
conflicts are never silently overwritten) and the ADR-0012 legacy slots
`amber_protocol_version`, `artifact_sequence`, and
`artifact_type` (const `"sync-envelope"`). The local producer
(`envelopeFromArtifact`) never emits `conflictRecord`.

The wrapped artifact types and their canonical path families
(`ARTIFACT_PATH_REGISTRY` — artifact type is never authority by itself; see
the admission pipeline):

| `artifactType` | Canonical path family |
| --- | --- |
| `session-manifest` | `.amber/sessions/<sessionId>/manifest.json` |
| `timeline-event` | `.amber/sessions/<sessionId>/timeline.jsonl` |
| `feature-list` | `feature_list.json` |
| `route` | `routes/<name>.route.json` |
| `loop-contract` | `workflow-packs/<name>.pack.json` |
| `context-page` | `.amber/context/pages/<pageId>.json` |
| `context-request` | `.amber/context/requests/<requestId>.json` |
| `knowledge-plan` | `docs/wiki/knowledge-plan.json` (or `.yaml`) |
| `workflow-assessment` | `docs/workflow-assessment.md` (or `.json`) |
| `memory-entry` | `.amber/memory/registry/<entryId>.json` |
| `memory-request` | `.amber/memory/requests/<requestId>.json` |
| `governance-report` | `docs/governance-report.md` (or `.json`) |

**Producing an envelope** (`envelopeFromArtifact` / `packEnvelope`): the
artifact path must already resolve canonically and the file must exist; the
envelope gets `schemaVersion: "1.0.0"`, a fresh `crypto.randomUUID()`
`envelopeId`, the canonical path plus its `sha256:` hash, structural identity
from `resolveIdentity(cwd)`, origin profile from
`resolveDeploymentProfile(cwd)` (falling back to `personal-node`),
`createdAt` as the current ISO timestamp, and
`versionNegotiation: { amberProtocolVersion: <running Amber package
version>, minCompatibleVersion: "1.0.0", capabilities:
["sync-envelope-v1", "structural-identity-v1"] }`. `packEnvelope` writes it
to `.amber/sync/envelopes/<envelopeId>.json` and reports pack errors as
strings instead of throwing.

## Version negotiation semantics (版本协商语义)

`checkCompatibility(envelope, local?)` compares the envelope's
`versionNegotiation` against the receiving install. `local.version` defaults
to the running Amber package version and `local.capabilities` defaults to the
frozen `LOCAL_CAPABILITIES` set `["sync-envelope-v1", "structural-identity-v1"]`.
The envelope is compatible only when every one of these holds:

1. a `versionNegotiation` object exists;
2. `amberProtocolVersion` matches strict `x.y.z` — malformed semver is
   refused, never guessed;
3. `minCompatibleVersion` matches strict `x.y.z`;
4. the producer's **major** is not greater than the local major — an envelope
   produced by a newer major is refused because its protocol semantics are
   unknown;
5. the local version is not below `minCompatibleVersion` — a minimum above
   local is refused (silent downgrade refused);
6. every declared capability is present in the local capability set.

All violated conditions accumulate into the `reasons` list; compatibility is
`reasons.length === 0`. In admission, incompatibility is one refusal with
`conflictType: "version-mismatch"` carrying every reason. The
`schemaVersion` field is handled structurally, not here: the schema enum
currently admits only `"1.0.0"`, so any other value fails schema validation
(status `invalid`), not version negotiation.

## The admission pipeline (准入管线)

`admitEnvelope(cwd, envelope)` is the one admission pipeline. It returns
`{ status: "admitted" | "refused" | "invalid", conflictType, artifactPath,
errors }` and evaluates in this fixed order — the order itself is contract:

1. **Schema validation** (AJV). Failure → `invalid` (input is malformed; not
   a semantic conflict).
2. **Artifact path/type resolution** (`resolveSyncArtifact`). Failure →
   `invalid`. Before any existence check, read, hash, or ledger write, the
   primitive rejects: unknown artifact types; empty/blank paths; `.` or `..`;
   absolute paths; backslash separators; empty, dot, or `..` segments; paths
   outside the type's canonical family from the registry above; lexical
   escapes from the repository root; symlink/realpath escapes
   (`resolvePathWithin`); and directories or non-regular files. A missing
   file (ENOENT) is tolerated here — it returns the canonical
   repository-relative POSIX path.
3. **Protocol compatibility** (`checkCompatibility`). Failure → `refused`,
   `version-mismatch`.
4. **Tenant identity**: `envelope.structuralIdentity.tenantId` must equal the
   local `tenantId`. Failure → `refused`, `identity-mismatch`.
5. **Repository identity**: `repositoryId` must equal the local
   `repositoryId`. Failure → `refused`, `identity-mismatch`.
6. **Repository generation**: `repositoryGeneration` must equal the local
   generation. Failure → `refused`, `generation-mismatch`.
7. **Content hash**: only if the local artifact file exists, its sha256
   (computed over the utf8 file content, formatted `sha256:<64 hex>`) must
   equal `artifactRef.hash`. A difference → `refused`, `concurrent-edit`, and
   the local artifact is preserved (never overwritten). If the local file
   does not exist, the hash stage does not run and the envelope is admitted.

Otherwise the envelope is `admitted` with the canonical `artifactPath`.

**Why identity precedes content reads.** Stages 4–6 run before stage 7 opens
or hashes any file, deliberately: a foreign-tenant or foreign-repository
envelope must surface as `identity-mismatch` no matter what the local file
contains. If content were hashed first, a mismatched-tenant envelope whose
content diverged would be misclassified as `concurrent-edit`, and the
pipeline would have read and hashed repository content for an envelope that
was never eligible for admission. Identity-first keeps classification
correct and keeps the read boundary fail-closed: no artifact content is read
before the envelope proves it belongs to this tenant, repository, and
generation. `unpackEnvelope` is a thin wrapper over `admitEnvelope` and
therefore inherits this exact order.

## Structural identity resolution (结构身份解析)

`resolveIdentity(cwd)` (ADR-0019 D4 hybrid bootstrap) resolves the local
identity an incoming envelope is compared against. The `repositoryId`
precedence chain is:

1. `.amber/identity.json` `repositoryId` — the explicit governed override
   (applied when it is a non-empty string);
2. the **normalized** `remote.origin.url`, when a `.git` directory exists and
   the remote is configured — the same remote is one repository, whatever
   directory each clone lives in;
3. the deterministic default `"local-repository"`.

`path.basename(cwd)` is NEVER used — that was the pre-F035 implementation,
and it is unstable across clones.

Remote URL normalization collapses spelling variants to one identity: trim;
strip any scheme (`https://`, `ssh://`, `git://`, …); strip
`user[:pass]@` credentials before the first slash; rewrite scp-form
`host:path` to `host/path` (the host must be longer than one character so a
Windows drive letter like `C:` is not mistaken for a host); convert
backslashes to slashes; lowercase the host segment; strip trailing slashes;
strip a trailing `.git`. Defaults and overrides for the remaining fields:
`tenantId` defaults to `"local"`, `organizationId` to `"personal"`, and
`repositoryGeneration` to `0`; `.amber/identity.json` (when valid JSON and
an object — otherwise ignored) overrides `tenantId`/`organizationId` when a
non-empty string, `repositoryGeneration` when a number ≥ 0, and
`personId`/`agentId` when a string. `personId` is otherwise inferred from
git config as `"Name <email>"`, only inside a real git repository and only
when both `user.name` and `user.email` are set; the identity file wins over
git inference for any field it declares.

## Conflict classification (冲突分类)

First match wins, in the fixed admission order. Only semantic refusals enter
the conflict ledger; invalid input never does.

| # | Condition | Status | `conflictType` | Conflict ledger entry |
| --- | --- | --- | --- | --- |
| 1 | Schema validation fails | `invalid` | — | none |
| 2 | Artifact path/type resolution fails | `invalid` | — | none |
| 3 | Version/capability incompatibility | `refused` | `version-mismatch` | one pending conflict |
| 4 | `tenantId` mismatch | `refused` | `identity-mismatch` | one pending conflict |
| 5 | `repositoryId` mismatch | `refused` | `identity-mismatch` | one pending conflict |
| 6 | `repositoryGeneration` mismatch | `refused` | `generation-mismatch` | one pending conflict |
| 7 | Local content hash differs | `refused` | `concurrent-edit` | one pending conflict |
| — | none of the above | `admitted` | — | applied ledger |

The closed `conflictType` set is `concurrent-edit`, `generation-mismatch`,
`version-mismatch`, `identity-mismatch` (`CONFLICT_TYPES`); the closed
resolution set is `pending`, `local-wins`, `remote-wins`,
`manual-merge-required` (`RESOLUTIONS`). The pipeline records only `pending`
conflicts; no module in this surface resolves one — resolution is a human
concern.

## Ledger semantics (账本语义)

Three append-only ledgers live under `.amber/sync/`:

- **`conflicts.jsonl`** — semantic conflicts. Each record is
  `{ conflictType, envelopeId, artifactPath, detail, resolution, recordedAt }`
  with `resolution` defaulting to `"pending"`; `recordConflict` throws
  `ConflictError` on an unknown `conflictType`. Records are appended, never
  overwritten; `listConflicts` returns them in ledger order and skips corrupt
  lines.
- **`applied.jsonl`** — `{ envelopeId, appliedAt }` per admitted-and-applied
  envelope.
- **`refused.jsonl`** — `{ envelopeId, refusedAt }` per semantically refused
  envelope. A refused envelope is NEVER marked applied; this separate ledger
  is what stops repeated replays from recording duplicate conflicts.

**Invalid vs refused.** `applyEnvelope` routes admission results into three
actions: `invalid` (`ok: false`, no conflict, no applied mark, errors only),
`conflict` (`ok: false`, exactly one pending conflict recorded — using the
canonical `artifactPath`, falling back to `artifactRef.path` — and never
applied), and `applied` (`ok: true`). Invalid structural input is thus
distinct from a valid semantic conflict: it produces an explicit error and
never touches the conflict ledger.

**Replay idempotency.** `replayEnvelopes(cwd)` reads every `.json` file in
`.amber/sync/envelopes/` in sorted filename order (skipping unreadable
files), snapshots the applied and refused envelope-id sets at the start of
the pass, then for each envelope: skips it if already applied; skips it if
already refused (the conflict was recorded once and must not be duplicated);
otherwise applies it through `applyEnvelope`. `ok` increments `applied` and
marks the envelope applied; `conflict` collects the conflict and marks the
envelope refused (terminal for this and later passes); `invalid` accumulates
into `errors`. Returns `{ applied, conflicts, errors }`. Because the
snapshots are taken once before the pass, markings made during a pass take
effect for the next pass.

## Transport preparation contract — decision D1 (传输准备契约)

Transport is preparation/report-only. The session never executes `git add`,
`git commit`, or `git push`, and there is no `--execute` escape hatch; the
only git invocation on this surface is the read-only `git remote` listing
used to compute `remoteConfigured`. Envelopes are still *carried* by git
(ADR-0019 D1): the `.amber/sync/envelopes/` directory is committed to the
shared Team Hub repository and exchanged via git remote — by a human
replaying the proposed operations. Reintroducing live transport requires its
own accepted ADR defining policy, approval, isolation, ledger, and recovery
semantics, plus a governed Action.

`pushEnvelopes(cwd)` produces the preparation report — a published,
schema-governed, ADR-0012-versioned contract
(`schemas/sync-transport-report.schema.json`, compiled by the cached AJV
adapter `scripts/lib/core/sync-transport-report-contract.js`; F040, ADR-0020
adjudication 5). The emitted report self-validates against its own schema and
folds any violation into `errors` (fail-closed); `amber sync session push
--json` surfaces the schema-valid report object for machine consumption,
while text mode renders shell lines derived one-way from the structured ops.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `"1.0.0"` (ADR-0012 versioning; bumped on breaking shape changes) |
| `mode` | always `"prepare"` |
| `envelopeCount` | number of parsed envelopes in `.amber/sync/envelopes/` |
| `envelopeIds` | the `envelopeId` values that are strings |
| `envelopePaths` | `.amber/sync/envelopes/<id>.json` per envelope, sorted |
| `affectedPaths` | every file under `.amber/sync/`, repository-relative POSIX, sorted |
| `proposedOps` | **structured operations** (never shell strings): `[]` when there are no envelopes; otherwise `{verb: "add", paths: [".amber/sync"]}`, `{verb: "commit", message: "amber sync: N envelope(s)"}`, plus `{verb: "push"}` only when a remote is configured — closed verb set (add/commit/push), confined paths carried as an explicit array |
| `remoteConfigured` | whether `git remote` lists at least one remote |
| `conflictCount` | records currently in `conflicts.jsonl` |
| `refusedCount` | distinct envelope ids in `refused.jsonl` |
| `note` | one of three deterministic messages: no envelopes to prepare; prepared with proposed operations NOT executed; prepared with no remote configured so `git push` was not proposed |
| `errors` | empty unless the report itself violates its contract (self-check, fail-closed) |

Session orchestration: `pullEnvelopes(cwd)` maps `replayEnvelopes` to
`{ validated, refused, conflicts, errors }` (`validated` = applied count);
`runSyncSession(cwd)` runs pull then preparation and returns
`{ session, summary: { pulled, refused, conflicts, preparation }, errors }`.
The session status is `"failed"` only when `errors` is non-empty — that is,
only invalid structural envelopes fail a session; semantic refusals are
persisted conflicts and surface through the summary, not as session errors.

## Invariants (不变量)

1. **Schema SSOT.** `schemas/sync-envelope.schema.json`, compiled by the
   cached AJV adapter, is the only structural validator; any second copy of
   structural rules is drift.
2. **Fixed refusal order.** Schema → path/type → protocol → tenant →
   repository → generation → content hash; the first failure determines the
   classification, and reordering changes observable conflict types.
3. **Identity before content.** No artifact content is read or hashed before
   tenant, repository, and generation admission, so identity mismatches can
   never surface as `concurrent-edit`.
4. **Path allowlist before any filesystem effect.** No existence check,
   read, hash, or ledger write happens for a path outside the artifact
   type's canonical family or outside the repository (lexically or through a
   symlink/realpath transition).
5. **Refused is never applied.** Semantic refusals record exactly one pending
   conflict and go to `refused.jsonl`, never `applied.jsonl`; replay skips
   both already-applied and already-refused envelopes.
6. **Invalid is not a conflict.** Schema or path failures are explicit
   errors with no conflict-ledger entry.
7. **Zero git mutations.** Preparation proposes structured operations
   (schema-governed, closed verb set — never shell strings); only the
   read-only `git remote` query runs.
8. **Envelope boundary.** One envelope wraps exactly one registered
   artifact type at its canonical path; source, secrets, agents, tools, and
   arbitrary files are refused.

## Machine surfaces (机器表面)

- Structural SSOT: `schemas/sync-envelope.schema.json`
- AJV adapter (only structural validator): `scripts/lib/core/sync-envelope-contract.js`
- Admission pipeline, compatibility, path registry, pack/unpack:
  `scripts/lib/core/sync-remote.js` (`admitEnvelope`, `checkCompatibility`,
  `resolveSyncArtifact`, `envelopeFromArtifact`, `packEnvelope`,
  `unpackEnvelope`)
- Identity resolution: `scripts/lib/core/identity.js` (`resolveIdentity`,
  `normalizeRemoteUrl`, `resolveRepositoryId`)
- Ledgers, apply, replay: `scripts/lib/core/sync-conflicts.js`
- Pull/push/session and the preparation report: `scripts/lib/core/sync-session.js`
- CLI wiring: `scripts/lib/sync-commands.js`
- On-disk state: `.amber/sync/envelopes/` (envelope store),
  `.amber/sync/conflicts.jsonl`, `.amber/sync/applied.jsonl`,
  `.amber/sync/refused.jsonl`
- Plan: `docs/plans/F035-Harden-distributed-sync-admission-and-fail-closed-boundaries.md`;
  ADR-0012 (protocol and schema versioning), ADR-0019 (distributed
  governance stage-1 decisions)

**Mandatory-update rule:** any change to the envelope schema, the admission
order, the artifact path registry, the identity precedence chain, the ledger
record shapes, or the preparation report shape must update this contract in
the same change.
