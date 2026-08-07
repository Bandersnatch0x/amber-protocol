# ADR-0009: Contract-Driven Context Distillation — Amber Governs, Agents Generate

**Status:** Accepted
**Date:** 2026-08-07
**Builds on:** [ADR-0001](0001-governance-first-artifact-first.md) (governance-first, artifact-first),
[ADR-0003](0003-governance-gated-execution.md) (the shape of a narrow, gated exception),
[ADR-0004](0004-evidence-grade-verification.md) (evidence grading).
**Context:** Landscape review of six external agent-memory / context-engineering sources, followed by a
decision interview with the project lead.

---

## Context

Amber already produces high-grade evidence — session ledgers, gate records, plans, reviews, evolution
logs — but that evidence **sinks**. It lands in `.amber/` when a session ends and is never read again,
while the next agent boots from `AGENTS.md` and `docs/wiki/`, which nobody refreshed. The repository
accumulates artifacts without accumulating knowledge.

A survey of the current agent-memory landscape (Tencent TencentDB-Agent-Memory, zosmaai/pi-llm-wiki,
SAGE (arXiv 2605.12061), PrimeIntellect prime-agent, rohitg00/agentmemory, and the "Memory Engineer"
long-form) produced four points of consensus worth acting on:

1. **The write path determines everything.** Retrieval quality is capped by what was written.
2. **Fully automatic memory maintenance is not a solved problem.** Human-or-agent-in-the-loop with an
   explicit gate is the current state of the art — which is precisely Amber's existing propose-and-gate
   posture.
3. **File-based memory is control.** Inspectable files beat opaque stores for governance.
4. **Quality metrics are meaningless without cost metrics.**

Point 2 is the opening. Every competing system generates memory automatically and asks you to trust it.
Amber can generate memory that is **provenance-backed, mechanically verifiable, and gated** — which is
a different product, not a worse one.

The obvious implementation — have Amber call an LLM to distil evidence into pages — was considered and
rejected. It contradicts ADR-0001 ("without executing Dynamic Workflows"), contradicts ADR-0005's
file-tree-level restatement of "governance, not execution", falls outside even ADR-0003's narrow
exception (which explicitly still forbids "account-bearing CLIs"), destroys artifact determinism,
breaks offline/CI operation, and adds the first non-`ajv` runtime dependency.

## Decision

Amber gains a **Context layer** capability under a new top-level command, `amber context`. It follows a
strict division of labour:

> **Amber owns the contract and the gate. The host agent owns the generation.**

Amber never calls an LLM. It emits a fully-specified distillation contract; whichever agent is already
driving the session (Claude Code, Codex, …) executes it with its own model; Amber then validates the
result and accepts or refuses it.

### D1 — Scope: write path only

This effort closes the **write** loop: capture → contract → distil → verify → persist → detect
staleness → re-contract. Retrieval, ranking, and per-agent context assembly ("loadout") are explicitly
**not** in scope and are deferred to a separate effort.

### D2 — Contract-driven distillation, not built-in LLM

`amber context request` writes a request artifact to `.amber/context/requests/<id>.json` containing:
hash-bearing source references, the target output schema, the distillation instructions, hard
constraints (cite every block, invent no facts, mark uncertainty as `unknown`), and a machine-checkable
`acceptance` list of error codes. The agent executes it. `amber context ingest` validates and persists.

Amber's zero-LLM, `ajv`-only dependency posture is **preserved**. ADR-0001, ADR-0003 and ADR-0005 are
unmodified by this ADR.

### D3 — Output location: Amber's own namespace, one index page

Accepted pages are written to `.amber/context/pages/`. Amber additionally maintains **exactly one**
generated index file under `docs/wiki/` pointing at them, so agents can discover the pages from the
wiki they already read. No other project document is created or rewritten — ADR-0001's "without
rewriting existing project documents" holds.

### D4 — Triggers: explicit plus source-change

Version one supports two triggers:

- **Explicit** — `amber context request --page <id>`.
- **Source-change** — a persisted page whose mutable source hashes no longer match disk yields a
  refresh request. This is what makes the loop a loop rather than a line.

