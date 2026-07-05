# Amber Artifact-First Evidence Layer — Phase 1 Design

**Status:** Proposed (awaiting user review)
**Date:** 2026-07-05
**Builds on:** ADR-0001 (governance-first), ADR-0003 (governance-gated execution), ADR-0004 (evidence-grade verification), ADR-0005 (experimental execution removal)
**Predecessor:** `2026-06-30-amber-governed-loop-execution-design.md`

---

## 1. Context — why this, why now

Amber's boundary is defended and the easy governance artifacts are done (v1.3.0). The
question this design answers: **what is the next layer of value, given Amber will NOT become
a runtime, IDE, or orchestrator?**

A blind-spot scan + external survey + five-role adversarial roundtable (factual, engineering,
boundary, strategy, moat) produced and stress-tested ten candidate interventions. The
converged finding is narrow and deliberately unglamorous:

- Every "ambitious" option (replay-from-ledger, amber-mcp, cross-agent handoff, governance
  console rebuild, cost governance) is either **factually premised on a false gap**, **out of
  bounds per ADR-0001/0003**, an **engineering tar pit**, or **me-too in a red sea owned by
  4000★+ competitors**. See §6 for the kill/defer rationale.
- The only interventions with a real moat, low cost, and zero boundary risk all **strengthen
  assets Amber already owns**: the drift detectors (SP2/SP3) and the tamper-evident ledger.
- The single unoccupied space in the 2026 landscape is **"agent-artifact drift as a CI-native
  lint"**: the SDD ecosystem checks spec↔impl drift; the agent-governance runtime ecosystem
  checks runtime policy; nobody checks whether the artifacts an agent leaves behind
  (`feature_list.json`, wiki, scaffold) still match HEAD. Amber already detects this — it just
  is not CI-deployable as a standalone command.

The competitive frame: Microsoft `agent-governance-toolkit` (4647★) and `veritas_os` occupy
the **runtime-governance** space ("intercept agent tool calls"). Amber's defensible conviction
is the opposite stance: **inspect, don't intercept** — governance artifacts that live in the
repo as files any CI/SIEM/reviewer can read without Amber being in the agent's hot path. That
conviction is architectural for the competitors to copy only by contradicting their own design.

## 2. Direction (6–12 month positioning)

**Amber is the artifact-first evidence layer for agent-assisted repos.** Three verbs:

1. **Catch** what drifted (agent artifacts vs HEAD).
2. **Prove** what happened (tamper-evident, git-anchored ledger).
3. **Speak** CI- and SIEM-native formats (exit codes, annotations, OTLP/CSV/JSON).

Differentiation line: **inspect, don't intercept.** This phase ships all three verbs in
minimal, boundary-safe, zero-new-dependency form, then lets adoption signal decide Phase 2
(among the deferred options in §6).

## 3. Phase 1 scope (≈ 1 week, all in-bounds, zero new runtime dependencies)

Three work items, sequenced for adoption leverage:

| # | Work item | Effort | Asset it strengthens | Boundary |
|---|-----------|--------|----------------------|----------|
| 1 | `amber drift` — CI-native drift gate | ~1 day | drift detectors (SP2/SP3) | Verification layer, read-only |
| 2 | `amber ledger export` — SIEM/compliance bridge | ~1–2 days | tamper-evident ledger | Observability layer, read-only |
| 3 | `amber ledger seal` + `verify-anchoring` — git-anchored ledger integrity | ~2–3 days | closes ADR-0003 self-admitted gap | Governance layer, no execution |

Each item is detailed in §4. Items are independent and individually shippable.

## 4. Work-item designs

### 4.1 `amber drift` — CI-native drift gate

**Problem.** `detectArtifactDrift`, `detectWikiDrift`, and `detectScaffoldVersionDrift` already
exist and are surfaced inside `amber status` / `amber doctor` / `amber maintenance`. But there
is no standalone `amber drift` command (confirmed: `drift` does not appear in `scripts/amber.js`
or the `COMMANDS` array), and the existing surfaces mix drift with many other signals and lack
CI-native semantics (single-concern output, drift-count exit code, machine format).

**Wedge.** The unoccupied space is not "drift detection" (Amber has it) — it is **"a 30-second
CI lint for agent-artifact drift that any repo can adopt without buying into the full Amber
session lifecycle."** This is the adoption wedge: lowest commitment, highest reach.

