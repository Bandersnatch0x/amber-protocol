# Pilot run: Amber value-validation — operability + governance-overhead pass

**Date:** 2026-07-11
**Operator:** single agent operator (self-run), acting as author + timer
**Product:** `amber-protocol` tree at commit `2193583` (post G1/G2/N2/A1 fixes)
**Protocol:** [`minimal-value-validation-pilot.md`](./minimal-value-validation-pilot.md)
**Handoff:** [`pilot-value-validation-HANDOFF.md`](./pilot-value-validation-HANDOFF.md)
**Adjudication baseline:** [`adjudication-loop-and-value.md`](./adjudication-loop-and-value.md)

---

## 0. Honest scope banner (read first)

This is **NOT** the 2×10 field pilot that closes 实际价值. It is a **single-operator
operability + governance-overhead validation** run on two independent, non-product,
real open-source repos, at the request of the product owner (who supplied the "pull a
Node and a Python repo and test" instruction, unblocking the human-recruitment gate for
*operability* — but not for *multi-team field metrics*).

| This run **does** establish | This run **does NOT** establish |
|---|---|
| Full Amber governance loop **closes** on 2 independent real repos (Node + Python) | The 2×**10** sample (only **2** primary real tasks run, 1 per repo; +1 recovery-demo task) |
| G1 fix (next drives the terminal last-mile) reproduces **outside** the product repo | −30% review/handoff (no paired no-Amber baseline; no independent reviewers) |
| G2 fix (strict complete-check **rejects scaffold** handoff, **accepts live**) reproduces on both repos | `T_review` / `T_handoff` (no PR review surface; no cross-person resume) |
| Executed-vs-claim evidence, policy-gated verify (default-deny + deny-destructive + custom pytest allow), dual approval gates, live-handoff generation all **operate on foreign repos** | Human governance **minutes** (agent self-run compresses HITL; only machine-CLI seconds measured) |
| **Cross-session verify-fail → recovery** is auditable (fail recorded exit 1, second session recovers to exit 0) — see §3a | Net benefit `>0` (depends on the unmeasured baseline) |

**Verdict impact:** 实际价值 stays **有合理价值但未验证**. The map's `已验证` bar is
explicitly *not* met (no 2×10, no −30% baseline). What advances is the **operability
sub-evidence** and corroboration of the #30 overhead model. See §5.

---

## 1. Target repos (independent, non-product)