Two candidates were rejected (see *Considered and rejected*): evidence-driven auto-routing, and reusing
the existing `wiki drift` signals.

### D5 — Staleness: dual hash, and `no-change` is a valid outcome

Sources are classified **immutable** (append-only ledger ranges, archived sessions, accepted ADRs) or
**mutable** (source files, live documents). Immutable sources are hashed for tamper detection only and
are never staleness-checked.

Mutable sources carry two hashes: `rawHash` and `normHash` (computed after stripping comments and
whitespace). **Only a `normHash` change raises a refresh request**; a raw-only change silently rebases.
Formatting passes and typo fixes therefore cost nothing.

When a genuine change does not affect a page's claims, the agent returns `{"outcome": "no-change"}` and
ingest rebases the hashes without touching content. Semantic judgement stays where the LLM already is;
Amber stays mechanical.

### D5a — Immutable sources are snapshotted, not referenced (Addendum, 2026-08-07)

Research (Wayfinder ticket "Do immutable source citations survive clean, gitignore, and archival?")
established that reference-only immutable citations are **not viable**: `amber clean` removes the entire
`.amber/` directory, and the scaffold recommends gitignoring `.amber/` entirely. A citation to
`.amber/sessions/<uuid>/ledger.jsonl#L12-L48` evaporates on the next clean or clone.

**Immutable source descriptors therefore embed an `excerpt`** — the literal cited lines copied at write
time — plus the excerpt's own hash. The original path remains as provenance metadata only. Verification
then has three outcomes:

1. Re-hash the embedded excerpt → detects page corruption.
2. If the live source still exists, compare the excerpt against it → detects tampering
   (`AMBER_E_CONTEXT_SOURCE_TAMPERED`).
3. If the live source is gone (cleaned, never cloned), re-verification is unavailable — the page stands
   on its own snapshot; `AMBER_E_CONTEXT_SOURCE_MISSING` is informational for immutable sources, not
   fatal.

This matches the immutable source-packet form of zosmaai/pi-llm-wiki (a source packet carries the
original plus the extracted form), and it makes pages self-contained and clone-safe.

### D6 — Page format: block-level structured JSON

A page is JSON, not Markdown. `sources` is a map of id → source descriptor; `blocks[]` is an ordered
list where every block declares a non-empty `sources` array. Block `text` may be a full multi-sentence
Markdown paragraph, so rendering yields prose rather than a pile of atomic facts. Immutable source
descriptors additionally embed an `excerpt` per D5a.

`{"type": "unknown"}` is a **first-class block type**. Without a legitimate way to say "the evidence
does not cover this", a mandatory-citation rule pushes a model toward fabricating citations.

### D7 — Command namespace: `amber context`

`amber context request | ingest | verify | list | show | refresh | stats`.

`distill` was unavailable (`amber maintenance distill` already extracts recurring gate findings) and
`knowledge` was unavailable (`amber wiki knowledge` already plans wiki page structure). `context`
aligns with the Context control layer and with the `layer` field in `error-catalog.js`.

### D8 — Verification: `verify` holds the codes, `doctor` summarises

Six new codes join `scripts/lib/core/error-catalog.js`:

| Code | Condition | Layer |
| --- | --- | --- |
| `AMBER_E_CONTEXT_SCHEMA_INVALID` | ingest payload fails the page schema | Context |
| `AMBER_E_CONTEXT_CLAIM_UNCITED` | a block cites source ids absent from the page's sources map (schema forbids empty arrays) | Context |
| `AMBER_E_CONTEXT_SOURCE_MISSING` | a referenced source no longer exists | Context |
| `AMBER_E_CONTEXT_SOURCE_STALE` | a mutable source's `normHash` no longer matches | Context |
| `AMBER_E_CONTEXT_SOURCE_TAMPERED` | an **immutable** source's hash no longer matches | Verification |
| `AMBER_E_CONTEXT_PAGE_ORPHANED` | a page is absent from the generated index | Context |
| `AMBER_E_CONTEXT_PAGE_OBSOLETE` | every mutable source of a page is missing — the described subject no longer exists | Context |

