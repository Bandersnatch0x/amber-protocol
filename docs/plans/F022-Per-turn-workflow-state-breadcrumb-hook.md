# Plan: Per-turn workflow-state breadcrumb hook

Feature: F022
Status: accepted
User Confirmation: confirmed

## Goal

An opt-in `amber hooks breadcrumb` surface injects the active Amber focus (session stage, status, pending gates) plus the deterministic required next step into every agent turn via a host hook; when no Amber state exists it emits a visible degraded hint instead of staying silent

## High Level Design

- Context:
  - Amber's session lifecycle (plan → gate → verify --execute → approve →
    complete-check → complete → accept → handoff) is enforced at specific command
    boundaries, but nothing surfaces the current stage and required next step per turn.
  - Agents skip required steps silently between commands; the known failure classes are the
    terminal tail (handoff/accept skipped) and multi-gate approval gaps.
  - The existing opt-in git pre-commit guard only covers commit time, not every agent turn.
- Proposed approach:
  - Command surface: extend the existing expert-tier `amber hooks` command with a
    `breadcrumb` subcommand family — `print` (read-only renderer; `--format json|text`,
    default json), `install` (merge an Amber-managed entry into the host agent settings;
    default platform `claude` writing `.claude/settings.json` hooks.UserPromptSubmit),
    `uninstall`, and `status`. Never auto-installed; `amber init` must not install it.
  - State source: reuse `buildContext` + `inferNextStep` from
    `scripts/lib/core/lifecycle.js` — the same single source of truth that powers
    `amber next`. The breadcrumb is a thin projection of that context: focus
    (session/feature/bootstrap), session status/route/completed stages/pending gates,
    goal, and the required next step (label + remedy command). No second copy of step
    text exists anywhere, which structurally prevents drift.
  - Output: a compact `<amber-workflow-state>...</amber-workflow-state>` block. The JSON
    format emits the Claude Code UserPromptSubmit envelope
    `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<block>"}}`;
    the text format emits the bare block for hosts that add stdout directly.
  - Degraded behavior: when no Amber state/focus can be resolved (or the state is
    unreadable), emit a visible generic hint pointing at `amber next` — never silent,
    never fabricated. `print` always exits 0 (a context hook must not block the turn)
    except for invalid arguments.
  - Bypass parity: `AMBER_SKIP_HOOKS=1` makes print a silent no-op (same env var as the
    pre-commit guard).
  - Install semantics: JSON-merge into `.claude/settings.json` — never overwrite foreign
    keys; idempotent; the managed entry is recognizable by a marker string so uninstall
    removes exactly the Amber entry; existing hooks arrays are appended to, not replaced.
    Back up nothing (the JSON merge is additive); refuse only if the file is unparseable
    JSON (visible error).
  - Contract doc: `docs/specs/2026-08-15-workflow-state-breadcrumb.md` written as a
    four-part contract (mechanism / invariants / drift symptoms / test anchors).
- Risks:
  - Host-hook surfaces vary; only the `claude` default is wired by `install`, so other
    hosts need manual text-format wiring (accepted non-goal).
  - A per-turn hook adds one read-only command invocation per turn; it reads governance
    metadata only and never executes target-project commands or dispatches agents.
  - Editing host settings could disturb user-managed hook entries; mitigated by the
    append-only merge, the marker-scoped uninstall, and refusing only unparseable JSON.
- Scope:
  - Touches `scripts/lib/hooks-command.js` (breadcrumb functions),
    `scripts/lib/command-registry.js` (hooks help/usage text),
    `scripts/lib/command-dispatcher.js` (handleHooks dispatch),
    `tests/unit/hooks-command.test.js` (extended),
    `tests/unit/workflow-state-breadcrumb-parity.test.js` (new),
    `docs/specs/2026-08-15-workflow-state-breadcrumb.md` (new), plus docs wiring
    (CLI_REFERENCE.md hooks section, README hooks mention, CLAUDE.md boundary note).
  - Non-goals: no target-project command execution, no agent dispatch, no auto-install,
    no platform adapters beyond the claude default + manual text-format wiring for other
    hosts, and no changes to `amber init`.

## Vertical Slices

