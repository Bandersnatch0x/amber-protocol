# Trusted Control Context / Runtime Boundary Contract (0047 · 0053 · 0058 · 0059)

**Spec ID:** `trusted-control-context-runtime-contract`
**Status:** proposed
**Updated:** 2026-09-16
**Review:** coordinator contract review 2026-09-16 (C0R) found three defects — F056 payloadHash overclaim, incomplete session lease binding, classification default/legacy contradiction — all repaired same day; full Standards/Spec review still pending, and runtime implementation has not started.
**Adoption authority:** Goal packet `.scratch/orchestration/all-tickets-0044-0060-2026-09-16-5HXix4` (user-approved objective); this spec converts the four boundary tickets' verified rulings plus the audit corrections into canonical text. Residual choices are recorded as implementation choices with their source.
**Provenance:** `issues/0047-runtime-interception-boundary.md`, `issues/0053-context-firewall-three-directions.md`, `issues/0058-second-domain-proof-research-adapter.md`, `issues/0059-generic-runtime-adapter.md` (2026-09-15 rulings, corrected 2026-09-16 by this packet's appended Log entries); audit P1-04 and P1-08 (`.scratch/product-scope-audit/0044-0060-2026-09-16-QjqMvx/REPORT.md` §5); coordinator contract-review-01 cross-ticket context-constraint finding (recorded in `issues/0050-run-runscope-snapshot.md` R0 revision); coordinator C0R contract-review findings 1-3 (2026-09-16), repaired in this revision. Source facts verified at HEAD `0a9cbeab` with file:line citations in §11.
**Depends on:** F050 (approval registry — single-use subject-bound approvals), F052 (runner registry — request/authorize/prepare/settle lifecycle), F056 (external effects registry), F058 (instruction-surface quote boundary), F062 (session stage verbs + lease), ADR-0001 (governance-first boundary; amended narrowly by §2.5), ADR-0009/0010/0015 (context request/Loadout/required artifacts), the trusted-control run contract (`docs/specs/trusted-control-run-contract.md` §3/§6, container resolved in §4 below).
**Implementation plan:** `docs/plans/trusted-control-context-runtime.md` (proposed; current implementation status: **not yet delivered**).

> Canonical contract for the context and Runtime boundary planes: PEP coverage
> as an explicit contract over four evidence classes (0047), the Context
> Firewall's three directions with declaration-based egress constraints at the
> real seams (0053), the context authority container inside the run contract's
> scopeInputs (resolving the six-field vs seventh-field contradiction), the
> generic Runtime Adapter's real five-stage callable lifecycle (0059), and the
> Research adapter's minimal capability set with honest time/egress/verifier
> semantics (0058). Exact digest equality is integrity, never containment.
> What is enforceable, what requires independent verification, and what is
> outside Amber's observation is stated per mechanism — no control is claimed
> that a deterministic check cannot back.

## 1. Problem

The four tickets ruled correctly on direction (blind-spot declaration for 0047, Loadout-as-snapshot for 0053, Runtime-calls-Amber for 0059, Research-before-Ops for 0058) but four of their mechanical claims were false at the real seams (audit P1-04, P1-08):

1. **0053/0058 egress:** "content hash comparison at `prepareRunnerExecution` prevents restricted source content entering external writes" — (a) a whole-source digest vs a payload digest proves nothing about fragments, encodings, or rewrites inside the payload; (b) F056 does not pass through `prepareRunnerExecution` at all — its execution seam is `executeExternalEffect` (`external-registry.js:1315`), and Amber never sees F056 payload bytes (the CLI takes `--payload-hash` only, `external-commands.js:196`).
2. **0047 coverage matrix:** it blended a runner's self-reported `receipt.scope` (compared against the authorized bound at settle, `runner-registry.js:1909-1923`), caller-supplied dirty-path classification (`dirty-paths.js:65`), and "worktree diff raises host actions to observed" into one assurance story. A worktree diff is an independent observation of file state only; it cannot establish the absence of network effects and cannot attribute unmediated changes to a principal.
3. **0059 lifecycle:** `capability.request` was mapped directly onto `prepareRunnerExecution`, but prepare requires an already-recorded **and** authorized request (`runner-registry.js:1851-1854`); it neither submits nor authorizes, and the ticket's diagram omitted the human authorization handover that the MCP surface actually enforces (`mcp-action-runtime.js:191-198` returns `approvalRequired`).
4. **Run contract container:** the run contract froze authorization-relevant context constraints inside `scopeInputs.context_constraints` (§6 R-AU-1) — a seventh field that contradicts its own §3 six-field closed set, with the field names deferred to 0053 "owner to decide later".

This contract resolves all four without reopening the approved directions: the A blind-spot path, the bounded opt-in future policy, the Loadout-as-snapshot ruling, the Runtime-calls-Amber direction, and the search/extract/cite scope are all preserved.

## 2. PEP coverage as an explicit contract over evidence classes (0047)

### 2.1 The four evidence classes

Every assurance statement about a side effect is classified into exactly one class. Blending classes is the error this section eliminates.

| Class | Definition | Who produces the fact | Assurance ceiling |
| --- | --- | --- | --- |
| **E1 — Amber-recorded facts** | What Amber itself did and recorded: request capture, authorization and consumption, ledger events, hashes, timestamps | Amber (the mediator) | **observed** for the recorded facts themselves; says nothing about external behavior |
| **E2 — Executor self-report** | What an executor (runner, adapter, Runtime) claims about its own execution: receipt scope, outputs, exit status | The executor (interested party) | **claimed**; a check of a claim against a bound is a *claim check*, not an observation |
| **E3 — Independently observed state** | State read by an Amber-mediated read performed by a principal that is not the executor: worktree diff, dirty-path classification, citation-store contents | Amber-mediated observation, executor not the source | **observed** for exactly the state read (file state inside the observed repository); no claim about anything not read |
| **E4 — Unobservable host actions** | Host-agent tool calls and effects that never pass through Amber | Nobody Amber can name | **unavailable**; no record point exists, not even a claimed one, unless the host volunteers a report |

Corollaries (invariants):

- **R-EC-1** A worktree diff establishes file-state facts **inside the observed repository** only. It can never establish the absence of network effects, out-of-repository writes, or process-internal side effects. No test, receipt, or assurance statement may assert "no external effect occurred" on the basis of a diff.
- **R-EC-2** A reported scope is not an independent observation. `deriveOutcome`'s comparison of `receipt.scope` against the authorized target (`runner-registry.js:1909-1923`) is a fail-closed **claim check**: it refuses a self-report that exceeds the bound; it never certifies that the executor's actual behavior stayed inside it.
- **R-EC-3** E3 observation cannot attribute an unmediated change to a principal. A dirty path outside declared prefixes proves "this file changed outside the declared scope", not "the host agent did it" and not "only this happened".
- **R-EC-4** Evidence classes never merge into one row-level assurance value. A receipt may carry E1 facts (it was recorded, hashes matched) about E2 content (the runner's claim); each statement keeps its own class.

### 2.2 Corrected PEP coverage matrix

The approved A path is preserved: PEP covers all Amber-mediated side effects; unmediated host tool calls are a declared blind spot; no host interception, no sandbox ownership, no automatic agent dispatch.

| Execution path | Passes PEP? | E1 (recorded) | E2 (self-report) | E3 (independent observation) | E4 (unobservable) |
| --- | --- | --- | --- | --- | --- |
| governed-runner four gates (loop / route stage) | yes | request, policy verdict, approval consumption, ledger chain | process result (exit code, stdout) recorded by Amber — the process outcome is E1 (Amber ran and observed the process), the command's own external behavior (e.g. network calls it makes) is E2 if reported, else unobserved | worktree diff after the run (file state) | network/out-of-worktree effects of the executed command |
| F052 registered runner (incl. 0059 Runtime) | yes | submit/authorize/prepare/settle events, requestHash, drift refusals, approval consumption | the settle receipt in full: scope, outputs digest, exit status | worktree diff (when the runner's target is the repository) | the runner's actual behavior outside its receipt |
| F056 external effect | yes | proposal, authorization, execution and settlement records, requestHash, and the **declared** `payloadHash` — recorded at propose, re-derived and compared at execute/settle; the binding is between declared hashes, and payload bytes never enter Amber | adapter's declared receipt (`externalRecordId`, digests, declared status) — including any claim that the bytes actually sent matched the declared hash | none — the external system is outside Amber's reads | the external system's actual behavior |
| Host-agent tool calls (not through Amber) | no | none | none unless the host volunteers a report (a volunteered report is E2 with an unnamed executor) | post-hoc worktree diff (file state only) | network egress, out-of-repository writes, and attribution |

**Assurance ceilings per statement class** (unchanged in vocabulary from 0047, now correctly scoped): E1 facts may reach `observed` (or `verified` through an independent verification event, 0054); E2 content stays `claimed`/`unavailable` unless raised by E3 or independent verification; E3 facts are `observed` for exactly the state read; E4 is `unavailable` and is never raised by any later Amber-mediated fact except an E3 read of state that exists (e.g. a file that appeared).

### 2.3 Out-of-scope detection: semantics and error codes

Two distinct detections share the `AMBER_E_RUNNER_EXECUTION_SCOPE` code family (constant `EXECUTION_SCOPE_CODE`, `runner-registry.js:1520`); they are never conflated in records or tests:

- **D1 — settle-time claim violation (E2, fail-closed):** the presented receipt self-reports scope outside the authorized target (`repository` mismatch or a path not under a granted prefix) → outcome `failed`, code `AMBER_E_RUNNER_EXECUTION_SCOPE`, recorded in the settlement (existing `deriveOutcome`, `runner-registry.js:1909-1923`). This is a refused claim, not a detected effect.
- **D2 — post-hoc observed violation (E3, FAIL outcome):** an Amber-mediated worktree read observes dirty paths outside the declared `pathPrefixes` / booked feature paths. `classifyDirtyPaths` (`dirty-paths.js:65`) sorts caller-collected porcelain paths into managed / focusWork / outsideScope; the observing surface records an `outsideScope` classification as a FAIL fact. The record states exactly: file state observed out of scope (E3); actor unknown (no attribution); network effects unobserved. D2 never blocks the host (blind-spot contract) and never asserts more than the file-state fact.

**v3.1 §39 test discipline (option A, corrected):** "Direct execution bypass is impossible through public Core APIs" is tested only over mediated paths — every side-effecting path reachable through a public Amber API passes a PEP gate, and no un-gated mediated path can produce an E1 record claiming observed-or-better assurance. Unmediated host paths are outside §39's claim. A worktree-diff test asserts file-state confinement only; no test asserts absence of network effects.

### 2.4 Bounded opt-in future policy (preserved, unchanged)

Runtime interception (PreToolUse-level blocking) remains a *possible future opt-in enhancement*: never automatically installed, fail-open (detect and record `unavailable`, never block), and evaluated only after the 0059 lifecycle (§5) is implemented and external demand recurs. This contract grants no sandbox, runtime, or host-interception ownership.

### 2.5 ADR-0001 amendment

The narrow amendment appended to `docs/adr/0001-governance-first-artifact-first.md` by this packet states the §2.1/§2.2 contract in ADR form with source provenance. It makes no blanket control claim: it does not claim interception, sandboxing, or observability of unmediated actions.

## 3. Context Firewall: classification, purpose, TTL, snapshot, three directions (0053)

### 3.1 Trusted metadata owner and source validation

Classification, purpose, and TTL are **page/source-level metadata owned by the artifact that carries the content**, following the existing Scope Tag discipline (single source of truth lives in the page, not a sidecar):

| Metadata surface | Owner | Validation at the seam | Default when absent |
| --- | --- | --- | --- |
| Context Page `classification` / `purpose` / `ttl` | The page (declared at `amber context ingest`, covered by the page hash) | ingest validates enum/duration shape; the page's request binding and citation checks apply unchanged | stored `classification` absent ⇒ **effective projection `internal`** (see "Stored field vs effective projection" below — never a stored write-back); `purpose: null` (Loadout scope is the purpose), `ttl: null` (existing staleness semantics) — the effective default is valid **only** because governed ingest is itself the provenance boundary: a page entering through `context ingest` has a recorded request and sources (`context-ingest.js:50` `checkRequestBinding`) |
| Required Artifacts (operating-manual / route-manifest / loadout-definition) | The owning governance surface | fixed `classification: "internal"`; not caller-settable | n/a (always set when generated; pre-field artifacts via the effective projection below) |
| Distillation Contract `sources[]` `classification` | The request author (Amber writes the request) | schema enum; **`unknown` is an explicit legal value** for tool outputs and ad-hoc content | sources without a label carry `unknown` — never a silent default |
| Loadout `pages[]` / artifact entries | projection only (copied from the page/artifact, hashed with the Loadout) | load-build copies verbatim; a page whose stored classification disagrees with the page hash is `tampered` (existing discipline) | n/a |

**Stored field vs effective projection.** The stored `classification` field is canonical and page/source-owned: it contains exactly what the page or source declared, is covered by the page hash, and is never written back by any reader. The effective classification is a deterministic projection computed at read/load-build time:

- stored `classification` present ⇒ the stored value wins (canonical; the projection never overrides it);
- stored field absent **and** the source is a governed-ingest Context Page or a Required Artifact (provenance recorded) ⇒ effective `internal` — the established effective default, recorded as `classificationSource: "effective-default"` so the projection is explicit and testable, never silent;
- stored field absent for anything else (ad-hoc content, tool output, unlabeled request sources) ⇒ `unknown` — never a default `internal`.

Pre-field governed-ingest pages and Required Artifacts (records created before the field existed) therefore never gain a new stored classification — no backfill, no silent write-back; the compatibility projection above treats exactly those sources as effective `internal`. The projection is limited to governed-ingest Context Pages and Required Artifacts; it never applies to ad-hoc or tool-output sources, which stay `unknown` and fail closed under any ceiling.

**Classification vocabulary and rank:** `public(0) < internal(1) < confidential(2) < restricted(3) < secret(4)`, plus the special value `unknown` (no rank). Deterministic admission rule: a source is admitted under a ceiling `maxClassification` iff `rank(classification) ≤ rank(maxClassification)`. **`unknown` never satisfies any ceiling** — it is refused with an explicit `classification-unknown` reason, never silently passed (the effective-`internal` projection above applies only to governed-ingest pages and Required Artifacts, whose provenance is recorded; everything else must be labeled or refused).

**Downgrade is a governance change:** relabeling a source from `restricted`/`secret` to any lower class requires an independent human Decision recorded before the page hash changes; ingest refuses a downgrade that cannot show one. Upgrades (labeling more restrictive) are always allowed.

**Purpose:** a non-empty string referencing the Loadout scope (route or feature id). Reused from the existing Scope Tag; not duplicated into a second vocabulary.

**TTL:** an ISO-8601 duration on the page; the load-build computes the effective `expiresAt := page ingest/refresh time + ttl`. Two deterministic freshness checks, never merged: (a) *content staleness* (existing `normHash` discipline for mutable sources) and (b) *hard expiry* (`expiresAt` passed ⇒ the page is excluded with a new `excluded.reason: "expired"`). At consumption time (§4), a context authority whose `expiresAt` has passed refuses — expiry is a hard boundary, not a warning.

### 3.2 ContextSnapshot: the Loadout, extended in place

The 0053 ruling stands: **the Loadout is the ContextSnapshot; no second snapshot object exists.** The v3.1 ContextSnapshot field set maps onto the Loadout as:

| v3.1 field | Loadout carrier | Status |
| --- | --- | --- |
| sources | `artifacts.required[]` + `pages{}` + `references[]` (each with `rawHash`) | existing |
| filters | `tiers`, `pages[].scope`, `knowledgeKinds` | existing |
| redactions | **`redactions[]` (new, top-level)** | specified here |
| provenance | per-source `rawHash`/`normHash`/`excerptHash` + `generatedAt` + `deltaSince` | existing |
| content_hash | existing Loadout hash discipline (the Loadout is hash-pinned) | existing |

`redactions[]` entries: `{ field: string, reason: enum }` with reasons `classification-ceiling` (a field/page omitted because its classification exceeds the scope ceiling) and `purpose-mismatch` — recording **that** something was omitted and why, never values, counts, or ordering (the Redaction State discipline: deterministic, bounded, no masked success). A page denied by classification is *also* recorded in `excluded[]` with the new reason `classification`; `redactions[]` is for fields omitted inside admitted pages (e.g. an excerpt withheld), keeping the two ledgers of omission distinct.

### 3.3 Ingress (direction 1)

- Pages/artifacts enter the Loadout per §3.1; the load-build excludes `classification`-denied and `expired` pages with explicit reasons.
- The PDP v2 context face (0051 owner) evaluates rules of the shape `target.constraints.maxClassification` and produces grant/deny.
- Timeline events `context_granted` / `context_denied` (reserved-disabled by 0056's taxonomy; **this contract is the enabling ruling**) carry `{runId, source, classification, purpose, decision, reason}`. Until the 0056 slice lands, the reservation remains a ticket-level decision with no schema/code trace — stated as such, not claimed as implemented.

### 3.4 Tool output (direction 2)

F058 already covers "tool output is context and is untrusted": `treatSourcesAsQuotedEvidence: true` is schema-enforced for 1.3.0 contracts (`context-request.schema.json:108-131`) and double-checked by the eval (`instruction-surface-evals.js:424-441` schema gate, `:376,:582` instruction gate). Provenance hashes and word budgets exist (`sources[]` hashes, `budgetWords`, `maxWords`). This contract adds exactly one thing: tool-output-derived content carries `classification: "unknown"` until a human labels it (§3.1) — the quote boundary already prevents it from becoming instructions; classification now prevents it from silently entering a constrained scope.

### 3.5 Egress (direction 3) — declaration-based constraints at the real seams

**The guarantee is narrowed to what is true.** Amber constrains the **declared data flow of mediated inputs**. For F056, Amber receives only the declared `payloadHash` — payload bytes never enter Amber (the CLI takes `--payload-hash` only, `external-commands.js:196`). What is enforceable is that the execution/settlement record binds the same **declared payloadHash** that was reviewed in the proposal and recorded in the ledger: drift between those declared hashes refuses (existing re-derivation at `executeExternalEffect`). Amber cannot verify that the executor actually sent bytes matching that hash — the actual executed payload is an executor/adapter claim (E2, §2.1), outside Amber's direct observation, unless an independent verifier observes the bytes. `payloadHash` therefore establishes no actual payload-byte integrity, no actual-payload identity, and no leak prevention, and it says nothing about whether the payload contains fragments, encodings, or rewrites of restricted source content. **No hash comparison anywhere in Amber is leak prevention, and none may be documented as such.**

**R-EG-1 (F056 seam — propose and execute, not prepare).** The F056 input boundary is `proposeExternalEffect` (`external-registry.js:770` — takes `{id, effect, payloadHash}`; payload bytes never enter Amber) with re-derivation at `executeExternalEffect` (`:1315`). The proposal input gains:

```
payloadSources: [ { kind: "page" | "artifact" | "contract-source",
                    ref: string,           // pageId / artifact kind / request source ref
                    rawHash: "sha256:…" } ]  // the exact source revision claimed to feed the payload
```

and the effect-contract registration (`registerExternalEffect`) gains `maxPayloadClassification` (enum, default `internal`) and `requiresPayloadProvenance` (boolean, default `false`; a governance rule may require it for a system/operation). Validation, all at propose **and** re-derived at execute (drift refuses, existing `EXTERNAL_DRIFT_CODE`):

1. every `payloadSources` entry resolves against the current context snapshot (the Loadout / Contract sources of the target repository) — an unresolvable reference refuses with a wrong-scope-source reason (fail-closed, never "treat as unconstrained");
2. any resolved source whose `rank(classification) > rank(maxPayloadClassification)` refuses — restricted/secret content in the declared flow does not pass;
3. `requiresPayloadProvenance` and no declaration ⇒ refuses (unverifiable, not silently passed).

**R-EG-2 (Research search seam).** The `search` capability request carries the query text (available to Amber, unlike an F056 payload) plus `querySources[]` in exactly the R-EG-1 reference shape, with the capability's registered constraints declaring `maxQueryClassification` (default `internal`) and `requiresQueryProvenance` (default `false`). The same three validations run at the request seam. Amber holding the query text does **not** add a containment claim: no scanner is built, and no substring check is claimed as leak prevention (an exact-substring check would be a detection aid, not a guarantee; it is out of scope).

**R-EG-3 (host direct egress).** A host agent sending content out without Amber mediation is E4 (§2.1): no record point, not even claimed. The spec states the blind spot; the bounded opt-in detection hook (§2.4) is the only future mitigation, unchanged.

**Declassification / approval responsibility — who may raise a ceiling.** There is **no per-call override**. A legitimately needed write whose declared sources exceed the ceiling goes through exactly one of two governance changes: (a) relabel the source page (Decision + human approval; downgrades of restricted/secret need an independent Decision per §3.1), or (b) register a new effect version (F056) / capability version (F052/0052) with a higher declared ceiling — itself a human-approved registration. The caller of propose/search can never widen the ceiling by declaration.

### 3.6 Enforceable / independently verifiable / outside observation (egress)

| Statement | Status |
| --- | --- |
| "The declared sources resolve in this snapshot and are within the ceiling" | **Enforceable** — deterministic check at the seam (R-EG-1/2) |
| "The execution/settlement record binds the same declared payloadHash that was reviewed in the proposal/ledger" | **Enforceable** — declared-hash re-derivation refuses on drift (existing) |
| "The executor actually sent bytes matching the declared payloadHash" | **Not enforceable by Amber** — executor/adapter claim (E2); raised to `verified` only by an independent verifier observing the payload bytes |
| "An unauthorized declared flow was refused" | **Enforceable** — refusal records |
| "The payload contains no restricted content" | **Not enforceable**; requires independent verification (a verifier principal may compare payload bytes against source bytes and *find* leaks; absence is never provable) |
| "No undeclared restricted content rode the payload" | **Outside Amber's observation** — a false or incomplete declaration is E4/E2; recorded as such |
| "Nothing left the repository through host tooling" | **Outside Amber's observation** (E4) |

## 4. Context authority inside the run contract's scopeInputs (container resolution)

This section is the **single resolution** of the run contract's six-field `scopeInputs` closed set vs its §6 R-AU-1 seventh `context_constraints` field. The container is the existing `context_scope` field; no seventh field is added; the structure is closed and no name is left "to decide later".

```
scopeInputs.context_scope := {
  constraints: {                      // closed set; every field REQUIRED when context_scope is present
    maxClassification: "public" | "internal" | "confidential" | "restricted" | "secret",
    purpose: string | null,           // the Loadout scope id, or null
    expiresAt: string | null,         // RFC3339 hard deadline; null = no TTL (content staleness only)
    accessBoundaries: string[]        // sorted, unique, repo-relative path prefixes the context may touch
  }
}
```

The Loadout **content** hash is deliberately **not** inside `context_scope` — it is captured separately as the Layer-0 `contextHash` (run contract §3/§4). This placement resolves the ordinary-refresh vs authorization-change semantics mechanically:

- **R-CA-1 (ordinary content refresh).** Loadout content changes, `context_scope.constraints` byte-identical ⇒ `scopeHash` unchanged ⇒ an existing grant stays valid; the refresh is observable via `contextHash`/`contractHash` (run contract R-AU-1's bounded qualifier, now structural rather than prose).
- **R-CA-2 (authorization change refuses).** Any change to `maxClassification`, `purpose`, `expiresAt`, or `accessBoundaries` changes `scopeInputs` ⇒ `scopeHash` drift ⇒ consumption refuses (`scope-drift`, run contract R-AU-3(2)). Classification, purpose, TTL, and access changes are never silently ignored.
- **R-CA-3 (time/freshness at consumption).** When `constraints.expiresAt` is set and past at the consumption instant, the consumption refuses with `context-expired` before any effect — in addition to the load-build exclusion (§3.1) which keeps expired pages out of the snapshot in the first place.
- **R-CA-4 (missing data, fail-closed and honest).** Before the 0053 fields exist (today), `context_scope` is `null` on captured attempts: an explicit recorded absence meaning "no context-constraint check existed", never a defaulted value, and never described as covered. After the fields land: when the executing surface requires context authority (a grant binding context, or a PDP rule referencing classification), a `null`/incomplete `context_scope` refuses at capture with an explicit reason; when no rule requires it, `null` remains the honest absence.
- **R-CA-5 (hash inclusion).** The four constraint fields are inside `scopeInputs` and therefore inside `scopeHash` (canonical, set-sorted per run contract R-HA-2); they are **not** inside `contextHash`. `capabilityHash`, `policyHash`, and the grant tuple `{scopeHash, policyVersion, capabilityHash, boundAttemptId}` are unchanged.

The run contract's §3 row and §6 R-AU-1 are edited by this packet to reference this structure; all other Run decisions are untouched.

## 5. Generic Runtime Adapter: the real callable lifecycle (0059)

Direction stands: **the Runtime calls Amber**; Amber never calls a Runtime (ADR-0005/ADR-0022 preserved). What changes is the lifecycle map: the ticket's two compressed verbs hid three necessary stages. The real, already-callable lifecycle (CLI `amber runner …` actions, `runner-commands.js:157-164`; the submit stage is the `request` action at `:245`):

| # | Stage | Caller | Command / seam | Amber does | Amber never does |
| --- | --- | --- | --- | --- | --- |
| 1 | **submit** | Runtime | `amber runner request` → `submitRunnerRequest` (`runner-registry.js:1236`) | validates closed input, resolves the registered capability, derives risk, computes `requestHash` over the full shaped request (+ risk/environment-profile versions), appends `requested`; returns the approval binding a human must grant (`runner-request:<environment>:<requestHash>`) | authorize, execute |
| 2 | **approval grant** | Human (out of band) | F050 `grantApproval` with subject = the returned binding | records the approval; authority is the approval, not any later caller | — |
| 3 | **authorize** | Human or governed caller on their behalf | `amber runner authorize` → `authorizeRunnerRequest` (`:1369`) | consumes the single-use subject-bound approval; drift re-derivation (`requestDriftProblem` `:1330`); rehearsal separation; credential expiry; session-lease proof verified when `sessionBinding` is present (§5.2); appends `authorized` | execute; the consume call itself is not an authority — a Runtime invoking it cannot forge an approval it does not have |
| 4 | **prepare** | Runtime | `amber runner prepare` → `prepareRunnerExecution` (`:1829`) | requires status `authorized` and the matching runner pin; `resolveRunner` fails closed on drift; session-lease proof re-verified (§5.2); appends `prepared`; **one authorization settles at most one execution** | submit, authorize, or execute — prepare on an unrecorded request is `AMBER_E_RUNNER_EXECUTION_NOT_FOUND`, on an unauthorized one `AMBER_E_RUNNER_EXECUTION_STATE` |
| 5 | **external execution** | Runtime, outside Amber | — | nothing | Amber never starts, supervises, or intercepts the Runtime |
| 6 | **settle** | Runtime | `amber runner settle` → `settleRunnerExecution` (`:1933`) | derives the outcome from the receipt (timeout → signal → exit → scope claim check, `deriveOutcome` `:1887`); verifies the receipt's runner pin equals the prepared pin; session-lease proof re-verified (§5.2); settlement immutable | trust the receipt as observation — receipt content stays E2 (§2.1) |
| 6b | **abort** | Runtime or human | `amber runner abort` → `abortRunnerExecution` (`:2005`) | terminal `attempted` state for a lost runner / missing receipt — bookkeeping, never erasure | rewrite a settlement |

### 5.1 Request identity, duplicate, and retry

- **Identity** is `requestHash` — the canonical hash of the full shaped request including risk and environment-profile versions (`runner-registry.js:1297-1303`). Two requests differing in any hashed field are different requests.
- **Duplicate submit** (identical content) returns the existing pending request (`REQUEST_EXISTS` — "an identical declaration reuses the pending request", `:1318-1322`); a retry never forks.
- **Duplicate authorize** refuses (`REQUEST_EXISTS`, single-use); **duplicate prepare** refuses (`EXECUTION_EXISTS`); **duplicate settle** refuses (`EXECUTION_STATE`, immutable).
- A retry after drift is a **new request** with a new hash and needs a fresh human approval — stale authority never revives (existing discipline, restated because the ticket's diagram implied `authorized(requestHash)` returns directly).

### 5.2 Drift, lease, and fence

- **Drift** (existing, `requestDriftProblem` + `resolveRunner`): capability unresolvable, risk-policy version change, environment-profile version change, hash re-derivation mismatch, runner version/integrity mismatch — every one refuses fail-closed at authorize or prepare.
- **Session lease binding (new, proposed field — does not exist today):** the request gains an optional `sessionBinding: { sessionId, attemptId?, ownerId, tokenHash, fence }` — the identity needed to prove the current lease holder (`session-manifest.schema.json` lease block: `ownerId`/`tokenHash`/`fence`; the raw token is never persisted, only its digest). When present, **`authorize`, `prepare`, and `settle` each verify** that the session lease is unexpired and that `ownerId`, `tokenHash`, and `fence` still identify the current lease holder. A displaced or expired lease fails the stage with a lease-drift refusal (under the `REQUEST_DRIFT`/`EXECUTION_STATE` families): the displaced owner cannot pass a later stage, and in-flight execution is resolved only under the **current** lease owner's proof (abort or settle with the current `ownerId`/`tokenHash`/`fence`) — the displaced owner cannot settle. When absent (direct non-session use), the F050 approval plus the runner pin are the authority, unchanged.
- **Direct (non-session) F052 policy/scope binding (resolves run contract §8.2's exact unresolved fact; owner 0059):** the request record gains three Amber-computed frozen fields, set at submit, re-verified at authorize and prepare:
  - `policyHash` — sha256 of the canonical parsed governance rules (`.amber/governance/rules.json`) at submit; a later rules change is drift;
  - `capabilityHash` — sha256 of the canonical registered capability record (the registered field set, run contract §3);
  - `scopeHash` — sha256 of the canonical authority-relevant projection `{target, scope, effects, contextAuthority}` of the request itself;
  - plus optional caller-supplied `contextAuthority: { loadoutHash, constraints }` in exactly the §4 shape — same field names, same semantics, validated (references resolve; `expiresAt` honored) rather than restricted away. Session-mediated executions keep the session attempt record as their frozen home (run contract §8.2 mapping) and carry none of these — no duplicate freezing.

### 5.3 Recovery: every failure has a next owner

| Failure | Code / state | Next owner |
| --- | --- | --- |
| prepare on an unrecorded request | `AMBER_E_RUNNER_EXECUTION_NOT_FOUND` | Runtime: submit first |
| prepare on an unauthorized request | `AMBER_E_RUNNER_EXECUTION_STATE` (approval unconsumed) | Human: grant + authorize |
| receipt never arrives | prepared, non-terminal | Runtime or human: `abort` → terminal `attempted` |
| receipt's runner pin drifted | `resolveRunner` fail-closed | register/new version → new request |
| receipt self-reports out-of-scope | outcome `failed` + `AMBER_E_RUNNER_EXECUTION_SCOPE` (D1, §2.3) | recorded; no fake success |
| lease displaced/expired mid-flight | lease-drift refusal at the next stage (prepare/settle) | current lease owner: abort or settle under their own proof; the displaced owner cannot settle |
| duplicate settle/abort | `EXECUTION_STATE` immutable | read the existing settlement |

### 5.4 MCP projection and assurance ceilings

- MCP exposes the Runtime loop through **thin projections of the real stages**, not compressed verbs: Action Type `amber.runner.request` → `amber runner request` (stage 1) and `amber.runner.settle` → `amber runner settle` (stage 6). Both are mutating: the MCP runtime returns `approvalRequired: true` with the exact `command`/`commandArgv`/`commandShell` and never executes (`mcp-action-runtime.js:191-198`; only proven read-only variants direct-execute, `:161-179`). `authorize`/`prepare` stay CLI surface (already exist); MCP may project them later under the same approval-required discipline — no new authority is created either way.
- Corrected assurance ceilings (the ticket's "scope 校验通过 = observed" row was wrong):

| Returned part | Class (§2.1) | Ceiling |
| --- | --- | --- |
| Amber-recorded lifecycle facts (submit/authorize/prepare/settle events, requestHash match, timestamps, drift refusals) | E1 | observed |
| Receipt content (outputs, exit status, self-reported scope) | E2 | claimed — passing the scope claim check (D1) does not raise it |
| Worktree file state after the run | E3 | observed, file state only |
| Runtime behavior outside the receipt | E4/unobserved | unavailable |
| Deterministic replay (read/diagnose effects, 0055 R3) | — | replayable |
| Independent verification by a verifier ≠ producer principal | — | verified (0054) |

The incentive gradient stands: host-direct = claimed; via 0059 = authorization chain observed, output claimed; via governed-runner = process outcome observed too.

## 6. Research Adapter: minimal capability set with honest semantics (0058)

Scope stands: **search / extract / cite** (read / diagnose / write-target effects), Research before Ops, `ResearchProcess` as a LocalProcess-family ExecutionBoundary, BrowserSession out. Four claims are corrected:

### 6.1 Time semantics: retrieval ≠ record

- `retrievedAt` (per source): when the search/extract execution actually fetched the content — carried in the receipt `inputs[]` entries `{sourceRef, rawHash, retrievedAt}`.
- `recordedAt` (receipt field, existing): when Amber recorded the receipt.
- Deterministic freshness rule: a citation whose `recordedAt − retrievedAt` exceeds the source's declared freshness bound is flagged on the citation record (never silently accepted); the two timestamps are never merged into one "timestamp".

### 6.2 Evidence, output paths, and egress

- Byte evidence: per source `rawHash` = sha256 of the exact fetched bytes (mutable-source `normHash` discipline does not apply — fetched external content is treated as immutable-at-retrieval).
- Citation evidence: receipt `outputs[]` carries the mapping `{citationId → {sourceRef, locator (url/span), excerptHash}}`; `citation_exists` resolves against the citation store.
- Output path (fixed, target-local): **`.amber/research/citations.jsonl`** — append-only, one citation per line, `{citationId, sourceRef, rawHash, retrievedAt, locator, claimRef, at, prevHash, hash}`; implemented through the ledger-family factory (0045: no new ledger implementations outside `ledger-family`). No other write path exists for `cite`.
- Query egress: `querySources[]` per R-EG-2 — the declaration discipline replaces the ticket's hash-comparison claim, which was a false guarantee inherited from 0053.

### 6.3 Verification actors (corrected)

- `citation_exists` — deterministic (parse the store); any principal.
- `source_accessible` — deterministic HEAD/existence check; network unavailable records `unavailable`, never fake success.
- `claim_supported` — semantic judgment requiring an **independent verifier principal** (verifier ≠ producer). **Human review is sufficient, not necessary**: an independent service Principal may verify (0054's matrix and `verifyEvidence` admit service verifiers); the ticket's "human review 是唯一 verified 通道" overstated the rule. The producer never verifies its own claim.

### 6.4 Second-consumer honesty

The Research adapter is **planned (this spec + plan), not implemented**. Closing ticket 0058 authorized no directory moves: 0049's physical relocation precondition is a *running* second consumer, which does not exist until the §6 slices land. No `src/` move may cite 0058 as satisfied.

### 6.5 End-to-end technical acceptance flow

One Research run through the full chain (the acceptance standard, one sentence preserved and made executable):

1. capability registration: `search`/`extract`/`cite` registered in the F052 capability registry with constraints (`maxQueryClassification`, `requiresQueryProvenance` for search) and `evidenceContract` (human-approved registration);
2. `amber runner request` (search) with `querySources[]` → R-EG-2 validations pass or refuse deterministically;
3. human grants the F050 approval for the returned binding; `amber runner authorize`;
4. `amber runner prepare`; ResearchProcess executes the retrieval outside Amber; `amber runner settle` with per-source `{sourceRef, rawHash, retrievedAt}`;
5. `cite` run writes `.amber/research/citations.jsonl`; receipt `outputs[]` carries the mapping;
6. `citation_exists` + `source_accessible` verify deterministically; `claim_supported` is judged by an independent verifier principal (human or service ≠ producer);
7. the full chain is attributable by `(runId/attemptId, requestHash, approval consumption, receipt)` joins, and the core-domain dependency guard (`tests/unit/core-domain-separation.test.js`, 0049's spec) stays green.

## 7. Owner / caller mapping (summary)

| Mechanism | Field owner (source of truth) | Caller supplies | Amber validates |
| --- | --- | --- | --- |
| Page classification/purpose/ttl | the Context Page | nothing (ingest-time metadata) | enum/shape, request binding, downgrade Decision |
| Loadout redactions/exclusions | the Loadout build | nothing | determinism, reasons closed |
| F056 `payloadSources[]` | the proposal | the declaration | resolution, ceiling, provenance-required (R-EG-1) |
| Research `querySources[]` | the capability request | the declaration | same (R-EG-2) |
| effect `maxPayloadClassification` / capability `maxQueryClassification` | the registration (human-approved) | nothing at call time | ceiling at the seam; no per-call override |
| `scopeInputs.context_scope.constraints` | the run contract attempt record (frozen) | nothing (derived from Loadout) | R-CA-1..5 |
| F052 `policyHash`/`capabilityHash`/`scopeHash` | the request record (Amber-computed) | nothing | re-derivation drift refusal |
| `sessionBinding` / `contextAuthority` on F052 requests | the request record | the binding values | full lease proof (`ownerId`/`tokenHash`/`fence`, unexpired) at authorize/prepare/settle; §4 validation |

## 8. Invariant test cases (deterministic, bounded)

Each case is a required product test at the real seam (not a model check); the plan maps them to slices:

1. **hash ≠ containment:** a payload whose digest differs from a restricted source's digest but contains an excerpt of it — with the source declared, R-EG-1 refuses on the ceiling; with the source undeclared, the honest outcome is "outside declared flow" (no pass may be recorded as safe). No test may assert hash-mismatch proves no leak. The `payloadHash` binding is a declared-hash binding only — no test may assert actual payload-byte integrity, actual-payload identity, or leak prevention from it (§3.5).
2. **context-authority drift:** content-only Loadout refresh ⇒ grant stays valid and the refresh is observable; `maxClassification` change ⇒ `scopeHash` drift ⇒ consumption refuses.
3. **expired context:** `constraints.expiresAt` in the past at consumption ⇒ refuse `context-expired`; expired page at load-build ⇒ excluded with reason `expired`.
4. **wrong-scope source:** a `payloadSources`/`querySources` reference that does not resolve in the current snapshot ⇒ refuse, never "treat as unconstrained".
5. **unauthorized prepare:** prepare on a `requested` request ⇒ `AMBER_E_RUNNER_EXECUTION_STATE`, approval unconsumed, nothing executed.
6. **duplicate / missing settlement:** second settle refuses immutably; missing receipt ⇒ abort ⇒ terminal `attempted`, no re-settle, no erasure.
7. **request owner routing:** a grant/approval bound to request identity X cannot authorize request Y (subject binding `runner-request:<env>:<requestHash>`; `boundAttemptId` for session grants) — Y's authorize refuses.
8. **claim-check vs observation:** a receipt within bounds settles with its content still `claimed`; an E3 dirty-path observation outside prefixes records a FAIL file-state fact with no actor attribution and no network-absence claim.
9. **lease displacement:** a mid-flight lease displacement (owner change, fence bump, or expiry) fails the next stage (`prepare`/`settle`) under the displaced owner's proof; the current lease owner resolves the execution (abort or settle under their own `ownerId`/`tokenHash`/`fence`); the displaced owner cannot settle. Direct non-session requests (no `sessionBinding`) are unaffected — the F050 approval plus the runner pin remain the authority.

## 9. Out of scope / owning tickets

- PDP v2 rule schema and the `policy.evaluated` event shape — 0051 (this contract only requires the `maxClassification` constraint face and cites it).
- Capability registration field extensions beyond the egress constraints named here — 0052.
- Outcome/verification/assurance event semantics — 0054; replay bundle contents — 0055; timeline event enabling (`context_granted`/`context_denied`, run events) — 0056.
- The run contract's remaining decisions (identity, freeze, admission sequence, replay) — `trusted-control-run-contract.md`; this contract touches only the context container (§4).
- No sandbox, no runtime interception, no automatic agent dispatch, no DLP/scanner/model platform, no new default-surface verbs (F063's seven-verb default help is unchanged; any new subcommands register outside the default projection).
- No V3.1 S1–S11 wording claims: the V3.1 FINAL source file is missing (`SOURCE-V31`, goal packet `requirements.json` evidence gap); this contract makes no whole-v3 compliance claim and invents no S-numbers.

## 10. How this serves the product goals

- **No-chat trusted continuation (N):** receivers can distinguish recorded authorization chains (E1) from executor claims (E2) from observed file state (E3) — the audit §9 exit criterion ("which authorization covered which execution") holds per evidence class instead of one blended value.
- **Evidence completeness (S2):** the four corrected seams (F056 propose/execute, research request, F052 submit, run-contract capture) each fail closed with explicit reasons; gaps are recorded, never defaulted.
- **Human overhead (S3):** drift and ceiling violations are machine-checkable refusals before effects; the cost is a bounded declaration per mediated egress, not a review of payloads.
- These are contribution paths, not measured outcomes; no real-user metrics exist and none are claimed.

## 11. Source index (verified at HEAD `0a9cbeab`)

| Fact | Source |
| --- | --- |
| F052 lifecycle functions and codes | `scripts/lib/core/runner-registry.js` — `submitRunnerRequest:1236`, `requestDriftProblem:1330`, `authorizeRunnerRequest:1369`, `prepareRunnerExecution:1829`, `deriveOutcome:1887` (scope claim check `:1909-1923`), `settleRunnerExecution:1933`, `abortRunnerExecution:2005`, `markRunnerExecutionRolledBack:2045`; `REQUEST_INPUT_FIELDS:804`, `EXECUTION_SCOPE_CODE:1520`, `ENVIRONMENT_PROFILES:743` |
| F056 real seams | `scripts/lib/core/external-registry.js` — `deriveRequestContent:713`, `proposeExternalEffect:770` (payload never enters the ledger), `executeExternalEffect:1315`, `settleExternalExecution:1379`; CLI `--payload-hash` only: `scripts/lib/external-commands.js:196` |
| MCP approval-required seam | `scripts/lib/mcp-action-runtime.js` — read-only direct exec `:161-179`, approvalRequired return `:191-198`; capability parity `scripts/lib/mcp-action-contracts.js` |
| Dirty-path classification (E3, caller-supplied list) | `scripts/lib/core/dirty-paths.js:65` |
| F058 quote boundary (schema + eval) | `schemas/context-request.schema.json:108-131`; `scripts/lib/core/instruction-surface-evals.js:376,424-441,582` |
| Loadout schema (closed fields, exclusion reasons, tiers) | `schemas/context-loadout.schema.json` (`excluded` reasons `:139`, pages shape `:87-111`) |
| Session lease fields | `schemas/session-manifest.schema.json` (`lease` block: ownerId/tokenHash/acquiredAt/expiresAt/ttlMs/fence) |
| Runner CLI subcommands | `scripts/lib/runner-commands.js` — action list `:157-164` (register / capability / **request** / authorize / requests / prepare / settle / abort / …); the submit stage is the `request` action (`:245` → `submitRunnerRequest`) |
| Approval subject binding | `runner-registry.js:1315` `approvalBindingOf` → `runner-request:<environment>:<requestHash>`; F050 `grantApproval` `scripts/lib/core/approval-registry.js:655` |
| Ticket rulings being corrected | `issues/0047` (coverage matrix, amendment draft), `issues/0053` (egress hash comparison `:80-83`, 落点 list), `issues/0058` (query egress `:91-95`, "唯一 verified 通道" `:69`), `issues/0059` (capability.request→prepare mapping `:64`) |
| Audit findings | `.scratch/product-scope-audit/0044-0060-2026-09-16-QjqMvx/REPORT.md` P1-04 (§5 `:135-144`), P1-08 (§5 `:173-180`) |
| Run contract container contradiction | `docs/specs/trusted-control-run-contract.md` §3 six-field closed set vs §6 R-AU-1 `scopeInputs.context_constraints` |
