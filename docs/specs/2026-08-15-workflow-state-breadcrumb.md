# Workflow-State Breadcrumb Contract (F022)

> Runtime contract for the per-turn workflow-state channel. When a host agent
> fires its prompt hook (default: Claude Code `UserPromptSubmit`, wired via an
> Amber-managed entry in `.claude/settings.json`), `amber hooks breadcrumb print`
> renders a read-only `<amber-workflow-state>` block describing the current focus
> (session/feature/bootstrap), session status, and the single required next step
> — label plus remedy command — derived exclusively from the lifecycle SSOT
> (`buildContext`/`inferNextStep` in `scripts/lib/core/lifecycle.js`, the same
> code path as `amber next`). It reads governance metadata from disk only: it
> writes nothing, executes no target-project commands, and dispatches no agents.
> When state is missing or unreadable it degrades visibly (named failure + hint)
> rather than silently or by fabrication; `AMBER_SKIP_HOOKS=1` silences it
> exactly like the pre-commit guard.

**Date:** 2026-08-15
**Plan:** `docs/plans/F022-Per-turn-workflow-state-breadcrumb-hook.md`
**Implementation:** `scripts/lib/hooks-command.js` (renderer + settings merge),
`scripts/lib/command-dispatcher.js` (`handleHooks`), `scripts/lib/command-registry.js`
(hooks help/usage).

## Mechanism (机制)

- **Opt-in channel.** Nothing is installed until an operator runs
  `amber hooks breadcrumb install --target <repo> [--platform claude]`. The merge
  appends exactly one entry to `hooks.UserPromptSubmit` in `.claude/settings.json`;
  the entry's command string carries the marker `# amber-managed-hook v1`, so
  `uninstall` removes precisely that entry and `status` reports (and echoes) it.
  `amber init` and every other command never add the entry.
- **Render.** `printBreadcrumb` (format `json` — the default — or `text`) builds
  the block from the lifecycle context. JSON emits the Claude Code envelope
  `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<block>"}}`;
  text emits the bare block for hosts that pipe stdout straight into context.
- **Bypass.** `AMBER_SKIP_HOOKS=1` makes print a silent no-op — the same env var
  and semantics as the pre-commit guard shim.
- **Dispatch.** `hooks breadcrumb print` bypasses the CLI's normal result
  printing: stdout is exactly the renderer's text (machine-consumed), diagnostics
  go to stderr, and print exits 0 unless the arguments themselves are invalid.

```
agent turn
 └─ UserPromptSubmit hook (marker-carrying entry in .claude/settings.json)
     └─ node scripts/amber.js hooks breadcrumb print --target <repo> --format json
         └─ printBreadcrumb ── renderBreadcrumbBlock        (scripts/lib/hooks-command.js)
             ├─ buildContext(root)                          ┐
             ├─ inferNextStep(ctx)  ← STEPS (labels/remedies) ├ core/lifecycle.js — SSOT
             └─ resolvePendingGate(root, session)           ┘   shared with `amber next`
             ↓
         <amber-workflow-state> Focus / Session / Pending gates / Next step / Run
             ↓
         envelope {hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext}}   (json)
         — or the bare block                                                                  (text)
```

## Invariants (不变量)