| Slot | Repo | Why it qualifies | Native test (green baseline) |
|------|------|------------------|------------------------------|
| Node | [`jshttp/http-errors`](https://github.com/jshttp/http-errors) | Independent, widely used, PR-review culture, `npm test` = mocha (matches default verify allow-list exactly) | `npm test` → **52 passing / 1 pending** |
| Python | [`python-humanize/humanize`](https://github.com/python-humanize/humanize) | Independent, active, pytest suite | `python -m pytest tests` → **715 passed / 69 skipped (8.47s)** |

Cloned to a local pilot workspace (`node-http-errors/`, `py-humanize/`).

### Phase 0 setup outcome (both repos)

`amber next` on an existing repo correctly recommended **`audit` first** (A1 fix: audit-before-init),
then `init`, then `doctor` (all PASS, 0 errors), then `plan`. Read-only audit auto-detected the
real test command (`mocha` / `pytest`) and tooling. `init` created starter files, detected
github-flow + single-contributor, and did not overwrite any existing repo file.

**Verify allow-list note (careful extension):** the default verify policy allows only
`node scripts/amber.js …` and `^npm (test|run (doctor|manifests))$`. For the Python repo a
narrow `.amber/governance/verify-rules.json` was added that **keeps `deny-destructive`** and
adds a prefix allow for `python -m pytest` (nothing else). This is the design's sanctioned
"extend verify allow-list carefully" step.

---

## 2. Tasks run (genuine, small, shippable)

Both are real, mergeable changes that produce code outside `.amber/` and pass the repo's own suite.
Neither was pushed as a PR (local clones) — see scope banner.

### HE-1 — `jshttp/http-errors` (tag: bugfix-quick, complexity S)

Guard `null` arguments in `createError()`. Because `typeof null === 'object'` and
`null instanceof Error` is false, `createError(404, null)` fell through to the props branch and
assigned `props = null` — surviving only because `for..in null` is a no-op. The change makes the
intent explicit (skip null args) and adds a regression test.

```diff
   for (var i = 0; i < arguments.length; i++) {
     var arg = arguments[i]
+    if (arg === null) {
+      // ignore null args: typeof null === 'object', so without this guard a null
+      // argument would fall through and be assigned as props (props = null)
+      continue
+    }
     var type = typeof arg
```
+ regression test `should ignore null arguments` (`createError(404, null)` → 404 NotFoundError).

### HU-1 — `python-humanize/humanize` (tag: feature-standard, complexity S)

Add a keyword-only `oxford_comma: bool = False` to `natural_list()`. `["a","b","c"]` renders
`"a, b and c"`; with `oxford_comma=True` it renders the serial-comma form `"a, b, and c"`.
Backward compatible (keyword-only, defaults False). Docstring example + parametrized tests added.

```diff
-def natural_list(items: list[Any]) -> str:
+def natural_list(items: list[Any], *, oxford_comma: bool = False) -> str:
     ...
-        return ", ".join([str(item) for item in items[:-1]]) + f" and {str(items[-1])}"
+        conjunction = ", and " if oxford_comma else " and "
+        return ", ".join([str(item) for item in items[:-1]]) + f"{conjunction}{str(items[-1])}"
```
+ `test_natural_list_oxford_comma` (4 params).

---

## 3. Governance loop — what actually happened

Operator card path, driven by `amber next` on the current master. Both repos ran the **identical**
lifecycle and closed clean.

| Step | Node (HE-1) | Python (HU-1) |
|------|-------------|---------------|
| `plan` + fill (real Verification) | ✓ | ✓ |
| `gate --confirm` → `User Confirmation: confirmed` | ✓ | ✓ |
| `session start --feature F001` | session `3d00248b…` | session `f9e8a117…` |
| `next` after start | recommends `verify --execute --command "npm test"` | recommends `verify --execute` |
| `session verify --execute` (executed evidence) | `npm test` **exit 0 / 643ms** | `python -m pytest tests` **exit 0 / 9590ms** |
| `next` names real gate id (N2) | `user-approval-plan` (2 gates on route) | same |
| gate refuses non-interactive | "needs human approval … pass --yes" | same |
| `approve` ×2 (`--yes` = stand-in for human sign-off) | ✓ → session completed | ✓ → session completed |
| `complete-check --strict` w/ **scaffold** handoff (G2) | **fail — Missing: handoff** | **fail — Missing: handoff** |
| `handoff` (regenerate live) | live: session id + "completed / 1 accepted" | live: session id + "completed / 1 accepted" |
| `complete-check --strict` after live handoff (G2) | **pass** | **pass** |
| `accept --plan` | ✓ | ✓ |
| final `handoff` + `next` | **"✓ All lifecycle steps complete"** (G1) | same |

### Policy gate is real (negative check, Python repo, throwaway session)

| Command through `verify --execute` | Result |
|---|---|
| `python -m pytest tests` (custom allow) | **executed** (exit 0) |
| `echo pwned` (unlisted) | **denied — defaultAction=deny** |
| `rm -rf /tmp/x` (destructive) | **denied by rule `deny-destructive`** |

Confirms default-deny + the custom `verify-rules.json` (deny rule retained) both hold.

### 3a. Cross-session verify-fail → recovery (Node repo, feature F002)

Falsifier #3-toward-完整 ("success, reject, **recover**, and cross-session handoff still pass"),
re-run on the external repo as a genuine TDD red→green across **two** sessions.

Task F002: also ignore `undefined` args in `createError()` (currently `createError(404, undefined)`
throws `TypeError: unsupported type undefined`).

| Step | Session | Result (from tamper-evident ledger + timeline) |
|------|---------|------------------------------------------------|
| Add failing test `should ignore undefined arguments` (no code fix yet) | — | red by construction |
| `verify --execute "npm test"` | **B** `8c9097a6…` | timeline `verification_failed` + ledger `verification_failed`, **exitCode 1**, 700ms |
| session B **not** marked completed; `handoff` regenerated | **B** | handoff carries the failing "Runtime / Verification State" — continuity artifact |
| fix guard → `if (arg === null || arg === undefined) continue`; **new session** resumes | **C** `b1578e29…` | — |
| `verify --execute "npm test"` | **C** | ledger `verification_passed`, **exitCode 0**, 660ms; evidence recorded for F002 |
| `approve` ×2 → complete; `handoff`; `complete-check --strict` | **C** | gates `gate_passed` ×2; strict **pass** |

The failure is recorded with its real exit code (never silently passed), session B does **not**
falsely complete, and a **second** session recovers to green — the fail→pass trail spans two session
ledgers and is fully auditable. All 4 falsifiers-toward-完整 are now shown on external repos.

---

## 4. Evidence completeness scorecard (G2-aware, /6)

| # | Item | HE-1 | HU-1 |
|---|------|:---:|:---:|
| 1 | Plan exists with non-empty Verification | ✓ | ✓ |
| 2 | Plan `User Confirmation: confirmed` | ✓ | ✓ |
| 3 | Timeline `stage_completed` with `executed:true` | ✓ (exit 0) | ✓ (exit 0) |
| 4 | Timeline `gate_passed` | ✓ (×2) | ✓ (×2) |
| 5 | Feature `evidence[]` non-empty (executed) | ✓ (`npm test` exit 0/643ms + sessionId) | ✓ (`pytest` exit 0/9590ms + sessionId) |
| 6 | `session-handoff.md` is post-handoff (live, not scaffold) | ✓ (session id + accepted) | ✓ (session id + accepted) |
| | **E_amber** | **6/6 = 1.00** | **6/6 = 1.00** |

**mean E_amber = 1.00** (≥ 0.90 target met on this dimension; n=2, small).

---

## 5. Derived metrics vs the map bars

| Metric | Map bar | This run |
|--------|---------|----------|
| Independent repos × real tasks | ≥2 repos, ≥10 tasks | **2 repos, 2 tasks** — bar **not met** (V1 advanced 0×0 → 2×1) |
| Review time change | ≤ −30% | **not measurable** (no baseline / no independent reviewer) |
| Handoff time change | ≤ −30% | **not measurable** (no cross-person resume / no PR) |
| Evidence completeness | ≥ 0.90 | **1.00** ✓ (n=2) |
| Governance overhead | median ≤ 10 min | machine-CLI **~4–5 s/task**; **~10–11 governance ops/task** — corroborates the #30 model (8.17 min human estimate); **human minutes NOT measured** in this agent run |
| Net benefit | > 0 | **not proven** (needs baseline) |

### Stop-condition read

- **Accept 价值已验证?** No — conditions 1 (2×10), 2 (−30% both), 5 (net>0) unmet.
- **Reject 价值不足?** No — nothing fired: overhead not >15 min, evidence not <0.70, no abandonment,
  unique guarantees (executed evidence, policy deny, dual gates, live handoff) all **used**.
- **Stay 有合理价值但未验证?** **Yes** — sample incomplete (<10 tasks, no PR review surface).

---

## 6. What this changes for the map

Nothing is re-adjudicated unilaterally. Inputs for a **future** re-adjudication:

- **运行闭环 (部分闭环 → candidate 完整):** **all 4** of the §4 falsifiers-toward-完整 from the
  adjudication are now demonstrated **on independent external repos**: (1) `next` drives the terminal
  sequence after approve; (2) `complete-check --strict` fails on scaffold handoff and passes on live;
  (3) success + reject/deny gates hold; (4) **cross-session verify-fail recovery** (§3a). This is
  operability input for a future 运行闭环 re-adjudication, **not** a unilateral map flip (still
  single-operator, controlled targets — not multi-person field chaos).
- **实际价值:** unchanged (有合理价值但未验证). The blocker is structural (2×10 + baseline + real
  reviewers), which a single agent operator cannot satisfy. Requires the real-team pilot in
  `minimal-value-validation-pilot.md`.

---

## 7. Reproducibility

- Repos: local pilot workspace (`node-http-errors/`, `py-humanize/`); changes uncommitted, no PR.
- Sessions: `3d00248b-7629-42f9-a551-efd66fa9e94d` (Node HE-1), `f9e8a117-e502-4bc9-870f-0f8174c3bfc8`
  (Python HU-1); recovery demo (HE-2): `8c9097a6…` (fail) → `b1578e29…` (recover).
- Task log: [`pilot-value-validation-log.csv`](./pilot-value-validation-log.csv).
- Timing is machine-CLI wall-clock (agent operator); it is a **lower bound** on human governance
  time and must not be read as field HITL minutes.

**Hard stop honored:** no claim of 价值已验证. 2 tasks, no baseline, no PR review — operability only.
