# F087 — Provenance-only refresh exemption from the γ admission limit

Status: proposed
Date: 2026-11-07
Amends: `docs/specs/2026-08-21-governed-memory-layer.md` §5.3, §6.3, §6.5, §8.2, §9, §11-5, §12
Related: ADR-0018 (D3/D7 amendments), `docs/plans/F087-Provenance-only-memory-refresh-exemption.md`

## 1. Problem

γ is a rolling 168-hour admission limit of five entries (§6.5). Because an entry's identity is
content-addressed over `{claim, knowledgeKind, targetSurface, sources, supersedeTarget?}` (§10.2),
refreshing the provenance of an existing claim — same claim text, same kind, same surface, new
source hashes — produces a new `entryId`. That refresh must enter through `ingest`, and ingest
counted it exactly like new knowledge.

Consequences measured on an isolated target (2026-11-07 audit):

- a claim-preserving refresh consumes one of the five slots;
- with the window exhausted, the refresh is refused `AMBER_E_MEMORY_RATE_LIMITED` while doctor
  §11-2 keeps reporting the source drift, and its own remedy text names supersede/abandon as the
  durable exits;
- six drifted entries therefore need two windows (`needs-re-review` for days), and an entry bound
  to an actively developed source file pays the quota repeatedly.

The limit itself is retained: its object (admission rate / human approval ceremony) is real, it is
measured directly from the ledger, and it has a single atomic enforcement point. What was wrong is
the counting domain, not the number.

## 2. Normative definition: provenance-only refresh

An entry `E` is a **provenance-only refresh** of its predecessor `T` if and only if **all** hold:

1. `E.supersedeTarget` is a non-empty string naming `T`;
2. `T` exists in the entry registry (`.amber/memory/registry/`);
3. `T.status ∈ {active, needs-re-review}` (the same predecessor states `approveSupersedePair`
   accepts, §5.4);
4. `E.claim === T.claim`, `E.knowledgeKind === T.knowledgeKind`, and
   `E.targetSurface === T.targetSurface` — **exact, byte-for-byte string equality** (no trimming,
   no case folding, no normalization);
5. **the source binding actually changed**: the **set of unique** source-binding signatures over
   `(kind, ref, rawHash, normHash, excerptHash)` differs from `T`'s. Order is irrelevant and
   repeating an identical source is not a change; only the unique signature set matters. This is
   the provenance-set rule, deliberately distinct from the entry-accounting multiset rule in §3.3
   (admission accounting still permits same-side duplicates);
6. `E` is a distinct identity from `T` (`E.entryId !== T.entryId`), checked explicitly.

> **Identity is not evidence.** `entryId` hashes `supersedeTarget` as well as the core fields
> (§10.2), so adding the pointer changes the id even when the sources are untouched. A predicate
> that inferred "refresh" from `E.entryId !== T.entryId` would let an unchanged resubmission
> consume zero quota. Condition 5 is therefore explicit and independent.

Everything else is **not** a refresh and stays charged: a changed claim, a changed knowledge kind,
a changed target surface, an unchanged source binding, a missing predecessor, a predecessor in
any other status (draft, proposal, superseded, abandoned), a self-referential pointer, and any
entry without `supersedeTarget`.

**Authority.** The predicate is derived only from registry-backed content plus the entry's own
core text. No payload flag, provenance field, caller identity or `needs-re-review` label can
assert exemption. In particular, an arbitrary `supersedeTarget` does not help: the predecessor must
exist, be in an eligible state, and match the three core fields exactly.

## 3. Admission and accounting

### 3.1 Single accounting definition

`gammaWindow(targetRoot)` (`.amber/memory/registry` + `.amber/context/events.jsonl`) is the only
place γ is computed. For each `memory-ingest` event with `outcome === "admitted"` in
`[T−168h, T]`:

- only an event with **neither** partition property is **legacy**: charged += `entryIds.length` —
  the prior accounting, unchanged, so historical windows keep their meaning without rewriting a
  single event;
- an event carrying **either** property is a partitioned record: both properties must be present,
  both must be entry-id arrays, and the pair must satisfy §3.3. Only then does it contribute
  charged/exempt lengths. A malformed or incomplete partition is excluded from both counts,
  reported in `problems`, and refuses admission — it is **never** treated as legacy.

`quotaRemaining = max(0, 5 − charged)`. Exempt admissions never reduce it.

### 3.2 Admission (ingest stage 4)

1. Classify every candidate — current batch and queued candidates from other open requests —
   against the registry with §2.
2. Only **charged** candidates enter the quota pool, ranked K1/K2/K3 exactly as before (§6.5).
   Exempt candidates neither consume a slot nor displace a charged candidate.