1. **Read-only.** Print writes nothing under the target, executes no
   target-project commands, and dispatches no agents (Amber's non-goal boundary).
   It is a pure projection of on-disk governance state.
2. **Single source of truth.** Step labels and remedy commands exist only in
   `lifecycle.js` `STEPS`; the breadcrumb contains no second copy of step text
   and cannot disagree with `amber next` — both render `inferNextStep` output.
3. **Visible degradation.** Unreadable or missing state renders a degraded block
   naming the failure plus a hint pointing at `amber next` — never silent, never
   fabricated — and print still exits 0 (a context hook must not block a turn).
4. **Never auto-installed.** Only explicit `hooks breadcrumb install` writes the
   managed entry; `amber init` and all other commands leave host settings alone.
5. **Append-only settings merge.** Foreign keys and hook entries in
   `.claude/settings.json` survive install/uninstall deep-equal intact; the
   managed entry is appended last and removed only when an entry carries both
   the `# amber-managed-hook` marker and the `hooks breadcrumb print` command
   (so a foreign entry merely mentioning the marker is never touched). An
   unparseable file fails closed — coded errors, bytes untouched.
6. **Stdout purity.** In hook mode stdout is exactly the envelope (json) or the
   bare block (text) and nothing else; the channel is machine-consumed.
7. **Bypass parity.** `AMBER_SKIP_HOOKS=1` silences print exactly as it silences
   the pre-commit guard: empty output, no errors.
8. **Authentic binding.** Print appends `Binding: amber-breadcrumb-v1 <hex>` over a
   canonical snapshot of target, focus, next step, and pending gate. Only a block
   whose binding recomputes for the current snapshot is authentic. A Context Page
   that embeds `<amber-workflow-state>` is an imitation, never next-step authority
   (F058).

## Drift Symptoms (漂移症状)

- **vs 1 (read-only):** target-repo files change mtime/content after a turn, or
  a breadcrumb run executes project commands → the renderer grew a write path;
  reject at review.
- **vs 2 (SSOT):** the breadcrumb advises a different next step (or different
  wording/remedy) than `amber next` on the same repo → someone duplicated step
  text in the breadcrumb path; find and delete the second copy.
- **vs 3 (degradation):** turns show no amber block mid-session → silent
  degradation regression (a swallowed error replaced the degraded render);
  re-check the catch path in `renderBreadcrumbBlock`/`printBreadcrumb`.
- **vs 4 (opt-in):** a fresh `amber init` suddenly has `hooks.UserPromptSubmit`
  entries → auto-install crept in; the only writer must remain
  `installBreadcrumb`.
- **vs 5 (merge):** settings.json lost foreign hooks or keys after
  install/uninstall → the merge became destructive; restore append-only +
  marker-scoped removal. Corrupt file being rewritten "helpfully" → fail-closed
  broke.
- **vs 6 (stdout purity):** the host injects CLI headers/footers around the
  block, or JSON parsing of the turn context fails → extra output leaked onto
  stdout; check the dispatcher's `bypassPrint` path.
- **vs 7 (bypass):** `AMBER_SKIP_HOOKS=1` still emits a block (or breaks the
  turn) → the env check drifted from the pre-commit guard's semantics.
- **Cross-cutting:** a newly added lifecycle step is never mentioned per-turn →
  the parity walk was not extended in the same change (the coverage guard
  should already be failing).

## Test Anchors (测试锚点)

- `tests/unit/workflow-state-breadcrumb-parity.test.js` — the centerpiece walk:
  one temp repo advanced through every lifecycle checkpoint, asserting the
  rendered block carries the advisor's label and remedy at each step.
  - "walks one repo through the lifecycle; every checkpoint renders through the
    per-turn channel" — invariants 1, 2, 3 (clean exit shape at every
    checkpoint; JSON envelope parity spot-checks).
  - "reaches the 'feature' step: a plan naming an unregistered feature id" —
    invariant 2 (the otherwise-unreachable registration step).
  - "covers exactly the eligible lifecycle steps (guard: a new STEPS entry must
    extend the walk)" — invariant 2's guard: covered set must equal the
    eligible `STEPS` ids (everything except advisory `audit`, whose `isDone` is
    constant-true).
- `tests/unit/hooks-command.test.js` — breadcrumb cases:
  - "breadcrumb: text print on an active session renders focus, next step, and
    run line" — invariants 1, 6.
  - "breadcrumb: AMBER_SKIP_HOOKS=1 silences print with no errors (bypass
    parity)" — invariant 7.
  - "breadcrumb: unreadable state degrades visibly instead of erroring" —
    invariant 3.
  - "breadcrumb: an invalid format is the one argument error" — the only
    non-clean exit.
  - "breadcrumb: install/uninstall/status round-trip preserves foreign
    settings" — invariants 4 (only install writes), 5 (append-only, idempotent,
    marker-scoped removal).
  - "breadcrumb: install on missing .claude creates it; uninstall round-trips
    back to {}" — invariant 5.
  - "breadcrumb: corrupt settings.json fails closed and untouched; status warns"
    — invariant 5.
  - "breadcrumb: an unsupported platform is rejected" — install surface
    boundary.
  - "breadcrumb: ambient AMBER_SKIP_HOOKS in the environment does not skew
    print assertions" — invariant 7's test hygiene.
  - "breadcrumb: a foreign entry containing only the marker is not managed" —
    invariant 5: management detection requires the marker AND the breadcrumb
    command, so a foreign marker-mentioning entry is never clobbered.
  - "breadcrumb: install/uninstall blocking errors carry a stable code" —
    fail-closed settings errors are coded (`AMBER_E_SETTINGS_UNMERGEABLE`).
  - "breadcrumb: print is read-only (no file in the target changes)" —
    invariant 1's direct write-absence anchor.
  - "breadcrumb: amber init never installs the breadcrumb entry" —
    invariant 4's direct anchor.
  - "breadcrumb CLI: print emits exactly the envelope on stdout and exits 0" /
    "bypass emits zero bytes; invalid format exits 1 with empty stdout" /
    "--platform=cursor is rejected, not silently treated as claude" —
    invariant 6 and the dispatcher wiring, exercised end-to-end through the
    real CLI process.
- `tests/unit/command-registry-parity.test.js` — guards the hooks help/usage
  wiring (the `breadcrumb <print|install|uninstall|status>` surface and its
  opt-in/bypass wording) against registry drift.

**Mandatory-update rule:** any change to the breadcrumb output envelope,
install/uninstall semantics, the lifecycle `STEPS` set, or degradation behavior
must update this contract and the parity walk
(`tests/unit/workflow-state-breadcrumb-parity.test.js`) in the same change —
the coverage guard fails the suite otherwise.