**Design.**

```
amber drift --target <repo> [--json] [--format gh-annotations] [--no-fail] [--scope artifact|wiki|scaffold|all]
```

- Runs the three existing detectors and aggregates `counts.drifted` across scopes.
- **Exit code: `0` if no drift, `1` if any drift** (CI semantics — `totalDrifted` count is
  always present in the `--json` envelope for scripts that want the exact number). `--no-fail`
  always exits 0 (report-only, for informational CI steps).
- `--json` envelope: `{ target, available, scopes: { artifact: {...}, wiki: {...}, scaffold: {...} }, totalDrifted, exitCode }` — reuses each detector's existing return shape verbatim.
- Human output: one line per drifted item, grouped by scope, plus a summary line. Suitable
  for direct reading in CI logs.
- **CI ergonomics:** document a GitHub Actions snippet and a `--format=gh-annotations` option
  (emits `::warning file=...::...` lines) so drift surfaces as PR annotations. This is the
  adoption hook.
- Reuses: `detectArtifactDrift` / `detectWikiDrift` / `detectScaffoldVersionDrift` unchanged.
  Adds: a new `scripts/lib/drift-command.js` aggregator + `drift` entry in `COMMANDS` +
  `PER_COMMAND_USAGE` + a dispatcher branch.

**Boundary.** Verification layer, read-only, no execution. Identical in shape to the existing
`doctor`/`manifests` CI checks. Explicitly does **not** auto-fix drift (that would be a
mutating action).

**Self-check (ponytail).** One assert-based demo in `scripts/lib/drift-command.js` mirroring
`artifact-drift.js`'s heuristic self-test pattern; plus unit tests on the exit-code aggregation
and the `--no-fail` / `--json` / `--format=gh-annotations` branches.

### 4.2 `amber ledger export` — SIEM/compliance bridge

**Problem.** The tamper-evident ledger (`scripts/lib/core/loop-ledger.js`) is an append-only
JSONL hash chain — but it is a local file SIEM/SOC/compliance tooling cannot query. The
enterprise pain most cited in 2026 literature (PredictionGuard, Palo Alto, Cyberhaven) is
agentic work being invisible to SIEM. Amber owns a real audit trail and ships no export path
(confirmed: only `okf-export.js` exists, which exports the wiki, not the ledger).

**Design.**

```
amber ledger export --target <repo> [--format json|csv|otlp-json] [--home loops|routes|sessions|all] [--out <path>]
```

- Uses `walkLedgers(stateDir, cb)` (already exported from `loop-ledger.js`) to enumerate every
  existing `ledger.jsonl` across `loops` / `routes` / `sessions` homes.
- For each ledger, `readLedger()` + `verifyLedgerChain()` — **export refuses to emit a broken
  chain** (records the break in the export manifest instead). The export carries integrity, not
  just data.
- Output formats:
  - `json` (default): one canonical JSON document per `--out` (or stdout): `{ generatedAt, target, ledgers: [{ home, sub, path, intact, recordCount, records: [...] }] }`.
  - `csv`: one row per ledger record (flattened), with `ledger_home, ledger_sub, kind, prevHash, hash, ...rest` columns.
  - `otlp-json`: OTLP-compatible JSON spans (one span per record), so existing OpenTelemetry
    collectors can ingest. **No protobuf, no new dependency** — JSON-encoded OTLP is a valid
    OTLP encoding.
- Return shape mirrors `okf-export.js`: `{ target, outputDir|stdout, format, ledgers, records, intactCount, brokenCount, errors, warnings }`.
- Adds: `scripts/lib/core/ledger-export.js` + `ledger` entry in `COMMANDS` with subcommand
  `export` (future subcommands: `seal`, `verify-anchoring` from §4.3). Per-command usage in
  `PER_COMMAND_USAGE.ledger`.

**Boundary.** Observability layer, pure read. No external writes (does not push to a SIEM —
the user pipes the output to their own collector). Honors ADR-0001's "inspectable artifacts."

**Why ship if SIEM export is "me-too"?** It is not the differentiator; it is the **plumbing
that makes the differentiator consumable**. Without it, the ledger is a local file nobody
reads. Ship as plumbing, do not market as the story. (Fact-checker confirmed the gap is real;
moat-checker flagged the category as crowded — both are correct, and the resolution is
"plumbing, not positioning.")

