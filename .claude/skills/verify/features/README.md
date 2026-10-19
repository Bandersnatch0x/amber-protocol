# Amber Protocol verification map

This directory is the maintained source for verifying the user-facing behavior of the
`amber` CLI (and, where noted, the Web Viewer). Read this index before driving, then use the
matching feature file as the recipe.

The CLI is a **short-lived process**: every command runs to completion and exits. There is no
server to keep alive, no port, and no seed data for the primary surface.

## Baseline preconditions

- Run from the repo root with `node scripts/amber.js` (or a globally installed `amber`).
- Drive a **disposable target repo**, one per run, so verification never writes into this
  repository's own `.amber/` state:

  ```bash
  TMPD="$(mktemp -d)"; T="$(cygpath -w "$TMPD")"   # Git Bash on Windows
  node scripts/amber.js init --target "$T"
  ```

- Start from a freshly `init`-ed target unless a recipe says otherwise.
- A disposable target is not a git repo, so completion's "work present" check passes via the
  non-git path. When driving a git target instead, the tree must be dirty or carry a commit
  newer than the session's `createdAt`.
- Run `node scripts/amber.js doctor --target "$T"` and require `Errors: 0` before driving.
- Never drive a Web Viewer instance this run did not start.

## Driving conventions

- Treat every command as literal. Keep quoted goals, feature ids, and flags unchanged.
- Every governed write is a **typed mutation** and needs `--yes` (or `--confirm`); without it
  the command prints `Executed: false` and exits `1`.
- Prefer `--json` for assertions; the human text is for reading.
- Read the files a command wrote back from the target — do not hand-write governance files to
  make a check pass.
- Restore any fixture state you mutate. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final line.
- CLI proof includes the command, stdout, stderr, and exit code.
- Mutation proof includes a read-only second view of the stored value (read the file back).
- Record the feature id and the entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.
- Proof artifacts live in `.amber/tmp/verify/<run-id>/` and survive teardown.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible
behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short ids with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with amber` starts with `Preconditions:` and uses labeled bullets that pair
   each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required
state, commands, and observable proof.

## Features

- [Audit a repository](./audit.md) covers the read-only diagnosis of a target repo.
- [Adopt and check health](./init-doctor.md) covers `init` scaffolding and `doctor` checks.
- [Read the next step](./next.md) covers `next` guidance and the per-turn breadcrumb hook.
- [Run a session lifecycle](./session-lifecycle.md) covers start, plan, verify, approve,
  complete-check, and complete.
- [Generate a handoff](./handoff.md) covers the live handoff document and the bundle.