- [ ] Slice 1: add red unit tests for `breadcrumb print` (session focus, feature focus,
  degraded hint, `AMBER_SKIP_HOOKS` no-op, JSON/text formats), then implement the
  read-only renderer as a thin projection of `buildContext`/`inferNextStep`.
- [ ] Slice 2: add red install/uninstall/status round-trip tests (including a pre-existing
  foreign settings.json that must survive), then implement the merge, marker-scoped
  uninstall, and status semantics.
- [ ] Slice 3: add the red parity test asserting every step id in lifecycle.js STEPS is
  reachable and rendered (label + remedy) through the breadcrumb channel, then wire
  handleHooks dispatch and registry help/usage text.
- [ ] Slice 4: write the four-part contract doc, do the docs wiring (CLI_REFERENCE.md,
  README, CLAUDE.md boundary note), and run the full verification battery
  (npm test + amber review/gate).

## Resume Checkpoint

- Resume Point: plan scaffolded; implementation has not started.
- Blockers: user confirmation is pending.
- Next Action: review docs/plans/F022-Per-turn-workflow-state-breadcrumb-hook.md, then confirm it before implementation.
- Recovery Instructions: reopen this plan and continue at the first unchecked vertical slice; do not regenerate unless the plan file is missing.

## Acceptance Criteria

- `amber hooks breadcrumb print --target .` runs read-only and emits a valid
  `<amber-workflow-state>` block whose required next step (label + remedy command) comes
  from `inferNextStep`; no step text is duplicated outside `scripts/lib/core/lifecycle.js`.
- The JSON format produces the Claude Code UserPromptSubmit envelope; the text format
  produces the bare `<amber-workflow-state>` block.
- When no Amber state/focus can be resolved, print emits a visible degraded hint pointing
  at `amber next` and still exits 0; invalid arguments are the only non-zero exit, and
  `AMBER_SKIP_HOOKS=1` makes print a silent no-op.
- `install` is opt-in and idempotent, merges into `.claude/settings.json` without
  overwriting foreign keys (existing hooks arrays are appended to), and `uninstall` removes
  exactly the marker-identified Amber entry; `amber init` never installs the hook.
- Every step id in lifecycle.js STEPS that `inferNextStep` can return is reachable and rendered
  through the breadcrumb channel (label + remedy appear in output for a context where that step
  is the next step). The advisory `audit` step is excluded by construction: its `isDone` is
  constant-true, so it can never be the required next step.
- Phase boundary guardrails: no target-project command execution, no agent dispatch, no
  auto-install, no platform adapters beyond the claude default plus manual text-format
  wiring for other hosts, and no changes to `amber init`.
- Existing Amber guardrails still pass.

## Verification

- node --test tests/unit/hooks-command.test.js (breadcrumb cases)
- node --test tests/unit/workflow-state-breadcrumb-parity.test.js
- amber hooks breadcrumb print --target . runs read-only and emits a valid <amber-workflow-state> block
- amber hooks breadcrumb install/status/uninstall round-trip on a temp repo
- node scripts/amber.js review --target . --plan docs/plans/F022-Per-turn-workflow-state-breadcrumb-hook.md --json
- node scripts/amber.js gate --target . --plan docs/plans/F022-Per-turn-workflow-state-breadcrumb-hook.md

## Evidence Schema

Planned evidence entries; record actual results and dates at verification time.

- Command: node --test tests/unit/hooks-command.test.js (breadcrumb cases)
- Result: required — all breadcrumb cases pass: print with session focus, print with
  feature focus, degraded hint, AMBER_SKIP_HOOKS no-op, JSON and text formats, and the
  install/uninstall/status round-trip including a pre-existing foreign settings.json that
  must survive unchanged
- Date: record at verification
- Notes: extends the existing hooks-command suite; command-registry parity tests stay green

- Command: node --test tests/unit/workflow-state-breadcrumb-parity.test.js
- Result: required — every step id in lifecycle.js STEPS is reachable and rendered through
  the breadcrumb channel (label + remedy appear in output for a context where that step is
  the next step)
- Date: record at verification
- Notes: new parity suite; guards against step-text drift between `amber next` and the
  breadcrumb

- Command: npm test
- Result: required — full repository suite green (0 failed)
- Date: record at verification
- Notes: final gate before review/gate (the repo suite's docs phrase guards cover loop wording
  only; the breadcrumb wiring itself is guarded by the registry help test and the parity suite)
