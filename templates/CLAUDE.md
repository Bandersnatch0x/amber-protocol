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
