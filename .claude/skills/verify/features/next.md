# Read the next step

`next` answers "what should happen now?" by reading the target's governance state and naming a
single focused next step, the reason, and a runnable remedy. The same read powers the per-turn
`<amber-workflow-state>` breadcrumb an agent sees each turn.

## Sub-features

- `next-focus` auto-selects the feature in focus and reports how many others are pending.
- `next-step` names the next lifecycle step, why, and the exact command to run.
- `next-objective` folds a stated objective into the route suggestion.
- `next-json` emits the focus, next step, and governance actions as JSON.
- `next-breadcrumb` renders the per-turn `<amber-workflow-state>` block read-only.

## How to get to it (user POV)

- Run `amber next --target <repo>` for the human-readable next step.
- Add `--objective "…"` to fold in what you are trying to do.
- Add `--json` for the machine-readable form.
- Run `amber hooks breadcrumb print --target <repo>` to see what the per-turn hook injects.

## Driving it with amber

Preconditions:

- A disposable target is `init`-ed (baseline) so a feature exists but has no plan.

- **Read the next step.** Run `node scripts/amber.js next --target "$T"`.
  Output names `Context: feature F001 (auto-selected)`, `Next step: Create a plan`,
  a `Why:` line, and a `Run:` command invoking `amber plan`. Exit code `0`.
- **Fold in an objective.** Run
  `node scripts/amber.js next --objective "add a status endpoint" --target "$T"`.
  The `Route suggestion:` line reflects the objective; an unmatched objective says no route
  matched and suggests running the plan gate first.
- **Machine-readable view.** Run `node scripts/amber.js next --target "$T" --json`.
  A JSON object with `focus` (`type`, `id`, `autoSelected`, `othersPending`), `nextStep`
  (`id`, `label`, `why`, `remedy`), and `governanceActions`.
- **Breadcrumb.** Run `node scripts/amber.js hooks breadcrumb print --target .`.
  A JSON envelope whose `hookSpecificOutput.additionalContext` holds an
  `<amber-workflow-state>` block with `Focus:`, `Next step:`, and `Binding:` lines.
- **Step advances.** Run `node scripts/amber.js plan --feature F001 --title "Slice" --target "$T" --yes`,
  then `node scripts/amber.js next --target "$T"` again. The named next step moves past
  "Create a plan".

## Gotchas

- `next` is read-only; it reports a remedy but never runs it.
- The focus is **auto-selected** — `next` may pick a feature other than the one you had in mind.
  Read `focus.id` rather than assuming.
- The breadcrumb hook is **opt-in**; `amber init` does not install it. `breadcrumb print` only
  reads governance metadata and never runs project commands.
- `next` and the breadcrumb are two views of the same read — do not treat them as separate
  sources of truth.
