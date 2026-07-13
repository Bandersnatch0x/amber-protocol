# Weekly Self-Dogfood Ritual

**Source:** [issue #49](https://github.com/Bandersnatch0x/amber-protocol/issues/49) — drive one real feature through the full Amber session lifecycle each week.
**Cadence:** weekly (suggested: the first working session of the week).
**Owner:** any maintainer; rotates.

Real usage is Amber's highest-yield bug channel — the [external pilot map #35](https://github.com/Bandersnatch0x/amber-protocol/issues/35) found 5 real defects, but pilots are episodic and expensive, and CI only dogfoods `amber drift` (non-blocking). This ritual replaces episodic pilots with a **repeatable weekly run** that drives one real piece of work through the entire governed lifecycle and converts every UX friction into a `next-up` issue.

This is a **process / ritual** document. It adds nothing to code or `package.json`. It complements [LOOP.md](../LOOP.md) (loop engineering) and the [Amber Agent Operating Manual](wiki/AMBER_AGENT_OPERATING_MANUAL.md).

---

## 1. Why

| Signal | What it shows |
|--------|---------------|
| Pilot #35 → 5 real bugs | Real usage finds what CI can't, but only episodically |
| CI only runs `amber drift` | Non-blocking; no feature actually traverses the lifecycle |
| `complete-check` rejects template handoff (G2) | Code layer (isLiveHandoff / hasHandoffEvidence in evaluateCompletion) refuses init-scaffold; only live-regenerated handoff from `handoff` satisfies the gate (verified; 2193583 anchor). |

A weekly ritual keeps the **real** lifecycle exercised continuously, so the path that ships to users is the path we actually walk.

---

## 2. When to run

- **Weekly**, ideally at the start of the week's first working session — before context has decayed.
- **One feature per week.** Not more. The point is the full path, not throughput.
- **Skip only if** there is genuinely nothing in the backlog (then the ritual's job is to *find* the next candidate — see §7).
- Pair it with the existing [Daily Amber Triage](../LOOP.md) loop: triage surfaces candidates, the weekly ritual drives one to `accepted`.

---

## 3. What to pick

A good dogfood target is:

1. **Real** — work that would ship anyway (a bugfix, small feature, safe refactor, or a doc/governance fix that closes a known gap). Not a synthetic "touch README".
2. **Lifecycle-shaped** — small enough to finish in one session, real enough to exercise every stage `plan → gate → verify --execute → approve → complete → accept → handoff`.
3. **High-friction-yield** — preferably a known Amber weakness (G2 from `docs/quality/`), because fixing it *through* the lifecycle is self-referentially dogfooding the path it improves.
4. **Non-destructive** by default — doc/governance/skill tasks are safest to drive end-to-end first; code tasks after.
5. **Avoid** targets owned by a parallel task that is mid-flight (e.g. another issue's branch). Pick unclaimed work.

Pick the route that fits (`feature-standard` | `bugfix-quick` | `refactor-safe`) — see Operating Manual §5.

---

## 4. The full lifecycle command template

This is the **canonical, e2e-verified** path (matches `docs/quality/e2e-governance-loop-verify.md`). Run it top-to-bottom. The tail (`complete → accept → handoff`) is exercised explicitly; `amber next` now includes the terminal sequence steps (handoff / complete-check / session-complete / accept) per the lifecycle definition.

> Replace `<FID>` with a feature id registered in `feature_list.json`, `<SID>` with the session id printed by step 4, and `<GATE>` with the route's gate id (find with `amber route inspect feature-standard`).

```bash
# ── 0. Orient (read-only): know where you are before you start ─────────────
node scripts/amber.js next --target .
gh issue list --repo Bandersnatch0x/amber-protocol --label next-up
git status

# ── 1. Plan the slice (feature must already exist in feature_list.json) ────
node scripts/amber.js plan --target . --feature <FID> --title "<one-line title>"
#    → then FILL the generated docs/plans/<FID>-*.md sections
#      (problem, approach, evidence criteria, scope). An unfilled plan is not plan-ready.

# ── 2. Gate: move the plan to implementation-ready ─────────────────────────
node scripts/amber.js gate --target . --plan docs/plans/<FID>-<slug>.md --confirm

# ── 3. Do the REAL work and commit it ──────────────────────────────────────
#    (the actual code / doc change. This is the only step that mutates the product.)

# ── 4. Start a governed session BOUND to the feature ──────────────────────
node scripts/amber.js session start \
  --target . \
  --goal "<goal echoing the plan>" \
  --route feature-standard \
  --feature <FID>
#    prints: Session created: <SID>

# ── 5. Verify with REAL execution evidence (never a claim-only verify) ─────
node scripts/amber.js session verify \
  --target . \
  --session <SID> \
  --execute \
  --command "npm test"
#    --execute runs the command, records its real exit code in the tamper-evident
#    ledger, and (because the session is bound to <FID>) refluxes evidence into
#    feature_list.json. A claim-only verify (no --execute) is NOT acceptable here.

# ── 6. Approve the gate (human; separate from the worker) ─────────────────
node scripts/amber.js session approve \
  --target . \
  --session <SID> \
  --gate <GATE> \
  --yes
#    In a real TTY, drop --yes for the interactive prompt. Worker output never
#    approves itself (Operating Manual §7).

# ── 7. Complete-check (strict: needs executed evidence + live handoff) ─────
node scripts/amber.js session complete-check --target . --session <SID> --strict

# ── 8. Mark the session complete (governance terminal state) ───────────────
node scripts/amber.js session complete --target . --session <SID>

# ── 9. Accept the plan into the evolution log ─────────────────────────────
node scripts/amber.js accept \
  --target . \
  --plan docs/plans/<FID>-<slug>.md \
  --session <SID>

# ── 10. Leave handoff state (never end a session without this) ────────────
node scripts/amber.js handoff --target .          # regenerate session-handoff.md
node scripts/amber.js handoff bundle --target .   # portable continuation artifact
node scripts/amber.js handoff validate --target . # verify it's complete
```

### Terminal-state checklist

The run is only "done" when ALL of these are true:

- [ ] `session complete-check --strict` reports **pass** (executed evidence, not a claim).
- [ ] Feature status in `feature_list.json` is `passing` or `accepted` with non-empty `evidence`.
- [ ] `handoff validate` exits `0`.
- [ ] `session verify-ledger` reports the session ledger **intact**.
- [ ] The session is in terminal state (`completed` / `accepted`) — not stranded in `created`/`executing`.

---

## 5. UX friction → issue → next-up queue

**The ritual's second output (after the feature itself) is friction.** Every place the lifecycle hurt is a bug in Amber's UX, and it feeds the next week's candidate pool.

For each friction hit during the run, open an issue immediately — don't "remember it later":

```bash
gh issue create --repo Bandersnatch0x/amber-protocol \
  --title "dogfood: <what hurt, e.g. next drops complete/accept/handoff after approve>" \
  --label next-up \
  --body "Found during weekly dogfood of <FID>/<SID>. Steps: ... Expected: ... Actual: ..."
```

Rules:

- **Log it where it happened** — at the offending step, before moving on.
- **One issue per friction**, not a batch at the end (batches lose detail).
- **Reproducible** — include the exact command and the output that was wrong/confusing.
- **Label `next-up`** so it enters the candidate pool for §7.
- **Be honest about severity** — a confusing message is `next-up`, a bypassable gate is `bug, ready-for-agent`.

The feedback loop closes weekly: **run ritual → log friction → next week's ritual picks one friction from the queue → fix it through the same lifecycle → log any new friction.** This is the continuous, cheap replacement for episodic pilots.

---

## 6. Exit criteria (出坑标准 — when the ritual has done its job)

The ritual itself has a graduation bar. It stops being a separate ritual (and becomes just "how we work") when, for **four consecutive weeks**, all hold:

1. **Path walked fully** — every weekly target reached `accepted` via `verify --execute` (not claim) + live handoff validated `0`. No skipped tail.
2. **No gate bypassed** — policy deny, claim-only-on-strict, accept-without-evidence, and multi-gate `--gate` all held as designed.
3. **Friction trending down** — fewer than 2 new `next-up` friction issues per week, and the open friction queue is shrinking.
4. **Navigation closed** — `amber next` recommends the full terminal sequence after `approve` (handoff / complete-check / session-complete / accept); operators no longer have to memorize the tail. (G1 verified closed on HEAD.)
5. **Evidence honesty** — `complete-check --strict` rejects init/template handoff (closes G2); no greenwashed completions.

Until all five hold for four weeks, the ritual stays weekly. If a regression appears (a gate becomes bypassable, `next` drops the tail again), the ritual resumes.

---

## 7. First-round dogfood candidate list

Candidates are drawn from the current backlog (`gh issue list --label next-up`) and the open gaps in `docs/quality/adjudication-loop-and-value.json`. Each is small enough for one session and exercises the full lifecycle. The prior Candidate B (G2) and Candidate C (deferred to post-#48) are stale: #48 has landed (`npm run orient` issued), #50 closed G1, and #51 closed G2. A fresh operator running the ritual would see no live candidate in the old list.

The recommended **first run** now points to a truly open ticket: the G1/G2 target-repo verification (addresses the adjudication gaps that remain open for real TARGET repos even after product-repo closures).

### Candidate A — Verify G1/G2 closure on a real TARGET repo  ← recommended first run

- **Source:** open `next-up` (G1/G2 target-repo verification) and `docs/quality/adjudication-loop-and-value.json` (G1/G2 gaps still block full closure + honest Evidence ≥90% measurement).
- **Why suitable:** Product HEAD claims G1 (next last-mile after approve) and G2 (complete-check --strict rejects templates) closed, yet pilot evidence on fresh targets contradicts; this is the live gap. The weekly ritual drives the exact end-to-end path (plan → gate → verify --execute → approve → complete → accept → handoff) whose navigation and evidence integrity are under test. Selecting this as the dogfood slice self-referentially exercises (and can generate evidence for) the claimed closures on the repo that matters for operators. High-yield for surfacing any remaining UX friction in orient/next/complete-check/handoff.
- **Shape:** verification + possible small doc updates; use `feature-standard` (or `bugfix-quick` if scoped narrowly); prefer a non-product target clone for the verification steps.

### Selection summary

| Week | Candidate | Route | Expected friction yield |
|------|-----------|-------|-------------------------|
| 1 (first run) | A — G1/G2 target-repo verification (product claims vs. real targets + json gaps) | feature-standard | next / orient last-mile, strict complete-check on live handoff, target-repo evidence |
| 2+ | re-evaluate live `next-up` queue + open gaps in adjudication json | per route | per discovered friction |

Record each completed run in `session-handoff.md` (regenerated at step 10) and the friction issues opened in the GitHub `next-up` queue — together these make the four-week graduation bar in §6 auditable without a new state file.
