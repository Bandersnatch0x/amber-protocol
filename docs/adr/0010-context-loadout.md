# ADR-0010: Context Loadout — Amber Governs the Agent's Context Window

**Status:** Accepted
**Date:** 2026-08-07
**Amended by:** [ADR-0015](0015-review-blocker-remediation-contracts.md) separates the Operating
Manual, selected Route manifest, and Loadout Definition into `artifacts.required[]`; they are
Required Artifacts, not Context Pages. The corrected pre-release contract remains
`schemaVersion: 1.0.0` and verifies these artifacts fail closed.
**Builds on:** [ADR-0009](0009-contract-driven-context-distillation.md) (the write path — the
loadout's pages and freshness hashes are its upstream), [ADR-0001](0001-governance-first-artifact-first.md)
(governance-first, artifact-first), [ADR-0004](0004-evidence-grade-verification.md) (evidence grading).
**Context:** Six-source research on context engineering / agentic retrieval (Anthropic context
engineering and context management, Redis context retrieval for AI agents, Letta/MemGPT memory
architecture, the AGENTS.md open format, ElliotOne deterministic context budgeting), followed by a
decision interview with the project lead covering all seven map tickets.

---

## Context

The write path (ADR-0009) made knowledge durable: provenance-backed pages under
`.amber/context/pages/`, indexed by `docs/wiki/context-index.md`. But nothing **reads** it well. A
host agent either boots from static `AGENTS.md`/`CLAUDE.md`/wiki (unbounded, unranked) or gets the
fixed-shape `handoff bundle` (a full snapshot, not task-scoped). There is no answer to "what should
this agent's context window contain for THIS task, and is all of it provably fresh?"

The research consensus mirrors the write-path finding, inverted: **the read path determines what the
write path is worth.** Anthropic's stale-tool-result eviction cut tokens 84% over 100 turns and its
context-management primitives beat baseline by 39% — context-window governance is independently
valuable. Redis catalogues five failure modes of retrieval in agentic loops (paraphrase mismatch,
cross-document stitching, query drift, no-accounting, poisoned steps), all of which reduce to
"context silently contains the wrong or stale thing." ElliotOne shows deterministic selection is
achievable without embeddings: priority-tagged blocks, stable ordering, out-of-budget exclusion with
recorded reasons, fail-fast on required overflow.

**Framing decision: this is context governance, not retrieval.** Amber cannot embed, rank by
similarity, or summarize (no model, no network, zero new runtime dependencies — same standing rules
as ADR-0009). The host agent already has native RAG. Amber's read path is a deterministic budget
allocator over provenance-linked knowledge — the exact mirror of how the write path governs
generation without generating.

---

## Decisions

### D1 — Input signal: route primary, feature qualifier (T1)

`amber context load --route <id> [--feature <id>]`. The route selects the **mode of work**
(bugfix-quick → fix-class knowledge; refactor-safe → refactor-class), matched mechanically from
`routes/*.json` stage structure; `--feature` narrows the **topic subset** using `feature_list.json`'s
existing `area`/`paths` metadata. Free-text goals are not a loadout input: the existing regex
goal→route matching in session routing already yields a route id before loadout selection, so no new
parsing is introduced.

### D2 — Artifact form: generated file (T2)

The loadout is a file at `.amber/context/loadouts/<route>[-<feature>].json`: deterministic (same
signal → byte-identical output), cacheable (same-signal regeneration skipped), diffable (shows what
context changed between sessions), and embeds each referenced page's `rawHash` so `verify` can
re-check at load time. Gitignored with the rest of `.amber/`, consistent with pages/requests/events.
Write-path principle upheld: **file = evidence.**

### D3 — Budget and tiering (T3)

- **Tiers**: required (pinned — operating manual, the route's own stages/contract, the loadout's
  definition), priority (fresh AND matching scope), optional (fill remaining budget).
- **Budget unit**: word estimate — Amber has no tokenizer, and a coarse word count is the
  deterministic proxy. Default ≈ 4000 words, overridable via `--budget <n>`.
- **Stable order**: required → priority → recency → pageId (same input → same loadout, assertable in
  tests; selection stability is a first-class property).
- **Required-tier overflow → fail-fast** (command errors, mirroring ingest's refusal posture).
- Out-of-budget exclusions are recorded **with reasons** inside the loadout.

### D4 — Freshness gate: hybrid (T4)

- `tampered` / `obsolete` → hard-excluded at every tier (integrity broken / subject gone — including
  them is actively wrong).
- `stale` → hard-excluded from the priority and optional tiers (reason recorded); the **required
  tier is exempt** — a stale required page is always included, explicitly marked stale, so the
  irreplaceable context is never missing and the agent sees the warning.

Reuses `amber context verify` statuses (ok/stale/tampered/obsolete) as the freshness signal; no new
freshness machinery.

### D5 — Page scope: retrofit the write path (T5)

Pages gain an optional `scope` array. `context-page.schema.json` moves 1.0.0 → 1.1.0 (optional
field, backwards compatible — pages without `scope` stay valid); `amber context request` gains an
optional `--scope <id>`; the agent carries the scope into the payload; `ingest` stamps it into the
page. Single source of truth — page metadata lives in the page, no sidecar that can drift.

### D6 — Duplicate-load accounting (T6)

The loadout records `references: [{ pageId, rawHash }]` for every page it references (the D2
embedded hashes ARE the accounting set). The host agent compares against what it already has in
context and skips re-loading. Optional `--since <timestamp>` emits only pages added or re-hashed
after that point — the warm-continuation delta. This is the mechanical analog of Anthropic's
context-editing eviction: Amber records what should be skipped rather than deciding it itself.

### D7 — Validation timing: hybrid (T7)

Generation-time: the allocator applies the D4 hard gate. Load-time: a new `amber context verify
--loadout <file>` re-checks **required-tier** pages' hash freshness only (cheap; guards the
irreplaceable bits). The amber-context-continuity journey tells the agent to run it right before loading.

---

## Rejected alternatives

- **Free-text goal as input** (D1) — needs an LLM to parse; contradicts standing rules and invites
  Redis's query-drift failure mode. The regex goal→route path already handles goals mechanically.
- **Ephemeral stdout loadout** (D2) — no audit trail, no diffing, breaks file = evidence.
- **Two tiers only** (D3) — loses the ability to prefer "fresh AND matching" over "fresh but
  off-scope" within the budget.
- **Page-count budget** (D3) — page sizes vary by orders of magnitude; unusable as a cap.
- **No budget cap** (D3) — destroys the "provably bounded" property that makes the loadout a
  governance artifact.
- **All-hard freshness gate** (D4) — a sole required page that happens to be stale would fail-fast
  or starve the loadout entirely.
- **Soft freshness weights** (D4) — keeps stale info in context, against Anthropic's eviction
  evidence and the "provably fresh" promise.
- **Sidecar page-tags file** (D5) — a second source of truth that can drift from pages.
- **Derive scope from source refs** (D5) — brittle, depends on ref-naming conventions.
- **Load-time full re-verify** (D7) — every load pays a full verify pass for a benefit concentrated
  in the required tier.
- **Semantic/embedding retrieval anywhere** — requires a model; out of scope by standing rules.

---

## Impact

- **New command**: `amber context load` (+ `--budget`, `--since`, `--feature`, `--route`),
  `amber context verify --loadout <file>`.
- **Write-path changes**: `context-page.schema.json` 1.1.0 (optional `scope`), `request` `--scope`,
  `ingest` stamps scope.
- **Glossary** (CONTEXT.md): add **Loadout**, **Context Budget**, **Scope Tag**.
- **Skill**: extend `skills/amber-context-continuity/SKILL.md` with the load step.
- **Tests**: allocator determinism (same signal → same loadout), tier ordering, budget exclusion
  with reasons, fail-fast, freshness gates per tier, scope stamping round trip.

This ADR completes the loop begun by ADR-0009: write (evidence → verified knowledge) and read
(verified knowledge → task-scoped context) are now two halves of one governed cycle.
