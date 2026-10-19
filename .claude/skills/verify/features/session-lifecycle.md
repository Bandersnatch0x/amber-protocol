# Run a session lifecycle

A session is the governed unit of work: it is started, given a plan, backed by recorded
verification, approved at its gates, and closed only once the completion check passes. This is
the feature that proves Amber's core claim — that work leaves inspectable, gate-checked
evidence.

## Sub-features

- `session-start` creates a session, writing a manifest and a timeline.
- `session-plan` writes a plan document for a feature.
- `session-verify-claim` records a self-reported verification claim (no command runs).
- `session-verify-execute` runs the command and records its real exit code, behind the policy gate.
- `session-approve` records a gate pass.
- `session-complete-check` reports which completion requirements are still missing.
- `session-complete` closes the session once the check passes.

## How to get to it (user POV)

- Run `amber session start --goal "…" [--feature <id>] --target <repo>` to begin.
- Run `amber plan --feature <id> --title "…" --target <repo>` to write the plan.
- Run `amber session verify --session <id> --command "…" --execute --target <repo>` to record evidence.
- Run `amber session approve --session <id> --gate <gate-id> --target <repo>` to pass a gate.
- Run `amber session complete-check --session <id> --target <repo>` to see what is missing.
- Run `amber session complete --session <id> --target <repo>` to close.

## Driving it with amber

Preconditions:

- A disposable target is `init`-ed (baseline).

- **Start.** Run
  `node scripts/amber.js session start --goal "verify probe" --target "$T" --yes --json`.
  The JSON carries a top-level `sessionId`; the text names a route (`feature-standard`) and the
  goal. Without `--yes` it exits `1` with `Executed: false`. Capture the id:
  `SID=$(node scripts/amber.js session start --goal "verify probe" --target "$T" --yes --json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).sessionId)')`
- **Confirm the session on disk.** Read `"$TMPD/.amber/sessions/$SID/manifest.json"` and
  `…/timeline.jsonl`, and list `…/gates/`. Two gate files appear
  (`user-approval-plan.gate.json`, `user-approval-implement.gate.json`) — the ids `--gate`
  expects. The `sessionId` on stdout alone is not proof.
- **Plan.** Run
  `node scripts/amber.js plan --feature F001 --title "Slice" --target "$T" --yes`.
  It reports `Created: 1` and `+ docs/plans/F001-Slice.md`. Confirm the file exists on disk.
- **Verification scaffolding.** `session verify --execute` reads
  `<target>/.amber/governance/verify-rules.json` and **defaults to deny** when it is absent. To
  exercise the allowed path, write a minimal allow rule first (this is verification scaffolding,
  not part of the product):

  ```bash
  mkdir -p "$TMPD/.amber/governance"
  printf '{ "schemaVersion": 1, "defaultAction": "deny", "rules": [ { "id": "allow-node", "action": "allow", "match": "prefix", "pattern": "node " } ] }' \
    > "$TMPD/.amber/governance/verify-rules.json"
  ```

- **Denied path (verify the gate works).** Before writing that rule, run
  `node scripts/amber.js session verify --session "$SID" --command 'node -e "process.exit(0)"' --execute --target "$T" --yes`.
  It exits `1` with `Verification command denied by policy: no allow rule matched; defaultAction=deny`.
- **Allowed path.** With the rule in place, re-run the same command. It exits `0` with
  `Verification recorded for session: …` and `Executed: node -e "process.exit(0)" (exit 0, …ms)`.
- **Approve.** Run
  `node scripts/amber.js session approve --session "$SID" --gate user-approval-plan --target "$T" --yes`.
  It reports `Gate: user-approval-plan` and lists remaining pending gates. A `gate_passed` event
  lands in `timeline.jsonl`.
- **Check.** Run `node scripts/amber.js session complete-check --session "$SID" --target "$T"`.
  Early on it reads `status: fail` and `Missing: verification, approval, handoff`.
- **Close the gaps.** Record feature evidence
  (`amber feature verify --feature F001 --command "node -e 0" --result "exit 0" --target "$T" --yes`)
  and regenerate the handoff (`amber handoff --target "$T"`). Re-run `complete-check`: it now
  reads `status: pass` with all seven reasons satisfied.
- **Complete.** Run `node scripts/amber.js session complete --session "$SID" --target "$T" --yes`.
  It reports `Session completed: <id>` and may nominate a memory write-back. Confirm with
  `amber session status --session "$SID" --target "$T"` → `Status: completed`.

## Gotchas

- Every governed write here is a **typed mutation** and needs `--yes` (or `--confirm`):
  `session start`, `session verify`, `session approve`, `session complete`. Missing it exits `1`
  with `Executed: false` — never treat the text as success.
- `session verify --execute` is gated by **`<target>/.amber/governance/verify-rules.json`**
  (the *verification* policy), not the governed-execution `governance/rules.json`. Default is
  deny. A built-in destructive-command deny cannot be removed by any rule.
- Without `--execute`, `session verify` records a self-reported claim (`executed: false`). A
  strict `complete-check --strict` requires a command that actually ran.
- `complete-check` needs six things: goal, timeline, verification, approval, work, and handoff.
  The **handoff** check needs a non-scaffold `session-handoff.md`, whose verification section
  comes from `feature_list.json` evidence (`amber feature verify`) — not from the session
  timeline. Running only `session verify` leaves the handoff looking empty.
- On a route that contains a `verb` stage, `session verify` is refused; advance through
  `session run` / `session settle` instead.
- The disposable target is not a git repo, so "work present" passes via the non-git path. On a
  git target, the tree must be dirty or carry a commit newer than the session's `createdAt`.
