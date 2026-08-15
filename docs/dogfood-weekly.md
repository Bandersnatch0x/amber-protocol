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
2. **Lifecycle-shaped** — small enough to finish in one session, real enough to exercise every stage `plan → gate → verify --execute → approve → complete → accept → learnings → handoff`.
3. **High-friction-yield** — preferably a known Amber weakness (G2 from `docs/quality/`), because fixing it *through* the lifecycle is self-referentially dogfooding the path it improves.
4. **Non-destructive** by default — doc/governance/skill tasks are safest to drive end-to-end first; code tasks after.
5. **Avoid** targets owned by a parallel task that is mid-flight (e.g. another issue's branch). Pick unclaimed work.

Pick the route that fits (`feature-standard` | `bugfix-quick` | `refactor-safe`) — see Operating Manual §5.

---

## 4. The full lifecycle command template

This is the **canonical, e2e-verified** path (matches `docs/quality/e2e-governance-loop-verify.md`; the conditional `learnings` step is a later addition — F023). Run it top-to-bottom. The tail (`complete → accept → learnings → handoff`) is exercised explicitly; `amber next` now includes the terminal sequence steps (learnings / handoff / complete-check / session-complete / accept) per the lifecycle definition.

### 4.0 Pick the route first

| Work shape | Route | Typical goal verbs | Gates (inspect, don't memorize) |
|------------|-------|--------------------|---------------------------------|
| New capability / feature | `feature-standard` | add, implement, create, build, support | `user-approval-plan`, `user-approval-implement` |
| Bug / defect fix | `bugfix-quick` | fix, repair, resolve, close | inspect with `route inspect bugfix-quick` |
| Safe refactor | `refactor-safe` | refactor, restructure, extract | inspect with `route inspect refactor-safe` |

```bash
# Always list gates for the chosen route before approve:
node scripts/amber.js route inspect <ROUTE>
```

Using `feature-standard` with a goal that starts with `fix …` will warn that the goal does not match the route pattern — that is intentional; switch to `bugfix-quick` for fix work (#64).

> Replace `<FID>` with a feature id in `feature_list.json`, `<SID>` with the session id from step 4, `<ROUTE>` with the chosen route, and `<GATE>` with **each** gate id from `route inspect <ROUTE>` (not a single hardcoded gate).

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
  --goal "<goal echoing the plan; match route goalPattern>" \
  --route <ROUTE> \
  --feature <FID> \
  --confirm
#    prints: Session created: <SID>
#    Then: node scripts/amber.js route inspect <ROUTE>  → list every gate id

# ── 5. Verify with REAL execution evidence (never a claim-only verify) ─────
node scripts/amber.js session verify \
  --target . \
  --session <SID> \
  --execute \
  --command "npm test" \
  --confirm
#    --execute runs the command, records its real exit code in the tamper-evident
#    ledger, and (because the session is bound to <FID>) refluxes evidence into
#    feature_list.json. A claim-only verify (no --execute) is NOT acceptable here.

# ── 6. Approve EVERY remaining gate (human; separate from the worker) ──────
#    feature-standard has TWO gates — approve each once, in order:
node scripts/amber.js session approve \
  --target . \
  --session <SID> \
  --gate <GATE_1> \
  --yes
node scripts/amber.js session approve \
  --target . \
  --session <SID> \
  --gate <GATE_2> \
  --yes
#    …repeat for any further gates from `route inspect <ROUTE>`.
#    In a real TTY, drop --yes for the interactive prompt. Worker output never
#    approves itself (Operating Manual §7).
#    Note: approving the LAST pending gate may auto-mark the session completed.
#    Step 8 is then a no-op (harmless). Do not skip earlier gates because of this.

# ── 7. Complete-check (strict: needs executed evidence + live handoff) ─────
#    Regenerate live handoff first so complete-check --strict is not satisfied by
#    an init-scaffold handoff (G2).
node scripts/amber.js handoff --target .
node scripts/amber.js session complete-check --target . --session <SID> --strict

# ── 8. Mark the session complete (governance terminal state) ───────────────
#    May print "Session already completed" if step 6 auto-completed on last gate.
node scripts/amber.js session complete --target . --session <SID>

# ── 9. Accept the plan into the evolution log ─────────────────────────────
node scripts/amber.js accept \
  --target . \
  --plan docs/plans/<FID>-<slug>.md \
  --session <SID>

# ── 10. Learning write-back checkpoint (read-only; book when triggered) ───
node scripts/amber.js learnings --target . --feature <FID>
#    Reports whether the accepted work hit mandatory knowledge write-back
#    triggers (schema / contract / infra paths). If any matched, write the
#    review onto the suggested surface (docs/specs, docs/adr, or docs/wiki)
#    and book it — Amber never writes knowledge docs itself:
node scripts/amber.js learnings --target . --feature <FID> --reviewed --surface <path>
#    No matched triggers → the checkpoint does not apply (no fake gate).
#    Booking through the CLI also keeps the next/breadcrumb/handoff parity
#    channels and the governance loop fed from the same lifecycle SSOT.

# ── 11. Leave handoff state (never end a session without this) ────────────
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

**Escalation — when the same class comes back.** If a friction class you already fixed resurfaces (second occurrence), don't just re-fix the symptom: run `amber break-loop --target . --issue <n> --title "<what recurred>" --recurrence <n>` right after opening the new issue, fill the scaffolded post-mortem (root-cause category, prevention mechanism, write-back surface), and link the post-mortem from that issue. `amber break-loop validate` must pass before the issue leaves `next-up` — a recurring defect closes with a checkable prevention record, not another patch.

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

Prior Candidate A (G1/G2 target-repo verification, #54) and the 2026-07-14 dogfood friction set (#60–#66) are **closed**. A fresh operator will often see an empty `next-up` queue. When that happens, pick from the live candidates below or invent one real small slice and log new friction as you go.

### Candidate A — Empty-queue dogfood: policy dry-run honesty (rules check ↔ runner)

- **Source:** continuous-improvement note 2026-07-22 (`governance rules check` now uses `evaluateGovernedPolicy`).
- **Why suitable:** Confirms the check surface and governed-runner stay aligned after policy changes; exercises `plan → gate → verify --execute → approve → complete → accept → learnings → handoff` on a governance-layer fix.
- **Shape:** already landed as a code fix; next dogfood can re-verify on a fresh target with a custom `rules.json` allow prefix + shell composite.

### Candidate B — Hosted web boundary (only if you want product expansion)

- **Source:** BACKLOG deferred: multi-tenant / non-localhost web beyond the local viewer.
- **Why suitable:** Clear Phase-D-plus scope; large enough for multi-session → prefer `/grill-with-docs` first, not a silent dogfood.

### Selection summary

| Week | Candidate | Route | Expected friction yield |
|------|-----------|-------|-------------------------|
| current | A — policy dry-run honesty / any real small slice when `next-up` is empty | bugfix-quick or feature-standard | rules check, verify policy, handoff tail |
| next | re-evaluate live `next-up` + external adoption / value pilot gaps | per route | per discovered friction |

Record each completed run in `session-handoff.md` (regenerated at step 11) and the friction issues opened in the GitHub `next-up` queue — together these make the four-week graduation bar in §6 auditable without a new state file.
