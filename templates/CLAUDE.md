# Claude Working Rules

Use the same repository-local Harness as `AGENTS.md`.

Start every session by reading:

1. `PROGRESS.md`
2. `session-handoff.md`
3. `feature_list.json`
4. `docs/wiki/index.md`
5. `docs/wiki/engineering/verification.md`
6. `.workflow/continuous-improvement/state.json` when continuing a goal or automation wake

V1 scope is limited to safe init, audit, wiki, doctor, and handoff workflows. Do not execute dynamic workflows, dispatch subagents, orchestrate worktrees, or automatically rewrite old project documents.

Use `docs/wiki/agent/continuous-improvement.md` for recurring health passes, automation wakeups, or ongoing improvement goals. Use `docs/wiki/agent/workflow-packets.md` when research, synthesis, writing, and review should be separated.

Completion requires verification evidence in `feature_list.json` plus a clear next action in `PROGRESS.md` and `session-handoff.md`.

## Approval boundary (do not self-approve)

`amber session approve` records human sign-off on a `user-approval` gate. You are
the agent, not the user:

- Do **not** run `amber session approve` on the user's behalf.
- Do **not** pass `--yes` to `amber session approve`.
- When a gate needs approval, stop and ask the user to approve it themselves.

Consider adding `amber session approve` to your Claude Code deny list so the
approval always routes to a human.