**Self-check.** Unit tests: export of a known fixture ledger matches a golden JSON/CSV/OTLP
file; a tampered chain produces `intact: false` and is refused; `walkLedgers` enumerates all
three homes.

### 4.3 `amber ledger seal` + `verify-anchoring` — git-anchored integrity

**Problem.** ADR-0003 (L67) and `loop-ledger.js` (L4–6) **both self-admit** the gap: *"This
detects accidental/single-record tampering — not an attacker who rewrites the whole file and
recomputes every hash (that needs external anchoring)."* This is the single most honest,
lowest-controversy gap to close: it is documented as a gap by Amber itself.

**Design.** Anchor each ledger's tail hash into git history, so forging a ledger now requires
rewriting git history too. Human-triggered, not scheduled.

```
amber ledger seal   --target <repo> [--reviewer <name>]     # create/update annotated seal tag
amber ledger verify-anchoring --target <repo>               # recompute tails, compare to seal
```

- `seal` walks all ledgers (`walkLedgers`), computes each ledger's tail hash (last record's
  `hash`) + record count, and writes a **single annotated git tag** named
  `amber-ledger-seal-<commit-sha-prefix>` whose tag message is a canonical JSON map:
  `{ sealedAt, reviewer, ledgers: [{ home, sub, tailHash, recordCount }] }`.
- The tag is anchored to `HEAD`. Git's own object-hash integrity (and optional commit signing,
  which Amber does not add) protects the seal. An attacker must rewrite both the ledger **and**
  the git tag history.
- `verify-anchoring` finds the most recent `amber-ledger-seal-*` tag, recomputes each ledger's
  current tail hash, and reports `{ matched, ledgerChangedSinceSeal, sealTag, drift: [...] }`.
  Exit non-zero if any ledger's tail no longer matches the seal (the ledger was rewritten after
  sealing without a new seal).
- **No Ed25519 signing in Phase 1.** Ed25519 (`node:crypto` supports it natively on Node 18,
  zero new deps) is deliberately deferred: in-repo keys give no marginal gain over SHA-256, and
  key management (HSM / OS keystore) is its own project. `claude-code-slack-channel` (34★)
  already ships Ed25519-signed journals, so signing is a "catch-up + git-anchor" play, not a
  differentiator — defer until key handling is real. Git-anchoring alone closes the
  self-admitted gap and is the differentiated half.
- Adds: `scripts/lib/core/ledger-seal.js` + `seal`/`verify-anchoring` subcommands under the
  `ledger` command group introduced in §4.2. Uses `git-exec.js` (`gitOutput`) for tag create/
  read, consistent with existing git access.

**Boundary.** Governance layer. Creates a git tag — a **local, human-triggered** git object
write, not an external write (no push), not scheduling, not agent dispatch. Same boundary
category as the opt-in pre-commit hook: a governance-metadata artifact in git. No `--execute`,
no policy gate needed (it writes a tag, not a command run). Explicitly **not** Ed25519 runtime
signing infra in this phase.

## 5. Boundary compliance (ADR mapping)

| Work item | ADR-0001 (no execution) | ADR-0003 (5-gate exec) | ADR-0004 (evidence verify) | Verdict |
|-----------|-------------------------|------------------------|----------------------------|---------|
| `amber drift` | Read-only Verification check, no execution — identical shape to `doctor`. | Not applicable (no command run). | Not applicable. | **In bounds.** |
| `amber ledger export` | Read-only export of inspectable artifacts. | Not applicable. | Not applicable. | **In bounds.** |
| `amber ledger seal` | Writes a git tag (governance metadata), no workflow execution, no external write, no scheduling. Human-triggered. | Not a `governed.command` run — no policy/approval/worktree gates needed (it does not execute a command). | Not applicable. | **In bounds** (same category as the opt-in hook). |

None of the three items reopens the holes ADR-0004 closed (no agent-written
`verification_passed`), nor the holes ADR-0003 closed (no approval bypass, no unattended run),
nor the autonomous-execution rot ADR-0005 deleted.

## 6. Explicitly deferred / killed (with rationale)