3. The batch stays all-or-nothing: if the charged pool exceeds the remaining quota, the batch is
   admitted only when **every charged current candidate** falls inside the top-`quota` slice;
   otherwise the whole submission is refused `AMBER_E_MEMORY_RATE_LIMITED` with the ranked pool
   recorded. Exempt candidates never cause a refusal.
4. Exempt and charged current candidates are both written as `proposal`; the human `approve`
   gate, `book`, schema, source-binding and signal gates are unchanged.

### 3.3 Ledger payload (additive)

`memory-ingest` (admitted) keeps `entryIds[]` complete (every admitted identity) and adds:

| field | meaning |
| --- | --- |
| `gammaChargedEntryIds[]` | the subset that consumed quota, in `entryIds` order |
| `gammaExemptEntryIds[]` | the provenance-only refresh subset, in `entryIds` order |

`ranking[]` rows gain `exempt: boolean` so a refusal or admission trace shows the classification
that produced it. `gammaChargedEntryIds.length + gammaExemptEntryIds.length === entryIds.length`
for every event this version writes; legacy events have neither field and keep legacy accounting.
Rejected and no-change events carry no partition (they admit nothing).

**Partition contract (single validator: `gammaPartitionProblem`).** The charged and exempt
identities are **disjoint sets** — one identity is either charged or exempt, never both. No
global de-duplication rule is added: duplicate inputs keep their existing meaning and may repeat
**within** a side, but the two sides merged must reproduce `entryIds` as an **exact multiset**
(per-id occurrence counts). Presence is decided by property ownership: only an event with
**neither** property is legacy; an event carrying **one** property is incomplete. Any of the
following is a **corrupt ledger**, never silently re-read as legacy or empty: a field of the
wrong type (string, `null`, mixed array), a missing counterpart, a non-array or non-string
`entryIds`, an empty-string identity, or an identity on both sides.

### 3.4 Status projection ([`amber memory status`](2026-08-21-governed-memory-layer.md))

`gamma` gains `windowExempt` (count of exempt admissions in the window) and `problems` (corrupt
partition records in the window, empty when healthy), and keeps `windowAdmitted` meaning
**charged** admissions, so `quotaRemaining === max(0, 5 − windowAdmitted)`. Corrupt records are
excluded from both counts. The section shape stays three-part (entries / gamma / surface); these
are additive fields, not a new section. A non-empty `problems` makes `status` report the same
errors doctor does and exit non-zero — the projection stays read-only, but it never reports a
corrupt ledger as healthy. Admission refuses to compute a quota from the same window
(`AMBER_E_MEMORY_STATE_INVALID`).

### 3.5 Doctor rule 5

Rule 5 judges the **charged** count (`windowAdmitted > 5` → error) and additionally refuses a
partition that violates §3.3 (malformed or incomplete fields, non-array identities, or an
identity on both sides) with a fail-closed ledger error. Legacy events are exempt from the
partition check and keep prior accounting.

## 4. Non-goals

- No change to `GAMMA_QUOTA` (5) or the 168-hour window; no configuration knob, no second quota.
- No change to `book --ratify` (γ-free by design) or `abandon`.
- No identity change: `sources` stay inside the `entryId` hash, so a refresh is still a new entry
  and still needs a human `approve` plus a supersession.
- No automatic repair: a refresh is never inferred or written by Amber; the operator submits it.

## 5. Compatibility

- **Data.** Registry entries and request artifacts are unchanged. Old ledger events are never
  rewritten. A ledger mixing legacy and partitioned events counts correctly.
- **Public JSON.** `status.gamma.windowAdmitted` narrows to "charged"; `windowExempt` is additive.
  Consumers that only read `quotaRemaining`/`windowAdmitted` keep working; the narrowing is a
  semantic clarification, not a breaking shape change.
- **MCP.** `amber.memory.status` keeps its permissions; its goal text names the charged/exempt
  distinction.

## 6. Verification obligations

Focused tests must cover: zero-quota refresh admitted; zero-quota changed-claim supersession
refused; **a pointer-only resubmission, a duplicate-only source list and a reordered-only source
list all charged, while a real hash change is admitted**; mixed batch charging only its non-exempt
subset; queued refreshes neither displacing charged candidates nor blocked by exhausted quota;
repeat admission after the predecessor is already superseded (charged, not exempt); invalid/missing
predecessor (charged); legacy events keeping prior accounting; doctor and status agreeing with the
ledger; the partition consistency check (malformed field types, one-field-only records, non-string
identities, cross-side duplicates rejected; same-side duplicates legal with an exact multiset);
and the **real CLI writer** against the Web reader under a deterministic parent/child handshake —
the child reports its half-write and blocks until the parent has performed one real reader
observation and releases it (no fixed sleep window).
