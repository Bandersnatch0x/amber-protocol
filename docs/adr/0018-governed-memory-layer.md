# ADR-0018: Governed Memory Layer — Registry-Backed Memory with Governed Promotion

**Status:** Accepted
**Date:** 2026-08-21
**Builds on:** [ADR-0009](0009-contract-driven-context-distillation.md) (contract-driven distillation — the governed
knowledge pipeline whose parts and topology this layer reuses),
[ADR-0003](0003-governance-gated-execution.md) (the narrow, human-gated mutation seam that MCP approval-required
memory actions inherit)
**Context:** Wayfinder map
[#169 "Governed Memory Layer"](https://github.com/Bandersnatch0x/amber-protocol/issues/169), closed through six
rounds of roundtable debate with independent adjudication: the industry survey
([#171](https://github.com/Bandersnatch0x/amber-protocol/issues/171)), the object model
([#170](https://github.com/Bandersnatch0x/amber-protocol/issues/170)), the write-back gate
([#172](https://github.com/Bandersnatch0x/amber-protocol/issues/172)), the promotion rules
([#173](https://github.com/Bandersnatch0x/amber-protocol/issues/173)), the dreaming maintenance loop
([#174](https://github.com/Bandersnatch0x/amber-protocol/issues/174)), and the verb surface
([#175](https://github.com/Bandersnatch0x/amber-protocol/issues/175)). All six resolutions are decision-complete.

---

## Context

Amber's memory primitives were scattered across seven homes with no shared lifecycle: session ledgers and
transcripts (append-only, die with `amber clean`), handoff bundles (rebuilt on demand), context Loadouts,
`docs/wiki/`, `MEMORY.md`, `notes.md`, and F023 learning write-backs. Evidence sank: knowledge that should
survive a session had no governed path into anything durable, and `MEMORY.md` — the one human-curated
long-term surface — had no machine-checkable contract with the rest of the system.

Three verb lifecycles were missing entirely: an auto-triggered write-back gate (Amber detects and gates,
the host agent generates, a human approves), dreaming-style background maintenance, and tiered promotion
rules from session-level memory to long-term memory.

Map #169 resolved this through six adjudicated rounds, each a full roundtable (fact inventory → pro/con
attack → independent adjudicator). The survey (#171) found industry consensus on binding write-back to
lifecycle events, quantitative promotion gates with human approval, and supersession over deletion. Five
design rounds then fixed the object model, the gate, the promotion rules, the dreaming loop, and the verb
surface. This ADR records the resulting architecture; the full mechanical detail — every closed set,
schema, payload, error code, and the single implementation batch — lives in the spec:
[../specs/2026-08-21-governed-memory-layer.md](../specs/2026-08-21-governed-memory-layer.md).

## Decision

### D1 — Four memory layers; a layer is a triple, not a name

Memory is modelled as four layers — L1 session, L2 portable, L3 human-curated, L4 distilled — each defined
by the triple *writer stance × volatility class × mutation policy* rather than by storage location. This
absorbs the rejected single-axis proposals (write-rights, volatility) as layer attributes instead of
competing ontologies. The spec must fill all twelve cells of the create/invalidate/retire × L1–L4 matrix;
any empty cell makes the spec incomplete (#170-Q1). A dreaming proposal is not an eighth primitive: it is
the `proposal` state of an L4 entry. → spec §3

### D2 — Entry identity lives only in the entry registry

The atomic unit of memory is a structured entry with metadata (claim, knowledge kind, target surface,
provenance), physically persisted as files. But its primary key lives exclusively in the Amber-owned entry
registry (`.amber/memory/registry/`, content-hash identity, same family as the context-page pipeline);
human-curated markdown never carries an id. Binding to L3 text is downgraded to file-level surface
registration: `book` records the surface's normHash (read-only registration — Amber never writes the
file), and later drift mechanically moves entries to `needs-re-review`. The registry is the authority for
entry state and provenance; `MEMORY.md` is the authority for its own content text; on inconsistency the
entry goes to re-review, and neither side silently wins. The registry is a rebuildable catalog; recovery
after `clean` follows the re-admission contract from surviving L3 surfaces plus git history. → spec §3–§4

### D3 — Supersession is the only retirement verb, capped by deterministic budget gates

Nothing is ever physically deleted; retirement is supersession only (`active → superseded`), approved by a
human, with the text removal in `MEMORY.md` performed by hand while Amber only books it. Unbounded growth
is capped by three deterministic gates (#170-Q4, #173): **α** — a physical budget on `MEMORY.md`
(≤ 50 entries ∧ ≤ 8 KB; a priori values, with a mandatory 50%-utilisation doctor review); **β** —
one-in-one-out: once the budget is exhausted, admission requires a `supersedeTarget` pointer to an
existing registry entry, approved atomically in the same call; **γ** — an admission rate limit of 5
entries per 168-hour rolling window over the shared event ledger, enforced at ingest with all-or-nothing
semantics and a deterministic K1/K2/K3 ordering (staleness, supersession pressure, content-hash
tiebreak — reproducible, never FIFO). → spec §6

### D4 — One event ledger: the `memory-*` closed set

All memory-domain events (request creation, ingest acceptance and rejection, approval and rejection,
booking, abandonment) flow into the single existing ledger `.amber/context/events.jsonl` via the existing
`appendEvent`, under a closed set of five event kinds (`memory-request-created`, `memory-ingest`,
`memory-approval`, `memory-book`, `memory-abandon`) — no additions, no private per-trigger event files, no
session-timeline or loop-ledger writes, no sixth ledger. The ledger is the audit trail; the registry is
the state authority; doctor verifies their consistency. → spec §9

### D5 — Promotion is `ingest → approve → book`, with dual-track ratification

The governed pipeline reuses the ADR-0009 contract topology (request → agent generates → mechanical
ingest) and inserts exactly one human gate: entry-level `approve` (exactly one entryId per call; reject
returns to draft with a mandatory reason). A human then writes the entry text into `MEMORY.md` and `book`
registers the surface hash, transitioning the entry to `active`. The human capability to edit `MEMORY.md`
directly is inalienable (L3 layer definition); such out-of-band amendments are legal but are not
promotions — they must be ratified via `book` with `origin ∈ {governed-promotion,
human-direct-ratification}`, are flagged by doctor when unratified, and only registry entries can be
superseded. Write-back is triggered at two deterministic points (session completion with handoff evidence;
feature accept with category hit); conversion of the three review-only proposal streams goes through the
human escape hatch under the same signal floor. → spec §5–§6

### D6 — Dreaming is a pure L1 loop contract, not a subsystem

Background maintenance ships as one workflow pack, `workflow-packs/memory-maintenance.pack.json`, carrying
a single loop contract (`memory-maintenance-dreaming`): scheduled weekly but `enabled: false`, report-only
(no `governed` field — mechanical fields must not reference artifacts that do not exist yet), with the
governance triplet copied verbatim from `safe-amber-bootstrap`. Its products enter the already-adjudicated
pipeline as memory requests (state `proposal`), attributed by `provenance.channel ∈` an 8-value closed
set, auditable per batch via `batchId`, and each request must cite one of the six closed-set signals.
γ's "period" is defined mechanically as the 168-hour rolling window over the event ledger — zero state
files; the loop's `state.json` spine is declared but write-forbidden. The maintenance verb face
(`collect`/`inspect`) is explicitly reserved for a future same-level adjudication. → spec §7

### D7 — Five CLI verbs; exactly three MCP tools; whitelist split instead of new mechanisms

The verb surface is `amber memory request | ingest | approve | book | abandon`, plus the read-only
`amber memory status`. MCP exposes exactly three tools — `amber.memory.approve` and `amber.memory.abandon`
(mutating, approval-required) and `amber.memory.status` (read-only, free execution) — because a verb
enters the MCP surface if and only if its legal invocation does not depend on local pipeline presence or
local ceremony. Registration is single-track (session-style): `memory` joins the typed command family
with exactly three capabilities and three action-type JSONs; the three CLI-only verbs ride the existing
`KNOWN_UNTYPED_SUBCOMMANDS` whitelist with inline identity gates as the price. Approval ceremony is
bounded (γ = 5 approvals + 1 book per window) but non-zero. Evidence kinds reuse the existing
`approval-record` / `ingest-record` vocabulary; side effects reuse `ledger-append`. → spec §8, §13

## Considered and rejected

- **Markdown-anchored entry primary keys** (#170). ADR-0009 already rejected regex claim-boundaries and
  line-range hashing; the never-overwrite rule makes id-in-file impossible; shadow ledgers drift.
  Entries survive as objects — in the registry.
- **TTL / garbage collection as a retirement verb** (#170-Q4). Destructive automatic execution conflicts
  with the red lines, and "time ≠ value"; session-level clearing already lives in `amber clean`.
- **Session-gate approval** (#172-Q3). Write-back proposals arise after the session reaches `COMPLETED`,
  a terminal state with no host gate to hang one on.
- **Page-level request payloads and free-text drafts** (#172-Q4). Page objects would enter the registry
  with undefined unpack transitions; free text fatally conflicts with the zero-LLM rule.
- **Batch-level approval verbs** (#172-A1). Human review granularity must never degrade from entry to
  batch; batch rejection is N entry-level rejects.
- **A `promote` aggregate verb** (#175-Q1). It erases the observable reject middle state, cannot express
  human-direct ratification, and F018 approval cannot partially authorize a composite.
- **Dual-track (context-style) registration** (#175-Q4). The `context/load` dangling registration shows
  the audit cost of a third registration point; memory is session-scale, not context-scale.
- **Legislating the maintenance verb face now** (#175-Q5, #174-M6). Naming `collect` without its
  persistence path would be half-legislation; the upgrade is a contract change requiring its own
  same-level adjudication.
- **`state.json` as loop state** (#174-Q5). Phantom legislation: no code reads or writes it; the window
  and ordering semantics already live in the event ledger.

## Consequences

**Positive:** the three missing verb lifecycles land on one object model and one ledger; unbounded growth
is mathematically capped with zero destructive automation; every promotion carries provenance, audit
events, and lineage; the seams add no new mechanisms (whitelist split, reused hash/event/validation parts,
an extended error-code family); human ceremony is bounded by γ.

**Negative:** human approval ceremony has a hard upper bound but is non-zero — sustained weekly batches
cost real attention; registry rebuildability depends on the re-admission contract and on `MEMORY.md`
surviving `clean` (the git re-include is advisory, not enforced); the approval surface grows by one
command family (a fifth dialect, mitigated by the single ledger); the spec-level mechanical definitions
(delimiters, payload field names, status projection, admission arithmetic) carry implementation-time risk
until batch A lands.

**Neutral:** `MEMORY.md` remains human territory — Amber only registers hashes; the L2 portable layer
stays a layer pending the conditional-downgrade clause; MCP surface growth beyond three tools and the
maintenance verb face are explicitly deferred to future same-level adjudication.

## Related

- Spec: [../specs/2026-08-21-governed-memory-layer.md](../specs/2026-08-21-governed-memory-layer.md)
- Map [#169](https://github.com/Bandersnatch0x/amber-protocol/issues/169); resolutions:
  [#170](https://github.com/Bandersnatch0x/amber-protocol/issues/170),
  [#171](https://github.com/Bandersnatch0x/amber-protocol/issues/171),
  [#172](https://github.com/Bandersnatch0x/amber-protocol/issues/172),
  [#173](https://github.com/Bandersnatch0x/amber-protocol/issues/173),
  [#174](https://github.com/Bandersnatch0x/amber-protocol/issues/174),
  [#175](https://github.com/Bandersnatch0x/amber-protocol/issues/175)
- `templates/MEMORY.md` — the creed surface; batch A adds the entry section and ratification reminder
- `schemas/memory-request.schema.json`, `schemas/memory-entry.schema.json` (created by batch A);
  family template `schemas/context-request.schema.json`
- `workflow-packs/memory-maintenance.pack.json` (created by batch A); governance-triplet source
  `workflow-packs/safe-amber-bootstrap.pack.json`
- `scripts/lib/mcp-action-contracts.js`, `scripts/lib/command-registry.js`, `scripts/lib/cli-typed-seam.js`
- `docs/wiki/amber-ontology-mcp.md` — the CLI/MCP mapping table extended by three rows