`AMBER_E_CONTEXT_SOURCE_TAMPERED` is deliberately a *Verification*-layer concern: an append-only
artifact that changed is the same class of problem `amber loop verify-ledger` exists to catch, and must
not share a bucket with "this page needs an update".

`amber context verify --json` is the authority. `doctor` gains a single aggregate finding whose
`remedy` points at it, matching the existing `drift` → `maintenance inspect` drill-down pattern.
Retrofitting a check registry and error codes onto `doctor`'s 19 legacy findings is a real gap but is
**not** a dependency of this work; it is tracked separately.

### D9 — Instrumentation: events plus a report

`request` and `ingest` append to `.amber/context/events.jsonl` (append-only), and `amber context stats`
reports over it. Tracked: `normHash` filter rate and `no-change` rate (cost), and ingest pass rate, error-code
distribution, `unknown`-block share, and mean sources-per-block (quality).

## Considered and rejected

- **Amber calls an LLM directly.** Contradicts ADR-0001/0005; not covered by ADR-0003's exception,
  which still forbids account-bearing CLIs; destroys determinism; breaks offline and CI operation;
  introduces the first non-`ajv` runtime dependency.
- **Evidence-driven auto-routing** (new session evidence automatically selects its target page).
  Requires semantic classification of evidence, which requires an LLM — unavailable per D2 — or a
  hand-maintained mapping table that rots. Deferred to a follow-on effort. Note this is deferral, not
  cancellation: `--page` already implements the evidence-scan-and-bundle path; auto-routing adds a layer
  above it rather than replacing it.
- **Reusing `wiki drift` signals as triggers.** `staleDocs` / `missingRequired` / `controlledDrifted`
  are time-, file- and template-based and carry no source references, so requests derived from them
  cannot populate `sources`. The resulting pages would be permanently exempt from `AMBER_E_CONTEXT_SOURCE_STALE`
  — provenance-free islands inside a provenance-grounded system. `wiki drift` continues to do its own
  job unchanged.
- **Markdown pages with enforced footnotes.** Deciding "what counts as one claim" by regular expression
  is unstable across list items, code blocks and headings, and is trivially worked around.
- **Line-range hashing** (`#L12-L48` plus a hash of that span). More precise than whole-file hashing but
  requires line-drift correction; complexity is not justified at this stage.
- **Symbol-level anchors.** Most accurate, but requires a JavaScript parser — a new dependency.

## Consequences

### Positive

- Evidence stops sinking: the loop closes without Amber becoming a runtime.
- Every persisted claim carries provenance, so "is this still true?" becomes a mechanical question.
- `CONTEXT.md`'s long-defined but never-implemented **Source Bundle** term finally has an implementation.
- The zero-LLM, `ajv`-only, offline-capable, deterministic posture is unchanged; `npm test` can cover
  both ends of the loop because the non-deterministic middle is not Amber's.

### Negative

- The loop only runs when an agent is present to execute contracts. Amber alone cannot advance it.
- `normHash` stripping rules are per-file-type and will need maintenance as file types are added.
- Version one still requires a human to name the page (`--page`), so knowledge capture is not yet
  self-starting.

### Neutral

- `docs/wiki/` remains human territory apart from one generated index file.
- Existing `maintenance distill`, `wiki knowledge` and `wiki drift` behaviour is untouched.

## Related

- [ADR-0001](0001-governance-first-artifact-first.md) — governance-first, artifact-first
- [ADR-0003](0003-governance-gated-execution.md) — the precedent for a narrow, gated exception
- [ADR-0004](0004-evidence-grade-verification.md) — evidence grading
- [ADR-0005](0005-experimental-execution-removal.md) — governance, not execution
- `CONTEXT.md` — Source Bundle, Context Page, Distillation Contract

---

**Approved by:** Project lead
**Implementation:** pending — planned via the Wayfinder map "Compounding context: closing the write path"