| Option | Disposition | Rationale (verifying agent) |
|--------|-------------|------------------------------|
| **Replay-from-ledger** (#10) | **KILL** | Factual: ledger records only `command+exitCode+durationMs+hash`, timeline only stage events — insufficient to replay a session (false premise). Boundary: turns ledger from observation into execution driver (越界, ADR-0001 spirit). Engineering: deterministic replay needs process-level record/replay, not cleanly doable in Node (tar pit). Three independent kills. |
| **Cost/budget governance** (#7) | **KILL** | Red ocean (Helicone/Langfuse/openlit/DataDog own it). Factual: `budget.{total,used}` already in `session-manifest.schema.json` and shown by status — only ledger booking + complete-check gate is missing, i.e. busywork, not a direction. |
| **Cross-agent handoff protocol** (#8) | **DEFER** | Boundary: real-time multi-writer shared ledger needs a serialization coordinator = service form (越界). Engineering: value is 100% adoption-dependent; Amber does not run agents, so a "protocol" is a standard nobody adopts. The correct in-bounds form (per-agent ledger + artifact handoff via existing `amber handoff`) already exists. |
| **amber-mcp server** (#4) | **DEFER** | Boundary: append-only writes are in-bounds only for governance metadata, not evidence/approval (灰色). Moat: me-too (spec-workflow-mcp 4255★ etc.). Engineering: artifact-first (agents read files Amber writes) may already suffice — **prove necessity before building**. Reconsider in Phase 2 if adoption signal demands it. |
| **SDD governance bridge** (#5) | **DEFER** | Factual: "SDD tools lack governance" is overclaimed — Spec Kit has a governance section; Amber's real angle is *execution* governance on specs (narrower). Moat: derivative (spec-workflow-mcp already has dashboard+approval+VSCode). Reconsider if §4 lands and SDD users ask for it. |
| **Agent-eval verify gate** (#6) | **DEFER** | Real and cheap (extend `evidence-runner.js` with a `verification_eval` kind), but me-too (Helicone/Langfuse). Position as a Phase-2 extension of ADR-0004, not a strategic bet. |
| **Governance console rebuild** (#9) | **DEFER → reframed** | Factual: `apps/web` already runs with sessions/timeline/gates/routes/transcripts routes. Engineering: **extend, do not rebuild**. Reconsider after §4 gives the console new evidence/drift/SIEM data to actually display. |

## 7. Risks and open questions (for the plan stage)

1. **Seal-tag proliferation.** One tag per seal on busy repos could accumulate. Plan-stage
   decision: mutable single tag (`amber-ledger-seal-latest`, force-updated) vs immutable
   per-commit tags. Recommendation: immutable per-commit, with `verify-anchoring` reading the
   most recent — git history is the audit trail; force-update would defeat the purpose.
2. **`amber drift` scope flag default.** Default `all` vs requiring explicit `--scope`. Plan
   to default to `all`, since CI wants one gate. Confirm against `doctor`'s precedent.
3. **OTLP-JSON field mapping.** Which ledger record fields map to which OTLP span fields is a
   plan-stage detail; the spec only commits to "valid OTLP JSON encoding, no protobuf, no new
   dependency."
4. **`walkLedgers` only covers loops/routes/sessions.** If future ledger homes are added,
   `export`/`seal` extend for free (single scan loop). No action now.
5. **Adoption signal for Phase 2.** Define what "demand for MCP / SDD bridge / console" looks
   qualitatively (issues, discussions, stars, user reports) so the Phase-2 decision is
   evidence-based, not vibe-based.

## 8. Success metrics (Phase 1)

- Three commands (`drift`, `ledger export`, `ledger seal` + `verify-anchoring`) shipped,
  documented in CLI reference, with unit tests + one assert-based self-check each.
- `amber drift --format=gh-annotations` demonstrable in this repo's own CI (dogfood).
- `amber ledger export --format otlp-json | <otel-collector>` round-trips without error on a
  fixture ledger.
- `amber ledger verify-anchoring` detects a forged ledger (tamper test) and exits non-zero.
- Zero new runtime dependencies added to root `package.json` (ajv, ajv-formats, nodemailer
  unchanged). No boundary ADR amendment required (this design is in-bounds; if review
  disagrees, an ADR-0003 addendum is the escalation path).

## 9. Out of scope for Phase 1 (do not expand)

- Ed25519 ledger signing (deferred per §4.3).
- Any MCP server, SDD bridge, eval gate, console work, cost ledger (deferred per §6).
- Auto-fixing drift, pushing seals to a remote, scheduling seals in CI — all boundary
  violations or scope creep.
