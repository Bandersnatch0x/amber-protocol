# sample Adoption Walkthrough

Target project: `D:\code_space\trae-project\sample`

Date: 2026-06-09

## Purpose

Use a real existing project to verify that Coding Harness adoption stays conservative:

- audit is read-only
- init can be previewed before writing
- team distribution writes only `.harness/team/`
- doctor correctly classifies a non-Harness target
- maintenance inspection can run without requiring full init

## Commands Run

```sh
node scripts/harness.js audit --target "D:\code_space\trae-project\sample" --json
node scripts/harness.js audit --target "D:\code_space\trae-project\sample" --summary
node scripts/harness.js adoption report --target "D:\code_space\trae-project\sample" --output docs/examples/sample-adoption-report.md --json
node scripts/harness.js adoption report --target "D:\code_space\trae-project\sample" --output-dir docs/examples --json
node scripts/harness.js init --target "D:\code_space\trae-project\sample" --dry-run --json
node scripts/harness.js team inspect --target "D:\code_space\trae-project\sample" --json
node scripts/harness.js team install --target "D:\code_space\trae-project\sample" --version 1.0.0 --preset safe-bootstrap --json
node scripts/harness.js team update --target "D:\code_space\trae-project\sample" --version 1.1.0 --dry-run --json
node scripts/harness.js doctor --target "D:\code_space\trae-project\sample" --json
node scripts/harness.js maintenance inspect --target "D:\code_space\trae-project\sample" --json
```

## Observed Result

- Target path exists.
- `audit` exited successfully and stayed read-only.
- `audit` found no existing minimum Harness files.
- `audit` detected Python tooling evidence from `pyproject.toml` and `requirements.txt`.
- `audit` did not promote a verification command into confirmed `commands`.
- `audit` suggested `python -m pytest` under `candidateCommands` because Python tooling and a `tests/` directory were present.
- `audit` kept an unknown noting that candidate verification commands require confirmation.
- `audit` filtered dependency and generated-output markdown from `env/`, `env_new/`, `.venv/`, `results/`, and `data/reports/`.
- After filtering, no ignored-path markdown leaked into `docs`.
- `audit --summary` produced an 18-line bounded text report for sample while preserving counts, `python -m pytest`, unknowns, and the next safe command.
- `adoption report` generated `docs/examples/sample-adoption-report.md` with audit, init dry-run, team distribution, and maintenance sections.
- `adoption report --output-dir` generated a non-conflicting timestamped filename and left the sample root uninitialized.
- `init --dry-run` previewed 30 files and wrote none.
- `team inspect` reported the local registry with versions `1.0.0` and `1.1.0`.
- `team install` wrote only:
  - `.harness/team/lock.json`
  - `.harness/team/snapshots/1.0.0.json`
- `team update --dry-run` previewed `1.0.0 -> 1.1.0` with `willWrite=false`.
- `doctor` exited non-zero, classified the target as `unharnessed-target-repo`, and reported missing Harness files.
- `maintenance inspect` exited successfully, saw no stale Harness Wiki docs, no rule-pack drift, and upgrade guidance from `1.0.0` to `1.1.0`.

## Adoption Recommendation

sample should not receive a full Harness init automatically. It already has substantial documentation and project-specific rules, so the safe path is:

1. Keep `.harness/team/` metadata as the lightweight team-distribution marker.
2. Review the `init --dry-run` file list manually.
3. Add `AGENTS.md`, `CLAUDE.md`, `feature_list.json`, and selected `docs/wiki/` pages only after a human decides how to reconcile them with the existing documentation set.
4. Confirm whether `python -m pytest` is the right verification command before promoting it into project docs or Harness state.

## Boundary Confirmation

This trial did not overwrite any existing sample project files. The only intentional write was the V5 team metadata under `.harness/team/`.
